import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** What canary-agent writes per hook (services/canary-agent/src/report.ts). The LLM text is advisory only. */
export interface HookReport {
  hook: string;
  createdAt: string;
  markdown: string;
  evidence: unknown;
}

export type ReportReader = (hook: string) => Promise<HookReport | null>;

export function fileReportReader(dir: string): ReportReader {
  return async (hook) => {
    // hook is validated as a 0x address by the caller, so it can never escape `dir`
    try {
      const raw = await readFile(join(dir, `${hook.toLowerCase()}.json`), "utf8");
      return JSON.parse(raw) as HookReport;
    } catch {
      return null;
    }
  };
}
