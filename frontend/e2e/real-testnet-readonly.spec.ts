import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Read-only check of the app built from the REAL deployments/10143.json, talking to the public Monad Testnet RPC. No wallet, no
 * fork, no mock. Run with FIRM_REAL_E2E=1 after `pnpm build` (without FIRM_FORK or NEXT_PUBLIC_RPC_URL).
 * It expects the state left by contracts/script/DemoSwap.s.sol on the public testnet: Pool B struck and BLOCKED, Pool C with 1 fill.
 */
test.skip(process.env.FIRM_REAL_E2E !== "1", "set FIRM_REAL_E2E=1 (and build from the real deployment) to run this");

const dep = () => JSON.parse(readFileSync(join(__dirname, "..", "src", "generated", "deployments.json"), "utf8"));

test("the app built from the real deployment reads the real testnet", async ({ page }) => {
  const d = dep();
  expect(d.source, "this build must come from the real deployments/10143.json, not a fork").toBe("testnet");
  const problems: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console.error: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => r.url().startsWith("http://127.0.0.1:3100") && r.status() >= 400 && problems.push(`HTTP ${r.status()} ${r.url()}`));

  await page.goto("/");
  await expect(page.getByText("LOCAL FORK BUILD")).toHaveCount(0);

  // leaderboard: what the real Scoreboard says
  await page.goto("/leaderboard");
  const board = page.getByTestId("leaderboard");
  await expect(board).toBeVisible({ timeout: 30_000 });
  const rowB = board.locator('tr[data-pool="B"]');
  await expect(rowB).toHaveAttribute("data-status", "BLOCKED");
  await expect(rowB.locator("td").nth(3)).toHaveText("1");
  await expect(rowB.locator("td").nth(5)).toHaveText("18.0%");
  await expect(board.locator('tr[data-pool="C"] td').nth(2)).toHaveText("1");
  await expect(rowB.locator(`a[href="https://testnet.monadexplorer.com/address/${d.pools.list.B.hook}"]`)).toBeVisible();

  // swap: the route preview from the real pools, B excluded because it is BLOCKED
  await page.goto("/swap");
  const table = page.getByTestId("route-table");
  await expect(table).toBeVisible({ timeout: 30_000 });
  await expect(table.locator("tbody tr").first()).toContainText("Pool Q");
  await expect(table).toContainText("BLOCKED on the Scoreboard: not tried");

  // integrate: the real addresses, with explorer links
  await page.goto("/integrate");
  await expect(page.getByText(d.core.scoreboard.address).first()).toBeVisible();
  await expect(page.locator(`a[href="https://testnet.monadexplorer.com/address/${d.core.firmRouter.address}"]`).first()).toBeVisible();

  expect(problems, problems.join("\n")).toEqual([]);
});
