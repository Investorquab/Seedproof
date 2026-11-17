// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Test double for the pqcVerify precompile (0x...0a01).
/// @dev The test harness signs with real ML-DSA-87 (@qorechain/sdk), checks the
///      signature with the real verifier in JS, and only then marks the exact
///      (pubkey, signature, message) triple valid here. Anything not marked
///      returns false, like a failed verification on chain.
contract MockQorePQC {
    mapping(bytes32 => bool) public valid;

    function setValid(bytes32 triple, bool ok) external {
        valid[triple] = ok;
    }

    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool)
    {
        return valid[keccak256(abi.encode(pubkey, signature, message))];
    }
}
