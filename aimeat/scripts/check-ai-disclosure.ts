/**
 * @file check-ai-disclosure.ts
 * @description The gate that keeps TARGET-058 true after everyone stops paying attention.
 *
 *   Eight phases of care are worth nothing if phase nine of somebody else's work quietly drops a
 *   label. Every rule this programme leans on is turned into something that fails a build here, and
 *   each assertion is written so that REMOVING the thing it protects makes it fail — a gate whose
 *   failing case has never been seen is a gate that checks nothing.
 *
 *   IT IGNORES COMMENTS. `ai-provenance-marks.ts` carries a comment telling the next person NOT to
 *   type `trainedAlgorithmicMedia` there. A naive grep fires on that comment, and a gate that cries
 *   wolf on its own documentation gets switched off. Assertion 4 strips comments and string-aware
 *   scans what is left.
 *
 *   IT NAMES THE FIX, NOT JUST THE FAULT — same shape as check:importmap and check:mcp-tools.
 * @structure
 *   1. one LLM transport          — provider HTTP lives in ONE file; who may call it is a list
 *   2. MCP write tools            — every free-text write tool has DECIDED about `ai_provenance`
 *   2b. connector surfaces        — the CATALOG is the contract: node MCP, connector MCP and the
 *                                   shell-callable dispatch all carry what it promises
 *   3. one publish path           — storage.createApp() has one caller plus named distinct acts
 *   4. external vocabulary        — IPTC/IETF values live only in the adapter (comments ignored)
 *   5. locale parity              — every aiLabel.* key in every locale shipped, no [TODO:xx]
 *   6. the build prompt           — the transparency non-negotiable is still literally in it
 *   7. derived visibility         — both providers' PUBLICLY_LINKED cover the declared containers
 * @usage  pnpm check:ai-disclosure          (exit 1 on any violation)
 *         pnpm check:ai-disclosure --list   (print what each assertion currently protects)
 * @version-history
 *   v1.4.0 — 2026-08-12 — Assertion 5 reads the language list off locales/ instead of naming en and
 *     fi. Spanish was added, and a gate that had to be edited to notice a new language would have
 *     reported green on a disclosure nobody had written.
 *   v1.3.0 — 2026-08-01 — TARGET-058 Phase 11b. Assertion 2c: the READ direction. Phase 11 fixed
 *     writes and left reads broken, which is the same mistake one layer along.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 11. Assertion 2b: the gate reads BOTH MCP surfaces and the
 *     shell-callable dispatch, not just src/mcp/. It reported green for eight phases on a connector
 *     surface it could not see — where a declared write returned ok:true and the block was stripped
 *     as an unknown key. The catalog is now the contract every surface is checked against, so the
 *     NEXT field somebody adds cannot land on one surface and be forgotten on the others.
 *   v1.1.0 — 2026-08-01 — TARGET-058 Phase 8b. LLM_TRANSPORT_LEGACY_CALLERS is EMPTY: both known
 *     second paths now go through the chokepoint. Assertion 1 detects a transport caller by reading
 *     the import CLAUSE rather than scanning for the word `complete` — the old word-scan fired on
 *     `src/routes/openrouter.ts` purely because the route path is spelled `/v1/openrouter/complete`,
 *     which would have made a genuinely-clean file impossible to remove from the list. Assertion 2's
 *     two lists moved five borderline tools from "reviewed without" to "required".
 *   v1.0.0 — 2026-08-01 — TARGET-058 Phase 8.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { PUBLICLY_LINKED_CONTAINERS } from '../src/storage/types/ai-provenance.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');            // aimeat/
const rel = (p: string) => relative(root, p).replace(/\\/g, '/');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const failures: string[] = [];
const notes: string[] = [];
function fail(assertion: string, what: string, fix: string): void {
  failures.push(`✖ [${assertion}] ${what}\n      → ${fix}`);
}

/** Every .ts under a directory, recursively. */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Strip `//` and block comments without being fooled by a string that contains them.
 *
 * A URL like `http://…` inside a string literal must survive, and a comment containing a quote must
 * not swallow the rest of the file. Small state machine rather than a regex, because the regex
 * version of this is exactly the naive grep that fires on its own documentation.
 */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && next === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += c; i++;
      while (i < n) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

// ── 1. ONE LLM TRANSPORT ────────────────────────────────────────────────────────────────────────
// The provider HTTP call lives in exactly one file, and who may reach it is a list rather than a
// habit. This is the architectural guard the programme wants anyway: a raw fetch to a model endpoint
// somewhere else is, by construction, a completion nothing meters and nothing stamps.

/** The one module allowed to speak HTTP to a model provider. */
const LLM_TRANSPORT = 'src/services/openrouter.ts';

/** THE chokepoint: mints provenance and meters the call. Everything new must go through it. */
const LLM_CHOKEPOINT = 'src/services/ai-completion.ts';

/**
 * Callers of the raw transport that are NOT the chokepoint.
 *
 * EMPTY, and that is the assertion. Phase 8 froze two real second paths here by name — the
 * owner-facing `POST /v1/openrouter/complete` and `services/notebook-ai.ts` — because naming a gap
 * is better than hiding it. Phase 8b closed both, and emptying this list is what lets Phase 9 write
 * "content this node generates carries a record" in public without a footnote.
 *
 * A new entry is a decision to produce model output that nothing stamps and nothing bills. Adding
 * one is deliberately awkward: it means editing this file, in front of this comment.
 */
const LLM_TRANSPORT_LEGACY_CALLERS: Record<string, string> = {};

/**
 * Does this file import `complete` (or `completeOwner`-style aliases of it) FROM the raw transport?
 *
 * Reads the import CLAUSE rather than scanning the file for the word. The word is everywhere:
 * `src/routes/openrouter.ts` contains the string `'/v1/openrouter/complete'` and legitimately imports
 * `listModels` from the transport, which a word-scan reads as a completion caller forever. Testing
 * the binding makes the check say what it means — "you imported the function that talks to a model" —
 * and it still fires on `import { complete as run }`, because the LOCAL name is irrelevant.
 */
export function importsTransportComplete(src: string): boolean {
  const importClause = /import\s+(type\s+)?\{([^}]*)\}\s+from\s+['"](?:\.{1,2}\/)+(?:services\/)?openrouter\.js['"]/g;
  for (const m of src.matchAll(importClause)) {
    if (m[1]) continue;                                   // `import type { … }` binds no runtime call
    const bindings = m[2].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim());
    if (bindings.includes('complete')) return true;
  }
  // A namespace import can reach anything on the module, so it counts as reaching `complete`.
  return /import\s+\*\s+as\s+\w+\s+from\s+['"](?:\.{1,2}\/)+(?:services\/)?openrouter\.js['"]/.test(src);
}

function checkOneLlmTransport(): void {
  const providerCall = /fetch\s*\(\s*[`'"][^`'"]*\/(chat\/completions|completions|messages)\b/;
  for (const file of walk(join(root, 'src'))) {
    const r = rel(file);
    if (r === LLM_TRANSPORT) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    if (providerCall.test(src)) {
      fail('llm-transport', `${r} calls a model provider endpoint directly`,
        `route it through ${LLM_CHOKEPOINT}, which mints provenance and meters the call. `
        + `Only ${LLM_TRANSPORT} may speak HTTP to a provider.`);
    }
  }

  for (const file of walk(join(root, 'src'))) {
    const r = rel(file);
    if (r === LLM_TRANSPORT || r === LLM_CHOKEPOINT) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    if (!importsTransportComplete(src)) continue;
    if (r in LLM_TRANSPORT_LEGACY_CALLERS) {
      notes.push(`  known second LLM path: ${r} — ${LLM_TRANSPORT_LEGACY_CALLERS[r]}`);
      continue;
    }
    fail('llm-transport', `${r} calls the raw provider transport instead of the chokepoint`,
      `import from ${LLM_CHOKEPOINT} so the completion is stamped and metered. If this genuinely `
      + 'cannot go through it, add it to LLM_TRANSPORT_LEGACY_CALLERS with the reason — deliberately, '
      + 'in this file, where the next person will read it.');
  }
}

// ── 2. MCP WRITE TOOLS HAVE DECIDED ABOUT ai_provenance ─────────────────────────────────────────
// The MCP hop is where provenance either survives or is lost for good; once lost, no amount of
// labelling downstream reconstructs the truth. Every write tool that accepts free text must
// therefore be in exactly one of the two lists below — and a NEW one is in neither, so it fails.

/** Tools that MUST carry the optional `ai_provenance` input. Dropping it from one fails the build. */
const AI_PROVENANCE_REQUIRED = [
  'aimeat_app_draft_publish',
  'aimeat_app_publish',
  'aimeat_board_post',
  'aimeat_board_reply',
  // A published data package is world-readable at a permanent address and is read by people as
  // well as programs. When an AGENT publishes one, the rows and the change description are
  // model-touched output, and the descriptor carries the resulting record id in aimeat.
  'aimeat_datapackage_publish',
  'aimeat_dm_ask',
  'aimeat_dm_send',
  'aimeat_dm_send_as_owner',
  'aimeat_exchange_work_deliver',
  'aimeat_knowledge_contribute',
  'aimeat_memory_write',
  'aimeat_message_send',
  'aimeat_task_complete',
  'aimeat_workspace_comment',
  'aimeat_workspace_write',
];

/**
 * Write tools that take free text and deliberately do NOT carry the parameter — reviewed in Phase 4,
 * decided in Phase 8, and frozen here.
 *
 * The five that WERE borderline (board_reply, dm_ask, exchange_work_deliver, message_send,
 * workspace_comment) moved into the required list in Phase 8b: each carries text a person reads, and
 * the whole point of naming them here rather than quietly fixing them was to make that a decision.
 *
 * What remains is configuration, routing and machine plumbing — a group name, a schedule, an IAM
 * definition, a revenue split. Nobody reads those as authored prose, and a label on one would say
 * nothing to anyone. `app_draft_save` is the one deliberate content exception; the reason is on it.
 */
const AI_PROVENANCE_REVIEWED_WITHOUT = [
  // DECIDED, Phase 8b. A draft is inline-only staging that nobody but its author can see, and its
  // content is stamped at PUBLISH by the one publish path. A record minted at save time would
  // describe bytes that were never shown to anyone and that the next save replaces — and it would
  // have to be re-minted at publish regardless, because the published bytes are the ones a reader
  // gets. One act, one record, at the moment the content reaches a person.
  'aimeat_app_draft_save',
  // DECIDED, 2026-08-16. Same act, same reason, one call at a time: aimeat_app_draft_write appends a
  // PIECE of a draft, and a record minted per chunk would describe a fragment that was never a
  // readable page and that the next chunk changes. The published bytes are what a reader gets, and
  // aimeat_app_draft_publish stamps those. Its siblings (replace, read, seed) move no authored prose
  // of the caller's at all: replace names an exact passage, read returns what is already there, and
  // seed copies bytes the publish path already stamped.
  'aimeat_app_draft_write',
  'aimeat_app_template_propose',
  'aimeat_appdev_pitfall_report',
  'aimeat_board_create',
  'aimeat_capabilities_create',
  'aimeat_capabilities_update',
  'aimeat_commerce_beneficiary_split_set',
  'aimeat_exchange_need_post',
  'aimeat_feedback_send',
  'aimeat_flag_report',
  'aimeat_group_create',
  'aimeat_iam_define',
  // DECIDED, 2026-08-11. A share carries no content: it names an owner, a group and a key pattern.
  // Its one free-text field is `note`, a reminder in the owner's own list that the reader is never
  // shown. Provenance describes how content a person reads was made, and there is no such content
  // here — the records the share exposes carry their own, minted where they were written.
  'aimeat_share_create',
  'aimeat_organism_create',
  'aimeat_organism_update',
  'aimeat_schedule_create',
  'aimeat_task_create',
];

/** A parameter name that carries prose a person will read. */
const FREE_TEXT_PARAM = /\b(body|text|content|message|value|summary|description|title|note|notes|prompt|answer|reply)\s*:\s*z\./;
/** A tool name that writes something. */
const WRITE_VERB = /_(write|post|send|publish|contribute|complete|save|create|update|reply|comment|report|deliver|answer|ask|invite|define|propose|grant|set)\b/;

function mcpToolBlocks(): Array<{ name: string; file: string; block: string }> {
  const out: Array<{ name: string; file: string; block: string }> = [];
  for (const file of walk(join(root, 'src', 'mcp'))) {
    // Comments stripped FIRST, and this is not a nicety. `ai-provenance-input.ts` documents itself
    // with a worked `mcp.tool('aimeat_memory_write', … ...aiProvenanceInput …)` example in its
    // @usage block. Reading that as a real registration made the gate believe memory_write was
    // covered no matter what the actual tool did — the gate passed while the label was gone.
    const src = stripComments(readFileSync(file, 'utf8'));
    const starts = [...src.matchAll(/mcp\.tool\(\s*'([a-z0-9_]+)'/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
      out.push({ name: m[1], file: rel(file), block: src.slice(m.index!, end) });
    });
  }
  return out;
}

function checkMcpWriteTools(): void {
  const blocks = mcpToolBlocks();
  const carrying = new Set(blocks.filter(b => /aiProvenanceInputs?\b/.test(b.block)).map(b => b.name));

  for (const name of AI_PROVENANCE_REQUIRED) {
    if (!carrying.has(name)) {
      fail('mcp-provenance', `MCP tool ${name} no longer declares the ai_provenance input`,
        'spread `...aiProvenanceInputs` into its input shape and pass the declaration to '
        + 'provenanceForWrite(). Without it an agent has no way to say a person wrote what it is '
        + 'relaying, and the node records silence as model-written.');
    }
  }

  const decided = new Set([...AI_PROVENANCE_REQUIRED, ...AI_PROVENANCE_REVIEWED_WITHOUT]);
  for (const b of blocks) {
    if (decided.has(b.name)) continue;
    if (!WRITE_VERB.test(b.name) || !FREE_TEXT_PARAM.test(b.block)) continue;
    fail('mcp-provenance', `new MCP write tool ${b.name} (${b.file}) takes free text and nobody has decided about ai_provenance`,
      'either spread `...aiProvenanceInputs` into it and thread the declaration through '
      + 'provenanceForWrite(), or add it to AI_PROVENANCE_REVIEWED_WITHOUT in this file with a '
      + 'reason. Silence is not a decision.');
  }
}

// ── 2b. THE CONNECTOR'S SURFACES CARRY WHAT THE CATALOG PROMISES ────────────────────────────────
// Assertion 2 scanned `src/mcp/` and reported green on the half of the estate it could not see. The
// OTHER half — `src/cli/connect/`, what `aimeat connect serve` exposes and what every crewaimeat crew
// calls through — carried zero references to provenance, so a declared write returned ok:true and the
// declaration was stripped as an unknown key. A gate that passes on the surface it does not read is
// worse than the missing wiring, because it is the thing that was supposed to prevent it.
//
// THE CATALOG IS THE CONTRACT, and that is what makes this checkable rather than a taste question.
// `src/mcp/catalog/definitions/` declares `ai_provenance` on a tool; three surfaces implement those
// tools; every one of them must carry it. When somebody adds the fifteenth tool, or the NEXT field,
// the two that were updated pass and the one that was forgotten fails here by name.

const CONNECTOR_MCP_DIR = 'src/cli/connect/mcp/tools';
const CONNECTOR_CARRIERS = 'src/cli/connect/ai-provenance-carry.ts';
const CONNECTOR_SHELL_WRAPPER = 'src/cli/connect/tool-call.ts';

/** Tool names the canonical catalog declares `ai_provenance` on. The contract all surfaces answer to. */
function catalogProvenanceTools(): string[] {
  const dir = join(root, 'src', 'mcp', 'catalog', 'definitions');
  const out: string[] = [];
  for (const file of walk(dir)) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const starts = [...src.matchAll(/name:\s*'([a-z0-9_]+)'/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
      const block = src.slice(m.index!, end);
      if (/\.{3}aiProvenanceCatalogInput\b/.test(block) || /\bai_provenance\s*:/.test(block)) out.push(m[1]);
    });
  }
  return [...new Set(out)].sort();
}

/** Tool registrations in the CONNECTOR's MCP surface, with the source of each block. */
function connectorMcpToolBlocks(): Array<{ name: string; file: string; block: string }> {
  const out: Array<{ name: string; file: string; block: string }> = [];
  for (const file of walk(join(root, CONNECTOR_MCP_DIR))) {
    const src = stripComments(readFileSync(file, 'utf8'));
    const starts = [...src.matchAll(/mcp\.tool\(\s*'([a-z0-9_]+)'/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
      out.push({ name: m[1], file: rel(file), block: src.slice(m.index!, end) });
    });
  }
  return out;
}

function checkConnectorSurfaces(): void {
  const promised = catalogProvenanceTools();
  if (promised.length === 0) {
    fail('connector-provenance', 'the catalog declares ai_provenance on no tool at all',
      'this check reads src/mcp/catalog/definitions/ for `...aiProvenanceCatalogInput`. If the catalog '
      + 'stopped declaring it, assertion 2 and this one are both checking nothing.');
    return;
  }

  // (a) The node's own surface. Same list, derived rather than hand-maintained: a tool the catalog
  //     promises the parameter on and src/mcp/ does not carry is the Phase 4 bug returning.
  const nodeCarrying = new Set(mcpToolBlocks().filter(b => /aiProvenanceInputs?\b/.test(b.block)).map(b => b.name));

  // (b) The connector's MCP surface — the one nothing was checking.
  const connectorBlocks = connectorMcpToolBlocks();
  const connectorNames = new Set(connectorBlocks.map(b => b.name));
  const connectorCarrying = new Set(connectorBlocks.filter(b => /aiProvenanceInputs?\b/.test(b.block)).map(b => b.name));

  // (c) The shell-callable surface. It carries provenance through ONE wrapper over the whole dispatch
  //     table rather than per handler, so what is checked is that the wrapper is still applied and
  //     that the tool has a carrier decision. A tool with no entry in the carrier map falls through
  //     `withProvenanceCarrying` untouched — which is exactly the silent strip, one layer down.
  const shellSrc = stripComments(read(CONNECTOR_SHELL_WRAPPER));
  if (!/\.map\(withProvenanceCarrying\)/.test(shellSrc)) {
    fail('connector-provenance', `${CONNECTOR_SHELL_WRAPPER} no longer wraps CONNECT_CLI_TOOLS with withProvenanceCarrying()`,
      'restore `.map(withProvenanceCarrying)` on the assembled list. Without it every shell-callable '
      + 'write tool — `aimeat connect call` AND the serve daemon\'s POST /local/call/:tool — goes back '
      + 'to dropping a caller\'s ai_provenance block behind an ok:true.');
  }
  const carrierSrc = stripComments(read(CONNECTOR_CARRIERS));
  const declaredCarriers = new Set(
    [...carrierSrc.matchAll(/^\s{2}(aimeat_[a-z0-9_]+):/gm)].map(m => m[1]));

  for (const name of promised) {
    if (!nodeCarrying.has(name)) {
      fail('connector-provenance', `the catalog promises ai_provenance on ${name} but src/mcp/ does not carry it`,
        'spread `...aiProvenanceInputs` into the node MCP registration, or stop promising it in the '
        + 'catalog. A schema that advertises a parameter the handler discards is the failure this '
        + 'programme exists to catch.');
    }
    // A tool the connector does not expose at all is not this check's business — but one it DOES
    // expose has to honour the same contract, because that is the schema a crew reads.
    if (connectorNames.has(name) && !connectorCarrying.has(name)) {
      fail('connector-provenance', `connector MCP tool ${name} drops the ai_provenance the catalog promises`,
        `spread \`...aiProvenanceInputs\` into its shape in ${CONNECTOR_MCP_DIR}/ and hand the block to `
        + 'provenanceEchoedResult(). A zod object STRIPS unknown keys, so without this a crew declares, '
        + 'gets ok:true, and the node records the opposite.');
    }
    if (!declaredCarriers.has(name)) {
      fail('connector-provenance', `${name} has no entry in CONNECTOR_PROVENANCE_CARRIERS`,
        `add one in ${CONNECTOR_CARRIERS}: either a carrier that records the declaration, or `
        + '`{ kind: \'not-carried\', route }` naming the node route that would have to accept it. '
        + 'No entry means the shell path silently ignores the block — the same bug, one layer down.');
    }
  }

  // The two MCP surfaces must not drift APART either: a tool carrying it on the node and not on the
  // connector is the state Phase 11 found, and the reverse would be just as invisible.
  const nodeOnly = [...nodeCarrying].filter(n => connectorNames.has(n) && !connectorCarrying.has(n));
  const connectorOnly = [...connectorCarrying].filter(n => !nodeCarrying.has(n));
  for (const n of nodeOnly) {
    fail('connector-provenance', `${n} carries ai_provenance on the node surface but not on the connector surface`,
      `add \`...aiProvenanceInputs\` in ${CONNECTOR_MCP_DIR}/. Crews call through the connector; the `
      + 'node surface being right does not help them.');
  }
  for (const n of connectorOnly) {
    fail('connector-provenance', `${n} carries ai_provenance on the connector surface but not on the node's own`,
      'add it in src/mcp/ too, and to the catalog definition. Two surfaces answering differently about '
      + 'the same tool is the drift this assertion exists to stop.');
  }

  checkConnectorReadDirection(carrierSrc, connectorBlocks);

  const notCarried = [...carrierSrc.matchAll(/^\s{2}(aimeat_[a-z0-9_]+):\s*\{\s*kind:\s*'not-carried'/gm)].map(m => m[1]);
  if (notCarried.length) {
    notes.push(`  connector declarations NOT recorded (the node route accepts none): ${notCarried.length} tool(s) — `
      + `${notCarried.join(', ')}. Each returns ai_provenance.recorded=false with the reason.`);
  }
}

// ── 2c. THE READ DIRECTION LOSES NOTHING ────────────────────────────────────────────────────────
// Phase 11 fixed writes and left reads broken, which is the same mistake one layer along: a route
// that serves its record on the ENVELOPE carrier (`meta.provenance`, the one carrier §A4 froze) hands
// it to a connector tool that does `resp.data ?? resp` and drops the envelope. A crew reading its own
// content back got `ai_provenance_id` — a pointer — and no statement.
//
// Route → tool is not statically derivable, so the routes are a LIST you have to edit. A seventh one
// fails this check until somebody says what wraps it, which is the same shape as
// CREATE_APP_DISTINCT_ACTS and LLM_TRANSPORT_LEGACY_CALLERS.

/** Routes that serve a provenance record on `meta.provenance`, and what carries it to a caller. */
const ENVELOPE_PROVENANCE_ROUTES: Record<string, string> = {
  'src/routes/memory/key.ts':
    'GET /v1/memory/:key (+ the public read) — connector: aimeat_memory_read, folded.',
  'src/routes/apps/read.ts':
    'the app detail read — connector: aimeat_app_get, folded.',
  'src/routes/knowledge/packages-core.ts':
    'the knowledge package manifest read — connector: aimeat_knowledge_get, folded.',
  'src/routes/ai.ts':
    'POST /v1/ai/complete — no connector tool wraps it; apps read it via the browser SDK, which '
    + 'reads r.meta.provenance directly (sdk-libs/ai/index.js).',
  'src/routes/openrouter.ts':
    'POST /v1/openrouter/complete — owner-facing, same as ai.ts: no connector tool.',
};

/** Connector MCP read tools that MUST fold the envelope carrier onto their payload. */
const CONNECTOR_META_READS = ['aimeat_memory_read', 'aimeat_app_get', 'aimeat_knowledge_get'];

const READ_FOLD = 'readPayloadWithProvenance';

function checkConnectorReadDirection(
  carrierSrc: string, connectorBlocks: Array<{ name: string; file: string; block: string }>,
): void {
  // The shell surface folds UNCONDITIONALLY inside withProvenanceCarrying — no list to forget. That
  // property is what is asserted; deleting the fold from inside the wrapper would otherwise pass the
  // `.map(withProvenanceCarrying)` check above while losing every record on the shell path.
  if (!carrierSrc.includes(READ_FOLD)) {
    fail('connector-provenance', `${CONNECTOR_CARRIERS} no longer folds meta.provenance onto read payloads`,
      `restore ${READ_FOLD}() and its use inside withProvenanceCarrying(). Without it every `
      + 'shell-callable read drops the record the node served on the envelope, and a crew sees a '
      + 'provenance id it cannot resolve into a statement.');
  }

  const byName = new Map(connectorBlocks.map(b => [b.name, b]));
  for (const name of CONNECTOR_META_READS) {
    const b = byName.get(name);
    if (!b) {
      fail('connector-provenance', `${name} is listed in CONNECTOR_META_READS but is not registered on the connector MCP surface`,
        'either it was renamed — update the list — or it was removed, in which case delete the entry.');
      continue;
    }
    if (!b.block.includes(READ_FOLD)) {
      fail('connector-provenance', `connector MCP tool ${name} unwraps the envelope without folding meta.provenance`,
        `use ${READ_FOLD}(resp) instead of \`resp.data ?? resp\`. Its node route serves the whole `
        + 'record on meta.provenance; the plain unwrap returns the id and throws the statement away.');
    }
  }

  const seen = new Set<string>();
  for (const file of walk(join(root, 'src', 'routes'))) {
    const r = rel(file);
    if (!/\benvelopeMeta\s*\(/.test(stripComments(readFileSync(file, 'utf8')))) continue;
    seen.add(r);
    if (!(r in ENVELOPE_PROVENANCE_ROUTES)) {
      fail('connector-provenance', `${r} serves provenance on meta.provenance and nobody has said what carries it to a caller`,
        'add it to ENVELOPE_PROVENANCE_ROUTES in this file, naming the connector tool that folds it '
        + `with ${READ_FOLD}() — or saying that no connector tool wraps this route. The envelope is `
        + 'dropped by every `resp.data ?? resp` in the connector, so a new one here is a record lost '
        + 'silently.');
    }
  }
  for (const r of Object.keys(ENVELOPE_PROVENANCE_ROUTES)) {
    if (!seen.has(r)) {
      fail('connector-provenance', `${r} is listed as serving meta.provenance but no longer calls envelopeMeta()`,
        'remove it from ENVELOPE_PROVENANCE_ROUTES — a stale entry makes the list read as bigger '
        + 'coverage than it has.');
    }
  }
}

// ── 3. ONE PUBLISH PATH ─────────────────────────────────────────────────────────────────────────
// Provenance went missing at a forgotten publish door in Phase 4, again in Phase 5, and Phase 8
// found FIVE doors where the audit had counted three. One function, and a short list of acts that
// genuinely are not a publish.

const PUBLISH_PATH = 'src/services/app-publish.ts';

/** Writes an app row WITHOUT being a publish. Each is a different act, with a different rule. */
const CREATE_APP_DISTINCT_ACTS: Record<string, string> = {
  'src/services/app-lifecycle.ts':
    'A fork COPIES bytes rather than generating them: it carries the source provenance record forward '
    + 'and must not mint a new one, must not announce, and must not fire the publish feed. This was '
    + 'two entries until 2026-08-11 (routes/apps/fork-manage.ts and mcp/apps-fork.ts), which is what '
    + 'an exemption list looks like when one act has two implementations. Step 8 collapsed them into '
    + 'forkApp() here, and the two old entries came out with the code: neither file writes an app row '
    + 'any more. One act, one exemption, one place to check when the provenance rule changes.',
  'src/services/apps-backup-import.ts':
    'Restoring a backup replays rows that were already published; re-announcing a restore would '
    + 'spam the feed with history.',
  'src/services/component-registrar.ts':
    'Node-internal seeding of built-in components at boot, with no principal to attribute to.',
};

function checkOnePublishPath(): void {
  for (const file of walk(join(root, 'src'))) {
    const r = rel(file);
    if (r === PUBLISH_PATH) continue;
    const src = stripComments(readFileSync(file, 'utf8'));
    if (!/\bstorage\.createApp\s*\(/.test(src)) continue;
    if (r in CREATE_APP_DISTINCT_ACTS) { notes.push(`  app row written outside the publish path: ${r} — ${CREATE_APP_DISTINCT_ACTS[r]}`); continue; }
    fail('one-publish-path', `${r} writes an app version without going through ${PUBLISH_PATH}`,
      `call publishApp() from ${PUBLISH_PATH}. It is what stamps provenance, runs the transparency `
      + 'lint, enforces the quota, carries the access code and the operator-hide forward, provisions '
      + 'the subdomain, writes the change log and fires the feed. Every door that reimplemented some '
      + 'of that forgot the rest.');
  }
}

// ── 4. EXTERNAL VOCABULARY LIVES IN ONE FILE ────────────────────────────────────────────────────
// The IETF draft expires and the W3C vocabulary is months old: when either moves, one function and
// one test change — but only while these strings exist in exactly one place.

const ADAPTERS = 'src/services/ai-provenance-adapters.ts';

/**
 * Value tokens from the external vocabularies. Deliberately the unambiguous ones: `ai-generated` is
 * also OUR `level` enum and `autonomous` is an ordinary English word, so neither can be forbidden
 * without the gate crying wolf.
 */
const EXTERNAL_VOCABULARY = [
  'trainedAlgorithmicMedia',
  'compositeWithTrainedAlgorithmicMedia',
  'machine-generated',
  'ai-originated',
  'cv.iptc.org/newscodes/digitalsourcetype',
];

function checkVocabularyContainment(): void {
  const scan = [join(root, 'src'), join(root, 'public')];
  for (const dir of scan) {
    for (const file of walk(dir).concat(dir.endsWith('public') ? [] : [])) {
      const r = rel(file);
      if (r === ADAPTERS) continue;
      // COMMENTS ARE NOT CODE. ai-provenance-marks.ts documents this very rule by naming the
      // strings; a gate that fails on its own documentation is a gate somebody switches off.
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const token of EXTERNAL_VOCABULARY) {
        if (src.includes(token)) {
          fail('vocabulary', `${r} spells the external vocabulary value "${token}"`,
            `move it into ${ADAPTERS} and call the adapter. That file is the only place these `
            + 'values are allowed to exist, which is what keeps "when the IETF draft expires, one '
            + 'function changes" true.');
        }
      }
    }
  }
}

// ── 5. LOCALE PARITY FOR THE LABEL COPY ─────────────────────────────────────────────────────────
// Rule 4, enforced rather than remembered. A label string is a compliance string: an English
// fallback shown to a Finnish or Spanish reader is a disclosure they were not given in their own
// language. The list of languages is read from locales/ rather than typed here, so the language
// somebody adds next enforces itself on the commit that adds it.

/** Every locale the node ships, taken from the files themselves. English first, then the rest. */
function shippedLocales(): string[] {
  const tags = readdirSync(join(root, 'locales'))
    .filter(f => /^[a-z]{2}\.json$/.test(f))
    .map(f => f.slice(0, 2));
  return ['en', ...tags.filter(t => t !== 'en').sort()];
}

function checkLocaleParity(): void {
  const [, ...others] = shippedLocales();
  const en = JSON.parse(read('locales/en.json')) as Record<string, Record<string, string>>;
  const enKeys = Object.keys(en.aiLabel ?? {});

  if (enKeys.length === 0) {
    fail('locales', 'locales/en.json has no aiLabel.* keys at all',
      'the visible label reads its words from these keys; without them every label falls back to a '
      + 'raw key string.');
    return;
  }

  for (const tag of others) {
    const loc = JSON.parse(read(`locales/${tag}.json`)) as Record<string, Record<string, string>>;
    const locKeys = Object.keys(loc.aiLabel ?? {});
    for (const k of enKeys) {
      if (!locKeys.includes(k)) {
        fail('locales', `aiLabel.${k} exists in en.json but not in ${tag}.json`,
          `add it in ${tag}, composed in that language rather than translated from the English. `
          + 'This is the sentence that reader is legally owed.');
      }
    }
    for (const k of locKeys) {
      if (!enKeys.includes(k)) fail('locales', `aiLabel.${k} exists in ${tag}.json but not in en.json`, 'add the English.');
    }
    for (const [k, v] of Object.entries(loc.aiLabel ?? {})) {
      if (String(v).includes(`[TODO:${tag}]`)) {
        fail('locales', `aiLabel.${k} in ${tag}.json is still a [TODO:${tag}] placeholder`,
          `write the ${tag} text. A placeholder shipped as a disclosure is worse than an English `
          + 'one, because it reads as broken software rather than as a statement.');
      }
    }
  }
}

// ── 6. THE BUILD PROMPT STILL ASKS FOR THE LABEL ────────────────────────────────────────────────
// A literal presence check, so a future prompt edit cannot silently drop the one instruction that
// puts a label into every app somebody builds on this node.

const BUILD_PROMPT = 'src/services/build-app-prompt.ts';
const BUILD_PROMPT_NON_NEGOTIABLES: Array<{ literal: string; why: string }> = [
  { literal: 'AIMEAT.ai.disclose(', why: 'the call that draws the label at first exposure' },
  { literal: 'AIMEAT.ai.declare()', why: 'attaching the record to anything the app stores or publishes' },
  { literal: 'AIMEAT.ai.chatNotice()', why: 'the Article 50(1) notice when the app opens a chat' },
  { literal: '<meta name="aimeat-ai"', why: 'the app\'s own declaration, which the publish check reads' },
];

function checkBuildPrompt(): void {
  const src = read(BUILD_PROMPT);
  for (const { literal, why } of BUILD_PROMPT_NON_NEGOTIABLES) {
    if (!src.includes(literal)) {
      fail('build-prompt', `${BUILD_PROMPT} no longer contains "${literal}" (${why})`,
        'put it back. This prompt is what every app built on this node is written from, so removing '
        + 'a line here removes a label from every app built after it — silently, and only visible '
        + 'weeks later in an audit.');
    }
  }
}

// ── 7. DERIVED VISIBILITY COVERS EVERY PUBLISHING CONTAINER ─────────────────────────────────────
// "Visibility follows the content" is elegant and it has a maintenance obligation: a publishing
// route whose container is missing from the predicate leaves its provenance silently private, and
// a label that will not resolve reads to a visitor as no provenance at all.

const PREDICATE_FILES = {
  sqlite: 'src/storage/providers/sqlite/methods/ai-provenance.ts',
  postgres: 'src/storage/providers/postgres-kysely/methods/ai-provenance.ts',
} as const;

function checkPubliclyLinkedContainers(): void {
  const sqlite = read(PREDICATE_FILES.sqlite);
  const postgres = read(PREDICATE_FILES.postgres);

  const sqlitePredicate = /const PUBLICLY_LINKED = `([\s\S]*?)`;/.exec(sqlite)?.[1];
  const postgresPredicate = /const publiclyLinked = [\s\S]*?sql<boolean>`([\s\S]*?)`;/.exec(postgres)?.[1];

  if (!sqlitePredicate || !postgresPredicate) {
    fail('derived-visibility', 'could not find the PUBLICLY_LINKED predicate in one of the providers',
      `it must stay a single named constant in ${PREDICATE_FILES.sqlite} and ${PREDICATE_FILES.postgres} `
      + 'so this check — and a human reading it — can see the whole rule in one place.');
    return;
  }

  for (const c of PUBLICLY_LINKED_CONTAINERS) {
    if (!new RegExp(`\\b${c.sqliteTable}\\b`).test(sqlitePredicate)) {
      fail('derived-visibility', `SQLite PUBLICLY_LINKED does not cover the "${c.name}" container (${c.sqliteTable})`,
        `add a clause for it (${c.publicWhen}). Without it every provenance record attached to a `
        + `${c.name} item stays privately resolvable, and the label on a public item 404s.`);
    }
    if (!postgresPredicate.includes(c.postgresTable)) {
      fail('derived-visibility', `Postgres PUBLICLY_LINKED does not cover the "${c.name}" container (${c.postgresTable})`,
        `add a clause for it (${c.publicWhen}).`);
    }
  }

  // The two providers must also agree with each other: a container covered on one backend and not
  // the other means the same content is publicly attributable on SQLite and silently private on
  // Postgres, which is the harder bug to see because prod is only one of them.
  const sqliteTables = [...sqlitePredicate.matchAll(/FROM\s+([A-Za-z_"]+)/g)].map(m => m[1]);
  const postgresTables = [...postgresPredicate.matchAll(/FROM\s+("?[A-Za-z_]+"?)/g)].map(m => m[1]);
  if (sqliteTables.length !== postgresTables.length) {
    fail('derived-visibility',
      `the two providers' PUBLICLY_LINKED predicates cover different numbers of containers `
      + `(SQLite ${sqliteTables.length}: ${sqliteTables.join(', ')}; Postgres ${postgresTables.length}: ${postgresTables.join(', ')})`,
      'make them agree, and add the container to PUBLICLY_LINKED_CONTAINERS in '
      + 'src/storage/types/ai-provenance.ts so both are checked next time.');
  }
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────

function listProtected(): void {
  console.log('\ncheck:ai-disclosure protects:\n');
  console.log(`  1. one LLM transport   — ${LLM_TRANSPORT} only; chokepoint ${LLM_CHOKEPOINT}`);
  console.log(`     known second paths: ${Object.keys(LLM_TRANSPORT_LEGACY_CALLERS).join(', ') || 'none'}`);
  console.log(`  2. MCP write tools     — ${AI_PROVENANCE_REQUIRED.length} must carry ai_provenance, `
    + `${AI_PROVENANCE_REVIEWED_WITHOUT.length} reviewed without`);
  const promised = catalogProvenanceTools();
  console.log(`  2b. connector surfaces — ${promised.length} catalog tools; node MCP + ${CONNECTOR_MCP_DIR}/ + `
    + `the ${CONNECTOR_SHELL_WRAPPER} wrapper must all carry them`);
  console.log(`  3. one publish path    — ${PUBLISH_PATH}; ${Object.keys(CREATE_APP_DISTINCT_ACTS).length} distinct acts named`);
  console.log(`  4. vocabulary          — ${EXTERNAL_VOCABULARY.length} value tokens confined to ${ADAPTERS}`);
  console.log(`  5. locales             — every aiLabel.* key in ${shippedLocales().join(' + ')}, no [TODO:xx]`);
  console.log(`  6. build prompt        — ${BUILD_PROMPT_NON_NEGOTIABLES.length} literals must be present`);
  console.log(`  7. derived visibility  — ${PUBLICLY_LINKED_CONTAINERS.map(c => c.name).join(', ')} on both providers\n`);
}

if (process.argv.includes('--list')) {
  listProtected();
  process.exit(0);
}

checkOneLlmTransport();
checkMcpWriteTools();
checkConnectorSurfaces();
checkOnePublishPath();
checkVocabularyContainment();
checkLocaleParity();
checkBuildPrompt();
checkPubliclyLinkedContainers();

if (failures.length) {
  console.error(`\n✖ ${failures.length} AI-disclosure violation(s):\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  console.error('  Full design: docs/internal/EUAct/10-validators-and-ci.md\n');
  process.exit(1);
}

if (notes.length) {
  console.log('✓ AI disclosure gates pass. Known, listed exceptions:');
  for (const n of notes) console.log(n);
} else {
  console.log('✓ AI disclosure gates pass.');
}
