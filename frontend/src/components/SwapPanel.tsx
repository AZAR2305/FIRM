"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAccount, useChainId, usePublicClient } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { isAddress, type Address, type Hex } from "viem";
import { GAS, monadTestnet } from "@/lib/config";
import { deployments, mustDeployments, poolNameById, tokens } from "@/lib/deployments";
import { fmt, parseAmount, shortAddress } from "@/lib/format";
import { toCalldataRoutes, type RouteT } from "@/lib/routes";
import { DEMO_VILLAINS, freshVillains, routeWithVillain } from "@/lib/demo";
import { describeLogs, type TimelineStep } from "@/lib/timeline";
import { bufferedGas, describeError, waitForReceipt } from "@/lib/tx";
import { wagmiConfig } from "@/lib/wagmi";
import { useAllowance, useBalances, useRoutePlan } from "@/hooks/useChainData";
import { EmptyState, ErrorState, Loading, NotDeployed } from "./States";
import { RouteTable } from "./RouteTable";
import { Timeline } from "./Timeline";
import { ExplorerTxLink } from "./TxLink";
import { WalletButton } from "./WalletButton";

type Mode = "protected" | "raw";
type Symbol = "tUSD" | "tUSDC";

/** The demo preset (landing page "Try the demo"): point the unprotected router at the pool whose hook hides a fee. */
const DEMO_RAW_POOL = "B";

interface Outcome {
  hash: Hex;
  mode: Mode;
  status: "success" | "reverted";
  steps: TimelineStep[];
  received: bigint | null;
  gasUsed: bigint;
  gasLimit: bigint;
}

export function SwapPanel() {
  const d = deployments;
  if (!d) return <NotDeployed />;
  return <SwapInner />;
}

function SwapInner() {
  const d = mustDeployments();
  const params = useSearchParams();
  const demo = params.get("demo") === "1";
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const client = usePublicClient({ chainId: monadTestnet.id });
  const qc = useQueryClient();
  const t = tokens(d);

  // a link from the agent page (or anyone) can prefill the order: ?amount=250&from=tUSD&to=0x... . Each value is validated; anything else is ignored.
  const amountParam = params.get("amount");
  const toParam = params.get("to");
  const recipientOverride = toParam && isAddress(toParam) ? (toParam as Address) : null;
  const [from, setFrom] = useState<Symbol>(params.get("from") === "tUSDC" ? "tUSDC" : "tUSD");
  const [amountText, setAmountText] = useState(amountParam && /^[0-9]{1,12}([.][0-9]{1,6})?$/.test(amountParam) ? amountParam : "1000");
  const modeParam = params.get("mode");
  const [mode, setMode] = useState<Mode>(modeParam === "protected" ? "protected" : modeParam === "raw" ? "raw" : demo ? "raw" : "protected");
  // demo only: which of our own cheating fixtures a naive aggregator "ranked first". undefined = the guide's default, null = none
  const [villainChoice, setVillainChoice] = useState<string | null | undefined>(undefined);
  const [rawPoolChoice, setRawPoolChoice] = useState<string | null>(demo ? DEMO_RAW_POOL : null);
  const [busy, setBusy] = useState<null | "approve" | "swap">(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [step, setStep] = useState<string>("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [approvalTx, setApprovalTx] = useState<Hex | null>(null);

  const to: Symbol = from === "tUSD" ? "tUSDC" : "tUSD";
  const fromToken = t[from];
  const zeroForOne = from === "tUSD" ? d.pools.zeroForOne : !d.pools.zeroForOne;
  const amountIn = parseAmount(amountText);
  const onRightChain = isConnected && chainId === monadTestnet.id;

  const plan = useRoutePlan(zeroForOne, amountIn);
  const balances = useBalances(address);
  const balance = balances.data ? balances.data[from] : undefined;

  // ---- what exactly will be sent
  const best = plan.data?.routes[0];
  const rawPool = useMemo(() => {
    const cands = plan.data?.candidates ?? [];
    const chosen = rawPoolChoice ? cands.find((c) => c.name === rawPoolChoice && c.quotedOut != null) : undefined;
    if (chosen) return chosen;
    return best ? cands.find((c) => c.name === best.name) : undefined;
  }, [plan.data, rawPoolChoice, best]);

  const villains = plan.data ? freshVillains(plan.data.candidates) : [];
  const activeVillain = !demo ? null : villainChoice === undefined ? (villains[0] ?? null) : villainChoice;
  const protectedRoutes = useMemo(() => {
    if (!plan.data) return [];
    const forced = activeVillain ? routeWithVillain(plan.data, plan.data.candidates, activeVillain) : null;
    return forced ?? plan.data.routes;
  }, [plan.data, activeVillain]);

  const target = mode === "protected" ? d.core.firmRouter.address : d.core.rawRouter.address;
  const targetName = mode === "protected" ? "FirmRouter" : "RawRouter";
  const allowance = useAllowance(fromToken.address, address, target);
  const approved = amountIn != null && allowance.data != null && allowance.data >= amountIn;
  const enoughBalance = amountIn != null && balance != null && balance >= amountIn;

  const call = useMemo(() => {
    if (!address || amountIn == null) return null;
    if (mode === "protected") {
      if (!plan.data || protectedRoutes.length === 0) return null;
      const routes = toCalldataRoutes(protectedRoutes, zeroForOne);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200);
      return { address: d.core.firmRouter.address, abi: d.abis.FirmRouter, functionName: "swapExactIn", args: [routes, amountIn, 0n, recipientOverride ?? address, deadline] as const, routes: protectedRoutes };
    }
    if (!rawPool || rawPool.quotedOut == null) return null;
    const route: RouteT = { key: rawPool.key, zeroForOne, hookData: "0x", advertisedOut: 0n };
    return { address: d.core.rawRouter.address, abi: d.abis.RawRouter, functionName: "swapExactInRaw", args: [route, amountIn, 0n, recipientOverride ?? address] as const, routes: [] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, amountIn, mode, plan.data, protectedRoutes, rawPool, zeroForOne, recipientOverride]);

  const callSig = call ? `${call.functionName}:${mode}:${amountIn}:${recipientOverride ?? ""}:${call.routes.map((r) => r.poolId).join(",")}:${rawPool?.name ?? ""}` : "none";

  // ---- simulateContract before sending (spec 12.3), plus the gas limit that will be sent
  const sim = useQuery({
    queryKey: ["swap-sim", callSig, address, approved],
    enabled: !!client && !!call && !!address && onRightChain && approved && enoughBalance && !busy,
    refetchInterval: 8_000,
    retry: false,
    queryFn: async () => {
      // a real transaction has a non-zero gas price; some hooks behave differently in a zero-gas-price simulation
      const gasPrice = await client!.getGasPrice();
      const base = { address: call!.address, abi: call!.abi, functionName: call!.functionName, args: call!.args, account: address!, gasPrice } as const;
      const { result } = await client!.simulateContract(base as never);
      const gas = await client!.estimateContractGas(base as never);
      return { result: result as unknown, gasLimit: bufferedGas(gas), gasEstimate: gas };
    },
  });

  const predicted = useMemo(() => {
    if (!sim.data || !call) return null;
    if (mode === "protected") {
      const [out, leg] = sim.data.result as readonly [bigint, bigint];
      if (leg < 0n) return { text: "Simulation: no pool will honour its quote. Your input would be returned and strikes recorded.", out: 0n, nofill: true };
      const row = call.routes[Number(leg)];
      return { text: `Simulation: the router fills via ${row ? `Pool ${row.name}` : `route #${Number(leg) + 1}`} and you receive about ${fmt(out, 2)} ${to}.`, out, nofill: false };
    }
    const out = sim.data.result as bigint;
    return { text: `Simulation: the raw router sends everything through Pool ${rawPool?.name} and you receive about ${fmt(out, 2)} ${to}, with no check.`, out, nofill: false };
  }, [sim.data, call, mode, rawPool, to]);

  // ---- actions
  async function approve() {
    if (!client || !address || amountIn == null) return;
    setBusy("approve");
    setActionError(null);
    try {
      const w = await getWalletClient(wagmiConfig, { chainId: monadTestnet.id, account: address });
      const base = { address: fromToken.address, abi: d.abis.MockToken, functionName: "approve", args: [target, amountIn] as const, account: address } as const;
      setStep(`Simulating the ${from} approval`);
      const { request } = await client.simulateContract(base as never);
      let gas: bigint = GAS.approve;
      try {
        gas = bufferedGas(await client.estimateContractGas(base as never));
      } catch {
        // keep the explicit fallback limit
      }
      setStep("Confirm the approval in your wallet");
      const hash = await w.writeContract({ ...(request as object), gas } as never);
      setStep("Waiting for the approval to confirm");
      const receipt = await waitForReceipt(client, hash);
      if (receipt.status !== "success") throw new Error("The approval reverted on-chain.");
      setApprovalTx(hash);
      await qc.invalidateQueries({ queryKey: ["allowance"] });
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  async function swap() {
    if (!client || !address || !call || !sim.data) return;
    setBusy("swap");
    setActionError(null);
    setOutcome(null);
    try {
      const w = await getWalletClient(wagmiConfig, { chainId: monadTestnet.id, account: address });
      const gasPrice = await client.getGasPrice();
      setStep("Simulating the swap");
      const { request } = await client.simulateContract({ address: call.address, abi: call.abi, functionName: call.functionName, args: call.args, account: address, gasPrice } as never);
      const gas = sim.data.gasLimit;
      setStep("Confirm the swap in your wallet");
      const hash = await w.writeContract({ ...(request as object), gas } as never);
      setStep("Waiting for the swap to confirm");
      const receipt = await waitForReceipt(client, hash);
      const steps = describeLogs(receipt.logs, d.abis.FirmRouter, d.abis.RawRouter, poolNameById(d));
      const received = steps.find((s) => s.kind === "filled" || s.kind === "raw")?.amount ?? null;
      setOutcome({ hash, mode, status: receipt.status, steps, received, gasUsed: receipt.gasUsed, gasLimit: gas });
      await Promise.all([qc.invalidateQueries({ queryKey: ["balances"] }), qc.invalidateQueries({ queryKey: ["leaderboard"] }), qc.invalidateQueries({ queryKey: ["route-plan"] }), qc.invalidateQueries({ queryKey: ["allowance"] })]);
    } catch (e) {
      setActionError(describeError(e));
    } finally {
      setBusy(null);
      setStep("");
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      {/* ------------------------------------------------ left: the order */}
      <section className="card space-y-5 p-5" aria-labelledby="order-h">
        <h2 id="order-h" className="text-lg font-bold">
          Your swap
        </h2>
        {recipientOverride ? (
          <p className="rounded-md border border-warn/50 bg-warn/10 p-3 text-sm" data-testid="recipient-note">
            The output will be sent to <span className="mono break-all">{recipientOverride}</span>, not to your wallet. Check the address before you sign.
          </p>
        ) : null}
        {demo ? (
          <p className="rounded-md border border-brand/50 bg-brand/10 p-3 text-sm" data-testid="demo-note">
            Demo preset: the unprotected router is pointed at Pool B, the fixture hook that quotes the best price and hides a fee of about 18% when it
            really executes. Run it in Raw mode, then switch to Protected and run the same trade. Pool B is our own test fixture.
          </p>
        ) : null}

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-mute" htmlFor="from">
              You pay
            </label>
            <div id="from" className="card px-3 py-2 font-semibold" data-testid="from-token">
              {from}
            </div>
          </div>
          <button type="button" className="btn" aria-label="Swap the pair direction" onClick={() => { setFrom(to); setOutcome(null); }}>
            ⇄
          </button>
          <div>
            <span className="mb-1 block text-xs font-semibold text-mute">You receive</span>
            <div className="card px-3 py-2 font-semibold">{to}</div>
          </div>
        </div>

        <div>
          <label className="mb-1 flex justify-between text-xs font-semibold text-mute" htmlFor="amount">
            <span>Amount of {from}</span>
            <span>
              Balance:{" "}
              <span data-testid="balance">{!isConnected ? "connect a wallet" : balances.isLoading ? "..." : balance != null ? fmt(balance, 2) : "?"}</span>
            </span>
          </label>
          <input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            onChange={(e) => { setAmountText(e.target.value); setOutcome(null); }}
            aria-invalid={amountIn == null}
            aria-describedby="amount-help"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-lg font-semibold"
          />
          <p id="amount-help" className="mt-1 text-xs text-mute">
            {amountIn == null ? <span className="text-bad">Enter an amount greater than 0.</span> : "Test tokens, 18 decimals."}
          </p>
        </div>

        <fieldset>
          <legend className="mb-1 text-xs font-semibold text-mute">Router</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Router">
            <label className={`card cursor-pointer p-3 text-sm ${mode === "protected" ? "border-ok" : ""}`}>
              <input type="radio" name="mode" className="mr-2" checked={mode === "protected"} onChange={() => { setMode("protected"); setOutcome(null); }} data-testid="mode-protected" />
              <strong>Protected</strong> (FirmRouter)
              <span className="mt-1 block text-xs text-mute">Checks each pool&apos;s quote against its real fill in the same transaction, rejects and strikes cheats, falls back.</span>
            </label>
            <label className={`card cursor-pointer p-3 text-sm ${mode === "raw" ? "border-bad" : ""}`}>
              <input type="radio" name="mode" className="mr-2" checked={mode === "raw"} onChange={() => { setMode("raw"); setOutcome(null); }} data-testid="mode-raw" />
              <strong>Raw</strong> (RawRouter)
              <span className="mt-1 block text-xs font-semibold text-bad">Unprotected comparator.</span>
              <span className="block text-xs text-mute">Executes one pool with no check. It exists only to show what protection saves.</span>
            </label>
          </div>
        </fieldset>

        {mode === "protected" && demo && plan.data ? (
          <div data-testid="villain-picker">
            <label className="mb-1 block text-xs font-semibold text-mute" htmlFor="villain">
              Demo: the cheating pool a naive aggregator ranked first
            </label>
            <select
              id="villain"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              value={activeVillain ?? ""}
              onChange={(e) => { setVillainChoice(e.target.value === "" ? null : e.target.value); setOutcome(null); }}
              data-testid="villain-select"
            >
              <option value="">None: use the organic route</option>
              {Object.entries(DEMO_VILLAINS).map(([name, v]) => {
                const c = plan.data!.candidates.find((x) => x.name === name);
                return (
                  <option key={name} value={name} disabled={!c || c.quotedOut == null}>
                    Pool {name}: {v.cheat} [{c?.status ?? "?"}]{c?.status === "BLOCKED" ? " already caught: the router will skip it" : ""}
                  </option>
                );
              })}
            </select>
            <p className="mt-1 text-xs text-mute" data-testid="villain-help">
              {activeVillain ? DEMO_VILLAINS[activeVillain]!.how : "No cheat is forced; the route is the best quotes."} Only the order is forced here. The router still re-quotes and re-checks every pool on-chain.
              {villains.length === 0 ? " Every cheat has been caught already: see the leaderboard, and the proof page for the first-encounter transactions." : ""}
            </p>
          </div>
        ) : null}

        {mode === "raw" && plan.data ? (
          <div>
            <label className="mb-1 block text-xs font-semibold text-mute" htmlFor="rawpool">
              Pool the unprotected router uses
            </label>
            <select
              id="rawpool"
              className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm"
              value={rawPool?.name ?? ""}
              onChange={(e) => { setRawPoolChoice(e.target.value); setOutcome(null); }}
              data-testid="raw-pool"
            >
              {plan.data.candidates
                .filter((c) => c.quotedOut != null)
                .map((c) => (
                  <option key={c.name} value={c.name}>
                    Pool {c.name}: {c.description} (quote {fmt(c.quotedOut!, 1)}){c.name === best?.name ? " [best quote]" : ""}
                  </option>
                ))}
            </select>
            <p className="mt-1 text-xs text-mute">A naive router would take the best quote. You can pick any pool to see what it really delivers.</p>
          </div>
        ) : null}

        {/* ------------------------------------------------ steps */}
        <ol className="space-y-3" aria-label="Steps">
          <li className="rounded-lg border border-line p-3">
            <p className="text-sm font-semibold">
              <span className="mr-2 mono text-mute">1</span>Approve {from} for {targetName}
            </p>
            <p className="mt-1 text-xs text-mute" data-testid="allowance-line">
              {!isConnected ? "Connect a wallet." : allowance.isLoading ? "Checking allowance..." : approved ? `Approved: allowance ${fmt(allowance.data ?? 0n, 2)} ${from} covers this swap.` : `Not approved: ${targetName} may spend ${fmt(allowance.data ?? 0n, 2)} ${from}, this swap needs ${amountIn != null ? fmt(amountIn, 2) : "?"}.`}
            </p>
            {approvalTx ? (
              <p className="mt-1 text-xs text-ok" data-testid="approval-link">
                <ExplorerTxLink hash={approvalTx} label="Approval confirmed:" />
              </p>
            ) : null}
            <button type="button" className="btn mt-2" disabled={!onRightChain || amountIn == null || approved || busy !== null || !enoughBalance} onClick={approve} data-testid="approve-button">
              {busy === "approve" ? "Approving..." : approved ? "Approved" : `Approve ${amountIn != null ? fmt(amountIn, 2) : ""} ${from}`}
            </button>
          </li>
          <li className="rounded-lg border border-line p-3">
            <p className="text-sm font-semibold">
              <span className="mr-2 mono text-mute">2</span>Simulated outcome
            </p>
            <div className="mt-1 text-xs" data-testid="simulation" aria-live="polite">
              {!onRightChain ? (
                <span className="text-mute">Connect a wallet on Monad Testnet to simulate.</span>
              ) : !enoughBalance && amountIn != null ? (
                <span className="text-warn">Not enough {from}: use Mint test tokens above.</span>
              ) : !approved ? (
                <span className="text-mute">Approve first: the simulation needs the allowance.</span>
              ) : sim.isLoading ? (
                <span className="text-mute">Simulating (eth_call) before anything is sent...</span>
              ) : sim.isError ? (
                <span className="text-bad">Simulation failed: {describeError(sim.error)}. Nothing will be sent.</span>
              ) : predicted ? (
                <span className={predicted.nofill ? "text-warn" : "text-ok"}>{predicted.text}</span>
              ) : (
                <span className="text-mute">No route available.</span>
              )}
            </div>
            {sim.data ? (
              <p className="mt-1 text-xs text-mute" data-testid="gas-line">
                Gas limit that will be sent: {sim.data.gasLimit.toString()} (estimate {sim.data.gasEstimate.toString()} + {GAS.estimateBufferPct.toString()}%). Monad charges the limit, not the gas used.
              </p>
            ) : null}
          </li>
          <li className="rounded-lg border border-line p-3">
            <p className="text-sm font-semibold">
              <span className="mr-2 mono text-mute">3</span>Send
            </p>
            {!isConnected ? (
              <div className="mt-2">
                <WalletButton />
              </div>
            ) : (
              <button type="button" className={`btn mt-2 ${mode === "protected" ? "btn-primary" : ""}`} disabled={!sim.data || !approved || busy !== null || sim.isError} onClick={swap} data-testid="swap-button">
                {busy === "swap" ? "Swapping..." : mode === "protected" ? "Swap with protection" : "Swap without protection"}
              </button>
            )}
          </li>
        </ol>
        {busy ? <p role="status" className="text-sm text-mute" data-testid="step-line">{step}</p> : null}
        {actionError ? <ErrorState title="That did not go through" error={actionError} /> : null}
      </section>

      {/* ------------------------------------------------ right: preview + timeline */}
      <div className="space-y-6">
        <section className="card p-5" aria-labelledby="route-h">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="route-h" className="text-lg font-bold">
              Route preview
            </h2>
            <span className="text-xs text-mute">{plan.isFetching ? "refreshing..." : "live, every few seconds"}</span>
          </div>
          {amountIn == null ? (
            <EmptyState title="Enter an amount to see the route" />
          ) : plan.isLoading ? (
            <Loading what="Quoting the seeded pools" />
          ) : plan.isError ? (
            <ErrorState title="Could not read the pools" error={plan.error} onRetry={() => plan.refetch()} />
          ) : plan.data && plan.data.routes.length === 0 ? (
            <EmptyState title="No pool can fill this trade right now">Every candidate is blocked, over its cap or could not be quoted.</EmptyState>
          ) : plan.data ? (
            <>
              <RouteTable plan={{ routes: protectedRoutes, skipped: plan.data.skipped.filter((k) => !protectedRoutes.some((r) => r.name === k.name)) }} symbolOut={to} />
              <p className="mt-3 text-xs text-mute">
                Quotes are off-chain eth_calls. The protected router re-quotes every pool inside the swap transaction and compares its real fill with that
                quote; the floor is what it enforces. Order and eligibility follow quote-api&apos;s rules and are not trusted for safety.
              </p>
            </>
          ) : null}
        </section>

        <section className="card p-5" aria-labelledby="timeline-h">
          <h2 id="timeline-h" className="mb-3 text-lg font-bold">
            Timeline
          </h2>
          {busy === "swap" ? (
            <Loading what={step || "Working"} />
          ) : outcome ? (
            <div className="space-y-3" data-testid="outcome">
              <p className="text-sm">
                <ExplorerTxLink hash={outcome.hash} label={outcome.mode === "protected" ? "Protected swap" : "Raw swap"} />{" "}
                <span className={outcome.status === "success" ? "text-ok" : "text-bad"}>{outcome.status === "success" ? "confirmed" : "REVERTED"}</span>. Gas limit {outcome.gasLimit.toString()}, used {outcome.gasUsed.toString()}.
              </p>
              <Timeline steps={outcome.steps} />
              {outcome.steps.some((s) => s.kind === "nofill") ? (
                <p className="rounded-md border border-warn/50 bg-warn/10 p-3 text-sm" role="status">
                  Nothing was swapped. Your {from} was returned in the same transaction, and the strikes above are now public on the leaderboard.
                </p>
              ) : null}
              {outcome.received != null ? (
                <p className="text-sm font-semibold" data-testid="received">
                  You received about {fmt(outcome.received, 1)} {to} {outcome.mode === "protected" ? "(protected)" : "(unprotected)"}.
                </p>
              ) : null}
            </div>
          ) : (
            <EmptyState title="Nothing sent yet">The step-by-step result of your swap appears here, built from the router&apos;s event logs.</EmptyState>
          )}
        </section>
        <p className="text-xs text-mute">
          Connected as {address ? <span className="mono">{shortAddress(address as Address)}</span> : "nobody"}. Router addresses come from deployments/10143.json.
        </p>
      </div>
    </div>
  );
}
