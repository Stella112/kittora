// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {GroupKitty} from "../src/GroupKitty.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {SigAuth} from "../src/SigAuth.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract GroupKittyTest is Base {
    uint256 t; // explicit clock (via_ir caches block.timestamp in tests)

    function setUp() public override {
        super.setUp();
        t = vm.getBlockTimestamp();
    }

    function _warp(uint256 dt) internal {
        t += dt;
        vm.warp(t);
    }

    // ------------------------------------------------------------ the headline: full 5-member cycle

    function test_fullCycle_loanRepayShareOutWithProfit() public {
        uint256 g = _groupWith5(5); // meeting 0: 5 shares each
        _warp(1 days);
        for (uint256 i; i < 5; ++i) {
            _buy(users[i], g, 5); // meeting 1: 5 more
        }
        assertEq(_totalShares(g), 50);
        assertEq(_cash(g), 50e6);
        assertEq(_social(g), 2e6);
        assertEq(gk.sharesInMeeting(g, alice, 1), 5);

        // bob: 10 own shares (10 USDT), carol guarantees with 10 shares -> 20 USDT
        uint256 id = _request(bob, g, 20e6, 7 days, _arr(carol), _arr(10));
        _approve(carol, id);
        (uint256 cs, uint256 cp) = _memberShares(g, carol);
        assertEq(cp, 10);
        assertEq(cs, 10);
        _approve(dave, id);
        gk.disburse(id);
        assertEq(USDT.balanceOf(bob), 1_000e6 - 10e6 - 0.4e6 + 20e6);

        // partial then full repay; 10% interest = 2 USDT
        assertEq(gk.owed(id), 22e6);
        _repay(bob, id, 10e6);
        assertEq(gk.owed(id), 12e6);
        _repay(bob, id, 12e6);
        (, cp) = _memberShares(g, carol);
        assertEq(cp, 0, "pledge released");
        assertEq(_cash(g), 52e6);

        // alice rolls her payout into a SafeLock
        uint256 lock = _open(alice, PocketVault.Kind.SafeLock, uint64(t + 60 days), 0, 0);
        vm.warp(t = t + 29 days);
        uint256 got = _claim(alice, g, lock);
        // paid 10 shares + 2 x 0.2 social = 10.4; gets 52 x 10/50 + 2/5 = 10.8
        assertEq(got, 10.8e6);
        assertApproxEqAbs(vault.pocketAssets(lock), 10.8e6, 2);
        for (uint256 i = 1; i < 5; ++i) {
            uint256 bal = USDT.balanceOf(users[i]);
            uint256 out = _claim(users[i], g, 0);
            assertEq(out, 10.8e6);
            assertEq(USDT.balanceOf(users[i]), bal + out);
        }
        assertEq(USDT.balanceOf(address(gk)), 0, "group fully paid out");
    }

    // ------------------------------------------------------------ defaults

    function test_defaultCutsBorrowerThenGuarantor_othersUntouched() public {
        uint256 g = _groupWith5(5);
        _warp(1 days);
        for (uint256 i; i < 5; ++i) {
            _buy(users[i], g, 5);
        }
        uint256 valueBefore = gk.valueOfShares(g, 10);
        uint256 id = _request(bob, g, 15e6, 5 days, _arr(carol), _arr(5));
        _approve(carol, id);
        _approve(dave, id);
        gk.disburse(id);

        vm.expectRevert(GroupKitty.NotDue.selector);
        gk.markDefault(id);
        _warp(5 days + 2 days + 1);
        gk.markDefault(id);

        (uint256 bs,) = _memberShares(g, bob);
        (uint256 cs, uint256 cp) = _memberShares(g, carol);
        assertEq(bs, 0, "borrower cut first");
        assertEq(cs, 5, "guarantor lost pledged 5");
        assertEq(cp, 0);
        for (uint256 i; i < 5; ++i) {
            address u = users[i];
            if (u == bob || u == carol) continue;
            assertEq(gk.valueOfShares(g, 10), valueBefore, "non-guarantor value unchanged");
        }
        (uint256 as_,) = _memberShares(g, alice);
        assertEq(as_, 10);

        vm.expectRevert(GroupKitty.BadLoanState.selector);
        gk.markDefault(id);
    }

    function test_defaultAfterPartialRepay_othersNotWorse() public {
        uint256 g = _groupWith5(5);
        _warp(1 days);
        for (uint256 i; i < 5; ++i) {
            _buy(users[i], g, 5);
        }
        uint256 id = _request(bob, g, 15e6, 5 days, _arr(carol), _arr(5));
        _approve(carol, id);
        _approve(dave, id);
        gk.disburse(id);
        _repay(bob, id, 5e6); // 1.5 interest + 3.5 principal
        uint256 before = gk.valueOfShares(g, 10);
        _warp(8 days);
        gk.markDefault(id);
        assertGe(gk.valueOfShares(g, 10), before);
        (uint256 cs,) = _memberShares(g, carol);
        assertGe(cs, 8); // borrower's 10 shares covered most of 12; guarantor cut <= 2
        // share-out still pays exactly what's there
        _warp(30 days);
        uint256 paid;
        for (uint256 i; i < 5; ++i) {
            paid += _claim(users[i], g, 0);
        }
        assertEq(USDT.balanceOf(address(gk)), 0);
        assertGt(paid, 0);
    }

    // ------------------------------------------------------------ loan rules

    function test_loanLimitRules() public {
        uint256 g = _groupWith5(5); // 5 shares each, value 5
        address[] memory none = new address[](0);
        uint256[] memory nonep = new uint256[](0);
        _rev(GroupKitty.LoanLimit.selector); // own 5, no guarantors: cover 5
        _request(bob, g, 6e6, 5 days, none, nonep);
        uint256 id = _request(bob, g, 5e6, 5 days, none, nonep);
        assertEq(id, 1);
        assertEq(gk.ownLoanLimit(g, bob), 15e6);
        _rev(GroupKitty.HasActiveLoan.selector);
        _request(bob, g, 1e6, 5 days, none, nonep);
        // multiple cap: own 5 x 3 = 15 even with big guarantees
        address[] memory gs = new address[](2);
        uint256[] memory ps = new uint256[](2);
        (gs[0], gs[1], ps[0], ps[1]) = (dave, erin, 5, 5);
        _rev(GroupKitty.LoanLimit.selector);
        _request(carol, g, 16e6, 5 days, gs, ps);
        uint256 id2 = _request(carol, g, 15e6, 5 days, gs, ps);
        assertEq(id2, 2);
    }

    function test_loanRequestRevertPaths() public {
        uint256 g = _groupWith5(5);
        address[] memory gs = new address[](2);
        uint256[] memory ps = new uint256[](2);
        (gs[0], gs[1], ps[0], ps[1]) = (carol, carol, 1, 1);
        _rev(GroupKitty.BadParams.selector); // duplicate guarantor
        _request(bob, g, 5e6, 5 days, gs, ps);
        _rev(GroupKitty.BadParams.selector); // self guarantee
        _request(bob, g, 5e6, 5 days, _arr(bob), _arr(1));
        _rev(GroupKitty.BadParams.selector); // non-member guarantor
        _request(bob, g, 5e6, 5 days, _arr(relayer), _arr(1));
        _rev(GroupKitty.BadParams.selector); // zero pledge
        _request(bob, g, 5e6, 5 days, _arr(carol), _arr(0));
        _rev(GroupKitty.LoanLimit.selector); // pledge > guarantor shares
        _request(bob, g, 5e6, 5 days, _arr(carol), _arr(6));
        _rev(GroupKitty.BadParams.selector); // length mismatch
        _request(bob, g, 5e6, 5 days, _arr(carol), new uint256[](0));
        _rev(GroupKitty.BadParams.selector);
        _request(bob, g, 0, 5 days, new address[](0), new uint256[](0));
        _rev(GroupKitty.CycleEnded.selector); // beyond cycle end
        _request(bob, g, 1e6, 31 days, new address[](0), new uint256[](0));
        _rev(GroupKitty.NotMember.selector);
        _request(relayer, g, 1e6, 1 days, new address[](0), new uint256[](0));
    }

    function test_approvalAndDisburseRules() public {
        uint256 g = _groupWith5(5);
        uint256 id = _request(bob, g, 8e6, 5 days, _arr(carol), _arr(3));
        _rev(GroupKitty.SelfApproval.selector);
        _approve(bob, id);
        _rev(GroupKitty.NotMember.selector);
        _approve(relayer, id);
        _approve(dave, id);
        _rev(GroupKitty.AlreadyApproved.selector);
        _approve(dave, id);
        _approve(erin, id);
        vm.expectRevert(GroupKitty.NotReady.selector); // guarantor has not approved
        gk.disburse(id);
        _approve(carol, id);
        gk.disburse(id);
        vm.expectRevert(GroupKitty.BadLoanState.selector);
        gk.disburse(id);
        _rev(GroupKitty.BadLoanState.selector);
        _approve(alice, id);
    }

    function test_guarantorWithOwnLoanCannotPledge() public {
        uint256 g = _groupWith5(5);
        _request(carol, g, 1e6, 5 days, new address[](0), new uint256[](0));
        uint256 id = _request(bob, g, 6e6, 5 days, _arr(carol), _arr(2));
        _rev(GroupKitty.HasActiveLoan.selector);
        _approve(carol, id);
    }

    function test_cancelReleasesPledgesAndRules() public {
        uint256 g = _groupWith5(5);
        uint256 id = _request(bob, g, 8e6, 5 days, _arr(carol), _arr(3));
        _approve(carol, id);
        (, uint256 cp) = _memberShares(g, carol);
        assertEq(cp, 3);
        uint256 n = gk.nonces(dave);
        vm.prank(dave);
        vm.expectRevert(GroupKitty.BadLoanState.selector);
        gk.cancelLoan(dave, id, n, _dl(), "");
        n = gk.nonces(bob);
        vm.prank(bob);
        gk.cancelLoan(bob, id, n, _dl(), "");
        (, cp) = _memberShares(g, carol);
        assertEq(cp, 0);
        _request(bob, g, 1e6, 5 days, new address[](0), new uint256[](0)); // can request again
    }

    function test_repayRules() public {
        uint256 g = _groupWith5(5);
        uint256 id = _request(bob, g, 5e6, 5 days, new address[](0), new uint256[](0));
        _rev(GroupKitty.BadLoanState.selector);
        _repay(bob, id, 1e6);
        _approve(dave, id);
        _approve(erin, id);
        gk.disburse(id);
        _rev(GroupKitty.OverPayment.selector);
        _repay(bob, id, 5.5e6 + 1);
        _rev(GroupKitty.BadParams.selector);
        _repay(bob, id, 0);
        _repay(alice, id, 0.2e6); // anyone may repay on the borrower's behalf
        _repay(bob, id, 5.3e6);
        assertEq(gk.owed(id), 0);
        _rev(GroupKitty.BadLoanState.selector);
        _repay(bob, id, 1);
    }

    // ------------------------------------------------------------ group setup rules

    function test_createGroupRevertPaths() public {
        GroupKitty.Params memory p = _params();
        p.maxSharesPerMeeting = 6;
        _rev(GroupKitty.BadParams.selector);
        _create(alice, p);
        p = _params();
        p.approvalsRequired = 10;
        _rev(GroupKitty.BadParams.selector);
        _create(alice, p);
        p = _params();
        p.cycleEnd = uint64(t);
        _rev(GroupKitty.BadParams.selector);
        _create(alice, p);
        p = _params();
        p.sharePrice = 0;
        _rev(GroupKitty.BadParams.selector);
        _create(alice, p);
    }

    function test_joinRules() public {
        GroupKitty.Params memory p = _params();
        p.maxMembers = 3;
        uint256 g = _create(alice, p);
        _join(bob, g);
        _rev(GroupKitty.AlreadyMember.selector);
        _join(bob, g);
        _join(carol, g);
        _rev(GroupKitty.GroupFull.selector);
        _join(dave, g);
        _rev(GroupKitty.BadParams.selector);
        _join(dave, 99);
        assertEq(gk.memberList(g).length, 3);
        assertTrue(gk.isMember(g, carol));
        _warp(31 days);
        uint256 g2 = 1;
        g2;
        _rev(GroupKitty.CycleEnded.selector);
        _join(erin, g);
    }

    function test_buyRules() public {
        uint256 g = _create(alice, _params());
        _rev(GroupKitty.NotMember.selector);
        _buy(bob, g, 1);
        _buy(alice, g, 3);
        _rev(GroupKitty.MeetingLimit.selector);
        _buy(alice, g, 3);
        _buy(alice, g, 2); // social only charged once per meeting
        assertEq(_social(g), 0.2e6);
        _rev(GroupKitty.BadParams.selector);
        _buy(alice, g, 0);
        _warp(30 days);
        _rev(GroupKitty.CycleEnded.selector);
        _buy(alice, g, 1);
    }

    function test_poolCap() public {
        GroupKitty.Params memory p = _params();
        p.sharePrice = 25e6;
        p.socialFundPerMeeting = 0;
        uint256 g = _create(alice, p);
        for (uint256 i = 1; i < 5; ++i) {
            _join(users[i], g);
        }
        for (uint256 i; i < 4; ++i) {
            _buy(users[i], g, 5); // 4 x 125 = 500
        }
        _rev(GroupKitty.PoolCapExceeded.selector);
        _buy(erin, g, 1);
    }

    function test_onlyVaultHooks() public {
        uint256 g = _create(alice, _params());
        vm.expectRevert(GroupKitty.NotVault.selector);
        gk.contributeFor(g, alice, 1e6);
        vm.expectRevert(GroupKitty.NotVault.selector);
        gk.receiveForfeit(g, 1e6);
        vm.prank(address(vault));
        vm.expectRevert(GroupKitty.BadParams.selector);
        gk.receiveForfeit(99, 1e6);
    }

    function test_constructorRejectsZero() public {
        vm.expectRevert(GroupKitty.BadParams.selector);
        new GroupKitty(IERC20(address(0)), address(vault));
    }

    // ------------------------------------------------------------ social fund grants

    function test_socialFundGrant() public {
        uint256 g = _groupWith5(1); // social 1.0
        uint256 n = gk.nonces(bob);
        vm.prank(bob);
        vm.expectRevert(GroupKitty.BadParams.selector);
        gk.requestGrant(bob, g, 1.1e6, n, _dl(), "");
        vm.prank(bob);
        uint256 id = gk.requestGrant(bob, g, 0.6e6, n, _dl(), "");
        n = gk.nonces(bob);
        vm.prank(bob);
        vm.expectRevert(GroupKitty.SelfApproval.selector);
        gk.approveGrant(bob, id, n, _dl(), "");
        n = gk.nonces(carol);
        vm.prank(carol);
        gk.approveGrant(carol, id, n, _dl(), "");
        n = gk.nonces(carol);
        vm.prank(carol);
        vm.expectRevert(GroupKitty.AlreadyApproved.selector);
        gk.approveGrant(carol, id, n, _dl(), "");
        uint256 bal = USDT.balanceOf(bob);
        n = gk.nonces(dave);
        vm.prank(dave);
        gk.approveGrant(dave, id, n, _dl(), "");
        assertEq(USDT.balanceOf(bob), bal + 0.6e6);
        assertEq(_social(g), 0.4e6);
        n = gk.nonces(erin);
        vm.prank(erin);
        vm.expectRevert(GroupKitty.BadParams.selector); // already paid
        gk.approveGrant(erin, id, n, _dl(), "");
        n = gk.nonces(relayer);
        vm.prank(relayer);
        vm.expectRevert(GroupKitty.NotMember.selector);
        gk.requestGrant(relayer, g, 0.1e6, n, _dl(), "");
    }

    function test_grantNoLiquidityWhenFundDrained() public {
        uint256 g = _groupWith5(1);
        uint256 n = gk.nonces(bob);
        vm.prank(bob);
        uint256 a = gk.requestGrant(bob, g, 0.8e6, n, _dl(), "");
        n = gk.nonces(carol);
        vm.prank(carol);
        uint256 b = gk.requestGrant(carol, g, 0.8e6, n, _dl(), "");
        _grantApprove(dave, a);
        _grantApprove(erin, a);
        _grantApprove(dave, b);
        _rev(GroupKitty.NoLiquidity.selector);
        _grantApproveExternal(erin, b);
    }

    function _grantApprove(address who, uint256 id) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        vm.prank(who);
        gk.approveGrant(who, id, n, dl, "");
    }

    function _grantApproveExternal(address who, uint256 id) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.approveGrant(who, id, n, dl, "");
    }

    // ------------------------------------------------------------ Share-Out rules

    function test_shareOutRules() public {
        uint256 g = _groupWith5(3);
        uint256 id = _request(bob, g, 3e6, 5 days, new address[](0), new uint256[](0));
        _approve(dave, id);
        _approve(erin, id);
        gk.disburse(id);
        _rev(GroupKitty.CycleNotEnded.selector);
        _claim(alice, g, 0);
        _warp(30 days);
        _rev(GroupKitty.LoansOutstanding.selector);
        _claim(alice, g, 0);
        gk.markDefault(id);
        _claim(alice, g, 0);
        _rev(GroupKitty.AlreadyClaimed.selector);
        _claim(alice, g, 0);
        _rev(GroupKitty.NotMember.selector);
        _claim(relayer, g, 0);
        // grants blocked after share-out started
        uint256 n = gk.nonces(bob);
        vm.prank(bob);
        vm.expectRevert(GroupKitty.ShareOutStarted.selector);
        gk.requestGrant(bob, g, 1, n, _dl(), "");
    }

    function test_shareOutDustGoesToLastClaimer() public {
        GroupKitty.Params memory p = _params();
        p.socialFundPerMeeting = 0.1e6 + 1; // odd amount -> division dust
        uint256 g = _create(alice, p);
        _join(bob, g);
        _join(carol, g);
        _buy(alice, g, 1);
        _buy(bob, g, 1);
        _buy(carol, g, 1);
        _warp(30 days);
        uint256 a = _claim(alice, g, 0);
        uint256 b = _claim(bob, g, 0);
        uint256 c = _claim(carol, g, 0);
        assertEq(a + b + c, 3e6 + 3 * (0.1e6 + 1));
        assertGe(c, a);
        assertEq(USDT.balanceOf(address(gk)), 0);
    }

    function test_memberWithZeroSharesGetsSocialPart() public {
        uint256 g = _create(alice, _params());
        _join(bob, g);
        _buy(alice, g, 1); // social 0.2
        _warp(30 days);
        assertEq(_claim(bob, g, 0), 0.1e6);
        assertEq(_claim(alice, g, 0), 1.1e6);
    }

    // ------------------------------------------------------------ signatures (relayer path, incl. array hashing)

    function test_relayedCreateJoinLoanApproveSignatures() public {
        GroupKitty.Params memory p = _params();
        uint256 dl = _dl();
        bytes32 h = keccak256(
            abi.encode(
                gk.CREATE_TYPEHASH(),
                alice,
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
                uint256(0),
                dl
            )
        );
        vm.prank(relayer);
        uint256 g = gk.createGroup(alice, p, 0, dl, _sign(pks[0], gk, h));

        bytes memory sig = _sign(pks[1], gk, keccak256(abi.encode(gk.JOIN_TYPEHASH(), bob, g, uint256(0), dl)));
        vm.prank(relayer);
        gk.join(bob, g, 0, dl, sig);
        _join(carol, g);
        _buy(bob, g, 5);
        _buy(carol, g, 5);

        address[] memory gs = _arr(carol);
        uint256[] memory ps = _arr(2);
        uint256 n = gk.nonces(bob);
        h = keccak256(
            abi.encode(
                gk.LOAN_TYPEHASH(),
                bob,
                g,
                uint256(6e6),
                uint64(3 days),
                keccak256(abi.encodePacked(gs)),
                keccak256(abi.encodePacked(ps)),
                n,
                dl
            )
        );
        vm.prank(relayer);
        uint256 id = gk.requestLoan(bob, g, 6e6, 3 days, gs, ps, n, dl, _sign(pks[1], gk, h));

        n = gk.nonces(carol);
        sig = _sign(pks[2], gk, keccak256(abi.encode(gk.APPROVE_TYPEHASH(), carol, id, n, dl)));
        vm.prank(relayer);
        gk.approveLoan(carol, id, n, dl, sig);

        // tampered guarantor list fails
        n = gk.nonces(dave);
        sig = _sign(pks[3], gk, keccak256(abi.encode(gk.APPROVE_TYPEHASH(), dave, id, n, dl)));
        uint256 an = gk.nonces(alice);
        vm.prank(relayer);
        vm.expectRevert(SigAuth.BadSignature.selector);
        gk.approveLoan(alice, id, an, dl, sig);
    }
}
