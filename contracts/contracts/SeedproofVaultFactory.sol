// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {SeedproofVault} from "./SeedproofVault.sol";

/// @title Seedproof Vault Factory
/// @notice One vault per Pocket. The caller becomes the vault's Pocket (the only address
/// top-ups can pay), so nobody can create or claim a vault for someone else's address.
/// The factory keeps no power over the vaults it creates.
contract SeedproofVaultFactory {
    /// Pocket (0x address) => its vault.
    mapping(address pocket => address vault) public vaultOf;

    event VaultCreated(address indexed pocket, address indexed vault, bytes32 homeKeyHash);

    error AlreadyHasVault(address vault);

    /// @param homeKeyHash keccak256 of the Home Key's 2,592-byte ML-DSA-87 public key
    function create(
        bytes32 homeKeyHash,
        uint64 delay,
        address[] calldata guardians,
        address[] calldata limitTokens,
        uint256[] calldata limits
    ) external returns (address vault) {
        if (vaultOf[msg.sender] != address(0)) revert AlreadyHasVault(vaultOf[msg.sender]);
        vault = address(new SeedproofVault(homeKeyHash, msg.sender, delay, guardians, limitTokens, limits));
        vaultOf[msg.sender] = vault;
        emit VaultCreated(msg.sender, vault, homeKeyHash);
    }
}
