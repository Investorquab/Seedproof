/** Steal This Seed, step 2: check the vault the app created through the factory, and fund it. */
import { readFileSync } from "node:fs";
import { parseAbi, parseEther, parseUnits, keccak256 } from "viem";
import { pqcKeyFromRecoveryCode } from "@qorechain/sdk";
import { load, KEYS_DIR } from "./chain.js";
import { pub, wallet, ERC20, TOKENS, sendAndWait } from "./evm.js";
const dep = JSON.parse(readFileSync(new URL("../../../contracts/deployments/diana.json", import.meta.url), "utf8"));
const FACTORY = dep.factory.address as `0x${string}`;
const s = await load("steal");
const home = pqcKeyFromRecoveryCode(readFileSync(`${KEYS_DIR}/steal-homekey.txt`, "utf8").trim(), s.address);
const vault = (await pub.readContract({ address: FACTORY, abi: parseAbi(["function vaultOf(address) view returns (address)"]), functionName: "vaultOf", args: [s.evm] })) as `0x${string}`;
const V = parseAbi(["function pocket() view returns (address)", "function homeKeyHash() view returns (bytes32)", "function delay() view returns (uint64)"]);
const [pocket, hk, delay] = await Promise.all([
  pub.readContract({ address: vault, abi: V, functionName: "pocket" }),
  pub.readContract({ address: vault, abi: V, functionName: "homeKeyHash" }),
  pub.readContract({ address: vault, abi: V, functionName: "delay" }),
]);
console.log("steal vault", vault, "| pocket ok:", pocket.toLowerCase() === s.evm.toLowerCase(), "| home key ok:", hk === keccak256(home.publicKey), "| delay", delay);
if (process.argv.includes("--fund")) {
  const a = JSON.parse(readFileSync(`${KEYS_DIR}/accounts.json`, "utf8"));
  const w = wallet(a.funder.privateKey);
  await sendAndWait("funder -> steal vault 50 fUSD", w.writeContract({ address: TOKENS.fUSD, abi: ERC20, functionName: "transfer", args: [vault, parseUnits("50", 6)] }));
  await sendAndWait("funder -> steal vault 3 QOR", w.sendTransaction({ to: vault, value: parseEther("3") }));
}
console.log("vault fUSD", (await pub.readContract({ address: TOKENS.fUSD, abi: ERC20, functionName: "balanceOf", args: [vault] })).toString(), "QOR", (await pub.getBalance({ address: vault })).toString());
