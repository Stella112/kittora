// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// Gate 0 / S5 fork test: user with ZERO POL signs (1) USDT MetaTransaction approve, (2) vault Deposit.
// A separate relayer account submits both and pays gas. Mirrors Nimiq Pay signTokenApproval
// (src/stores/polygon-usdt.ts @2115a8d): domain {name, version "1", verifyingContract, salt=chainId}.
import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SpikeVault} from "../src/SpikeVault.sol";

interface IMetaTxToken {
    function executeMetaTransaction(address user, bytes calldata fn, bytes32 r, bytes32 s, uint8 v)
        external
        payable
        returns (bytes memory);
    function getNonce(address user) external view returns (uint256);
    function name() external view returns (string memory);
}

contract SpikeVaultForkTest is Test {
    address constant USDT = 0xc2132D05D31c914a87C6611C10748AEb04B58e8F;
    bytes32 constant META_TX_TYPEHASH = keccak256("MetaTransaction(uint256 nonce,address from,bytes functionSignature)");

    SpikeVault vault;
    uint256 userPk = 0xA11CE;
    address user;
    address relayer = makeAddr("relayer");

    function setUp() public {
        vm.createSelectFork(vm.envOr("POLYGON_RPC_URL", string("https://polygon-bor-rpc.publicnode.com")));
        user = vm.addr(userPk);
        vault = new SpikeVault(IERC20(USDT));
        deal(USDT, user, 3e6);
        vm.deal(relayer, 1 ether);
        assertEq(user.balance, 0, "user must hold zero POL");
    }

    function _tokenDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,address verifyingContract,bytes32 salt)"),
                keccak256(bytes(IMetaTxToken(USDT).name())),
                keccak256("1"),
                USDT,
                bytes32(block.chainid)
            )
        );
    }

    function _signMetaApprove(uint256 amount) internal view returns (bytes memory fn, bytes32 r, bytes32 s, uint8 v) {
        fn = abi.encodeWithSelector(IERC20.approve.selector, address(vault), amount);
        bytes32 structHash =
            keccak256(abi.encode(META_TX_TYPEHASH, IMetaTxToken(USDT).getNonce(user), user, keccak256(fn)));
        (v, r, s) = vm.sign(userPk, keccak256(abi.encodePacked("\x19\x01", _tokenDomainSeparator(), structHash)));
    }

    function _signVault(bytes32 typehash, uint256 amount, uint256 deadline) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(abi.encode(typehash, user, amount, vault.nonces(user), deadline));
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("KittoraSpikeVault"),
                keccak256("1"),
                block.chainid,
                address(vault)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(userPk, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return abi.encodePacked(r, s, v);
    }

    function test_gaslessApproveDepositWithdraw() public {
        uint256 amt = 2e6;
        (bytes memory fn, bytes32 r, bytes32 s, uint8 v) = _signMetaApprove(amt);
        vm.prank(relayer, relayer);
        IMetaTxToken(USDT).executeMetaTransaction(user, fn, r, s, v);
        assertEq(IERC20(USDT).allowance(user, address(vault)), amt);

        uint256 dl = block.timestamp + 600;
        bytes memory sig = _signVault(vault.DEPOSIT_TYPEHASH(), amt, dl);
        vm.prank(relayer, relayer);
        vault.deposit(user, amt, dl, sig);
        assertEq(IERC20(USDT).balanceOf(address(vault)), amt);
        assertEq(vault.balanceOf(user), amt);

        // replay must fail (nonce consumed)
        vm.prank(relayer);
        vm.expectRevert(SpikeVault.BadSignature.selector);
        vault.deposit(user, amt, dl, sig);

        bytes memory wsig = _signVault(vault.WITHDRAW_TYPEHASH(), amt, dl);
        vm.prank(relayer, relayer);
        vault.withdraw(user, amt, dl, wsig);
        assertEq(IERC20(USDT).balanceOf(user), 3e6);
        assertEq(user.balance, 0, "user spent no POL");
    }

    function test_capEnforced() public {
        deal(USDT, user, 6e6);
        (bytes memory fn, bytes32 r, bytes32 s, uint8 v) = _signMetaApprove(6e6);
        IMetaTxToken(USDT).executeMetaTransaction(user, fn, r, s, v);
        uint256 dl = block.timestamp + 600;
        bytes memory sig = _signVault(vault.DEPOSIT_TYPEHASH(), 6e6, dl);
        vm.expectRevert(SpikeVault.CapExceeded.selector);
        vault.deposit(user, 6e6, dl, sig);
    }
}
