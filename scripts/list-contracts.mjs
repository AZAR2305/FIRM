// Prints `<address> <path:Contract>` for every deployed contract (consumed by contracts/script/Verify.sh).
import { buildModel, listContracts } from "./lib/deployments.mjs";

for (const [address, contract] of listContracts(buildModel())) console.log(`${address} ${contract}`);
