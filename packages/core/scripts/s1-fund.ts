import { load, sendHybrid, msgSend, show, registeredKey, balances, registerKey } from "./chain.js";
const f = await load("funder"), p = await load("pocket"), s = await load("steal");
if (!(await registeredKey(f.address))) show("funder registers its seed-derived PQ key", await registerKey(f, f.seedPqc));
show("funder -> pocket 30, steal 20 (hybrid, seed key)", await sendHybrid(f, [msgSend(f.address, p.address, 30_000_000n), msgSend(f.address, s.address, 20_000_000n)], f.seedPqc));
for (const a of [f, p, s]) console.log(a.name, JSON.stringify(await balances(a.address)), "pqc:", (await registeredKey(a.address))?.length ?? "none");
