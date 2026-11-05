// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GroupKitty} from "../src/GroupKitty.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {Base} from "./Base.t.sol";

/// TEST MOCK: plain 6-decimal ERC20 used only by the GroupKitty invariant suite (no fork needed).
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT (TEST ONLY)", "mUSDT") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}

contract GroupHandler is Test {
    GroupKitty public gk;
    MockUSDT public token;
    uint256 public g;
    address[5] public actors;
    uint256 public t;
    uint256[] public loanIds;
    bool public defaultHurtOutsider;
    uint256 public defaults;
    uint256 public repaidFull;

    constructor(GroupKitty _gk, MockUSDT _token, uint256 _g, address[5] memory _actors) {
        gk = _gk;
        token = _token;
        g = _g;
        actors = _actors;
        t = block.timestamp;
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % 5];
    }

    function warp(uint256 dt) external {
        dt = bound(dt, 1 hours, 3 days);
        t += dt;
        vm.warp(t);
    }

    function buy(uint256 who, uint256 shares) external {
        address a = _a(who);
        shares = bound(shares, 1, 5);
        vm.prank(a);
        try gk.buyShares(a, g, shares, gk.nonces(a), type(uint256).max, "") {} catch {}
    }

    function request(uint256 who, uint256 guar, uint256 principal, uint256 pledge, uint256 dur) external {
        address b = _a(who);
        address gu = _a(guar);
        principal = bound(principal, 1e5, 40e6);
        pledge = bound(pledge, 1, 10);
        dur = bound(dur, 1 days, 6 days);
        address[] memory gs;
        uint256[] memory ps;
        if (gu != b) {
            gs = new address[](1);
            ps = new uint256[](1);
            gs[0] = gu;
            ps[0] = pledge;
        }
        uint256 n = gk.nonces(b);
        vm.prank(b);
        try gk.requestLoan(b, g, principal, uint64(dur), gs, ps, n, type(uint256).max, "") returns (uint256 id) {
            loanIds.push(id);
        } catch {}
    }

    function approve(uint256 loanSeed, uint256 who) external {
        if (loanIds.length == 0) return;
        uint256 id = loanIds[loanSeed % loanIds.length];
        address a = _a(who);
        uint256 n = gk.nonces(a);
        vm.prank(a);
        try gk.approveLoan(a, id, n, type(uint256).max, "") {} catch {}
    }

    function disburse(uint256 loanSeed) external {
        if (loanIds.length == 0) return;
        try gk.disburse(loanIds[loanSeed % loanIds.length]) {} catch {}
    }

    function repay(uint256 loanSeed, uint256 amount) external {
        if (loanIds.length == 0) return;
        uint256 id = loanIds[loanSeed % loanIds.length];
        GroupKitty.Loan memory l = gk.loan(id);
        if (l.status != GroupKitty.LoanStatus.Disbursed) return;
        uint256 o = gk.owed(id);
        amount = bound(amount, 1, o);
        uint256 n = gk.nonces(l.borrower);
        vm.prank(l.borrower);
        gk.repay(l.borrower, id, amount, n, type(uint256).max, "");
        if (amount == o) repaidFull++;
    }

    function markDefault(uint256 loanSeed) external {
        if (loanIds.length == 0) return;
        uint256 id = loanIds[loanSeed % loanIds.length];
        GroupKitty.Loan memory l = gk.loan(id);
        if (l.status != GroupKitty.LoanStatus.Disbursed) return;
        GroupKitty.Params memory p = gk.groupParams(g);
        uint256 due = uint256(l.disbursedAt) + l.duration + p.gracePeriod + 1;
        if (t < due) {
            t = due;
            vm.warp(t);
        }
        uint256[5] memory before;
        for (uint256 i; i < 5; ++i) {
            (,, uint256 s,,) = gk.members(g, actors[i]);
            before[i] = gk.valueOfShares(g, s);
        }
        gk.markDefault(id);
        defaults++;
        for (uint256 i; i < 5; ++i) {
            address a = actors[i];
            if (a == l.borrower || _isGuarantor(l, a)) continue;
            (,, uint256 s,,) = gk.members(g, a);
            if (gk.valueOfShares(g, s) < before[i]) defaultHurtOutsider = true;
        }
    }

    function _isGuarantor(GroupKitty.Loan memory l, address a) internal pure returns (bool) {
        for (uint256 i; i < l.guarantors.length; ++i) {
            if (l.guarantors[i] == a) return true;
        }
        return false;
    }

    function loanCount() external view returns (uint256) {
        return loanIds.length;
    }
}

contract GroupKittyInvariants is Test {
    GroupKitty gk;
    MockUSDT token;
    GroupHandler h;
    uint256 g;
    address[5] actors;

    function setUp() public {
        token = new MockUSDT();
        gk = new GroupKitty(IERC20(address(token)), address(0xBEEF));
        for (uint256 i; i < 5; ++i) {
            actors[i] = address(uint160(0x1000 + i));
            token.mint(actors[i], 1_000e6);
            vm.prank(actors[i]);
            token.approve(address(gk), type(uint256).max);
        }
        GroupKitty.Params memory p = GroupKitty.Params({
            sharePrice: 1e6,
            socialFundPerMeeting: 0.2e6,
            meetingInterval: 1 days,
            cycleEnd: uint64(block.timestamp + 365 days),
            gracePeriod: 1 days,
            interestBps: 1000,
            maxLoanMultipleBps: 30000,
            maxSharesPerMeeting: 5,
            approvalsRequired: 2,
            maxMembers: 10
        });
        vm.prank(actors[0]);
        g = gk.createGroup(actors[0], p, 0, type(uint256).max, "");
        for (uint256 i = 1; i < 5; ++i) {
            vm.prank(actors[i]);
            gk.join(actors[i], g, 0, type(uint256).max, "");
        }
        for (uint256 i; i < 5; ++i) {
            vm.prank(actors[i]);
            gk.buyShares(actors[i], g, 5, 1, type(uint256).max, "");
        }
        h = new GroupHandler(gk, token, g, actors);
        targetContract(address(h));
    }

    /// Sum of claims never exceeds assets: the contract always holds cash + social fund.
    function invariant_balanceCoversBooks() public view {
        (,,,, uint256 cash, uint256 social,,,) = gk.groupState(g);
        assertGe(token.balanceOf(address(gk)), cash + social);
    }

    function invariant_sharesAddUp() public view {
        uint256 sum;
        for (uint256 i; i < 5; ++i) {
            (,, uint256 s, uint256 p,) = gk.members(g, actors[i]);
            sum += s;
            assertLe(p, s, "pledged <= shares");
        }
        (,,,,,,, uint256 total,) = gk.groupState(g);
        assertEq(sum, total);
    }

    /// A default never reduces a non-guarantor member's value.
    function invariant_defaultNeverHurtsOutsiders() public view {
        assertFalse(h.defaultHurtOutsider());
    }

    /// Settle everything, then Share-Out pays out exactly the balance, never more.
    function afterInvariant() public {
        GroupKitty.Params memory p = gk.groupParams(g);
        uint256 tt = uint256(p.cycleEnd) + 30 days;
        vm.warp(tt);
        for (uint256 i; i < h.loanCount(); ++i) {
            uint256 id = h.loanIds(i);
            if (gk.loan(id).status == GroupKitty.LoanStatus.Disbursed) gk.markDefault(id);
        }
        uint256 bal = token.balanceOf(address(gk));
        uint256 paid;
        for (uint256 i; i < 5; ++i) {
            address a = actors[i];
            uint256 n = gk.nonces(a);
            vm.prank(a);
            paid += gk.claimShareOut(a, g, 0, n, type(uint256).max, "");
        }
        assertEq(paid, bal);
        assertEq(token.balanceOf(address(gk)), 0);
        emit log_named_uint("loans requested", h.loanCount());
        emit log_named_uint("defaults during run", h.defaults());
        emit log_named_uint("full repays during run", h.repaidFull());
    }
}

// ---------------------------------------------------------------- PocketVault (Polygon fork)

contract VaultHandler is Test {
    PocketVault public vault;
    IERC20 public usdt;
    address[3] public actors;
    uint256[] public ids;
    uint256 t;

    constructor(PocketVault v, IERC20 u, address[3] memory a) {
        vault = v;
        usdt = u;
        actors = a;
        t = block.timestamp;
    }

    function open(uint256 who, uint256 amount) external {
        address a = actors[who % 3];
        amount = bound(amount, 1, 25e6);
        PocketVault.OpenPocketReq memory r =
            PocketVault.OpenPocketReq(a, PocketVault.Kind.Flex, 0, 0, amount, vault.nonces(a), type(uint256).max);
        vm.prank(a);
        try vault.openPocket(r, "") returns (uint256 id) {
            ids.push(id);
        } catch {}
    }

    function withdraw(uint256 seed, uint256 amount) external {
        if (ids.length == 0) return;
        uint256 id = ids[seed % ids.length];
        (address o,,,, uint256 sh) = vault.pockets(id);
        if (sh == 0) return;
        uint256 max = vault.pocketAssets(id);
        if (max == 0) return;
        amount = seed % 4 == 0 ? type(uint256).max : bound(amount, 1, max);
        uint256 n = vault.nonces(o);
        vm.prank(o);
        try vault.withdraw(o, id, amount, o, n, type(uint256).max, "") {} catch {}
    }

    function warp(uint256 dt) external {
        t += bound(dt, 1 hours, 20 days);
        vm.warp(t);
    }

    function count() external view returns (uint256) {
        return ids.length;
    }
}

contract PocketVaultInvariants is Base {
    VaultHandler vh;

    function setUp() public override {
        super.setUp();
        vh = new VaultHandler(vault, USDT, [alice, bob, carol]);
        targetContract(address(vh));
    }

    /// forge-config: default.invariant.runs = 16
    /// forge-config: default.invariant.depth = 20
    function invariant_claimsNeverExceedAssets() public view {
        uint256 sum;
        for (uint256 i = 1; i <= vault.pocketCount(); ++i) {
            sum += vault.pocketAssets(i);
        }
        assertLe(sum, vault.totalAssets());
    }
}
