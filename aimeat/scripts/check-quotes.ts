/**
 * @file check-quotes.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Keeps the developer's chat words out of the public repository: no tracked text file
 *   quotes him directly (`(Jouni, 2026-10-03: "…")`, `Jouni: "…"`, `Jouni said "…"`).
 *
 *   WHY IT EXISTS. The repository is public. Sessions had copied his chat messages word for word into
 *   about 180 lines of code comments, docs, skills and tests, because CLAUDE.md asked them to quote him
 *   rather than paraphrase. That rule is about understanding a request in the conversation; in a file
 *   the decision and its date are what a reader needs, written as a neutral statement:
 *   `(Jouni, 2026-10-03)` after the sentence that says what was decided. Rewritten on 2026-11-22.
 *
 *   WHAT IT READS. Every file git tracks, as text, except what can never change or is history: the
 *   database migrations (their hashes are held by check:migration-hashes), the generated SDK bundles
 *   (rebuilt from their sources), CHANGELOG.md and the superseded RFCs.
 * @usage
 *   pnpm check:quotes          (exit 1 when a tracked file quotes the developer)
 * @version-history
 *   v1.0.0 — 2026-11-22 — Initial, after the quotes were rewritten as neutral statements.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** His name, up to a short attribution (a date, "ruled", "said", "approved it"), then an opening quote. */
const QUOTE = /Jouni[^"“”\n]{0,60}[:,]\s*["“][^"”\n]{3,}|Jouni (?:said|wrote|asked|answered)[^"“\n]{0,20}["“][^"”\n]{3,}/;
const SKIP = /(^|\/)(CHANGELOG\.md|AIMEAT-RFC-v4\.0-[^/]*\.md)$|\/migrations\/[^/]*\.sql$|^aimeat\/src\/static\/sdk-libs\/dist\/|^aimeat\/scripts\/check-quotes\.ts$/;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf|otf|zip|gz|pdf|mp[34]|wasm|db)$/i;

const files = execFileSync('git', ['ls-files'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(f => f && !SKIP.test(f) && !BINARY.test(f));
const hits: string[] = [];
for (const f of files) {
  let text: string;
  try { text = readFileSync(path.join(REPO, f), 'utf8'); } catch { continue; }
  if (!text.includes('Jouni')) continue;
  text.split('\n').forEach((line, i) => { if (QUOTE.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 160)}`); });
}
if (hits.length) {
  console.error(`✖ ${hits.length} line(s) quote the developer's own words in the public repository:\n`);
  for (const h of hits) console.error(`  ${h}`);
  console.error('\n  → say what was decided in a neutral sentence and keep only the attribution and the date: "(Jouni, 2026-10-03)". His words stay in the conversation and on the node (the wish, the decision record), never in a file here.');
  process.exit(1);
}
console.log(`✓ no tracked file quotes the developer (${files.length} files read)`);
