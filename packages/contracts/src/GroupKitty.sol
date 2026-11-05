// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SigAuth} from "./SigAuth.sol";
import {IPocketVaultHooks} from "./interfaces/IKittora.sol";

/// @title GroupKitty
/// @notice A digital Village Savings and Loan Association. Members buy shares each meeting and pay into a social fund,
/// borrow from the pool with guarantors, repay with interest (which stays in the pool), and at cycle end each member
/// claims (pool cash x own shares / total shares) plus an equal part of the leftover social fund.
/// Pool value per share = (cash + outstanding loan principal) / total shares; the social fund is excluded.
/// Defaults are cut from the borrower's shares first, then pro rata from the guarantors' pledged shares.
/// Burning s = L x S / V shares for a loss L keeps every other member's share value unchanged.
contract GroupKitty is SigAuth, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Params {
        uint256 sharePrice;
        uint256 socialFundPerMeeting;
        uint64 meetingInterval;
        uint64 cycleEnd;
        uint64 gracePeriod;
        uint16 interestBps;
        uint16 maxLoanMultipleBps; // 30000 = 3x
        uint8 maxSharesPerMeeting; // 1..5
        uint8 approvalsRequired;
        uint16 maxMembers;
    }

    struct Group {
        Params p;
        address creator;
        uint64 startAt;
        uint16 memberCount;
        uint32 activeLoans; // disbursed, not yet repaid/defaulted
        uint256 cash; // loanable USDT, excludes social fund
        uint256 socialFund;
        uint256 outstanding; // principal out on loans
        uint256 totalShares;
        // Share-Out snapshot
        bool shareOutStarted;
        uint16 claimsLeft;
        uint256 soCash;
        uint256 soSocial;
        uint256 soShares;
        uint16 soMembers;
        uint256 soPaid;
    }

    struct Member {
        bool joined;
        bool claimed;
        uint256 shares;
        uint256 pledged; // shares frozen as guarantor
        uint256 activeLoan; // loan id requested or disbursed, 0 = none
    }

    enum LoanStatus {
        None,
        Requested,
        Disbursed,
        Repaid,
        Defaulted,
        Cancelled
    }

    struct Loan {
        address borrower;
        uint256 groupId;
        uint256 principal;
        uint256 interest;
        uint256 repaid;
        uint64 duration;
        uint64 disbursedAt;
        uint16 approvals;
        uint16 guarantorApprovals;
        LoanStatus status;
        address[] guarantors;
        uint256[] pledges;
    }

    struct Grant {
        address member;
        uint256 groupId;
        uint256 amount;
        uint16 approvals;
        bool paid;
    }

    uint256 public constant POOL_CAP = 500e6; // 500 USDT per group (pilot cap, immutable)
    uint256 public constant MAX_GUARANTORS = 10;

    bytes32 public constant CREATE_TYPEHASH = keccak256(
        "CreateGroup(address creator,uint256 sharePrice,uint256 socialFundPerMeeting,uint64 meetingInterval,uint64 cycleEnd,uint64 gracePeriod,uint16 interestBps,uint16 maxLoanMultipleBps,uint8 maxSharesPerMeeting,uint8 approvalsRequired,uint16 maxMembers,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant JOIN_TYPEHASH =
        keccak256("JoinGroup(address member,uint256 groupId,uint256 nonce,uint256 deadline)");
    bytes32 public constant BUY_TYPEHASH =
        keccak256("BuyShares(address member,uint256 groupId,uint256 shares,uint256 nonce,uint256 deadline)");
    bytes32 public constant LOAN_TYPEHASH = keccak256(
        "RequestLoan(address borrower,uint256 groupId,uint256 principal,uint64 duration,address[] guarantors,uint256[] pledges,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant APPROVE_TYPEHASH =
        keccak256("ApproveLoan(address member,uint256 loanId,uint256 nonce,uint256 deadline)");
    bytes32 public constant CANCEL_TYPEHASH =
        keccak256("CancelLoan(address borrower,uint256 loanId,uint256 nonce,uint256 deadline)");
    bytes32 public constant REPAY_TYPEHASH =
        keccak256("Repay(address payer,uint256 loanId,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant GRANT_TYPEHASH =
        keccak256("RequestGrant(address member,uint256 groupId,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant GRANT_APPROVE_TYPEHASH =
        keccak256("ApproveGrant(address member,uint256 grantId,uint256 nonce,uint256 deadline)");
    bytes32 public constant CLAIM_TYPEHASH = keccak256(
        "ClaimShareOut(address member,uint256 groupId,uint256 rollPocketId,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable asset;
    address public immutable vault;

    uint256 public groupCount;
    uint256 public loanCount;
    uint256 public grantCount;
    mapping(uint256 => Group) internal _groups;
    mapping(uint256 => mapping(address => Member)) public members;
    mapping(uint256 => address[]) internal _memberList;
    /// groupId => member => meeting index => shares bought in that meeting (group board: late / missed)
    mapping(uint256 => mapping(address => mapping(uint256 => uint256))) public sharesInMeeting;
    mapping(uint256 => mapping(address => mapping(uint256 => bool))) public socialPaid;
    mapping(uint256 => Loan) internal _loans;
    mapping(uint256 => mapping(address => bool)) public loanApprovedBy;
    mapping(uint256 => Grant) public grants;
    mapping(uint256 => mapping(address => bool)) public grantApprovedBy;

    event GroupCreated(uint256 indexed groupId, address indexed creator, Params params);
    event MemberJoined(uint256 indexed groupId, address indexed member);
    event SharesBought(
        uint256 indexed groupId, address indexed member, uint256 meeting, uint256 shares, uint256 social, address payer
    );
    event LoanRequested(
        uint256 indexed loanId,
        uint256 indexed groupId,
        address indexed borrower,
        uint256 principal,
        uint256 interest,
        uint64 duration,
        address[] guarantors,
        uint256[] pledges
    );
    event LoanApproved(uint256 indexed loanId, address indexed member, bool guarantor, uint16 approvals);
    event LoanCancelled(uint256 indexed loanId);
    event LoanDisbursed(uint256 indexed loanId, uint256 amount, uint64 dueAt);
    event LoanRepaid(uint256 indexed loanId, address indexed payer, uint256 amount, uint256 remaining);
    event LoanDefaulted(uint256 indexed loanId, uint256 writtenOff, uint256 borrowerSharesCut, uint256 guarantorSharesCut);
    event GrantRequested(uint256 indexed grantId, uint256 indexed groupId, address indexed member, uint256 amount);
    event GrantApproved(uint256 indexed grantId, address indexed member, uint16 approvals);
    event GrantPaid(uint256 indexed grantId, uint256 amount);
    event ForfeitReceived(uint256 indexed groupId, uint256 amount);
    event ShareOutClaimed(
        uint256 indexed groupId, address indexed member, uint256 amount, uint256 rolledIntoPocket
    );

    error BadParams();
    error NotMember();
    error AlreadyMember();
    error GroupFull();
    error CycleEnded();
    error CycleNotEnded();
    error MeetingLimit();
    error PoolCapExceeded();
    error LoanLimit();
    error HasActiveLoan();
    error BadLoanState();
    error AlreadyApproved();
    error SelfApproval();
    error NotReady();
    error NoLiquidity();
    error NotDue();
    error OverPayment();
    error LoansOutstanding();
    error AlreadyClaimed();
    error NotVault();
    error ShareOutStarted();

    constructor(IERC20 _asset, address _vault) SigAuth("Kittora GroupKitty", "1") {
        if (address(_asset) == address(0) || _vault == address(0)) revert BadParams();
        asset = _asset;
        vault = _vault;
    }

    // ------------------------------------------------------------------ views

    function groupParams(uint256 g) external view returns (Params memory) {
        return _groups[g].p;
    }

    function groupState(uint256 g)
        external
        view
        returns (
            address creator,
            uint64 startAt,
            uint16 memberCount,
            uint32 activeLoans,
            uint256 cash,
            uint256 socialFund,
            uint256 outstanding,
            uint256 totalShares,
            bool shareOutStarted
        )
    {
        Group storage gr = _groups[g];
        return (
            gr.creator,
            gr.startAt,
            gr.memberCount,
            gr.activeLoans,
            gr.cash,
            gr.socialFund,
            gr.outstanding,
            gr.totalShares,
            gr.shareOutStarted
        );
    }

    function memberList(uint256 g) external view returns (address[] memory) {
        return _memberList[g];
    }

    function loan(uint256 id) external view returns (Loan memory) {
        return _loans[id];
    }

    function isMember(uint256 g, address a) external view returns (bool) {
        return members[g][a].joined;
    }

    function meetingIndex(uint256 g) public view returns (uint256) {
        Group storage gr = _groups[g];
        return (block.timestamp - gr.startAt) / gr.p.meetingInterval;
    }

    /// @notice Current USDT value of `shares` (pool value per share, social fund excluded).
    function valueOfShares(uint256 g, uint256 shares) public view returns (uint256) {
        Group storage gr = _groups[g];
        if (gr.totalShares == 0) return shares * gr.p.sharePrice;
        return Math.mulDiv(shares, gr.cash + gr.outstanding, gr.totalShares);
    }

    /// @notice Max principal the member can request with no guarantors (own unpledged shares x multiple).
    function ownLoanLimit(uint256 g, address m) external view returns (uint256) {
        Member storage mb = members[g][m];
        return valueOfShares(g, mb.shares - mb.pledged) * _groups[g].p.maxLoanMultipleBps / 10_000;
    }

    // ------------------------------------------------------------------ group lifecycle

    function createGroup(address creator, Params calldata p, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        returns (uint256 g)
    {
        _auth(creator, _createHash(creator, p, nonce, deadline), nonce, deadline, sig);
        if (
            p.sharePrice == 0 || p.meetingInterval == 0 || p.cycleEnd <= block.timestamp || p.maxSharesPerMeeting == 0
                || p.maxSharesPerMeeting > 5 || p.approvalsRequired == 0 || p.maxMembers < 2
                || p.approvalsRequired >= p.maxMembers || p.maxLoanMultipleBps == 0 || p.interestBps > 10_000
        ) revert BadParams();
        g = ++groupCount;
        Group storage gr = _groups[g];
        gr.p = p;
        gr.creator = creator;
        gr.startAt = uint64(block.timestamp);
        emit GroupCreated(g, creator, p);
        _join(g, creator);
    }

    function _createHash(address creator, Params calldata p, uint256 nonce, uint256 deadline)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                CREATE_TYPEHASH,
                creator,
                p.sharePrice,
                p.socialFundPerMeeting,
                p.meetingInterval,
                p.cycleEnd,
                p.gracePeriod,
                p.interestBps,
                p.maxLoanMultipleBps,
                p.maxSharesPerMeeting,
                p.approvalsRequired,
                p.maxMembers,
                nonce,
                deadline
            )
        );
    }

    function join(address member, uint256 g, uint256 nonce, uint256 deadline, bytes calldata sig) external nonReentrant {
        _auth(member, keccak256(abi.encode(JOIN_TYPEHASH, member, g, nonce, deadline)), nonce, deadline, sig);
        _join(g, member);
    }

    function _join(uint256 g, address m) internal {
        Group storage gr = _groups[g];
        if (gr.creator == address(0)) revert BadParams();
        if (block.timestamp >= gr.p.cycleEnd) revert CycleEnded();
        if (members[g][m].joined) revert AlreadyMember();
        if (gr.memberCount >= gr.p.maxMembers) revert GroupFull();
        members[g][m].joined = true;
        gr.memberCount += 1;
        _memberList[g].push(m);
        emit MemberJoined(g, m);
    }

    // ------------------------------------------------------------------ savings

    function buyShares(address member, uint256 g, uint256 shares, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        _auth(member, keccak256(abi.encode(BUY_TYPEHASH, member, g, shares, nonce, deadline)), nonce, deadline, sig);
        _buy(g, member, shares, member);
    }

    /// @notice Autosave into a group. `amount` must equal shares x sharePrice + social fund due this meeting.
    function contributeFor(uint256 g, address member, uint256 amount) external nonReentrant {
        if (msg.sender != vault) revert NotVault();
        Group storage gr = _groups[g];
        uint256 m = meetingIndex(g);
        uint256 social = socialPaid[g][member][m] ? 0 : gr.p.socialFundPerMeeting;
        if (amount <= social || (amount - social) % gr.p.sharePrice != 0) revert BadParams();
        _buy(g, member, (amount - social) / gr.p.sharePrice, msg.sender);
    }

    function _buy(uint256 g, address member, uint256 shares, address payer) internal {
        Group storage gr = _groups[g];
        if (!members[g][member].joined) revert NotMember();
        if (block.timestamp >= gr.p.cycleEnd) revert CycleEnded();
        if (shares == 0) revert BadParams();
        uint256 m = meetingIndex(g);
        if (sharesInMeeting[g][member][m] + shares > gr.p.maxSharesPerMeeting) revert MeetingLimit();
        uint256 social = socialPaid[g][member][m] ? 0 : gr.p.socialFundPerMeeting;
        uint256 cost = shares * gr.p.sharePrice;
        if (gr.cash + gr.outstanding + gr.socialFund + cost + social > POOL_CAP) revert PoolCapExceeded();
        sharesInMeeting[g][member][m] += shares;
        socialPaid[g][member][m] = true;
        members[g][member].shares += shares;
        gr.totalShares += shares;
        gr.cash += cost;
        gr.socialFund += social;
        emit SharesBought(g, member, m, shares, social, payer);
        asset.safeTransferFrom(payer, address(this), cost + social);
    }

    /// @notice A forfeited NIM SafeLock bond goes into the group's social fund.
    function receiveForfeit(uint256 g, uint256 amount) external nonReentrant {
        if (msg.sender != vault) revert NotVault();
        Group storage gr = _groups[g];
        if (gr.creator == address(0)) revert BadParams();
        if (gr.shareOutStarted) revert ShareOutStarted();
        gr.socialFund += amount;
        emit ForfeitReceived(g, amount);
        asset.safeTransferFrom(msg.sender, address(this), amount);
    }

    // ------------------------------------------------------------------ loans

    function requestLoan(
        address borrower,
        uint256 g,
        uint256 principal,
        uint64 duration,
        address[] calldata guarantors,
        uint256[] calldata pledges,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant returns (uint256 id) {
        _auth(
            borrower,
            keccak256(
                abi.encode(
                    LOAN_TYPEHASH,
                    borrower,
                    g,
                    principal,
                    duration,
                    keccak256(abi.encodePacked(guarantors)),
                    keccak256(abi.encodePacked(pledges)),
                    nonce,
                    deadline
                )
            ),
            nonce,
            deadline,
            sig
        );
        Group storage gr = _groups[g];
        Member storage b = members[g][borrower];
        if (!b.joined) revert NotMember();
        if (b.activeLoan != 0) revert HasActiveLoan();
        if (principal == 0 || duration == 0 || guarantors.length != pledges.length || guarantors.length > MAX_GUARANTORS) {
            revert BadParams();
        }
        if (block.timestamp + duration > gr.p.cycleEnd) revert CycleEnded();
        uint256 pledgedValue;
        for (uint256 i; i < guarantors.length; ++i) {
            address gu = guarantors[i];
            if (gu == borrower || !members[g][gu].joined || pledges[i] == 0) revert BadParams();
            for (uint256 j; j < i; ++j) {
                if (guarantors[j] == gu) revert BadParams();
            }
            Member storage gm = members[g][gu];
            if (gm.shares - gm.pledged < pledges[i]) revert LoanLimit();
            pledgedValue += valueOfShares(g, pledges[i]);
        }
        _checkLimit(g, b, principal, pledgedValue);
        id = ++loanCount;
        Loan storage l = _loans[id];
        l.borrower = borrower;
        l.groupId = g;
        l.principal = principal;
        l.interest = principal * gr.p.interestBps / 10_000;
        l.duration = duration;
        l.status = LoanStatus.Requested;
        l.guarantors = guarantors;
        l.pledges = pledges;
        b.activeLoan = id;
        emit LoanRequested(id, g, borrower, principal, l.interest, duration, guarantors, pledges);
    }

    function _checkLimit(uint256 g, Member storage b, uint256 principal, uint256 pledgedValue) internal view {
        uint256 ownValue = valueOfShares(g, b.shares - b.pledged);
        if (principal > ownValue * _groups[g].p.maxLoanMultipleBps / 10_000) revert LoanLimit();
        if (principal > ownValue + pledgedValue) revert LoanLimit();
    }

    function approveLoan(address member, uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        _auth(member, keccak256(abi.encode(APPROVE_TYPEHASH, member, id, nonce, deadline)), nonce, deadline, sig);
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Requested) revert BadLoanState();
        uint256 g = l.groupId;
        Member storage m = members[g][member];
        if (!m.joined) revert NotMember();
        if (member == l.borrower) revert SelfApproval();
        if (loanApprovedBy[id][member]) revert AlreadyApproved();
        loanApprovedBy[id][member] = true;
        l.approvals += 1;
        bool isGuarantor;
        for (uint256 i; i < l.guarantors.length; ++i) {
            if (l.guarantors[i] == member) {
                // A guarantor with an open loan of their own may not pledge: it would weaken that loan's cover.
                if (m.activeLoan != 0) revert HasActiveLoan();
                if (m.shares - m.pledged < l.pledges[i]) revert LoanLimit();
                m.pledged += l.pledges[i];
                l.guarantorApprovals += 1;
                isGuarantor = true;
                break;
            }
        }
        emit LoanApproved(id, member, isGuarantor, l.approvals);
    }

    function cancelLoan(address borrower, uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        _auth(borrower, keccak256(abi.encode(CANCEL_TYPEHASH, borrower, id, nonce, deadline)), nonce, deadline, sig);
        Loan storage l = _loans[id];
        if (l.borrower != borrower || l.status != LoanStatus.Requested) revert BadLoanState();
        l.status = LoanStatus.Cancelled;
        members[l.groupId][borrower].activeLoan = 0;
        _releasePledges(l, id);
        emit LoanCancelled(id);
    }

    /// @notice Pays out an approved loan. Anyone may call; all rules are checked here.
    function disburse(uint256 id) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Requested) revert BadLoanState();
        uint256 g = l.groupId;
        Group storage gr = _groups[g];
        if (l.approvals < gr.p.approvalsRequired || l.guarantorApprovals != l.guarantors.length) revert NotReady();
        uint64 due = uint64(block.timestamp) + l.duration;
        if (due > gr.p.cycleEnd) revert CycleEnded();
        uint256 pledgedValue;
        for (uint256 i; i < l.pledges.length; ++i) {
            pledgedValue += valueOfShares(g, l.pledges[i]);
        }
        _checkLimit(g, members[g][l.borrower], l.principal, pledgedValue);
        if (gr.cash < l.principal) revert NoLiquidity();
        l.status = LoanStatus.Disbursed;
        l.disbursedAt = uint64(block.timestamp);
        gr.cash -= l.principal;
        gr.outstanding += l.principal;
        gr.activeLoans += 1;
        emit LoanDisbursed(id, l.principal, due);
        asset.safeTransfer(l.borrower, l.principal);
    }

    function owed(uint256 id) public view returns (uint256) {
        Loan storage l = _loans[id];
        return l.principal + l.interest - l.repaid;
    }

    /// @notice Partial or full repayment. Interest is paid first and goes to the pool; principal reduces outstanding.
    function repay(address payer, uint256 id, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        _auth(payer, keccak256(abi.encode(REPAY_TYPEHASH, payer, id, amount, nonce, deadline)), nonce, deadline, sig);
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Disbursed) revert BadLoanState();
        if (amount == 0) revert BadParams();
        uint256 remaining = owed(id);
        if (amount > remaining) revert OverPayment();
        Group storage gr = _groups[l.groupId];
        uint256 before = l.repaid;
        uint256 afterRepaid = before + amount;
        uint256 pBefore = before > l.interest ? before - l.interest : 0;
        uint256 pAfter = afterRepaid > l.interest ? afterRepaid - l.interest : 0;
        l.repaid = afterRepaid;
        gr.outstanding -= (pAfter - pBefore);
        gr.cash += amount;
        remaining -= amount;
        if (remaining == 0) {
            l.status = LoanStatus.Repaid;
            gr.activeLoans -= 1;
            members[l.groupId][l.borrower].activeLoan = 0;
            _releasePledges(l, id);
        }
        emit LoanRepaid(id, payer, amount, remaining);
        asset.safeTransferFrom(payer, address(this), amount);
    }

    /// @notice After due date + grace, writes off the unpaid principal by burning the borrower's unpledged shares first,
    /// then guarantors' pledged shares pro rata. Other members' share value is unchanged. Anyone may call.
    function markDefault(uint256 id) external nonReentrant {
        Loan storage l = _loans[id];
        if (l.status != LoanStatus.Disbursed) revert BadLoanState();
        uint256 g = l.groupId;
        Group storage gr = _groups[g];
        if (block.timestamp <= uint256(l.disbursedAt) + l.duration + gr.p.gracePeriod) revert NotDue();
        uint256 principalRepaid = l.repaid > l.interest ? l.repaid - l.interest : 0;
        uint256 loss = l.principal - principalRepaid;
        uint256 toBurn = Math.mulDiv(loss, gr.totalShares, gr.cash + gr.outstanding, Math.Rounding.Ceil);

        l.status = LoanStatus.Defaulted;
        gr.outstanding -= loss;
        gr.activeLoans -= 1;
        Member storage b = members[g][l.borrower];
        b.activeLoan = 0;

        uint256 bCut = Math.min(b.shares - b.pledged, toBurn);
        b.shares -= bCut;
        uint256 rem = toBurn - bCut;
        uint256 gCut;
        uint256 totalPledge;
        for (uint256 i; i < l.pledges.length; ++i) {
            totalPledge += l.pledges[i];
        }
        for (uint256 i; i < l.guarantors.length; ++i) {
            Member storage gm = members[g][l.guarantors[i]];
            uint256 cut;
            if (rem > 0) {
                cut = Math.mulDiv(rem, l.pledges[i], totalPledge, Math.Rounding.Ceil);
                if (cut > l.pledges[i]) cut = l.pledges[i];
                if (gCut + cut > rem) cut = rem - gCut;
            }
            gm.pledged -= l.pledges[i];
            gm.shares -= cut;
            gCut += cut;
        }
        gr.totalShares -= (bCut + gCut);
        emit LoanDefaulted(id, loss, bCut, gCut);
    }

    function _releasePledges(Loan storage l, uint256 id) internal {
        for (uint256 i; i < l.guarantors.length; ++i) {
            if (loanApprovedBy[id][l.guarantors[i]]) members[l.groupId][l.guarantors[i]].pledged -= l.pledges[i];
        }
    }

    // ------------------------------------------------------------------ social fund grants

    function requestGrant(address member, uint256 g, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
        returns (uint256 id)
    {
        _auth(member, keccak256(abi.encode(GRANT_TYPEHASH, member, g, amount, nonce, deadline)), nonce, deadline, sig);
        if (!members[g][member].joined) revert NotMember();
        if (_groups[g].shareOutStarted) revert ShareOutStarted();
        if (amount == 0 || amount > _groups[g].socialFund) revert BadParams();
        id = ++grantCount;
        grants[id] = Grant({member: member, groupId: g, amount: amount, approvals: 0, paid: false});
        emit GrantRequested(id, g, member, amount);
    }

    /// @notice Pays automatically once `approvalsRequired` other members approve.
    function approveGrant(address member, uint256 id, uint256 nonce, uint256 deadline, bytes calldata sig)
        external
        nonReentrant
    {
        _auth(member, keccak256(abi.encode(GRANT_APPROVE_TYPEHASH, member, id, nonce, deadline)), nonce, deadline, sig);
        Grant storage gt = grants[id];
        if (gt.member == address(0) || gt.paid) revert BadParams();
        Group storage gr = _groups[gt.groupId];
        if (!members[gt.groupId][member].joined) revert NotMember();
        if (member == gt.member) revert SelfApproval();
        if (grantApprovedBy[id][member]) revert AlreadyApproved();
        if (gr.shareOutStarted) revert ShareOutStarted();
        grantApprovedBy[id][member] = true;
        gt.approvals += 1;
        emit GrantApproved(id, member, gt.approvals);
        if (gt.approvals >= gr.p.approvalsRequired) {
            if (gr.socialFund < gt.amount) revert NoLiquidity();
            gt.paid = true;
            gr.socialFund -= gt.amount;
            emit GrantPaid(id, gt.amount);
            asset.safeTransfer(gt.member, gt.amount);
        }
    }

    // ------------------------------------------------------------------ Share-Out

    /// @notice Payout = cash x shares / totalShares + socialFund / members, snapshotted at the first claim.
    /// Rounding dust goes to the last claimer, so the group ends with exactly zero.
    /// @param rollPocketId 0 = pay to wallet; otherwise deposit into that PocketVault pocket (must be the member's).
    function claimShareOut(
        address member,
        uint256 g,
        uint256 rollPocketId,
        uint256 nonce,
        uint256 deadline,
        bytes calldata sig
    ) external nonReentrant returns (uint256 amount) {
        _auth(
            member, keccak256(abi.encode(CLAIM_TYPEHASH, member, g, rollPocketId, nonce, deadline)), nonce, deadline, sig
        );
        Group storage gr = _groups[g];
        Member storage m = members[g][member];
        if (!m.joined) revert NotMember();
        if (block.timestamp < gr.p.cycleEnd) revert CycleNotEnded();
        if (gr.activeLoans != 0) revert LoansOutstanding();
        if (m.claimed) revert AlreadyClaimed();
        if (!gr.shareOutStarted) {
            gr.shareOutStarted = true;
            gr.soCash = gr.cash;
            gr.soSocial = gr.socialFund;
            gr.soShares = gr.totalShares;
            gr.soMembers = gr.memberCount;
            gr.claimsLeft = gr.memberCount;
            gr.cash = 0;
            gr.socialFund = 0;
        }
        m.claimed = true;
        gr.claimsLeft -= 1;
        if (gr.claimsLeft == 0) {
            amount = gr.soCash + gr.soSocial - gr.soPaid;
        } else {
            amount = gr.soSocial / gr.soMembers;
            if (gr.soShares > 0) amount += Math.mulDiv(gr.soCash, m.shares, gr.soShares);
        }
        gr.soPaid += amount;
        emit ShareOutClaimed(g, member, amount, rollPocketId);
        if (amount == 0) return 0;
        if (rollPocketId == 0) {
            asset.safeTransfer(member, amount);
        } else {
            asset.forceApprove(vault, amount);
            IPocketVaultHooks(vault).depositFor(member, rollPocketId, amount);
        }
    }
}
