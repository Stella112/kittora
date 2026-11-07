// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {GroupKitty} from "../src/GroupKitty.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {SigAuth} from "../src/SigAuth.sol";

/// Addendum A1 gates: profile (A1.1), roles (A1.4), social fund payments (A1.5), one Autosave run per window (A1.3).
contract GroupKittyA1Test is Base {
    // ---------------------------------------------------------------- helpers (nonce read before the armed revert)

    function _now() internal view returns (uint256) {
        return vm.getBlockTimestamp(); // via_ir caches block.timestamp in tests
    }

    function _edit(address who, uint256 g, string memory name, string memory purpose, uint8 cover) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.updateProfile(who, g, name, purpose, cover, n, dl, "");
    }

    function _treasurer(address who, uint256 g, address m, bool on) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.setTreasurer(who, g, m, on, n, dl, "");
    }

    function _transfer(address who, uint256 g, address to) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.transferAdmin(who, g, to, n, dl, "");
    }

    function _remove(address who, uint256 g, address m) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.removeMember(who, g, m, n, dl, "");
    }

    function _propose(address who, uint256 g, address to, uint256 amount) internal returns (uint256 id) {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        id = gk.proposeSocialPayout(who, g, to, amount, "School fees", n, dl, "");
    }

    function _payApprove(address who, uint256 id) internal {
        uint256 n = gk.nonces(who);
        uint256 dl = _dl();
        _arm();
        vm.prank(who);
        gk.approveSocialPayout(who, id, n, dl, "");
    }

    function _execute(uint256 id) internal {
        _arm();
        gk.executeSocialPayout(id);
    }

    function _str(uint256 len) internal pure returns (string memory) {
        bytes memory b = new bytes(len);
        for (uint256 i; i < len; ++i) {
            b[i] = "a";
        }
        return string(b);
    }

    // ---------------------------------------------------------------- A1.1 profile

    function test_A1_1_createWithProfile() public {
        GroupKitty.Profile memory prof = GroupKitty.Profile({name: "Market traders", purpose: "Yaba, Lagos", coverId: 3});
        vm.expectEmit(false, false, false, true, address(gk));
        emit GroupKitty.GroupProfileUpdated(1, "Market traders", "Yaba, Lagos", 3);
        uint256 g = _createP(alice, _params(), prof);
        GroupKitty.Profile memory got = gk.profile(g);
        assertEq(got.name, "Market traders");
        assertEq(got.purpose, "Yaba, Lagos");
        assertEq(got.coverId, 3);
        assertEq(gk.adminOf(g), alice);
        assertEq(uint8(gk.roleOf(g, alice)), uint8(GroupKitty.Role.Admin));
    }

    function test_A1_1_adminEditsOthersCannot() public {
        uint256 g = _groupWith5(1);
        _edit(alice, g, "Family savings 2027", "For the house", 7);
        assertEq(gk.profile(g).name, "Family savings 2027");
        assertEq(gk.profile(g).coverId, 7);
        _rev(GroupKitty.NotAdmin.selector);
        _edit(bob, g, "Hijack", "", 0);
        _rev(GroupKitty.NotAdmin.selector);
        _edit(relayer, g, "Hijack", "", 0);
        assertEq(gk.profile(g).name, "Family savings 2027");
    }

    function test_A1_1_lengthAndCoverLimits() public {
        uint256 g = _groupWith5(1);
        _edit(alice, g, _str(32), _str(80), 7); // exactly at the limits
        _rev(GroupKitty.BadProfile.selector);
        _edit(alice, g, _str(33), "", 0);
        _rev(GroupKitty.BadProfile.selector);
        _edit(alice, g, "", "", 0);
        _rev(GroupKitty.BadProfile.selector);
        _edit(alice, g, "ok", _str(81), 0);
        _rev(GroupKitty.BadProfile.selector);
        _edit(alice, g, "ok", "", 8);
        // multi-byte UTF-8 counts bytes, not characters: 11 x "₦" (3 bytes) = 33 bytes
        _rev(GroupKitty.BadProfile.selector);
        _edit(alice, g, unicode"₦₦₦₦₦₦₦₦₦₦₦", "", 0);
        _rev(GroupKitty.BadProfile.selector);
        _createP(bob, _params(), GroupKitty.Profile({name: _str(33), purpose: "", coverId: 0}));
    }

    function test_A1_1_relayedProfileSignature() public {
        uint256 g = _groupWith5(1);
        uint256 dl = _dl();
        uint256 n = gk.nonces(alice);
        bytes32 h = keccak256(
            abi.encode(
                gk.PROFILE_TYPEHASH(), alice, g, keccak256(bytes("Ajo club")), keccak256(bytes("Fridays")), uint8(2), n, dl
            )
        );
        bytes memory sig = _sign(pks[0], gk, h);
        vm.prank(relayer);
        gk.updateProfile(alice, g, "Ajo club", "Fridays", 2, n, dl, sig);
        assertEq(gk.profile(g).name, "Ajo club");
        // the same signature cannot carry different text
        n = gk.nonces(alice);
        h = keccak256(
            abi.encode(gk.PROFILE_TYPEHASH(), alice, g, keccak256(bytes("Ajo club")), keccak256(bytes("x")), uint8(2), n, dl)
        );
        sig = _sign(pks[0], gk, h);
        vm.prank(relayer);
        vm.expectRevert(SigAuth.BadSignature.selector);
        gk.updateProfile(alice, g, "Ajo club", "Fridays", 2, n, dl, sig);
    }

    // ---------------------------------------------------------------- A1.4 roles

    function test_A1_4_onlyAdminAssignsRoles() public {
        uint256 g = _groupWith5(1);
        _rev(GroupKitty.NotAdmin.selector);
        _treasurer(bob, g, carol, true);
        _treasurer(alice, g, carol, true);
        assertEq(uint8(gk.roleOf(g, carol)), uint8(GroupKitty.Role.Treasurer));
        _rev(GroupKitty.BadParams.selector); // already a Treasurer
        _treasurer(alice, g, carol, true);
        _treasurer(alice, g, dave, true);
        _rev(GroupKitty.TooManyTreasurers.selector);
        _treasurer(alice, g, erin, true);
        _rev(GroupKitty.AdminCannotBeTreasurer.selector);
        _treasurer(alice, g, alice, true);
        _rev(GroupKitty.NotMember.selector);
        _treasurer(alice, g, relayer, true);
        _treasurer(alice, g, dave, false);
        assertEq(uint8(gk.roleOf(g, dave)), uint8(GroupKitty.Role.Member));
        assertEq(gk.treasurerCount(g), 1);
    }

    function test_A1_4_transferAdmin() public {
        uint256 g = _groupWith5(1);
        _treasurer(alice, g, bob, true);
        _rev(GroupKitty.NotAdmin.selector);
        _transfer(carol, g, carol);
        _rev(GroupKitty.BadParams.selector);
        _transfer(alice, g, relayer); // not a member
        _transfer(alice, g, bob); // a Treasurer becomes Admin and stops being Treasurer
        assertEq(gk.adminOf(g), bob);
        assertEq(uint8(gk.roleOf(g, bob)), uint8(GroupKitty.Role.Admin));
        assertFalse(gk.isTreasurer(g, bob));
        assertEq(gk.treasurerCount(g), 0);
        assertEq(uint8(gk.roleOf(g, alice)), uint8(GroupKitty.Role.Member));
        _rev(GroupKitty.NotAdmin.selector);
        _edit(alice, g, "old admin", "", 0);
        _edit(bob, g, "new admin", "", 1);
        _rev(GroupKitty.AdminCannotBeTreasurer.selector);
        _treasurer(bob, g, bob, true);
    }

    function test_A1_4_removeOnlyEmptyMembers() public {
        uint256 g = _create(alice, _params());
        _join(bob, g);
        _join(carol, g);
        _join(dave, g);
        _buy(bob, g, 3);
        _buy(dave, g, 3);
        _rev(GroupKitty.NotRemovable.selector);
        _remove(alice, g, bob); // holds shares
        _rev(GroupKitty.NotRemovable.selector);
        _remove(alice, g, alice); // the Admin
        _rev(GroupKitty.NotAdmin.selector);
        _remove(bob, g, carol);
        // a pledge blocks removal too: carol buys, guarantees bob, then has shares and a pledge
        _buy(carol, g, 2);
        uint256 id = _request(bob, g, 4e6, 1 days, _arr(carol), _arr(1));
        _approve(carol, id);
        _rev(GroupKitty.NotRemovable.selector);
        _remove(alice, g, carol);
        // a member with no shares, loan or pledge can be removed, and their role goes with them
        _join(erin, g);
        _treasurer(alice, g, erin, true);
        uint256 cashBefore = _cash(g);
        _remove(alice, g, erin);
        assertFalse(gk.isMember(g, erin));
        assertEq(uint8(gk.roleOf(g, erin)), uint8(GroupKitty.Role.None));
        assertEq(gk.treasurerCount(g), 0);
        address[] memory list = gk.memberList(g);
        assertEq(list.length, 4);
        for (uint256 i; i < list.length; ++i) {
            assertTrue(list[i] != erin);
        }
        (,, uint16 memberCount,,,,,,) = gk.groupState(g);
        assertEq(memberCount, 4);
        assertEq(_cash(g), cashBefore);
        _join(erin, g); // can rejoin
        assertTrue(gk.isMember(g, erin));
    }

    function test_A1_4_rolesNeverMoveMoney() public {
        uint256 g = _groupWith5(3);
        uint256 bal = USDT.balanceOf(address(gk));
        (uint256 cash, uint256 social, uint256 shares) = (_cash(g), _social(g), _totalShares(g));
        _treasurer(alice, g, bob, true);
        _transfer(alice, g, carol);
        _treasurer(carol, g, bob, false);
        _edit(carol, g, "x", "y", 1);
        assertEq(USDT.balanceOf(address(gk)), bal);
        assertEq(_cash(g), cash);
        assertEq(_social(g), social);
        assertEq(_totalShares(g), shares);
        for (uint256 i; i < 5; ++i) {
            (uint256 s,) = _memberShares(g, users[i]);
            assertEq(s, 3);
        }
    }

    // ---------------------------------------------------------------- A1.5 social fund payments

    function _cappedGroup(uint256 cap) internal returns (uint256 g) {
        GroupKitty.Params memory p = _params();
        p.maxSocialPayout = cap;
        g = _create(alice, p);
        for (uint256 i = 1; i < 5; ++i) {
            _join(users[i], g);
        }
        for (uint256 i; i < 5; ++i) {
            _buy(users[i], g, 1); // social fund 5 x 0.2 = 1.0
        }
    }

    function test_A1_5_capAndRecipientRules() public {
        uint256 g = _cappedGroup(0.5e6);
        _rev(GroupKitty.BadParams.selector);
        _propose(bob, g, bob, 0.5e6 + 1); // over the per-payout cap
        _rev(GroupKitty.NotMember.selector);
        _propose(bob, g, relayer, 0.1e6); // outside address
        _rev(GroupKitty.NotMember.selector);
        _propose(relayer, g, bob, 0.1e6); // non-member proposer
        uint256 n = gk.nonces(bob);
        uint256 dl = _dl();
        vm.prank(bob);
        vm.expectRevert(GroupKitty.BadProfile.selector);
        gk.proposeSocialPayout(bob, g, bob, 0.1e6, "", n, dl, ""); // empty reason
        vm.prank(bob);
        vm.expectRevert(GroupKitty.BadProfile.selector);
        gk.proposeSocialPayout(bob, g, bob, 0.1e6, _str(81), n, dl, "");
        _propose(bob, g, bob, 0.5e6); // at the cap
    }

    function test_A1_5_proposerAndRecipientApprovalsDontCount() public {
        uint256 g = _cappedGroup(0);
        _treasurer(alice, g, erin, true);
        uint256 id = _propose(bob, g, carol, 0.4e6); // bob proposes for carol
        _rev(GroupKitty.SelfApproval.selector);
        _payApprove(bob, id);
        _rev(GroupKitty.SelfApproval.selector);
        _payApprove(carol, id);
        _payApprove(dave, id);
        _rev(GroupKitty.PayoutNotReady.selector); // 1 of 2
        _execute(id);
        _payApprove(erin, id); // Treasurer
        uint256 bal = USDT.balanceOf(carol);
        _execute(id);
        assertEq(USDT.balanceOf(carol), bal + 0.4e6);
    }

    function test_A1_5_needsTreasurerOrAdminWhenNoTreasurer() public {
        uint256 g = _cappedGroup(0);
        _treasurer(alice, g, erin, true);
        uint256 id = _propose(bob, g, bob, 0.3e6);
        _payApprove(carol, id);
        _payApprove(dave, id);
        _payApprove(alice, id); // the Admin, but the group has a Treasurer: does not stand in
        _rev(GroupKitty.PayoutNotReady.selector);
        _execute(id);
        _payApprove(erin, id);
        _execute(id);

        // no Treasurer: the Admin's approval counts instead
        _treasurer(alice, g, erin, false);
        uint256 id2 = _propose(bob, g, bob, 0.3e6);
        _payApprove(carol, id2);
        _payApprove(dave, id2);
        _rev(GroupKitty.PayoutNotReady.selector);
        _execute(id2);
        _payApprove(alice, id2);
        _execute(id2);
    }

    function test_A1_5_expiredCannotApproveOrExecute() public {
        uint256 g = _cappedGroup(0);
        uint256 id = _propose(bob, g, bob, 0.3e6);
        _payApprove(carol, id);
        _payApprove(alice, id);
        assertEq(gk.payout(id).expiresAt, _now() + 7 days);
        vm.warp(_now() + 7 days + 1);
        _rev(GroupKitty.PayoutExpired.selector);
        _execute(id);
        _rev(GroupKitty.PayoutExpired.selector);
        _payApprove(dave, id);
    }

    function test_A1_5_expiryNeverPassesCycleEnd() public {
        GroupKitty.Params memory p = _params();
        p.cycleEnd = uint64(_now() + 2 days);
        uint256 g = _create(alice, p);
        _join(bob, g);
        _join(carol, g);
        _buy(alice, g, 1);
        _buy(bob, g, 1);
        uint256 id = _propose(bob, g, bob, 0.1e6);
        assertEq(gk.payout(id).expiresAt, p.cycleEnd);
    }

    function test_A1_5_mainPoolUntouched() public {
        uint256 g = _cappedGroup(0);
        uint256 loan = _request(bob, g, 1e6, 1 days, new address[](0), new uint256[](0));
        _approve(carol, loan);
        _approve(dave, loan);
        gk.disburse(loan);
        (,,,,, uint256 socialBefore, uint256 outstanding,,) = gk.groupState(g);
        uint256 cash = _cash(g);
        uint256 shares = _totalShares(g);
        uint256 value = gk.valueOfShares(g, 1);
        uint256 id = _propose(carol, g, dave, 0.7e6);
        _payApprove(bob, id);
        _payApprove(alice, id);
        _execute(id);
        (,,,,, uint256 socialAfter, uint256 outstandingAfter,,) = gk.groupState(g);
        assertEq(socialAfter, socialBefore - 0.7e6);
        assertEq(_cash(g), cash);
        assertEq(outstandingAfter, outstanding);
        assertEq(_totalShares(g), shares);
        assertEq(gk.valueOfShares(g, 1), value); // share value excludes the social fund
        _rev(GroupKitty.BadParams.selector);
        _execute(id); // once only
    }

    function test_A1_5_relayedProposeSignature() public {
        uint256 g = _cappedGroup(0);
        uint256 dl = _dl();
        uint256 n = gk.nonces(bob);
        bytes32 h = keccak256(
            abi.encode(gk.PROPOSE_TYPEHASH(), bob, g, carol, uint256(0.2e6), keccak256(bytes("Funeral")), n, dl)
        );
        bytes memory sig = _sign(pks[1], gk, h);
        vm.prank(relayer);
        uint256 id = gk.proposeSocialPayout(bob, g, carol, 0.2e6, "Funeral", n, dl, sig);
        assertEq(gk.payout(id).reason, "Funeral");
        n = gk.nonces(dave);
        sig = _sign(pks[3], gk, keccak256(abi.encode(gk.PAYOUT_APPROVE_TYPEHASH(), dave, id, n, dl)));
        vm.prank(relayer);
        gk.approveSocialPayout(dave, id, n, dl, sig);
        assertEq(gk.payout(id).approvals, 1);
    }

    // ---------------------------------------------------------------- A1.3 one Autosave run per meeting window

    function _groupMandate(address who, uint256 g, uint256 shares, uint32 runs) internal returns (uint256 m) {
        GroupKitty.Params memory p = gk.groupParams(g);
        PocketVault.MandateReq memory r = PocketVault.MandateReq(
            who, shares * p.sharePrice + p.socialFundPerMeeting, p.meetingInterval, runs, p.cycleEnd, true, g, vault.nonces(who), _dl()
        );
        vm.prank(who);
        m = vault.createMandate(r, "");
    }

    function _runs(uint256 m) internal view returns (uint32 runs) {
        (,,,, runs,,,,,) = vault.mandates(m);
    }

    function test_A1_3_twoConsecutiveWindows() public {
        uint256 g = _create(alice, _params());
        _join(bob, g);
        uint256 m = _groupMandate(bob, g, 2, 3);
        uint256 t = _now();
        vm.prank(relayer);
        vault.executeMandate(m); // window 0
        vm.warp(t + 1 days); // window 1
        vm.prank(relayer);
        vault.executeMandate(m);
        assertEq(gk.sharesInMeeting(g, bob, 0), 2);
        assertEq(gk.sharesInMeeting(g, bob, 1), 2);
        assertTrue(gk.socialPaid(g, bob, 0) && gk.socialPaid(g, bob, 1));
        assertEq(_runs(m), 2);
    }

    function test_A1_3_manualPurchaseSkipsWindowNoDoubleBuy() public {
        uint256 g = _create(alice, _params());
        _join(bob, g);
        uint256 m = _groupMandate(bob, g, 2, 3);
        uint256 t = _now();
        vm.prank(relayer);
        vault.executeMandate(m); // window 0 by Autosave
        vm.warp(t + 1 days); // window 1: bob pays by hand first
        _buy(bob, g, 1);
        uint256 bal = USDT.balanceOf(bob);
        vm.prank(relayer);
        vm.expectRevert(GroupKitty.AlreadyContributed.selector);
        vault.executeMandate(m);
        assertEq(USDT.balanceOf(bob), bal); // nothing pulled
        assertEq(gk.sharesInMeeting(g, bob, 1), 1); // not doubled
        assertEq(_runs(m), 1); // the run was not used up
        vm.warp(t + 2 days); // window 2 runs normally
        vm.prank(relayer);
        vault.executeMandate(m);
        assertEq(gk.sharesInMeeting(g, bob, 2), 2);
        assertEq(_runs(m), 2);
        (uint256 s,) = _memberShares(g, bob);
        assertEq(s, 5);
    }

    function test_A1_3_secondRunInSameWindowReverts() public {
        GroupKitty.Params memory p = _params();
        uint256 g = _create(alice, p);
        _join(bob, g);
        // a mandate whose interval is shorter than the meeting: the contract still allows one run per window
        PocketVault.MandateReq memory r = PocketVault.MandateReq(
            bob, 1e6 + p.socialFundPerMeeting, 1 hours, 5, p.cycleEnd, true, g, vault.nonces(bob), _dl()
        );
        vm.prank(bob);
        uint256 m = vault.createMandate(r, "");
        vm.prank(relayer);
        vault.executeMandate(m);
        vm.warp(_now() + 1 hours);
        vm.prank(relayer);
        vm.expectRevert(GroupKitty.AlreadyContributed.selector);
        vault.executeMandate(m);
        assertEq(gk.sharesInMeeting(g, bob, 0), 1);
    }

    function test_A1_3_insufficientBalanceRunReverts() public {
        uint256 g = _create(alice, _params());
        _join(bob, g);
        uint256 m = _groupMandate(bob, g, 2, 3);
        deal(address(USDT), bob, 1e6); // less than 2.2 per run
        vm.prank(relayer);
        vm.expectRevert();
        vault.executeMandate(m);
        assertEq(_runs(m), 0);
        assertEq(gk.sharesInMeeting(g, bob, 0), 0);
    }
}
