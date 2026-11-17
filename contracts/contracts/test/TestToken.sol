// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal ERC-20 for tests (stands in for fUSD on the testnet).
contract TestToken {
    string public name = "Test USD";
    string public symbol = "fUSD";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice A receiver that tries to re-enter the vault when it gets native QOR.
interface IVaultExecute {
    function execute(uint256 id) external;
}

contract ReentrantReceiver {
    address public vault;
    uint256 public id;
    bool public attempted;
    bool public reentered;

    function arm(address vault_, uint256 id_) external {
        vault = vault_;
        id = id_;
    }

    receive() external payable {
        if (!attempted && vault != address(0)) {
            attempted = true;
            try IVaultExecute(vault).execute(id) {
                reentered = true;
            } catch {}
        }
    }
}

/// @notice A receiver that refuses native transfers.
contract RejectingReceiver {
    receive() external payable {
        revert("no");
    }
}
