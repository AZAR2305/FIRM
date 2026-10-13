// Checks docs/SUBMISSION_FORM.md against the entry form's limits: the tagline is at most 200 characters, every other text block at most 8,000.
// It also fails if a block still contains words we promised not to use ("bonded").
import { readFileSync } from "node:fs";
const md = readFileSync(new URL("../docs/SUBMISSION_FORM.md", import.meta.url), "utf8");
const parts = md.split(/^## /m).slice(1);
let bad = 0;
for (const part of parts) {
  const title = part.split("\n")[0];
  const block = /```\n([\s\S]*?)```/.exec(part)?.[1]?.trimEnd();
  if (!block) continue;
  const limit = /^Tagline/.test(title) ? 200 : /link/i.test(title) ? 2000 : 8000;
  const ok = block.length <= limit && !/bonded/i.test(block);
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${String(block.length).padStart(5)} / ${limit}  ${title}`);
}
process.exit(bad ? 1 : 0);
