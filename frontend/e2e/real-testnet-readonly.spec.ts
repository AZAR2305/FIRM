import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read-only check of the app built from the REAL deployments/10143.json, talking to the public Monad Testnet RPC and, when
 * FIRM_REAL_E2E_ENVIO=1, to a real Envio HyperIndex (HyperSync) instance. No wallet, no fork, no mock.
 *
 *   cd frontend && NEXT_PUBLIC_ENVIO_GRAPHQL_URL=http://localhost:8080/v1/graphql pnpm build      (omit it to test the labelled fallback)
 *   FIRM_REAL_E2E=1 FIRM_REAL_E2E_ENVIO=1 npx playwright test e2e/real-testnet-readonly.spec.ts
 *
 * It expects the state left by contracts/script/DemoSwap.s.sol on the public testnet: Pool B struck and BLOCKED, Pool C with 1 fill, and
 * Pool G and R not yet caught.
 */
test.skip(process.env.FIRM_REAL_E2E !== "1", "set FIRM_REAL_E2E=1 (and build from the real deployment) to run this");
const WITH_ENVIO = process.env.FIRM_REAL_E2E_ENVIO === "1";

const read = (f: string) => JSON.parse(readFileSync(join(__dirname, "..", "src", "generated", f), "utf8"));
const EXPLORER = "https://testnet.monadexplorer.com";

test("the app built from the real deployment reads the real testnet", async ({ page }) => {
  const d = read("deployments.json");
  const ev = read("evidence.json");
  expect(d.source, "this build must come from the real deployments/10143.json, not a fork").toBe("testnet");
  expect(ev.available, "scripts/build-evidence.mjs must have been run").not.toBe(false);
  const rawTx = ev.txs.find((t: { label: string }) => t.label === "raw").hash as string;
  const firmTx = ev.txs.find((t: { label: string }) => t.label === "firm").hash as string;

  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console.error: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.url().startsWith("http://127.0.0.1:3100") && r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

  // ---- landing: the business story, with numbers computed from the two real transactions
  await page.goto("/");
  await expect(page.getByText("LOCAL FORK BUILD")).toHaveCount(0);
  await expect(page.getByTestId("city-map")).toBeVisible();
  await expect(page.getByTestId("villain-pills").locator("li")).toHaveCount(7);
  await expect(page.getByTestId("focus-monad")).toContainText("14 source-verified contracts");
  await expect(page.getByTestId("site-footer")).toContainText("Built with AI coding tools (Claude Code)");
  await expect(page.getByTestId("lie-diagram")).toBeVisible();
  await expect(page.getByTestId("raw-number")).toHaveText("819.2");
  await expect(page.getByTestId("firm-number")).toHaveText("998.2");
  await expect(page.getByTestId("example-text")).toContainText("Pool B quoted 999.0");
  await expect(page.locator(`a[href="${EXPLORER}/tx/${rawTx}"]`).first()).toBeVisible();
  await expect(page.locator(`a[href="${EXPLORER}/tx/${firmTx}"]`).first()).toBeVisible();
  await expect(page.getByTestId("audiences").locator("> div")).toHaveCount(3);
  await expect(page.getByTestId("cost-card")).toContainText("Monad charges the gas");
  await expect(page.getByTestId("cost-table")).toContainText("Pool A");
  await expect(page.getByTestId("limits")).toContainText("20 times out of 20");

  // ---- the judge walkthrough, with the live state of the cheats
  await page.goto("/demo");
  await expect(page.getByTestId("judge-steps").locator("> li")).toHaveCount(7);
  const live = page.getByTestId("live-state");
  await expect(live.locator('li[data-pool="B"]')).toContainText("Already caught", { timeout: 30_000 });
  await expect(live.locator('li[data-pool="G"]')).toContainText("Not caught yet");
  await expect(live.locator('li[data-pool="R"]')).toContainText("Not caught yet");
  await expect(page.getByTestId("step-protected")).toBeVisible();

  // ---- leaderboard: what the real Scoreboard says, from Envio (or the labelled fallback)
  await page.goto("/leaderboard");
  const board = page.getByTestId("leaderboard");
  await expect(board).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("source-badge")).toHaveAttribute("data-source", WITH_ENVIO ? "envio" : "chain");
  if (WITH_ENVIO) {
    await expect(page.getByTestId("source-badge")).toContainText("Envio HyperIndex");
    await expect(page.getByTestId("indexed-block")).toContainText("indexed to block");
  } else {
    await expect(page.getByTestId("source-badge")).toContainText("Envio is not configured");
  }
  const rowB = board.locator('tr[data-pool="B"]');
  await expect(rowB).toHaveAttribute("data-status", "BLOCKED");
  await expect(rowB.locator("td").nth(3)).toHaveText("1");
  await expect(rowB.locator("td").nth(5)).toHaveText("18.0%");
  await expect(board.locator('tr[data-pool="C"] td').nth(2)).toHaveText("1");
  await expect(board.locator('tr[data-pool="G"]')).toHaveAttribute("data-status", "UNRATED");
  await expect(rowB.locator(`a[href="${EXPLORER}/address/${d.pools.list.B.hook}"]`)).toBeVisible();
  if (WITH_ENVIO) {
    // history that only the index can provide: the real strike, with its real transaction
    const feed = page.getByTestId("activity-list");
    await expect(feed).toContainText("STRIKE on Pool B: quoted 999.0, delivered 819.2 (-18.0%)", { timeout: 30_000 });
    await expect(feed).toContainText("Status UNRATED -> BLOCKED (SEVERE_SHORTFALL)");
    await expect(feed.locator(`a[href="${EXPLORER}/tx/${firmTx}"]`).first()).toBeVisible();
  }

  // ---- hook detail
  await page.getByTestId("hook-link-B").click();
  await expect(page).toHaveURL(new RegExp(`/hooks/${d.pools.list.B.hook}$`, "i"));
  await expect(page.getByTestId("hook-flags")).toContainText("AFTER_SWAP_RETURNS_DELTA");
  await expect(page.getByTestId("hook-flags")).toContainText("can change the amount a swap delivers");
  await expect(page.getByTestId("hook-stats")).toContainText("18.0%");
  await expect(page.getByTestId("report-text")).toContainText("Pool B's hook is BLOCKED", { timeout: 30_000 });
  await expect(page.getByTestId("report-text")).toContainText("18.0% less than it quoted");
  await expect(page.getByTestId("report-mode")).toContainText(process.env.FIRM_REAL_E2E_LLM === "1" ? "AI-written, advisory" : "No language model was used");
  if (WITH_ENVIO) await expect(page.getByTestId("activity-list")).toContainText("STRIKE on Pool B");

  // ---- swap: the route preview, with the demo's cheat picker
  await page.goto("/swap?demo=1&mode=protected");
  const table = page.getByTestId("route-table");
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("villain-select")).toHaveValue("G"); // B is caught already, so the first cheat still catchable is G
  await expect(table.locator("tbody tr").first()).toContainText("Pool G");
  await expect(table).toContainText("BLOCKED on the Scoreboard: not tried");

  // ---- proof: everything sourced
  await page.goto("/proof");
  await expect(page.getByTestId(`proof-tx-raw`)).toContainText("RawSwap Pool B: in 1,000, out 819.1792");
  await expect(page.getByTestId(`proof-tx-firm`)).toContainText("Rejected Pool B: quoted 998.9970, delivered 819.1775");
  await expect(page.getByTestId(`proof-tx-firm`)).toContainText("StatusChanged: UNRATED -> BLOCKED (SEVERE_SHORTFALL)");
  await expect(page.getByTestId(`proof-tx-firm`)).toContainText("Filled via Pool C");
  await expect(page.getByTestId("contracts-table").locator("tbody tr")).toHaveCount(14);
  await expect(page.getByTestId("contracts-table").locator("td.text-ok")).toHaveCount(14); // all verified
  await expect(page.getByTestId("gas-table")).toContainText("Pool A");
  await expect(page.getByTestId("envio-check")).toContainText("agrees with the Scoreboard for all 7 hooks");
  await expect(page.getByTestId("not-run")).toContainText("20-trial benchmark");
  await expect(page.getByTestId("deployment-record")).toContainText("37 of 37");

  // ---- integrate: the real addresses, with explorer links
  await page.goto("/integrate");
  await expect(page.getByText(d.core.scoreboard.address).first()).toBeVisible();
  await expect(page.locator(`a[href="${EXPLORER}/address/${d.core.firmRouter.address}"]`).first()).toBeVisible();

  expect(problems, problems.join("\n")).toEqual([]);
});
