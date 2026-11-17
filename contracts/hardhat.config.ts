import path from "node:path";
import { HardhatUserConfig, subtask } from "hardhat/config";
import { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } from "hardhat/builtin-tasks/task-names";
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";

const SOLC = "0.8.28";

// Compile with solc-js from npm so builds work offline and in locked-down CI.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args: { solcVersion: string }, _hre, runSuper) => {
  if (args.solcVersion === SOLC) {
    return {
      compilerPath: path.join(__dirname, "node_modules", "solc", "soljson.js"),
      isSolcJs: true,
      version: SOLC,
      longVersion: "0.8.28+commit.7893614a",
    };
  }
  return runSuper();
});

const config: HardhatUserConfig = {
  solidity: {
    version: SOLC,
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    diana: {
      url: process.env.QORE_EVM_RPC ?? "https://evm-testnet.qore.host",
      chainId: 9800,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  mocha: { timeout: 120_000 },
};

export default config;
