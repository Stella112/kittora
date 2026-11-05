// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AaveV3Polygon, AaveV3PolygonAssets} from "aave-address-book/AaveV3Polygon.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {GroupKitty} from "../src/GroupKitty.sol";
import {SigAuth} from "../src/SigAuth.sol";
import {IAavePool} from "../src/interfaces/IKittora.sol";

/// Polygon mainnet fork, pinned block for reproducibility and RPC caching.
abstract contract Base is Test {
    uint256 constant FORK_BLOCK = 96_810_000;
    IERC20 constant USDT = IERC20(AaveV3PolygonAssets.USDT0_UNDERLYING);
    IERC20 constant AUSDT = IERC20(AaveV3PolygonAssets.USDT0_A_TOKEN);
    address constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint64 constant CLAIM_DELAY = 1 hours;

    PocketVault vault;
    GroupKitty gk;
    address attester = makeAddr("attester");
    address relayer = makeAddr("relayer");

    address[5] users;
    uint256[5] pks;
    address alice;
    address bob;
    address carol;
    address dave;
    address erin;

    function setUp() public virtual {
        vm.createSelectFork(vm.envOr("POLYGON_RPC_URL", string("https://polygon.drpc.org")), FORK_BLOCK);
        vault = new PocketVault(
            USDT, AUSDT, IAavePool(address(AaveV3Polygon.POOL)), attester, BURN, CLAIM_DELAY
        );
        gk = new GroupKitty(USDT, address(vault));
        vault.setGroupKitty(address(gk));
        string[5] memory names = ["alice", "bob", "carol", "dave", "erin"];
        for (uint256 i; i < 5; ++i) {
            (users[i], pks[i]) = makeAddrAndKey(names[i]);
            deal(address(USDT), users[i], 1_000e6);
            vm.startPrank(users[i]);
            USDT.approve(address(vault), type(uint256).max);
            USDT.approve(address(gk), type(uint256).max);
            vm.stopPrank();
        }
        (alice, bob, carol, dave, erin) = (users[0], users[1], users[2], users[3], users[4]);
    }

    function _sign(uint256 pk, SigAuth target, bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", target.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _pkOf(address a) internal view returns (uint256) {
        for (uint256 i; i < 5; ++i) {
            if (users[i] == a) return pks[i];
        }
        revert("unknown user");
    }

    bytes4 internal pendingRevert;

    /// Arms an expected revert for the next helper call (helpers read nonces first, which would consume vm.expectRevert).
    function _rev(bytes4 sel) internal {
        pendingRevert = sel;
    }

    function _arm() internal {
        if (pendingRevert != bytes4(0)) {
            vm.expectRevert(pendingRevert);
            pendingRevert = bytes4(0);
        }
    }

    function _dl() internal view returns (uint256) {
        return block.timestamp + 1 hours;
    }

    // ---------------- vault helpers (direct calls: signer == msg.sender, empty sig) ----------------

    function _open(address who, PocketVault.Kind kind, uint64 unlockAt, uint256 target, uint256 amount)
        internal
        returns (uint256 id)
    {
        PocketVault.OpenPocketReq memory r = PocketVault.OpenPocketReq({
            owner: who, kind: kind, unlockAt: unlockAt, target: target, amount: amount, nonce: vault.nonces(who), deadline: _dl()
        });
        vm.prank(who);
        id = vault.openPocket(r, "");
    }

    function _withdraw(address who, uint256 id, uint256 amount) internal returns (uint256) {
        uint256 n = vault.nonces(who);
        uint256 dl = _dl();
        vm.prank(who);
        return vault.withdraw(who, id, amount, who, n, dl, "");
    }

    // ---------------- group helpers ----------------

    function _params() internal view returns (GroupKitty.Params memory) {
        return GroupKitty.Params({
            sharePrice: 1e6,
            socialFundPerMeeting: 0.2e6,
            meetingInterval: 1 days,
            cycleEnd: uint64(block.timestamp + 30 days),
            gracePeriod: 2 days,
            interestBps: 1000, // 10% flat per loan
            maxLoanMultipleBps: 30000, // 3x
            maxSharesPerMeeting: 5,
            approvalsRequired: 2,
            maxMembers: 10
        });
    }

    function _create(address who, GroupKitty.Params memory p) internal returns (uint256 g) {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        g = gk.createGroup(who, p, n, dl, "");
    }

    function _join(address who, uint256 g) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.join(who, g, n, dl, "");
    }

    function _buy(address who, uint256 g, uint256 shares) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.buyShares(who, g, shares, n, dl, "");
    }

    function _request(address who, uint256 g, uint256 principal, uint64 duration, address[] memory gs, uint256[] memory ps)
        internal
        returns (uint256 id)
    {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        id = gk.requestLoan(who, g, principal, duration, gs, ps, n, dl, "");
    }

    function _approve(address who, uint256 id) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.approveLoan(who, id, n, dl, "");
    }

    function _repay(address who, uint256 id, uint256 amount) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.repay(who, id, amount, n, dl, "");
    }

    function _claim(address who, uint256 g, uint256 roll) internal returns (uint256) {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        return gk.claimShareOut(who, g, roll, n, dl, "");
    }

    function _arr(address a) internal pure returns (address[] memory x) {
        x = new address[](1);
        x[0] = a;
    }

    function _arr(uint256 a) internal pure returns (uint256[] memory x) {
        x = new uint256[](1);
        x[0] = a;
    }

    /// 5-member group, everyone joined, each buys `shares` in meeting 0.
    function _groupWith5(uint256 shares) internal returns (uint256 g) {
        g = _create(alice, _params());
        for (uint256 i = 1; i < 5; ++i) {
            _join(users[i], g);
        }
        for (uint256 i; i < 5; ++i) {
            _buy(users[i], g, shares);
        }
    }

    function _cash(uint256 g) internal view returns (uint256 c) {
        (,,,, c,,,,) = gk.groupState(g);
    }

    function _social(uint256 g) internal view returns (uint256 s) {
        (,,,,, s,,,) = gk.groupState(g);
    }

    function _totalShares(uint256 g) internal view returns (uint256 t) {
        (,,,,,,, t,) = gk.groupState(g);
    }

    function _memberShares(uint256 g, address m) internal view returns (uint256 s, uint256 p) {
        (,, s, p,) = gk.members(g, m);
    }
}
