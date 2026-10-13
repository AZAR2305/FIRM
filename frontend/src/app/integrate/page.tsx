import { formatAbiItem } from "viem/utils";
import type { AbiEvent } from "viem";
import { CodeBlock } from "@/components/CodeBlock";
import { AddressLink } from "@/components/TxLink";
import { NotDeployed } from "@/components/States";
import { RPC_URL, EXPLORER_URL } from "@/lib/config";
import { deployments } from "@/lib/deployments";
import { STATUS_NAMES, STATUS_HELP } from "@/lib/status";

export const metadata = { title: "Integrate | FIRM" };

const PLACEHOLDER = "<Scoreboard address: see deployments/10143.json>";

export default function IntegratePage() {
  const d = deployments;
  const sb = d?.core.scoreboard.address ?? PLACEHOLDER;
  const router = d?.core.firmRouter.address ?? "<FirmRouter address: see deployments/10143.json>";

  const ts = `import { createPublicClient, http } from "viem";
import deployments from "./deployments/10143.json"; // addresses and ABIs, the only source of truth

const client = createPublicClient({ transport: http("${RPC_URL}") });
const scoreboard = deployments.core.scoreboard.address; // ${sb}

const hook = "0x..."; // the hook address of the pool you are about to route through

// 0 UNRATED, 1 NORMAL, 2 WATCH, 3 BLOCKED. A hookless pool (zero address) is always NORMAL.
const status = await client.readContract({
  address: scoreboard,
  abi: deployments.abis.Scoreboard,
  functionName: "statusOf",
  args: [hook],
});

// the shortfall (in basis points) the router accepts from this hook right now
const toleranceBps = await client.readContract({
  address: scoreboard,
  abi: deployments.abis.Scoreboard,
  functionName: "toleranceBps",
  args: [hook],
});

if (status === 3) skipThisPool(); // BLOCKED: the hook delivered less than it quoted`;

  const sol = `interface IScoreboard {
    function statusOf(address hook) external view returns (uint8); // 0 UNRATED 1 NORMAL 2 WATCH 3 BLOCKED
    function toleranceBps(address hook) external view returns (uint16);
}

// IScoreboard(${sb})
function _hookAllowed(address hook) internal view returns (bool) {
    return IScoreboard(scoreboard).statusOf(hook) != 3; // not BLOCKED
}

// the floor FIRM would enforce for a quote:  quote * (10_000 - toleranceBps) / 10_000
function _floor(address hook, uint256 quotedOut) internal view returns (uint256) {
    return quotedOut * (10_000 - IScoreboard(scoreboard).toleranceBps(hook)) / 10_000;
}`;

  const events = d
    ? (d.abis.FirmRouter as readonly { type: string; name?: string }[]).filter((i) => i.type === "event").map((i) => formatAbiItem(i as AbiEvent))
    : [];

  return (
    <div className="space-y-12">
      <div className="page-head">
        <h1 className="page-title">Developers</h1>
        <p className="page-lead">
          Any router, wallet or agent can read the Scoreboard before it routes through a hook. It is a public, on-chain ledger; reading it needs
          no permission. Everything below is generated from <span className="mono">deployments/10143.json</span>.
        </p>
      </div>

      {!d ? <NotDeployed /> : null}

      <section className="space-y-3" aria-labelledby="read">
        <h2 id="read" className="text-lg font-bold">
          Read a hook&apos;s status and tolerance
        </h2>
        <CodeBlock code={ts} language="TypeScript, viem" label="Scoreboard.statusOf and toleranceBps" />
        <CodeBlock code={sol} language="Solidity" label="From a contract" />
        <ul className="grid gap-2 text-sm sm:grid-cols-2">
          {STATUS_NAMES.map((s, i) => (
            <li key={s} className="card p-3">
              <span className="mono mr-2 text-mute">{i}</span>
              <strong>{s}</strong>
              <span className="block text-xs text-mute">{STATUS_HELP[s]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3" aria-labelledby="use">
        <h2 id="use" className="text-lg font-bold">
          Route through FirmRouter
        </h2>
        <CodeBlock
          language="Solidity"
          label="FirmRouter.swapExactIn"
          code={`// approve FirmRouter (${router}) for amountIn of the input token first
(uint256 amountOut, int256 legIndex) = IFirmRouter(firmRouter).swapExactIn(
    routes,        // 1..4 candidate pools, best quote first; each {key, zeroForOne, hookData, advertisedOut}
    amountIn,
    minTotalOut,   // your own floor across the whole swap
    recipient,
    deadline
);
// legIndex == -1: nothing honoured its quote; the input was returned and the strikes persist`}
        />
        {events.length > 0 ? (
          <div>
            <h3 className="mb-2 text-sm font-semibold">FirmRouter events (the swap timeline is built from these)</h3>
            <ul className="mono space-y-1 break-all text-xs text-mute">
              {events.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {d ? (
        <section className="space-y-3" aria-labelledby="addr">
          <h2 id="addr" className="text-lg font-bold">
            Deployed addresses (Monad Testnet, chain 10143)
          </h2>
          <div className="card table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th scope="col">Contract</th>
                  <th scope="col">Address</th>
                  <th scope="col">Verification</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(d.core).map(([k, e]) => (
                  <tr key={k}>
                    <td>{e.contract.split(":").pop()}</td>
                    <td>
                      <AddressLink address={e.address} label={e.address} />
                    </td>
                    <td className="text-xs text-mute">{e.verification}</td>
                  </tr>
                ))}
                {(["tUSD", "tUSDC"] as const).map((k) => (
                  <tr key={k}>
                    <td>{k} (test token)</td>
                    <td>
                      <AddressLink address={d.fixtures[k].address} label={d.fixtures[k].address} />
                    </td>
                    <td className="text-xs text-mute">{d.fixtures[k].verification}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-mute">
            Uniswap v4 on Monad Testnet is Monad-maintained, not an official deployment: PoolManager <AddressLink address={d.infra.poolManager} label={d.infra.poolManager} />,
            V4Quoter <AddressLink address={d.infra.v4Quoter} label={d.infra.v4Quoter} />. Explorer: {EXPLORER_URL}.
          </p>
        </section>
      ) : null}

      {d ? (
        <section className="space-y-3" aria-labelledby="abis">
          <h2 id="abis" className="text-lg font-bold">
            ABIs
          </h2>
          {Object.entries(d.abis).map(([name, abi]) => (
            <details key={name} className="card p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                {name} <span className="text-xs font-normal text-mute">({(abi as unknown[]).length} entries)</span>
              </summary>
              <div className="mt-3">
                <CodeBlock code={JSON.stringify(abi, null, 2)} language="JSON" label={`${name} ABI`} />
              </div>
            </details>
          ))}
        </section>
      ) : null}
    </div>
  );
}
