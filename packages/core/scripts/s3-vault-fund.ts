import { load, sendHybrid, show, NET } from "./chain.js";
import { convertCoinMsg } from "../src/convert.js";
const f = await load("funder");
const D = { fUSD: "erc20:0x97143B771D34ddb9130b807b135Ae675A5a963CA", fETH: "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28", fBTC: "erc20:0x4604e7E45b2ecdbfbDc157103f5B2b62cb16451A" };
show("funder converts 600 fUSD, 0.3 fETH, 0.012 fBTC to ERC-20", await sendHybrid(f, [
  convertCoinMsg(f.address, f.evm, D.fUSD, 600_000_000n),
  convertCoinMsg(f.address, f.evm, D.fETH, 300_000_000_000_000_000n),
  convertCoinMsg(f.address, f.evm, D.fBTC, 1_200_000n),
], f.seedPqc));
