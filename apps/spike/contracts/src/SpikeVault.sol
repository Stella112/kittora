// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

// THROWAWAY Gate 0 / S5 spike vault. NOT production code. Never reuse.
// Pulls USDT from an owner who signed an EIP-712 Deposit; holds it; returns it on a signed Withdraw.
// Hard cap 5 USDT total (Maris, Nov 5 2026).
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SpikeVault is EIP712, Nonces, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant TOTAL_CAP = 5e6;
    bytes32 public constant DEPOSIT_TYPEHASH =
        keccak256("Deposit(address owner,uint256 amount,uint256 nonce,uint256 deadline)");
    bytes32 public constant WITHDRAW_TYPEHASH =
        keccak256("Withdraw(address owner,uint256 amount,uint256 nonce,uint256 deadline)");

    IERC20 public immutable token;
    mapping(address => uint256) public balanceOf;
    uint256 public total;

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);

    error Expired();
    error BadSignature();
    error CapExceeded();
    error Insufficient();

    constructor(IERC20 _token) EIP712("KittoraSpikeVault", "1") {
        token = _token;
    }

    function _check(bytes32 typehash, address owner, uint256 amount, uint256 deadline, bytes calldata sig) internal {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(typehash, owner, amount, _useNonce(owner), deadline)));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || signer != owner) revert BadSignature();
    }

    function deposit(address owner, uint256 amount, uint256 deadline, bytes calldata sig) external nonReentrant {
        _check(DEPOSIT_TYPEHASH, owner, amount, deadline, sig);
        if (total + amount > TOTAL_CAP) revert CapExceeded();
        balanceOf[owner] += amount;
        total += amount;
        emit Deposited(owner, amount);
        token.safeTransferFrom(owner, address(this), amount);
    }

    function withdraw(address owner, uint256 amount, uint256 deadline, bytes calldata sig) external nonReentrant {
        _check(WITHDRAW_TYPEHASH, owner, amount, deadline, sig);
        if (balanceOf[owner] < amount) revert Insufficient();
        balanceOf[owner] -= amount;
        total -= amount;
        emit Withdrawn(owner, amount);
        token.safeTransfer(owner, amount);
    }
}
