import { describe, expect, it } from "vitest";
import { mdTable, mean, pct, percentile, sum, tok } from "../src/stats";
import { renderResults } from "../src/report";
import type { Deployments } from "@firm/shared";

describe("stats", () => {
  it("percentile uses nearest rank", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNaN();
  });
  it("pct handles zero denominators", () => {
    expect(pct(1, 4)).toBe("25.0%");
    expect(pct(0, 0)).toBe("n/a");
  });
  it("sum/mean on bigint", () => {
    expect(sum([1n, 2n, 3n])).toBe(6n);
    expect(mean([2n, 4n])).toBe(3n);
    expect(mean([])).toBe(0n);
  });
  it("tok formats 18-decimals", () => {
    expect(tok(998_199_652_299_447_526_702n)).toBe("998.1996");
  });
  it("mdTable escapes pipes", () => {
    expect(mdTable({ headers: ["a|b", "c"], rows: [["x|y", 1]] })).toBe("| a\\|b | c |\n|---|---|\n| x\\|y | 1 |");
  });
});

describe("renderResults", () => {
  const dep = { core: { scoreboard: { address: "0xS" }, firmRouter: { address: "0xF" }, rawRouter: { address: "0xR" }, canaryRunner: { address: "0xC" } } } as unknown as Deployments;
  const run = { generatedAt: "t", commit: "abc", chainId: 10143, headBlockStart: 1n, headBlockEnd: 2n, localFork: false, trials: 20, txCount: 5, durationSec: 3, wallet: "0xW" };
  it("labels local forks loudly and testnet runs plainly", () => {
    expect(renderResults(dep, { ...run, localFork: true }, [])).toContain("NOT Monad Testnet measurements");
    expect(renderResults(dep, run, [])).toContain("Run against Monad Testnet (chain 10143)");
  });
  it("renders skipped experiments and tables", () => {
    const md = renderResults(dep, run, [
      { id: "B7", title: "x", method: "", tables: [], notes: [], skipped: "no indexer" },
      { id: "B2", title: "FP", method: "m", tables: [{ table: { headers: ["h"], rows: [[1]] } }], notes: ["n1"] },
    ]);
    expect(md).toContain("_Skipped: no indexer_");
    expect(md).toContain("## B2. FP");
    expect(md).toContain("- n1");
    expect(md).toContain("our own quarantined fixtures");
  });
});
