// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice QoreChain post-quantum precompile at 0x0000000000000000000000000000000000000a01.
/// @dev Active on qorechain-diana (testnet). Interface from docs.qorechain.io/developer-guide/evm-precompiles.
interface IQorePQC {
    function pqcVerify(bytes calldata pubkey, bytes calldata signature, bytes calldata message)
        external
        view
        returns (bool valid);
}
