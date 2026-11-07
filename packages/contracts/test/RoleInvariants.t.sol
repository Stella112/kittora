// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {GroupKitty} from "../src/GroupKitty.sol";
import {MockUSDT} from "./Invariants.t.sol";

/// A1.4 fuzz gate: random sequences of role actions never change any member's shares, pledges or loans, nor the
/// group's cash, social fund, outstanding principal, total shares or token balance. TEST MOCK token (no fork).
contract RoleHandler is Test {
    GroupKitty public gk;
    uint256 public g;
    address[7] public actors; // 0..4 hold shares; 5..6 joined with none (removable)
    uint256 public calls;
    mapping(bytes32 => uint256) public ok; // successful role actions by kind

    constructor(GroupKitty _gk, uint256 _g, address[7] memory _actors) {
        gk = _gk;
        g = _g;
        actors = _actors;
    }

    function _a(uint256 s) internal view returns (address) {
        return actors[s % 7];
    }

    function _admin() internal view returns (address) {
        return gk.adminOf(g);
    }

    function setTreasurer(uint256 who, bool on) external {
        address a = _admin();
        uint256 n = gk.nonces(a);
        vm.prank(a);
        try gk.setTreasurer(a, g, _a(who), on, n, type(uint256).max, "") { ok["treasurer"]++; } catch {}
        calls++;
    }

    function transferAdmin(uint256 who) external {
        address a = _admin();
        uint256 n = gk.nonces(a);
        vm.prank(a);
        try gk.transferAdmin(a, g, _a(who), n, type(uint256).max, "") { ok["admin"]++; } catch {}
        calls++;
    }

    function removeMember(uint256 who) external {
        address a = _admin();
        uint256 n = gk.nonces(a);
        vm.prank(a);
        try gk.removeMember(a, g, _a(who), n, type(uint256).max, "") { ok["remove"]++; } catch {}
        calls++;
    }

    function rejoin(uint256 who) external {
        address m = _a(who);
        uint256 n = gk.nonces(m);
        vm.prank(m);
        try gk.join(m, g, n, type(uint256).max, "") { ok["rejoin"]++; } catch {}
        calls++;
    }

    function editProfile(uint256 cover, bool byNonAdmin, uint256 who) external {
        address a = byNonAdmin ? _a(who) : _admin();
        uint256 n = gk.nonces(a);
        vm.prank(a);
        try gk.updateProfile(a, g, "Fuzz group", "edited", uint8(cover % 8), n, type(uint256).max, "") { ok["profile"]++; } catch {}
        calls++;
    }

    /// Non-admins try every role action: all must fail without effect.
    function intruder(uint256 who, uint256 target) external {
        address x = _a(who);
        if (x == _admin()) return;
        uint256 n = gk.nonces(x);
        vm.startPrank(x);
        try gk.setTreasurer(x, g, _a(target), true, n, type(uint256).max, "") {} catch {}
        try gk.transferAdmin(x, g, x, n, type(uint256).max, "") {} catch {}
        try gk.removeMember(x, g, _a(target), n, type(uint256).max, "") {} catch {}
        vm.stopPrank();
        calls++;
    }
}

contract RoleInvariantsTest is Test {
    MockUSDT token;
    GroupKitty gk;
    RoleHandler h;
    uint256 g;
    address[7] actors;
    uint256[7] sharesAtStart;
    uint256 balanceAtStart;
    uint256 cashAtStart;
    uint256 socialAtStart;
    uint256 sharesTotalAtStart;
    uint256 loanId;

    function setUp() public {
        token = new MockUSDT();
        gk = new GroupKitty(IERC20(address(token)), address(0xBEEF));
        for (uint256 i; i < 7; ++i) {
            actors[i] = address(uint160(0x2000 + i));
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
            maxMembers: 10,
            maxSocialPayout: 0
        });
        vm.prank(actors[0]);
        g = gk.createGroup(actors[0], p, GroupKitty.Profile({name: "Fuzz group", purpose: "", coverId: 0}), 0, type(uint256).max, "");
        for (uint256 i = 1; i < 7; ++i) {
            vm.prank(actors[i]);
            gk.join(actors[i], g, 0, type(uint256).max, "");
        }
        for (uint256 i; i < 5; ++i) {
            vm.prank(actors[i]);
            gk.buyShares(actors[i], g, 5, 1, type(uint256).max, "");
        }
        // an open loan with a pledge, so roles are fuzzed while money is out
        address[] memory gs = new address[](1);
        gs[0] = actors[2];
        uint256[] memory ps = new uint256[](1);
        ps[0] = 2;
        vm.prank(actors[1]);
        loanId = gk.requestLoan(actors[1], g, 6e6, 30 days, gs, ps, 2, type(uint256).max, "");
        vm.prank(actors[2]);
        gk.approveLoan(actors[2], loanId, 2, type(uint256).max, "");
        vm.prank(actors[3]);
        gk.approveLoan(actors[3], loanId, 2, type(uint256).max, "");
        gk.disburse(loanId);

        for (uint256 i; i < 7; ++i) {
            (,, sharesAtStart[i],,) = gk.members(g, actors[i]);
        }
        balanceAtStart = token.balanceOf(address(gk));
        (,,,, cashAtStart, socialAtStart,, sharesTotalAtStart,) = gk.groupState(g);
        h = new RoleHandler(gk, g, actors);
        targetContract(address(h));
    }

    function invariant_rolesNeverMoveMoney() public view {
        assertEq(token.balanceOf(address(gk)), balanceAtStart);
        (,,,, uint256 cash, uint256 social, uint256 outstanding, uint256 total,) = gk.groupState(g);
        assertEq(cash, cashAtStart);
        assertEq(social, socialAtStart);
        assertEq(outstanding, 6e6);
        assertEq(total, sharesTotalAtStart);
        for (uint256 i; i < 7; ++i) {
            (,, uint256 s,,) = gk.members(g, actors[i]);
            assertEq(s, sharesAtStart[i]);
        }
        (,,, uint256 pledged, uint256 active) = gk.members(g, actors[2]);
        assertEq(pledged, 2);
        (,,,, uint256 borrowerLoan) = gk.members(g, actors[1]);
        assertEq(borrowerLoan, loanId);
        assertEq(active, 0);
    }

    /// The fuzzer really exercised every role action (not only reverting calls).
    function afterInvariant() public view {
        if (h.calls() < 200) return; // short runs can miss rare paths
        assertGt(h.ok("treasurer"), 0);
        assertGt(h.ok("admin"), 0);
        assertGt(h.ok("remove"), 0);
        assertGt(h.ok("rejoin"), 0);
        assertGt(h.ok("profile"), 0);
    }

    function invariant_roleBookkeeping() public view {
        address admin = gk.adminOf(g);
        assertTrue(gk.isMember(g, admin));
        assertFalse(gk.isTreasurer(g, admin)); // the Admin is never also a Treasurer
        address[] memory list = gk.memberList(g);
        (,, uint16 memberCount,,,,,,) = gk.groupState(g);
        assertEq(list.length, memberCount);
        uint256 treasurers;
        for (uint256 i; i < list.length; ++i) {
            assertTrue(gk.isMember(g, list[i]));
            if (gk.isTreasurer(g, list[i])) treasurers++;
        }
        assertEq(treasurers, gk.treasurerCount(g));
        assertLe(treasurers, gk.MAX_TREASURERS());
        for (uint256 i; i < 5; ++i) {
            assertTrue(gk.isMember(g, actors[i])); // members holding shares can never be removed
        }
    }
}
