/**
 * @file src/services/app-scope-needs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Which scope words an app's code needs for the routes the 4.0.0 gates check
 *   (auth/rest-scope-gate.ts), read from the code itself, and which of them its sign-in does not ask
 *   for. One reading for two callers: the once-per-node step that lets the apps published before
 *   4.0.x keep working (services/rest-scope-keep-working-migration.ts, ruling
 *   decision-4-0-x-olemassa-olevat-agentit-saavat-rest-porttien-uudet-san), and the publish check
 *   that tells an author which word to declare (services/app-artifact-lint.ts).
 *
 *   POSITIVE EVIDENCE ONLY. A rule matches a CALL, never a mention: a route path counts when a string
 *   literal starts with it (`'/v1/ext/' + name`, `` `${NODE}/v1/ext/x` ``), which a sentence in a
 *   prompt or a help text does not do, and an SDK call counts by its method name
 *   (`AIMEAT.agents.list(`). Each finding carries the text it matched, so the owner can read why.
 *   The shapes were taken from the 218 apps on aimeat.io on 2026-10-13: extension actions, the IAM
 *   and webhook libraries, the agent list, task and schedule writes, workflow edits, organism
 *   workspace reads and workspace access, and the intake forms.
 *
 *   A CORTEX LIB COUNTS AS THE APP'S CODE. An app that loads `/v1/cortex/<name>/libs/<file>` runs
 *   that file under its own sign-in, so the caller passes the lib texts it resolved and they are read
 *   with the same rules. cortexLibRefs() names the libs an app loads.
 *
 *   WHAT AN APP ASKS FOR. Its `<meta name="aimeat-scopes">`, or the SDK's default set when it declares
 *   nothing (services/protected-resource.ts appScopesOf). Every rule names a word an app grant can
 *   hold (routes/app-grant-vocabulary.ts): a gate that also takes a word no app is granted names the
 *   app's word, as checkout completion names contract:spend with commerce:buy as its alternative.
 * @structure ScopeNeed · SCOPE_NEED_WORDS · AI_JOB_ON_DONE_RULE · DATAPACKAGE_READ_RULE · scanScopeNeeds(sources) · cortexLibRefs(html) · undeclaredScopeNeeds(html, libs) ·
 *   undeclaredScopeFindings(html, loadLib)
 * @usage
 *   const libs = await loadLibs(cortexLibRefs(html));
 *   const { missing } = undeclaredScopeNeeds(html, libs);
 * @version-history
 *   v1.2.1 — 2026-10-21 — A data package read (AIMEAT.datapackage.open, rows, versions, exportAs, list,
 *     or a /v1/datapackages/... or /v1/odata/... path) needs storage:read, rule 'datapackage-read': the
 *     owner's private packages ask it of an app since secaudit 2026-10 v41
 *     (services/app-datapackage-read-keep-migration.ts keeps it for the apps published before).
 *   v1.2.0 — 2026-10-21 — An AI job that names an `on_done` action needs ext:invoke (onDoneNeeds,
 *     rule 'ai-job-on-done'), which the start asks of an app since secaudit 2026-10; a need carries
 *     the rule that found it, so the once-only step for it (services/app-on-done-keep-migration.ts)
 *     gives the word for that call and no other.
 *   v1.1.0 — 2026-10-20 — A GET /v1/pub call needs storage:read, also when the path is only in a regex
 *     (S3-03 gated it on 2026-10-16 after the keep-working step was written; found on originalmiskate.com).
 *   v1.0.2 — 2026-10-17 — A realtime room made with createRoom() or a POST to /v1/realtime/rooms needs social:write (pitfall-list round).
 *   v1.0.1 — 2026-10-15 — cortexLibRefs bounds the cortex name and the file path in its pattern
 *     (CodeQL js/polynomial-redos).
 *   v1.0.0 — 2026-10-13 — Initial.
 */
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { appScopesOf } from './protected-resource.js';

/** One word the code needs, the text that shows it, and where that text is. */
export interface ScopeNeed {
  word: string;
  /** Set on a need a once-only step gives by itself: 'ai-job-on-done' (services/app-on-done-keep-migration.ts). */
  rule?: string;
  /** Words that pass the same gate (an app grant: contract:spend for commerce:buy). */
  alternatives?: string[];
  /** The matched text, trimmed to a line. */
  evidence: string;
  /** `app` or the lib path. */
  source: string;
}

/** A string literal (or a template interpolation) that STARTS with the path: a call, not a sentence. */
const LIT = String.raw`(?:['"\x60]|\})`;

interface Rule { word: string; alternatives?: string[]; re: RegExp; rule?: string }

/**
 * A data package read (services/datapackage/audience.ts): a signed-in app reads its owner's PRIVATE
 * package only with storage:read since secaudit 2026-10 v41. The once-only step for it
 * (services/app-datapackage-read-keep-migration.ts) gives the word for these calls and no other.
 */
export const DATAPACKAGE_READ_RULE = 'datapackage-read';

/** Calls whose word does not depend on the HTTP method. */
const RULES: Rule[] = [
  // Extension actions and instances (routes/extensions/actions.ts, instances.ts).
  // `/v1/ext/{ext}/{action}` with bare braces is a placeholder in a help text, not a call.
  { word: 'ext:invoke', re: new RegExp(`${LIT}/v1/ext(?:/(?!\\{)|['"\\x60])`, 'g') },
  { word: 'ext:invoke', alternatives: ['ext:write'], re: new RegExp(`${LIT}/v1/extensions/[^\\n;]{0,120}?/instances`, 'g') },
  // The IAM, webhook and living-hooks libraries call extension actions.
  // AIMEAT.iam reaches an extension only when init names one (`ext`); with `app` alone it reads the
  // node's own roster routes, which 4.0.0 does not gate (sdk-libs/iam/index.js).
  { word: 'ext:invoke', re: /\bAIMEAT\.iam\.init\s*\(\s*\{[^}]{0,200}?\bext\s*:/g },
  { word: 'ext:invoke', re: /\bAIMEAT\.webhook\.(?:send|read)\s*\(/g },
  { word: 'ext:invoke', re: /['"\x60]living-hooks\.settings['"\x60]/g },
  // The owner's agent list (routes/agents/profile-metadata.ts) and the v2 previews.
  { word: 'agent:read', re: /\bAIMEAT\.agents\.(?:list|get)\s*\(/g },
  { word: 'agent:read', re: new RegExp(`${LIT}/v1/agents(?:\\?[^'"\\x60\\s]*)?['"\\x60]`, 'g') },
  { word: 'agent:read', re: new RegExp(`${LIT}/v1/agents/v2/(?:basic-agents|migrate)`, 'g') },
  // Work for another agent and schedules made by the refinery library.
  { word: 'task:write', re: /\bAIMEAT\.agents\.(?:createTask|run)\s*\(/g },
  { word: 'task:read', re: new RegExp(`${LIT}/v1/(?:agents/v2/tasks|agui/)`, 'g') },
  // Organism reads (routes/organisms/*.ts) and the SDK's organism and intake methods.
  { word: 'organism:read', re: /\bAIMEAT\.organism\.(?:workspaces|findOrCreateWorkspace|access|members)\s*\(/g },
  { word: 'organism:read', re: /\bAIMEAT\.intake\.listForms\s*\(/g },
  { word: 'organism:read', re: /\/v1\/organisms\/['"\x60]\s*\+[^;\n]{0,100}?['"\x60]\/workspaces\b/g },
  { word: 'organism:read', re: /\/v1\/organisms\/\$\{[^}]{1,80}\}\/workspaces\b/g },
  { word: 'organism:read', re: new RegExp(`${LIT}/v1/(?:organisms/waiting|organisms/invitations/mine|intake/forms)`, 'g') },
  { word: 'organism:invite', re: /\bAIMEAT\.organism\.(?:access|members|requests)\s*\(/g },
  { word: 'organism:invite', re: /['"\x60]\/workspace-access\b|\/v1\/organisms\/[^'"\x60\s]*\/workspace-access\b/g },
  // Memory reads that 4.0.0 gates (covered by the default set, listed for completeness).
  { word: 'memory:read', re: /\bAIMEAT\.data\.discover\s*\(/g },
  { word: 'memory:read', re: new RegExp(`${LIT}/v1/(?:memory/discover|skills['"\\x60?])`, 'g') },
  // Installs, money and appeals.
  { word: 'packages:read', re: new RegExp(`${LIT}/v1/instances(?:['"\\x60?]|/[^'"\\x60]*?(?:/status)?['"\\x60])`, 'g') },
  { word: 'packages:write', re: /\/v1\/instances\/[^\n;]{0,80}?\/(?:check-update|migration-prompt)\b/g },
  // The gate takes commerce:buy or contract:spend; an app grant can hold only the second.
  { word: 'contract:spend', alternatives: ['commerce:buy'], re: /\bAIMEAT\.commerce\.completeCheckout\s*\(/g },
  { word: 'contract:spend', alternatives: ['commerce:buy'], re: new RegExp(`${LIT}/v1/app-store/purchase['"\\x60]|checkout-sessions/[^\\n;]{0,80}?/complete\\b`, 'g') },
  { word: 'wallet:read', re: /\bAIMEAT\.exchange\.approval\s*\(/g },
  { word: 'wallet:read', re: new RegExp(`${LIT}/v1/(?:app-store/purchases/|commerce/beneficiary/approvals)`, 'g') },
  { word: 'social:read', re: new RegExp(`${LIT}/v1/appeals['"\\x60?]`, 'g') },
  { word: 'catalogue:read', re: new RegExp(`${LIT}/v1/cortex/[^'"\\x60/\\s]+(?:/prompts|/ontology)`, 'g') },
  { word: 'work:request', re: new RegExp(`${LIT}/v1/federation/cross-node/work`, 'g') },
  // A realtime room made by the realtime library or by a POST (routes/realtime.ts); a list is a GET and open.
  { word: 'social:write', re: /\b[A-Za-z_$][\w$]*\.createRoom\s*\(/g },
  { word: 'social:write', re: new RegExp(`${LIT}/v1/realtime/rooms['"\\x60]\\s*,\\s*\\{[^}]{0,80}?method\\s*:\\s*['"\\x60]POST['"\\x60]`, 'gi') },
  // A file that is not public, read with the reader's token (routes/storage-files.ts GET /v1/pub, QA
  // audit S3-03). An app that shows workspace images often holds the path only in the pattern that
  // finds an image address in a document, so the escaped form of a regex counts as well.
  { word: 'storage:read', re: new RegExp(`${LIT}/v1/pub(?:/|['"\\x60])`, 'g') },
  { word: 'storage:read', re: /\\{1,2}\/v1\\{1,2}\/pub\\{1,2}\//g },
  // A data package read (DATAPACKAGE_READ_RULE): the SDK's read methods, and the read routes and the
  // OData feed by path. POST /v1/datapackages and /validate publish and check, and ask storage:write,
  // so the bare path and /validate are not reads.
  { word: 'storage:read', rule: DATAPACKAGE_READ_RULE, re: /\bAIMEAT\.datapackage\.(?:open|get|rows|versions|exportAs|list)\s*\(/g },
  { word: 'storage:read', rule: DATAPACKAGE_READ_RULE, re: new RegExp(`${LIT}/v1/(?:datapackages/(?!validate\\b)|odata/)`, 'g') },
];

/** The text around a match, on one line, for the owner to read. */
function excerpt(text: string, at: number, length: number): string {
  return text.slice(Math.max(0, at - 30), Math.min(text.length, at + length + 50)).replace(/\s+/g, ' ').trim();
}

/** Every word a finding can name (the rules' and the schedule calls'), for the test that each is grantable. */
export const SCOPE_NEED_WORDS: readonly string[] = [...new Set([...RULES.map(r => r.word), 'task:write', 'workflow:write', 'memory:write'])].sort();

/** A `/v1/schedules` call: its word follows its HTTP method (routes/schedules.ts). */
function scheduleNeeds(text: string, source: string): ScopeNeed[] {
  const out: ScopeNeed[] = [];
  const re = new RegExp(`${LIT}/v1/schedules\\b`, 'g');
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    const after = text.slice(at, at + 200);
    const before = text.slice(Math.max(0, at - 24), at);
    const method = /method\s*:\s*['"\x60](POST|PATCH|DELETE|PUT)['"\x60]/i.exec(after)?.[1]?.toUpperCase()
      ?? /\b(post|patch|del|delete)\w*\s*\(\s*['"\x60]?$/i.exec(before)?.[1]?.toUpperCase();
    let word: string | null = null;
    if (/^[^;\n]{0,80}\/trigger\b/.test(after)) word = 'task:write';
    else if (method === 'POST') word = 'task:write';
    else if (method === 'PATCH') word = 'workflow:write';
    else if (method === 'DEL' || method === 'DELETE') word = 'memory:write';
    if (word) out.push({ word, evidence: excerpt(text, at, 40), source });
  }
  // AIMEAT.refinery.schedule(), also through a variable that holds the library.
  if (/\bAIMEAT\.refinery\b/.test(text)) {
    for (const m of text.matchAll(/\b[A-Za-z_$][\w$]*\.schedule\s*\(/g)) {
      out.push({ word: 'task:write', evidence: excerpt(text, m.index ?? 0, m[0].length), source });
    }
  }
  return out;
}

/**
 * An AI job that names an extension action as its `on_done` (POST /v1/ai/jobs, AIMEAT.ai.job.start):
 * the action runs unattended when the answer lands, which needs ext:invoke of a caller that is not
 * the owner in person (services/ai-jobs/starter.ts, secaudit 2026-10). It counts only in code that
 * starts a job, and only where `on_done` is written as a property name.
 */
export const AI_JOB_ON_DONE_RULE = 'ai-job-on-done';
function onDoneNeeds(text: string, source: string): ScopeNeed[] {
  if (!/\bAIMEAT\.ai\.job\.start\s*\(/.test(text) && !new RegExp(`${LIT}/v1/ai/jobs['"\\x60]`).test(text)) return [];
  const out: ScopeNeed[] = [];
  for (const m of text.matchAll(/['"\x60]?\bon_done['"\x60]?\s*:/g)) {
    out.push({ word: 'ext:invoke', rule: AI_JOB_ON_DONE_RULE, evidence: excerpt(text, m.index ?? 0, m[0].length), source });
  }
  return out;
}

/** Every need the texts show. One entry per word and source; the first evidence is kept. */
export function scanScopeNeeds(sources: ReadonlyArray<{ source: string; text: string }>): ScopeNeed[] {
  const seen = new Map<string, ScopeNeed>();
  for (const { source, text } of sources) {
    const found: ScopeNeed[] = [];
    for (const rule of RULES) {
      for (const m of text.matchAll(rule.re)) {
        found.push({
          word: rule.word, ...(rule.rule ? { rule: rule.rule } : {}), ...(rule.alternatives ? { alternatives: rule.alternatives } : {}),
          evidence: excerpt(text, m.index ?? 0, m[0].length), source,
        });
      }
    }
    found.push(...scheduleNeeds(text, source));
    found.push(...onDoneNeeds(text, source));
    for (const need of found) {
      // The rule is part of the key, so an on_done need is kept beside another call that needs the same word.
      const key = `${need.word}|${need.rule ?? ''}|${need.source}`;
      if (!seen.has(key)) seen.set(key, need);
    }
  }
  return [...seen.values()];
}

/** The cortex libs an app loads, as the paths a `<script src>` or a loader names. */
export function cortexLibRefs(html: string): Array<{ name: string; file: string; path: string }> {
  const out = new Map<string, { name: string; file: string; path: string }>();
  // Both parts are bounded: an unbounded file part runs to the end of the text from every
  // `/v1/cortex/` before it fails, which is quadratic on a page that repeats the prefix.
  for (const m of html.matchAll(/\/v1\/cortex\/([^/'"\x60\s?#]{1,128})\/libs\/([^'"\x60\s?#)]{1,256}\.js)/g)) {
    const name = decodeURIComponent(m[1]);
    const file = decodeURIComponent(m[2]);
    out.set(`${name}/${file}`, { name, file, path: `/v1/cortex/${m[1]}/libs/${m[2]}` });
  }
  return [...out.values()];
}

/**
 * What an app's code needs and its sign-in does not ask for. `asks` is its declaration or the
 * default set; a need counts as met when that covers the word or one of its alternatives.
 */
export function undeclaredScopeNeeds(
  html: string, libs: ReadonlyArray<{ source: string; text: string }> = [],
): { asks: string[]; declared: boolean; signsIn: boolean; needs: ScopeNeed[]; missing: string[]; evidence: ScopeNeed[] } {
  const { scopes: asks, declared } = appScopesOf(html);
  // An app that loads no AIMEAT library and calls no AIMEAT method never signs in, so it holds no
  // grant for a word to go on: its calls go out without a token whatever it declares.
  const signsIn = /\bAIMEAT\.|\/v1\/libs\/|aimeat-(?:boot|auth)\b/.test(html);
  if (!signsIn) return { asks, declared, signsIn, needs: [], missing: [], evidence: [] };
  const needs = scanScopeNeeds([{ source: 'app', text: html }, ...libs]);
  const unmet = needs.filter(n => !scopeIsCovered(asks, n.word) && !(n.alternatives ?? []).some(a => scopeIsCovered(asks, a)));
  const missing = new Set<string>();
  const evidence: ScopeNeed[] = [];
  for (const n of unmet) {
    if (!missing.has(n.word)) evidence.push(n);
    missing.add(n.word);
  }
  return { asks, declared, signsIn, needs, missing: [...missing].sort(), evidence };
}

/**
 * The publish warning (services/app-artifact-lint.ts): each word the code needs and the sign-in does
 * not ask for, with the line that needs it. `loadLib` reads a cortex lib the app loads, or null.
 */
export async function undeclaredScopeFindings(
  html: string, loadLib: (path: string) => Promise<string | null>,
): Promise<Array<{ pitfall: string; severity: 'warn'; message: string; url: string }>> {
  const libs: Array<{ source: string; text: string }> = [];
  for (const ref of cortexLibRefs(html).slice(0, 12)) {
    const text = await loadLib(ref.path);
    if (text !== null) libs.push({ source: ref.path, text });
  }
  const { missing, evidence, declared } = undeclaredScopeNeeds(html, libs);
  if (!missing.length) return [];
  const where = evidence.map(e => `${e.word}: ${e.source === 'app' ? '' : `${e.source}: `}\`${e.evidence.slice(0, 100)}\``).join('; ');
  return [{
    pitfall: 'undeclared-scope-words', severity: 'warn', url: '/v1/appdev/pitfalls/undeclared-scope-words',
    message: `This app's code calls routes that need ${missing.map(w => `\`${w}\``).join(', ')}, and `
      + (declared ? 'its `<meta name="aimeat-scopes">` does not name them' : 'it declares no `aimeat-scopes`, so sign-in asks only for the default four')
      + `. From node 4.0 a signed-in app without the word is refused with 403 SCOPE_DENIED there. Where: ${where}. `
      + 'Add the words to aimeat-scopes (declaring replaces the default, so keep the words the app already uses); '
      + 'the person approves them at sign-in. An app published before its node moved to 4.0 kept them by itself, '
      + 'and aimeat_app_manage scope_allowance names them; a new app keeps nothing.',
  }];
}
