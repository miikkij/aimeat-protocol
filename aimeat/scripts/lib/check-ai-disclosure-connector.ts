/**
 * @file scripts/lib/check-ai-disclosure-connector.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Connector provenance checks extracted unchanged from the disclosure gate.
 * @version-history
 *   v1.2.0 -- 2026-10-05 -- Both surfaces' carrying of ai_provenance is read from their registered schemas
 *     (keysOf); a connector tool served over its CLI dispatch definition folds read provenance inside
 *     withProvenanceCarrying() (secaudit 2026-10, M3).
 *   v1.1.0 -- 2026-09-30 -- aimeat_memory_read_public joins CONNECTOR_META_READS: the connector
 *     tool folds meta.provenance now, and the check holds it to that.
 *   v1.0.1 -- 2026-09-30 -- ENVELOPE_PROVENANCE_ROUTES names src/routes/memory/public-read.ts, the
 *     public read moved out of routes/memory/key.ts (TARGET-082 review).
 *   v1.0.0 -- 2026-09-27 -- Keep the gate below its file-size ceiling while moving shared dispatch.
 */
import { join } from 'node:path';

export const CONNECTOR_MCP_DIR = 'src/cli/connect/mcp/tools';
export const CONNECTOR_SHELL_WRAPPER = 'src/tool-dispatch/index.ts';

interface CheckContext {
  root: string;
  walk(dir: string): string[];
  stripped(file: string): string;
  rel(file: string): string;
  read(file: string): string;
  stripComments(source: string): string;
  fail(assertion: string, what: string, fix: string): void;
  /** A tool's registered input keys on one MCP surface. */
  keysOf(surface: 'node' | 'connector', name: string): Set<string>;
  /** Every tool the connector MCP registers. */
  connectorNames(): Set<string>;
  notes: string[];
}

export function createConnectorChecks(context: CheckContext): { check(): void; catalogProvenanceTools(): string[] } {
  const { root, walk, stripped, rel, read, stripComments, fail, keysOf, notes } = context;
// ── 2b. THE CONNECTOR'S SURFACES CARRY WHAT THE CATALOG PROMISES ────────────────────────────────
// Assertion 2 scanned `src/mcp/` and reported green on the half of the estate it could not see. The
// OTHER half — `src/cli/connect/`, what `aimeat connect serve` exposes and what every crewaimeat crew
// calls through — carried zero references to provenance, so a declared write returned ok:true and the
// declaration was stripped as an unknown key. A gate that passes on the surface it does not read is
// worse than the missing wiring, because it is the thing that was supposed to prevent it.
//
// THE CATALOG IS THE CONTRACT, and that is what makes this checkable rather than a taste question.
// `src/tool-catalog/definitions/` declares `ai_provenance` on a tool; three surfaces implement those
// tools; every one of them must carry it. When somebody adds the fifteenth tool, or the NEXT field,
// the two that were updated pass and the one that was forgotten fails here by name.

const CONNECTOR_CARRIERS = 'src/tool-dispatch/ai-provenance-carry.ts';

/** Tool names the canonical catalog declares `ai_provenance` on. The contract all surfaces answer to. */
function catalogProvenanceTools(): string[] {
  const dir = join(root, 'src', 'tool-catalog', 'definitions');
  const out: string[] = [];
  for (const file of walk(dir)) {
    const src = stripped(file);
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
    const src = stripped(file);
    const starts = [...src.matchAll(/mcp\.tool\(\s*'([a-z0-9_]+)'/g)];
    starts.forEach((m, i) => {
      const end = i + 1 < starts.length ? starts[i + 1].index! : src.length;
      out.push({ name: m[1], file: rel(file), block: src.slice(m.index!, end) });
    });
  }
  return out;
}

function checkSurfaces(): void {
  const promised = catalogProvenanceTools();
  if (promised.length === 0) {
    fail('connector-provenance', 'the catalog declares ai_provenance on no tool at all',
      'this check reads src/tool-catalog/definitions/ for `...aiProvenanceCatalogInput`. If the catalog '
      + 'stopped declaring it, assertion 2 and this one are both checking nothing.');
    return;
  }

  // (a) The node's own surface. Same list, derived rather than hand-maintained: a tool the catalog
  //     promises the parameter on and src/mcp/ does not carry is the Phase 4 bug returning.
  const nodeCarrying = new Set(promised.filter(n => keysOf('node', n).has('ai_provenance')));

  // (b) The connector's MCP surface — the one nothing was checking.
  //     Its registered schema answers, as for the node: most of its tools run their CLI dispatch
  //     definition since 2026-10-05 (dispatch-tools.ts), and have no source block of their own.
  const connectorBlocks = connectorMcpToolBlocks();
  const connectorNames = context.connectorNames();
  const connectorCarrying = new Set([...connectorNames].filter(n => keysOf('connector', n).has('ai_provenance')));

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
  const nodeAll = new Set([...connectorNames, ...nodeCarrying].filter(n => keysOf('node', n).has('ai_provenance')));
  const nodeOnly = [...nodeAll].filter(n => connectorNames.has(n) && !connectorCarrying.has(n));
  const connectorOnly = [...connectorCarrying].filter(n => keysOf('node', n).size && !nodeAll.has(n));
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

  checkConnectorReadDirection(carrierSrc, connectorBlocks, connectorNames);

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
    'GET /v1/memory/:key — connector: aimeat_memory_read, folded.',
  'src/routes/memory/public-read.ts':
    'GET /v1/memory/:gaii/:key, the public read, moved out of key.ts on 2026-09-29 — shell path: '
    + 'aimeat_memory_read_public, folded inside withProvenanceCarrying; connector MCP: '
    + 'aimeat_memory_read_public, folded (CONNECTOR_META_READS).',
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
const CONNECTOR_META_READS = ['aimeat_memory_read', 'aimeat_memory_read_public', 'aimeat_app_get', 'aimeat_knowledge_get'];

const READ_FOLD = 'readPayloadWithProvenance';

function checkConnectorReadDirection(
  carrierSrc: string, connectorBlocks: Array<{ name: string; file: string; block: string }>, connectorNames: Set<string>,
): void {
  // The shell surface folds UNCONDITIONALLY inside withProvenanceCarrying — no list to forget. That
  // property is what is asserted; deleting the fold from inside the wrapper would otherwise pass the
  // `.map(withProvenanceCarrying)` check above while losing every record on the shell path.
  // The wrapper's own body, not the file: the helper's definition names itself, so a file-wide search
  // stayed green with the call taken out of the wrapper. Most connector reads run through it since
  // 2026-10-05 (dispatch-tools.ts), so this call is what folds their provenance.
  const wrapperBody = carrierSrc.match(/export function withProvenanceCarrying[\s\S]*?\n\}\n/)?.[0] ?? '';
  if (!new RegExp(`\\b${READ_FOLD}\\(`).test(wrapperBody)) {
    fail('connector-provenance', `${CONNECTOR_CARRIERS} no longer folds meta.provenance onto read payloads`,
      `restore ${READ_FOLD}() and its use inside withProvenanceCarrying(). Without it every `
      + 'shell-callable read drops the record the node served on the envelope, and a crew sees a '
      + 'provenance id it cannot resolve into a statement.');
  }

  const byName = new Map(connectorBlocks.map(b => [b.name, b]));
  for (const name of CONNECTOR_META_READS) {
    if (!connectorNames.has(name)) {
      fail('connector-provenance', `${name} is listed in CONNECTOR_META_READS but is not registered on the connector MCP surface`,
        'either it was renamed — update the list — or it was removed, in which case delete the entry.');
      continue;
    }
    // Served over its CLI dispatch definition: withProvenanceCarrying() folds, asserted above.
    const b = byName.get(name);
    if (!b) continue;
    if (!b.block.includes(READ_FOLD)) {
      fail('connector-provenance', `connector MCP tool ${name} unwraps the envelope without folding meta.provenance`,
        `use ${READ_FOLD}(resp) instead of \`resp.data ?? resp\`. Its node route serves the whole `
        + 'record on meta.provenance; the plain unwrap returns the id and throws the statement away.');
    }
  }

  const seen = new Set<string>();
  for (const file of walk(join(root, 'src', 'routes'))) {
    const r = rel(file);
    if (!/\benvelopeMeta\s*\(/.test(stripped(file))) continue;
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


  return { check: checkSurfaces, catalogProvenanceTools };
}
