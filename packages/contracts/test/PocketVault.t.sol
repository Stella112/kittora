// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Base} from "./Base.t.sol";
import {PocketVault} from "../src/PocketVault.sol";
import {SigAuth} from "../src/SigAuth.sol";
import {IAavePool} from "../src/interfaces/IKittora.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

contract PocketVaultTest is Base {
    // ------------------------------------------------------------ setup / wiring

    function test_constructorRejectsZero() public {
        vm.expectRevert(PocketVault.BadParams.selector);
        new PocketVault(IERC20(address(0)), AUSDT, IAavePool(address(1)), attester, BURN, 1);
        vm.expectRevert(PocketVault.BadParams.selector);
        new PocketVault(USDT, AUSDT, IAavePool(address(1)), address(0), BURN, 1);
    }

    function test_setGroupKittyOnce() public {
        vm.expectRevert(PocketVault.AlreadySet.selector);
        vault.setGroupKitty(address(1));
        PocketVault v2 = new PocketVault(USDT, AUSDT, IAavePool(address(1)), attester, BURN, 1);
        vm.prank(alice);
        vm.expectRevert(PocketVault.NotOwner.selector);
        v2.setGroupKitty(address(1));
        vm.expectRevert(PocketVault.BadParams.selector);
        v2.setGroupKitty(address(0));
    }

    // ------------------------------------------------------------ open / deposit

    function test_openFlexWithDeposit() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 10e6);
        assertEq(id, 1);
        assertApproxEqAbs(vault.pocketAssets(id), 10e6, 2);
        assertEq(vault.principalOf(alice), 10e6);
        assertEq(USDT.balanceOf(alice), 990e6);
    }

    function test_openEmptyPocketThenDeposit() public {
        uint256 id = _open(alice, PocketVault.Kind.Target, 0, 50e6, 0);
        uint256 n = vault.nonces(alice);
        vm.prank(alice);
        vault.deposit(alice, id, 5e6, n, _dl(), "");
        assertApproxEqAbs(vault.pocketAssets(id), 5e6, 2);
        (,,, uint256 target,) = vault.pockets(id);
        assertEq(target, 50e6);
    }

    function test_openRevertPaths() public {
        PocketVault.OpenPocketReq memory r = PocketVault.OpenPocketReq(alice, PocketVault.Kind.Bond, 0, 0, 0, 0, _dl());
        vm.startPrank(alice);
        vm.expectRevert(PocketVault.WrongKind.selector);
        vault.openPocket(r, "");
        r.kind = PocketVault.Kind.SafeLock;
        vm.expectRevert(PocketVault.BadParams.selector); // unlock in the past
        vault.openPocket(r, "");
        r.kind = PocketVault.Kind.Flex;
        r.unlockAt = uint64(block.timestamp + 1);
        vm.expectRevert(PocketVault.BadParams.selector); // flex with unlock
        vault.openPocket(r, "");
        r.kind = PocketVault.Kind.Target;
        r.unlockAt = 0;
        vm.expectRevert(PocketVault.BadParams.selector); // target 0
        vault.openPocket(r, "");
        r.owner = address(0);
        vm.stopPrank();
    }

    function test_depositCaps() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 0);
        uint256 n = vault.nonces(alice);
        vm.startPrank(alice);
        vm.expectRevert(PocketVault.CapExceeded.selector);
        vault.deposit(alice, id, 25e6 + 1, n, _dl(), "");
        vm.expectRevert(PocketVault.ZeroAmount.selector);
        vault.deposit(alice, id, 0, n, _dl(), "");
        for (uint256 i; i < 4; ++i) {
            vault.deposit(alice, id, 25e6, vault.nonces(alice), _dl(), "");
        }
        n = vault.nonces(alice);
        vm.expectRevert(PocketVault.CapExceeded.selector); // 100 USDT per user
        vault.deposit(alice, id, 1, n, _dl(), "");
        vm.stopPrank();
    }

    function test_depositNotOwnerOrBondPocket() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 0);
        uint256 n = vault.nonces(bob);
        vm.prank(bob);
        vm.expectRevert(PocketVault.NotOwner.selector);
        vault.deposit(bob, id, 1e6, n, _dl(), "");
        uint256 bid = _lockBond(alice, 5e6, 0);
        (uint256 pid,,,,,,,) = vault.bonds(bid);
        n = vault.nonces(alice);
        vm.prank(alice);
        vm.expectRevert(PocketVault.WrongKind.selector);
        vault.deposit(alice, pid, 1e6, n, _dl(), "");
    }

    // ------------------------------------------------------------ signatures (relayer path)

    function test_relayedDepositWithSignature() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 0);
        uint256 n = vault.nonces(alice);
        uint256 dl = _dl();
        bytes memory sig = _sign(pks[0], vault, keccak256(abi.encode(vault.DEPOSIT_TYPEHASH(), alice, id, 3e6, n, dl)));
        vm.prank(relayer);
        vault.deposit(alice, id, 3e6, n, dl, sig);
        assertApproxEqAbs(vault.pocketAssets(id), 3e6, 2);

        vm.prank(relayer); // replay
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, alice, n + 1));
        vault.deposit(alice, id, 3e6, n, dl, sig);
    }

    function test_forgedAndExpiredSignatures() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 0);
        uint256 n = vault.nonces(alice);
        uint256 dl = _dl();
        bytes memory bobSig = _sign(pks[1], vault, keccak256(abi.encode(vault.DEPOSIT_TYPEHASH(), alice, id, 3e6, n, dl)));
        vm.prank(relayer);
        vm.expectRevert(SigAuth.BadSignature.selector);
        vault.deposit(alice, id, 3e6, n, dl, bobSig);

        vm.prank(relayer); // empty sig from a non-signer
        vm.expectRevert(SigAuth.BadSignature.selector);
        vault.deposit(alice, id, 3e6, n, dl, "");

        vm.prank(relayer);
        vm.expectRevert(SigAuth.BadSignature.selector); // malformed
        vault.deposit(alice, id, 3e6, n, dl, hex"1234");

        bytes memory sig = _sign(pks[0], vault, keccak256(abi.encode(vault.DEPOSIT_TYPEHASH(), alice, id, 3e6, n, dl)));
        vm.warp(dl + 1);
        vm.prank(relayer);
        vm.expectRevert(SigAuth.Expired.selector);
        vault.deposit(alice, id, 3e6, n, dl, sig);
    }

    // ------------------------------------------------------------ yield

    function test_yieldAccruesProRata() public {
        uint256 a = _open(alice, PocketVault.Kind.Flex, 0, 0, 20e6);
        uint256 b = _open(bob, PocketVault.Kind.Target, 0, 1, 10e6);
        vm.warp(block.timestamp + 180 days);
        uint256 ga = vault.pocketAssets(a);
        uint256 gb = vault.pocketAssets(b);
        assertGt(ga, 20e6);
        assertGt(gb, 10e6);
        // alice's gain ~ 2x bob's gain
        assertApproxEqRel(ga - 20e6, 2 * (gb - 10e6), 0.001e18);
        assertLe(ga + gb, vault.totalAssets());
        // late depositor does not capture earlier yield
        uint256 c = _open(carol, PocketVault.Kind.Flex, 0, 0, 10e6);
        assertApproxEqAbs(vault.pocketAssets(c), 10e6, 2);
    }

    // ------------------------------------------------------------ withdraw

    function test_withdrawFlexPartialAndAll() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 10e6);
        vm.warp(block.timestamp + 30 days);
        _withdraw(alice, id, 4e6);
        assertEq(USDT.balanceOf(alice), 994e6);
        assertEq(vault.principalOf(alice), 6e6);
        uint256 rest = _withdraw(alice, id, type(uint256).max);
        assertGt(rest, 6e6); // includes yield
        assertEq(vault.principalOf(alice), 0);
        (,,,, uint256 sh) = vault.pockets(id);
        assertEq(sh, 0);
    }

    function test_withdrawRevertPaths() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 10e6);
        uint256 n = vault.nonces(alice);
        vm.startPrank(alice);
        vm.expectRevert(PocketVault.Insufficient.selector);
        vault.withdraw(alice, id, 11e6, alice, n, _dl(), "");
        vm.expectRevert(PocketVault.BadParams.selector);
        vault.withdraw(alice, id, 1e6, address(0), n, _dl(), "");
        vm.expectRevert(PocketVault.ZeroAmount.selector);
        vault.withdraw(alice, id, 0, alice, n, _dl(), "");
        vm.stopPrank();
        n = vault.nonces(bob);
        vm.prank(bob);
        vm.expectRevert(PocketVault.NotOwner.selector);
        vault.withdraw(bob, id, 1e6, bob, n, _dl(), "");
    }

    function test_safeLockBlockedBeforeUnlockThenOpens() public {
        uint64 unlock = uint64(block.timestamp + 7 days);
        uint256 id = _open(alice, PocketVault.Kind.SafeLock, unlock, 0, 10e6);
        uint256 n = vault.nonces(alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PocketVault.Locked.selector, unlock));
        vault.withdraw(alice, id, 1e6, alice, n, _dl(), "");
        vm.warp(unlock);
        uint256 out = _withdraw(alice, id, type(uint256).max);
        assertGt(out, 10e6 - 1);
    }

    // ------------------------------------------------------------ depositFor

    function test_depositForOnlyGroupKitty() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 0);
        vm.expectRevert(PocketVault.NotGroupKitty.selector);
        vault.depositFor(alice, id, 1e6);
        deal(address(USDT), address(gk), 5e6);
        vm.startPrank(address(gk));
        USDT.approve(address(vault), 5e6);
        vault.depositFor(alice, id, 5e6);
        vm.expectRevert(PocketVault.NotOwner.selector);
        vault.depositFor(bob, id, 1e6);
        vm.stopPrank();
        assertApproxEqAbs(vault.pocketAssets(id), 5e6, 2);
    }

    // ------------------------------------------------------------ autosave

    function _mandate(address who, uint256 amount, uint64 interval, uint32 maxRuns, uint64 expiry, bool toGroup, uint256 dest)
        internal
        returns (uint256)
    {
        PocketVault.MandateReq memory r =
            PocketVault.MandateReq(who, amount, interval, maxRuns, expiry, toGroup, dest, vault.nonces(who), _dl());
        vm.prank(who);
        return vault.createMandate(r, "");
    }

    function test_autosaveIntervalCapExpiryRevoke() public {
        uint256 id = _open(alice, PocketVault.Kind.Target, 0, 50e6, 0);
        uint256 m = _mandate(alice, 2e6, 1 days, 3, uint64(block.timestamp + 10 days), false, id);
        vm.startPrank(relayer);
        vault.executeMandate(m); // first run immediately
        vm.expectRevert(PocketVault.TooEarly.selector);
        vault.executeMandate(m);
        // via_ir caches block.timestamp in tests; track time explicitly
        uint256 t = vm.getBlockTimestamp();
        vm.warp(t += 1 days - 1);
        vm.expectRevert(PocketVault.TooEarly.selector); // 1 second early
        vault.executeMandate(m);
        vm.warp(t += 1);
        vault.executeMandate(m);
        vm.warp(t += 1 days);
        vault.executeMandate(m);
        vm.warp(t += 1 days);
        vm.expectRevert(PocketVault.MandateInactive.selector); // maxRuns reached
        vault.executeMandate(m);
        vm.stopPrank();
        assertGe(vault.pocketAssets(id), 6e6 - 3); // 3 runs x 2 USDT, plus yield

        uint256 m2 = _mandate(alice, 1e6, 1 days, 10, uint64(t + 2 days), false, id);
        vm.warp(t += 3 days);
        vm.expectRevert(SigAuth.Expired.selector);
        vault.executeMandate(m2);

        uint256 m3 = _mandate(alice, 1e6, 1 days, 10, uint64(t + 10 days), false, id);
        uint256 n = vault.nonces(alice);
        uint256 dl = _dl();
        bytes memory sig = _sign(pks[0], vault, keccak256(abi.encode(vault.REVOKE_TYPEHASH(), alice, m3, n, dl)));
        vm.prank(relayer);
        vault.revokeMandate(alice, m3, n, dl, sig);
        vm.expectRevert(PocketVault.MandateInactive.selector);
        vault.executeMandate(m3);
        n = vault.nonces(alice);
        vm.prank(alice);
        vm.expectRevert(PocketVault.MandateInactive.selector);
        vault.revokeMandate(alice, m3, n, _dl(), "");
        n = vault.nonces(bob);
        vm.prank(bob);
        vm.expectRevert(PocketVault.NotOwner.selector);
        vault.revokeMandate(bob, m3, n, _dl(), "");
        vm.expectRevert(PocketVault.MandateInactive.selector);
        vault.executeMandate(999);
    }

    function test_autosaveAllowanceAndParams() public {
        uint256 id = _open(alice, PocketVault.Kind.Flex, 0, 0, 0);
        uint256 m = _mandate(alice, 2e6, 1 days, 3, uint64(block.timestamp + 10 days), false, id);
        vm.prank(alice);
        USDT.approve(address(vault), 1e6);
        vm.expectRevert(PocketVault.InsufficientAllowance.selector);
        vault.executeMandate(m);

        PocketVault.MandateReq memory r =
            PocketVault.MandateReq(alice, 0, 1 days, 3, uint64(block.timestamp + 1 days), false, id, vault.nonces(alice), _dl());
        vm.startPrank(alice);
        vm.expectRevert(PocketVault.BadParams.selector);
        vault.createMandate(r, "");
        r.amountPerRun = 26e6;
        vm.expectRevert(PocketVault.CapExceeded.selector);
        vault.createMandate(r, "");
        r.amountPerRun = 1e6;
        r.toGroup = true;
        r.destId = 1;
        vm.expectRevert(PocketVault.NotMember.selector);
        vault.createMandate(r, "");
        vm.stopPrank();
    }

    function test_autosaveIntoGroup() public {
        uint256 g = _create(alice, _params());
        // 2 shares (2 USDT) + 0.2 social = 2.2 USDT per run
        uint256 m = _mandate(alice, 2.2e6, 1 days, 2, uint64(block.timestamp + 10 days), true, g);
        vault.executeMandate(m);
        (uint256 s,) = _memberShares(g, alice);
        assertEq(s, 2);
        assertEq(_social(g), 0.2e6);
        vm.warp(block.timestamp + 1 days);
        vault.executeMandate(m);
        (s,) = _memberShares(g, alice);
        assertEq(s, 4);
        // wrong amount for the group
        uint256 bad = _mandate(alice, 2.5e6, 1 days, 2, uint64(block.timestamp + 10 days), true, g);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(); // GroupKitty.BadParams bubbles
        vault.executeMandate(bad);
    }

    // ------------------------------------------------------------ NIM SafeLock bond

    function _lockBond(address who, uint256 amount, uint256 groupId) internal returns (uint256) {
        PocketVault.BondReq memory r = PocketVault.BondReq({
            owner: who,
            amount: amount,
            unlockAt: uint64(block.timestamp + 30 days),
            nimiqAddress: bytes20(uint160(0xBEEF)),
            nimLuna: 100e5,
            groupId: groupId,
            linkHash: keccak256("link"),
            nonce: vault.nonces(who),
            deadline: _dl()
        });
        vm.prank(who);
        return vault.lockBond(r, "");
    }

    function test_bondClaimAfterUnlock() public {
        uint256 b = _lockBond(alice, 5e6, 0);
        (, , , uint64 unlockAt,,,,) = vault.bonds(b);
        uint256 n = vault.nonces(alice);
        vm.prank(alice);
        vm.expectRevert(PocketVault.ClaimNotOpen.selector);
        vault.claimBond(alice, b, n, _dl(), "");
        vm.warp(unlockAt + CLAIM_DELAY + 1);
        n = vault.nonces(alice);
        uint256 dl = _dl();
        bytes memory sig = _sign(pks[0], vault, keccak256(abi.encode(vault.CLAIM_TYPEHASH(), alice, b, n, dl)));
        vm.prank(relayer);
        uint256 out = vault.claimBond(alice, b, n, dl, sig);
        assertGe(out, 5e6 - 1);
        assertEq(USDT.balanceOf(alice), 995e6 + out);
        vm.prank(attester);
        vm.expectRevert(PocketVault.BondInactive.selector);
        vault.forfeitBond(b, bytes32(uint256(1)));
        n = vault.nonces(bob);
        vm.prank(bob);
        vm.expectRevert(PocketVault.NotOwner.selector);
        vault.claimBond(bob, b, n, _dl(), "");
    }

    function test_bondForfeitToBurnWhenNoGroup() public {
        uint256 b = _lockBond(alice, 5e6, 0);
        vm.expectRevert(PocketVault.NotAttester.selector);
        vault.forfeitBond(b, bytes32(uint256(1)));
        vm.startPrank(attester);
        vm.expectRevert(PocketVault.BadParams.selector);
        vault.forfeitBond(b, bytes32(0));
        uint256 before = USDT.balanceOf(BURN);
        vm.expectEmit(true, false, false, false);
        emit PocketVault.BondForfeited(b, bytes32(uint256(0xabc)), BURN, 0, 0);
        vault.forfeitBond(b, bytes32(uint256(0xabc)));
        vm.stopPrank();
        assertGe(USDT.balanceOf(BURN) - before, 5e6 - 1);
        uint256 n = vault.nonces(alice);
        vm.warp(block.timestamp + 60 days);
        vm.prank(alice);
        vm.expectRevert(PocketVault.BondInactive.selector);
        vault.claimBond(alice, b, n, _dl(), "");
    }

    function test_bondForfeitToGroupSocialFund() public {
        uint256 g = _create(alice, _params());
        uint256 b = _lockBond(alice, 5e6, g);
        vm.prank(attester);
        vault.forfeitBond(b, bytes32(uint256(7)));
        assertGe(_social(g), 5e6 - 1);
    }

    function test_bondForfeitFallsBackToBurnAfterShareOut() public {
        uint256 g = _create(alice, _params());
        _buy(alice, g, 1);
        uint256 b = _lockBond(alice, 5e6, g);
        vm.warp(block.timestamp + 30 days);
        _claim(alice, g, 0); // share-out started
        uint256 before = USDT.balanceOf(BURN);
        vm.prank(attester);
        vault.forfeitBond(b, bytes32(uint256(7)));
        assertGe(USDT.balanceOf(BURN) - before, 5e6 - 1);
    }

    function test_bondForfeitWindowCloses() public {
        uint256 b = _lockBond(alice, 5e6, 0);
        vm.warp(block.timestamp + 30 days + CLAIM_DELAY + 1);
        vm.prank(attester);
        vm.expectRevert(PocketVault.ForfeitWindowClosed.selector);
        vault.forfeitBond(b, bytes32(uint256(1)));
    }

    function test_bondRevertPaths() public {
        PocketVault.BondReq memory r = PocketVault.BondReq(
            alice, 5e6, uint64(block.timestamp), bytes20(uint160(1)), 1, 0, keccak256("x"), 0, _dl()
        );
        vm.startPrank(alice);
        vm.expectRevert(PocketVault.BadParams.selector);
        vault.lockBond(r, "");
        r.unlockAt = uint64(block.timestamp + 1 days);
        r.groupId = 42;
        vm.expectRevert(PocketVault.NotMember.selector);
        vault.lockBond(r, "");
        vm.stopPrank();
    }

    function test_relayedLockBondSignature() public {
        PocketVault.BondReq memory r = PocketVault.BondReq(
            alice, 5e6, uint64(block.timestamp + 1 days), bytes20(uint160(1)), 1, 0, keccak256("x"), 0, _dl()
        );
        bytes32 h = keccak256(
            abi.encode(
                vault.BOND_TYPEHASH(), r.owner, r.amount, r.unlockAt, r.nimiqAddress, r.nimLuna, r.groupId, r.linkHash, r.nonce, r.deadline
            )
        );
        bytes memory sig = _sign(pks[0], vault, h);
        vm.prank(relayer);
        vault.lockBond(r, sig);
        assertEq(vault.bondCount(), 1);
    }

    function test_relayedOpenAndMandateSignatures() public {
        PocketVault.OpenPocketReq memory o = PocketVault.OpenPocketReq(alice, PocketVault.Kind.Flex, 0, 0, 1e6, 0, _dl());
        bytes memory sig = _sign(
            pks[0], vault, keccak256(abi.encode(vault.OPEN_TYPEHASH(), o.owner, o.kind, o.unlockAt, o.target, o.amount, o.nonce, o.deadline))
        );
        vm.prank(relayer);
        uint256 id = vault.openPocket(o, sig);
        PocketVault.MandateReq memory m =
            PocketVault.MandateReq(alice, 1e6, 1 days, 2, uint64(block.timestamp + 5 days), false, id, 1, _dl());
        sig = _sign(
            pks[0],
            vault,
            keccak256(
                abi.encode(vault.MANDATE_TYPEHASH(), m.owner, m.amountPerRun, m.interval, m.maxRuns, m.expiry, m.toGroup, m.destId, m.nonce, m.deadline)
            )
        );
        vm.prank(relayer);
        vault.createMandate(m, sig);
        uint256 n = 2;
        uint256 dl = _dl();
        sig = _sign(pks[0], vault, keccak256(abi.encode(vault.WITHDRAW_TYPEHASH(), alice, id, 1e6 / 2, alice, n, dl)));
        vm.prank(relayer);
        vault.withdraw(alice, id, 1e6 / 2, alice, n, dl, sig);
    }
}
