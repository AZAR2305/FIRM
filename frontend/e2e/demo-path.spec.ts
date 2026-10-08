import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { encodeFunctionData } from "viem";
import { join } from "node:path";

/**
 * The whole demo path in a real browser against a local fork of Monad Testnet:
 *   landing -> demo link -> connect -> mint -> RAW swap through the cheating pool (loses ~18%) -> PROTECTED swap (rejects it, fills
 *   the honest pool) -> leaderboard shows the hook BLOCKED -> integrate page. It also fails on ANY console error, page error or
 *   failed same-origin request on the way (spec 12.6: no console errors on the demo path).
 *
 * The wallet is a ~25-line EIP-1193 shim that forwards everything to the fork, whose dev account #1 is unlocked. It signs nothing
 * itself and holds no key. The fork must be freshly deployed (Pool B not yet struck); the test snapshots and reverts the chain.
 */
const FORK_RPC = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8546";
const ACCOUNT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // anvil dev account #1, unlocked, local only

async function rpc<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(FORK_RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}

function statusOfCalldata(hook: string): string {
  return encodeFunctionData({ abi: [{ type: "function", name: "statusOf", stateMutability: "view", inputs: [{ name: "hook", type: "address" }], outputs: [{ name: "", type: "uint8" }] }], functionName: "statusOf", args: [hook as `0x${string}`] }).slice(2);
}

async function forkIsUp(): Promise<boolean> {
  try {
    return (await rpc<string>("eth_chainId")) === "0x279f";
  } catch {
    return false;
  }
}

function deploymentsFile(): { pools: { list: Record<string, { hook: string }> }; core: { scoreboard: { address: string } } } {
  return JSON.parse(readFileSync(join(__dirname, "..", "src", "generated", "deployments.json"), "utf8"));
}

async function installWalletShim(page: Page) {
  await page.addInitScript(
    ({ account, rpcUrl }) => {
      const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
      const call = async (method: string, params: unknown[]) => {
        const r = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
        const j = await r.json();
        if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code ?? -32000 });
        return j.result;
      };
      (window as unknown as { ethereum: unknown }).ethereum = {
        isMetaMask: true,
        request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
          if (method === "eth_chainId") return "0x279f";
          if (method === "net_version") return "10143";
          if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") return null;
          return call(method, params);
        },
        on: (e: string, f: (...a: unknown[]) => void) => void (listeners[e] ??= []).push(f),
        removeListener: (e: string, f: (...a: unknown[]) => void) => void (listeners[e] = (listeners[e] ?? []).filter((x) => x !== f)),
      };
    },
    { account: ACCOUNT, rpcUrl: FORK_RPC },
  );
}

test("demo path: raw loses ~18%, protected rejects the cheat and fills honestly, leaderboard turns red", async ({ page }) => {
  test.skip(!(await forkIsUp()), `no fork at ${FORK_RPC}: start scripts/wsl-anvil.sh and redeploy (see frontend/README.md)`);

  // precondition: the app was built from THIS fork deployment and Pool B has not been struck yet
  const dep = deploymentsFile();
  const status = await rpc<string>("eth_call", [{ to: dep.core.scoreboard.address, data: "0x" + statusOfCalldata(dep.pools.list.B!.hook) }, "latest"]);
  expect(Number(BigInt(status)), "Pool B is already struck, or the app was built from another deployment: run Redeploy.sh, then `pnpm build` (it syncs deployments)").toBe(0);

  const snapshot = await rpc<string>("evm_snapshot");
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    if (r.url().startsWith("http://127.0.0.1:3100") && r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    if (r.url().startsWith("http://127.0.0.1:3100")) problems.push(`request failed ${r.url()}`);
  });

  try {
    await installWalletShim(page);

    // ------------------------------------------------ landing
    await page.goto("/");
    await expect(page.getByTestId("testnet-banner")).toContainText("Monad Testnet. Test tokens only.");
    await expect(page.getByTestId("testnet-banner").getByRole("link", { name: "MON faucet" })).toHaveAttribute("href", "https://faucet.monad.xyz");
    await expect(page.getByTestId("mint-button")).toBeVisible();
    await expect(page.getByText("54.2% as malicious")).toBeVisible();
    await expect(page.getByText(/26\.4% as .{0,3}likely malicious/)).toBeVisible();
    await expect(page.getByTestId("raw-number")).toHaveText("819.2");
    await expect(page.getByTestId("firm-number")).toHaveText("998.2");
    await page.getByTestId("try-demo").click();
    await expect(page).toHaveURL(/\/swap\?demo=1/);
    await expect(page.getByTestId("demo-note")).toBeVisible();

    // ------------------------------------------------ connect and mint (spec 12.1)
    await page.getByRole("banner").getByRole("button", { name: "Connect wallet" }).click();
    await expect(page.getByRole("button", { name: /Connected as/ })).toBeVisible();
    await page.getByTestId("mint-button").click();
    await expect(page.getByTestId("mint-status")).toContainText("Minted 10,000 tUSD and 10,000 tUSDC", { timeout: 60_000 });
    await expect(page.getByTestId("balance")).toHaveText("10,000.00", { timeout: 20_000 });

    // ------------------------------------------------ route preview
    await expect(page.getByTestId("route-table")).toBeVisible();
    const rows = page.getByTestId("route-table").locator("tbody tr");
    await expect(rows.first()).toContainText("Pool Q"); // quotes high only to simulations, so the off-chain quote ranks it first
    await expect(page.getByTestId("route-table")).toContainText("Pool B");

    // ------------------------------------------------ RAW (unprotected comparator), pointed at Pool B by the demo preset
    await expect(page.getByTestId("mode-raw")).toBeChecked();
    await expect(page.getByTestId("raw-pool")).toHaveValue("B");
    await expect(page.getByTestId("approve-button")).toBeEnabled();
    await page.getByTestId("approve-button").click();
    await expect(page.getByTestId("allowance-line")).toContainText("Approved", { timeout: 60_000 });
    await expect(page.getByTestId("simulation")).toContainText("raw router sends everything through Pool B", { timeout: 30_000 });
    await expect(page.getByTestId("simulation")).toContainText("819.18");
    const rawGasText = await page.getByTestId("gas-line").innerText();
    const rawLimit = BigInt(/Gas limit that will be sent: (\d+)/.exec(rawGasText)![1]!);
    await page.getByTestId("swap-button").click();
    await expect(page.getByTestId("outcome")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("timeline")).toContainText("Raw router swapped through Pool B with no check: received 819.2");
    await expect(page.getByTestId("received")).toContainText("819.2 tUSDC (unprotected)");

    // the transaction really carried the explicit limit shown in the UI (Monad charges the limit)
    const rawHash = (await page.getByTestId("outcome").locator("a").first().getAttribute("href"))!.split("/tx/")[1]!;
    const rawTx = await rpc<{ gas: string }>("eth_getTransactionByHash", [rawHash]);
    expect(BigInt(rawTx.gas)).toBe(rawLimit);

    // ------------------------------------------------ PROTECTED: same trade
    await page.getByTestId("mode-protected").check();
    await expect(page.getByTestId("allowance-line")).toContainText("Not approved");
    await page.getByTestId("approve-button").click();
    await expect(page.getByTestId("allowance-line")).toContainText("Approved", { timeout: 60_000 });
    await expect(page.getByTestId("simulation")).toContainText("the router fills via Pool C", { timeout: 30_000 });
    await expect(page.getByTestId("simulation")).toContainText("998.20");
    await page.getByTestId("swap-button").click();
    await expect(page.getByTestId("outcome")).toContainText("confirmed", { timeout: 90_000 });
    const tl = page.getByTestId("timeline");
    await expect(tl).toContainText("Skipped Pool Q: its in-transaction quote was below the quote it advertised off-chain.");
    await expect(tl).toContainText("Pool B quoted 999.0, delivered 819.2 (-18.0%). Rejected, strike recorded.");
    await expect(tl).toContainText("Filled via Pool C: received 998.2 (matches quote).");
    await expect(page.getByTestId("received")).toContainText("998.2 tUSDC (protected)");
    // order of the lines is the order of the logs
    const kinds = await tl.locator("li").evaluateAll((els) => els.map((e) => e.getAttribute("data-kind")));
    expect(kinds).toEqual(["skipped", "rejected", "filled"]);

    // ------------------------------------------------ leaderboard (client navigation, auto-refresh)
    await page.getByRole("link", { name: "Leaderboard" }).click();
    await expect(page).toHaveURL(/\/leaderboard/);
    const board = page.getByTestId("leaderboard");
    await expect(board).toBeVisible({ timeout: 20_000 });
    const rowB = board.locator('tr[data-pool="B"]');
    await expect(rowB).toHaveAttribute("data-status", "BLOCKED", { timeout: 20_000 });
    await expect(rowB).toContainText("BLOCKED");
    await expect(rowB.locator("td").nth(3)).toHaveText("1"); // strikes
    await expect(rowB.locator("td").nth(5)).toHaveText("18.0%"); // average shortfall
    await expect(rowB.locator("td").nth(6)).not.toContainText("never");
    await expect(board.locator("tbody tr").first()).toHaveAttribute("data-pool", "B"); // BLOCKED sorts first
    await expect(board.locator('tr[data-pool="C"] td').nth(2)).toHaveText("1"); // fills

    // refreshes by itself: a swap made outside the page shows up without a reload
    const before = await page.getByTestId("refresh-line").innerText();
    await expect.poll(async () => page.getByTestId("refresh-line").innerText(), { timeout: 15_000 }).not.toBe(before);

    // ------------------------------------------------ integrate
    await page.getByRole("link", { name: "Integrate" }).click();
    await expect(page.getByRole("heading", { name: "Integrate" })).toBeVisible();
    await expect(page.getByText("statusOf").first()).toBeVisible();
    await expect(page.getByText("toleranceBps").first()).toBeVisible();
    await expect(page.getByText(deploymentsFile().core.scoreboard.address).first()).toBeVisible();

    expect(problems, problems.join("\n")).toEqual([]);
  } finally {
    await rpc("evm_revert", [snapshot]).catch(() => undefined);
  }
});

test("pages render honest empty/error states instead of throwing when the chain is unreachable", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(e.message));
  // make every RPC call fail
  await page.route(FORK_RPC, (route) => route.abort());
  await page.goto("/leaderboard");
  await expect(page.locator("div.card[role=alert]")).toContainText("Could not read the Scoreboard", { timeout: 30_000 });
  await page.goto("/swap");
  await expect(page.getByRole("heading", { name: "Swap", exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});

test("no page overflows horizontally at phone width", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
  for (const path of ["/", "/swap?demo=1", "/leaderboard", "/integrate"]) {
    await page.goto(path);
    await page.waitForTimeout(2000);
    const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(w.scroll, `${path} is ${w.scroll}px wide in a ${w.client}px viewport`).toBeLessThanOrEqual(w.client);
  }
});
