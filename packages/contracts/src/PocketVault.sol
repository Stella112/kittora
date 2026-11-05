// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SigAuth} from "./SigAuth.sol";
import {IAavePool, IGroupKittyHooks} from "./interfaces/IKittora.sol";

/// @title PocketVault
/// @notice Personal USDT pockets (Flex, Target, SafeLock), NIM SafeLock commitment bonds and Autosave mandates.
/// All USDT is supplied to Aave V3. Each pocket holds internal shares over the vault's aUSDT position
/// (ERC-4626-style, virtual offset against inflation), so yield accrues pro rata. Yield is variable.
/// No admin, no upgrade, no early-exit for SafeLock. Pilot caps are constants.
contract PocketVault is SigAuth, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Kind {
        Flex,
        Target,
        SafeLock,
        Bond
    }

    enum BondStatus {
        None,
        Active,
        Claimed,
        Forfeited
    }

    struct Pocket {
        address owner;
        Kind kind;
        uint64 unlockAt;
        uint256 target;
        uint256 shares;
    }

    struct Bond {
        uint256 pocketId;
        address owner;
        bytes20 nimiqAddress;
        uint64 unlockAt;
        uint64 nimLuna;
        uint256 groupId;
        bytes32 linkHash;
        BondStatus status;
    }

    struct Mandate {
        address owner;
        uint256 amountPerRun;
        uint64 interval;
        uint32 maxRuns;
        uint32 runs;
        uint64 expiry;
        uint64 lastRun;
        bool toGroup;
        bool revoked;
        uint256 destId;
    }

    struct OpenPocketReq {
        address owner;
        Kind kind;
        uint64 unlockAt;
        uint256 target;
        uint256 amount;
        uint256 nonce;
        uint256 deadline;
    }

    struct MandateReq {
        address owner;
        uint256 amountPerRun;
        uint64 interval;
        uint32 maxRuns;
        uint64 expiry;
        bool toGroup;
        uint256 destId;
        uint256 nonce;
        uint256 deadline;
    }

    struct BondReq {
        address owner;
        uint256 amount;
        uint64 unlockAt;
        bytes20 nimiqAddress;
        uint64 nimLuna;
        uint256 groupId;
        bytes32 linkHash;
        uint256 nonce;
        uint256 deadline;
    }

    // ---- Pilot caps (Maris, Nov 5 2026). Immutable by design: no admin can change them. ----
    uint256 public constant MAX_DEPOSIT = 25e6; // 25 USDT per deposit
    uint256 public constant MAX_USER_PRINCIPAL = 100e6; // 100 USDT per user across pockets
    uint256 private constant OFFSET = 1e6; // virtual shares (10**6) against donation/inflation attacks

    bytes32 public constant OPEN_TYPEHASH = keccak256(
        "OpenPocket(address owner,uint8 kind,uint64 unlockAt,uint256 target,uint256 amount,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant DEPOSIT_TYPEHASH =
        keccak256("Deposit(address owner,uint256 pocketId,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant WITHDRAW_TYPEHASH = keccak256(
        "Withdraw(address owner,uint256 pocketId,uint256 amount,address to,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant MANDATE_TYPEHASH = keccak256(
        "CreateMandate(address owner,uint256 amountPerRun,uint64 interval,uint32 maxRuns,uint64 expiry,bool toGroup,uint256 destId,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant REVOKE_TYPEHASH =
        keccak256("RevokeMandate(address owner,uint256 mandateId,uint256 nonce,uint256 deadline)");
    bytes32 public constant BOND_TYPEHASH = keccak256(
        "LockBond(address owner,uint256 amount,uint64 unlockAt,bytes20 nimiqAddress,uint64 nimLuna,uint256 groupId,bytes32 linkHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("ClaimBond(address owner,uint256 bondId,uint256 nonce,uint256 deadline)");

    IERC20 public immutable asset;
    IERC20 public immutable aToken;
    IAavePool public immutable pool;
    address public immutable attester;
    address public immutable burnAddress;
    /// @notice Window after a bond's unlockAt in which the attester may still forfeit (watcher latency). Claims open after it.
    uint64 public immutable claimDelay;
    address private immutable deployer;

    /// @notice Set exactly once, right after deployment, by the deployer. Cannot be changed afterwards.
    address public groupKitty;

    uint256 public totalShares;
    uint256 public pocketCount;
    uint256 public bondCount;
    uint256 public mandateCount;
    mapping(uint256 => Pocket) public pockets;
    mapping(uint256 => Bond) public bonds;
    mapping(uint256 => Mandate) public mandates;
    mapping(address => uint256) public principalOf;

    event GroupKittySet(address groupKitty);
    event PocketOpened(uint256 indexed pocketId, address indexed owner, Kind kind, uint64 unlockAt, uint256 target);
    event Deposited(uint256 indexed pocketId, address indexed owner, address from, uint256 amount, uint256 shares);
    event Withdrawn(uint256 indexed pocketId, address indexed owner, address to, uint256 amount, uint256 shares);
    event MandateCreated(
        uint256 indexed mandateId,
        address indexed owner,
        uint256 amountPerRun,
        uint64 interval,
        uint32 maxRuns,
        uint64 expiry,
        bool toGroup,
        uint256 destId
    );
    event MandateExecuted(uint256 indexed mandateId, uint32 run, uint256 amount);
    event MandateRevoked(uint256 indexed mandateId);
    event BondLocked(
        uint256 indexed bondId,
        address indexed owner,
        uint256 pocketId,
        bytes20 nimiqAddress,
        uint64 nimLuna,
        uint64 unlockAt,
        uint256 groupId,
        bytes32 linkHash,
        uint256 amount
    );
    event BondClaimed(uint256 indexed bondId, uint256 amount);
    event BondForfeited(uint256 indexed bondId, bytes32 nimiqTxHash, address recipient, uint256 groupId, uint256 amount);

    error ZeroAmount();
    error CapExceeded();
    error NotOwner();
    error WrongKind();
    error Locked(uint64 unlockAt);
    error Insufficient();
    error BadParams();
    error NotGroupKitty();
    error NotAttester();
    error AlreadySet();
    error MandateInactive();
    error TooEarly();
    error InsufficientAllowance();
    error BondInactive();
    error ForfeitWindowClosed();
    error ClaimNotOpen();
    error NotMember();

    constructor(
        IERC20 _asset,
        IERC20 _aToken,
        IAavePool _pool,
        address _attester,
        address _burnAddress,
        uint64 _claimDelay
    ) SigAuth("Kittora PocketVault", "1") {
        if (
            address(_asset) == address(0) || address(_aToken) == address(0) || address(_pool) == address(0)
                || _attester == address(0) || _burnAddress == address(0)
        ) revert BadParams();
        asset = _asset;
        aToken = _aToken;
        pool = _pool;
        attester = _attester;
        burnAddress = _burnAddress;
        claimDelay = _claimDelay;
        deployer = msg.sender;
    }

    /// @notice One-shot wiring to break the deploy-order cycle. Callable once, by the deployer only.
    function setGroupKitty(address gk) external {
        if (msg.sender != deployer) revert NotOwner();
        if (groupKitty != address(0)) revert AlreadySet();
        if (gk == address(0)) revert BadParams();
        groupKitty = gk;
        emit GroupKittySet(gk);
    }

    // ------------------------------------------------------------------ views

    function totalAssets() public view returns (uint256) {
        return aToken.balanceOf(address(this));
    }

    function pocketAssets(uint256 pocketId) public view returns (uint256) {
        return _toAssets(pockets[pocketId].shares, totalAssets());
    }

    function _toAssets(uint256 shares, uint256 assets) internal view returns (uint256) {
        return Math.mulDiv(shares, assets + 1, totalShares + OFFSET);
    }

    // ------------------------------------------------------------------ pockets

    function openPocket(OpenPocketReq calldata r, bytes calldata sig) external nonReentrant returns (uint256 id) {
        _auth(
            r.owner,
            keccak256(abi.encode(OPEN_TYPEHASH, r.owner, r.kind, r.unlockAt, r.target, r.amount, r.nonce, r.deadline)),
            r.nonce,
            r.deadline,
            sig
        );
        if (r.kind == Kind.Bond) revert WrongKind();
        if (r.kind == Kind.SafeLock && r.unlockAt <= block.timestamp) revert BadParams();
        if (r.kind != Kind.SafeLock && r.unlockAt != 0) revert BadParams();
        if (r.kind == Kind.Target && r.target == 0) revert BadParams();
        id = _newPocket(r.owner, r.kind, r.unlockAt, r.target);
        if (r.amount > 0) _deposit(id, r.owner, r.amount);
    }

    function deposit(address owner, uint256 pocketId, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        _auth(
            owner, keccak256(abi.encode(DEPOSIT_TYPEHASH, owner, pocketId, amount, nonce, deadline)), nonce, deadline, sig
        );
        _requireUserPocket(pocketId, owner);
        _deposit(pocketId, owner, amount);
    }

    /// @param amount USDT to withdraw; type(uint256).max withdraws the whole pocket.
    function withdraw(
        address owner,
        uint256 pocketId,
        uint256 amount,
        address to,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant returns (uint256) {
        _auth(
            owner,
            keccak256(abi.encode(WITHDRAW_TYPEHASH, owner, pocketId, amount, to, nonce, deadline)),
            nonce,
            deadline,
            sig
        );
        Pocket storage p = _requireUserPocket(pocketId, owner);
        if (p.kind == Kind.SafeLock && block.timestamp < p.unlockAt) revert Locked(p.unlockAt);
        if (to == address(0)) revert BadParams();
        return _withdraw(pocketId, amount, to);
    }

    /// @notice Share-Out roll-over: GroupKitty deposits a member's payout into one of their pockets.
    function depositFor(address owner, uint256 pocketId, uint256 amount) external nonReentrant {
        if (msg.sender != groupKitty) revert NotGroupKitty();
        _requireUserPocket(pocketId, owner);
        _deposit(pocketId, msg.sender, amount);
    }

    // ------------------------------------------------------------------ autosave

    function createMandate(MandateReq calldata r, bytes calldata sig) external nonReentrant returns (uint256 id) {
        _auth(
            r.owner,
            keccak256(
                abi.encode(
                    MANDATE_TYPEHASH,
                    r.owner,
                    r.amountPerRun,
                    r.interval,
                    r.maxRuns,
                    r.expiry,
                    r.toGroup,
                    r.destId,
                    r.nonce,
                    r.deadline
                )
            ),
            r.nonce,
            r.deadline,
            sig
        );
        if (r.amountPerRun == 0 || r.interval == 0 || r.maxRuns == 0 || r.expiry <= block.timestamp) {
            revert BadParams();
        }
        if (r.toGroup) {
            if (groupKitty == address(0) || !IGroupKittyHooks(groupKitty).isMember(r.destId, r.owner)) {
                revert NotMember();
            }
        } else {
            _requireUserPocket(r.destId, r.owner);
            if (r.amountPerRun > MAX_DEPOSIT) revert CapExceeded();
        }
        id = ++mandateCount;
        mandates[id] = Mandate({
            owner: r.owner,
            amountPerRun: r.amountPerRun,
            interval: r.interval,
            maxRuns: r.maxRuns,
            runs: 0,
            expiry: r.expiry,
            lastRun: 0,
            toGroup: r.toGroup,
            revoked: false,
            destId: r.destId
        });
        emit MandateCreated(id, r.owner, r.amountPerRun, r.interval, r.maxRuns, r.expiry, r.toGroup, r.destId);
    }

    /// @notice Executes one due run. Anyone may call (the scheduler does); the contract enforces interval, cap and expiry.
    function executeMandate(uint256 id) external nonReentrant {
        Mandate storage m = mandates[id];
        if (m.owner == address(0) || m.revoked) revert MandateInactive();
        if (block.timestamp > m.expiry) revert Expired();
        if (m.runs >= m.maxRuns) revert MandateInactive();
        if (m.runs > 0 && block.timestamp < uint256(m.lastRun) + m.interval) revert TooEarly();
        if (asset.allowance(m.owner, address(this)) < m.amountPerRun) revert InsufficientAllowance();
        m.runs += 1;
        m.lastRun = uint64(block.timestamp);
        emit MandateExecuted(id, m.runs, m.amountPerRun);
        if (m.toGroup) {
            address gk = groupKitty;
            asset.safeTransferFrom(m.owner, address(this), m.amountPerRun);
            asset.forceApprove(gk, m.amountPerRun);
            IGroupKittyHooks(gk).contributeFor(m.destId, m.owner, m.amountPerRun);
        } else {
            _deposit(m.destId, m.owner, m.amountPerRun);
        }
    }

    function revokeMandate(address owner, uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig) external {
        _auth(owner, keccak256(abi.encode(REVOKE_TYPEHASH, owner, id, nonce, deadline)), nonce, deadline, sig);
        Mandate storage m = mandates[id];
        if (m.owner != owner) revert NotOwner();
        if (m.revoked) revert MandateInactive();
        m.revoked = true;
        emit MandateRevoked(id);
    }

    // ------------------------------------------------------------------ NIM SafeLock bond

    function lockBond(BondReq calldata r, bytes calldata sig) external nonReentrant returns (uint256 bondId) {
        _auth(
            r.owner,
            keccak256(
                abi.encode(
                    BOND_TYPEHASH,
                    r.owner,
                    r.amount,
                    r.unlockAt,
                    r.nimiqAddress,
                    r.nimLuna,
                    r.groupId,
                    r.linkHash,
                    r.nonce,
                    r.deadline
                )
            ),
            r.nonce,
            r.deadline,
            sig
        );
        if (
            r.unlockAt <= block.timestamp || r.nimiqAddress == bytes20(0) || r.nimLuna == 0
                || r.linkHash == bytes32(0)
        ) revert BadParams();
        if (r.groupId != 0) {
            if (groupKitty == address(0) || !IGroupKittyHooks(groupKitty).isMember(r.groupId, r.owner)) {
                revert NotMember();
            }
        }
        uint256 pid = _newPocket(r.owner, Kind.Bond, r.unlockAt, 0);
        bondId = ++bondCount;
        bonds[bondId] = Bond({
            pocketId: pid,
            owner: r.owner,
            nimiqAddress: r.nimiqAddress,
            unlockAt: r.unlockAt,
            nimLuna: r.nimLuna,
            groupId: r.groupId,
            linkHash: r.linkHash,
            status: BondStatus.Active
        });
        emit BondLocked(bondId, r.owner, pid, r.nimiqAddress, r.nimLuna, r.unlockAt, r.groupId, r.linkHash, r.amount);
        _deposit(pid, r.owner, r.amount);
    }

    /// @notice Attester reports an early unstake (active stake fell below the bonded NIM before unlockAt).
    /// The Nimiq tx hash is emitted so anyone can check the evidence. Trust assumption: see README.
    function forfeitBond(uint256 bondId, bytes32 nimiqTxHash) external nonReentrant {
        if (msg.sender != attester) revert NotAttester();
        Bond storage b = bonds[bondId];
        if (b.status != BondStatus.Active) revert BondInactive();
        if (block.timestamp > uint256(b.unlockAt) + claimDelay) revert ForfeitWindowClosed();
        if (nimiqTxHash == bytes32(0)) revert BadParams();
        b.status = BondStatus.Forfeited;
        uint256 gid = b.groupId;
        if (gid != 0) {
            uint256 amt = _withdraw(b.pocketId, type(uint256).max, address(this));
            address gk = groupKitty;
            asset.forceApprove(gk, amt);
            try IGroupKittyHooks(gk).receiveForfeit(gid, amt) {
                emit BondForfeited(bondId, nimiqTxHash, gk, gid, amt);
                return;
            } catch {
                asset.forceApprove(gk, 0);
                asset.safeTransfer(burnAddress, amt);
                emit BondForfeited(bondId, nimiqTxHash, burnAddress, 0, amt);
                return;
            }
        }
        uint256 amount = _withdraw(b.pocketId, type(uint256).max, burnAddress);
        emit BondForfeited(bondId, nimiqTxHash, burnAddress, 0, amount);
    }

    function claimBond(address owner, uint256 bondId, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        returns (uint256 amount)
    {
        _auth(owner, keccak256(abi.encode(CLAIM_TYPEHASH, owner, bondId, nonce, deadline)), nonce, deadline, sig);
        Bond storage b = bonds[bondId];
        if (b.owner != owner) revert NotOwner();
        if (b.status != BondStatus.Active) revert BondInactive();
        if (block.timestamp <= uint256(b.unlockAt) + claimDelay) revert ClaimNotOpen();
        b.status = BondStatus.Claimed;
        amount = _withdraw(b.pocketId, type(uint256).max, owner);
        emit BondClaimed(bondId, amount);
    }

    // ------------------------------------------------------------------ internals

    function _newPocket(address owner, Kind kind, uint64 unlockAt, uint256 target) internal returns (uint256 id) {
        if (owner == address(0)) revert BadParams();
        id = ++pocketCount;
        pockets[id] = Pocket({owner: owner, kind: kind, unlockAt: unlockAt, target: target, shares: 0});
        emit PocketOpened(id, owner, kind, unlockAt, target);
    }

    function _requireUserPocket(uint256 id, address owner) internal view returns (Pocket storage p) {
        p = pockets[id];
        if (p.owner == address(0) || p.owner != owner) revert NotOwner();
        if (p.kind == Kind.Bond) revert WrongKind();
    }

    /// @dev Checks, effects, then pull + Aave supply.
    function _deposit(uint256 id, address from, uint256 amount) internal {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_DEPOSIT) revert CapExceeded();
        Pocket storage p = pockets[id];
        address owner = p.owner;
        if (principalOf[owner] + amount > MAX_USER_PRINCIPAL) revert CapExceeded();
        uint256 shares = Math.mulDiv(amount, totalShares + OFFSET, totalAssets() + 1);
        if (shares == 0) revert ZeroAmount();
        p.shares += shares;
        totalShares += shares;
        principalOf[owner] += amount;
        emit Deposited(id, owner, from, amount, shares);
        asset.safeTransferFrom(from, address(this), amount);
        asset.forceApprove(address(pool), amount);
        pool.supply(address(asset), amount, address(this), 0);
    }

    function _withdraw(uint256 id, uint256 amount, address to) internal returns (uint256) {
        Pocket storage p = pockets[id];
        uint256 assets = totalAssets();
        uint256 shares;
        if (amount == type(uint256).max) {
            shares = p.shares;
            amount = _toAssets(shares, assets);
        } else {
            shares = Math.mulDiv(amount, totalShares + OFFSET, assets + 1, Math.Rounding.Ceil);
            if (shares > p.shares) revert Insufficient();
        }
        if (amount == 0) revert ZeroAmount();
        p.shares -= shares;
        totalShares -= shares;
        address owner = p.owner;
        uint256 pr = principalOf[owner];
        principalOf[owner] = pr > amount ? pr - amount : 0;
        emit Withdrawn(id, owner, to, amount, shares);
        if (pool.withdraw(address(asset), amount, to) != amount) revert Insufficient();
        return amount;
    }
}
