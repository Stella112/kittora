// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @notice EIP-712 authorisation used by every user action. A relayer submits the user's signature and pays gas.
/// If `sig` is empty and the signer is calling directly, the signature check is skipped (nonce + deadline still apply).
abstract contract SigAuth is EIP712, Nonces {
    error Expired();
    error BadSignature();

    constructor(string memory name, string memory version) EIP712(name, version) {}

    function _auth(address signer, bytes32 structHash, uint256 nonce, uint256 deadline, bytes calldata sig)
        internal
    {
        if (block.timestamp > deadline) revert Expired();
        _useCheckedNonce(signer, nonce);
        if (sig.length == 0 && msg.sender == signer) return;
        (address rec, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashTypedDataV4(structHash), sig);
        if (err != ECDSA.RecoverError.NoError || rec != signer) revert BadSignature();
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
