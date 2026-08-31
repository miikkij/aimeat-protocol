/**
 * @file src/services/node-capabilities.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own capabilities as DATA: what `discover` finds and `invoke` runs.
 *
 *   WHAT PROBLEM THIS IS. 297 tools do not fit in a model's context, and the two answers the
 *   industry settled on — tool search and programmatic calling — both assume a small set of
 *   primitives plus a catalogue you can look things up in. This is the catalogue. It adds a door
 *   beside the 297 and removes none of them: every existing tool answers exactly as before, and a
 *   client that wants all of them still gets all of them.
 *
 *   IT IS A PROJECTION, NOT A SECOND LIST. The entries are derived from
 *   `CLI_FALLBACK_TOOL_DEFINITIONS`, the transport-neutral catalog the three MCP surfaces already
 *   share. Writing a second list of capabilities by hand is the mistake this codebase has already
 *   paid for three times with three MCP doors, so there is exactly one source and this reads it.
 *
 *   WHY THE cliFallback SET AND NOT ALL 297. A capability belongs in the catalogue only if `invoke`
 *   can actually run it, and what makes a tool runnable by name is having a REST mapping in the
 *   shared dispatch table. Listing a capability that cannot be invoked would be a catalogue that
 *   lies. The boundary is therefore mechanical rather than curated, and it moves on its own as tools
 *   gain dispatch entries.
 *
 * @structure
 *   - NodeCapability — one catalogue entry
 *   - listNodeCapabilities() / findNodeCapability() / searchNodeCapabilities()
 *   - NON_INVOKABLE — the ids `invoke` refuses, and why
 * @usage
 *   import { searchNodeCapabilities } from '../services/node-capabilities.js';
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V2: discover + invoke).
 */
import { CLI_FALLBACK_TOOL_DEFINITIONS } from '../mcp/catalog/definitions.js';
import { CONNECT_CLI_TOOLS } from '../cli/connect/tool-call.js';
import type { ToolInputField } from '../mcp/catalog/definitions/types.js';

/** One capability, as a caller sees it: enough to decide, and enough to call. */
export interface NodeCapability {
  /** The name `invoke` takes. The same string the tool has, so one name means one thing. */
  id: string;
  title: string;
  description: string;
  /** Coarse family, derived from the id (`aimeat_memory_write` → `memory`). What `discover` facets on. */
  segment: string;
  /** The input contract, verbatim from the shared catalog. */
  input: Record<string, ToolInputField>;
  /** Which inputs must be present. Pulled out so a caller does not have to read the whole schema. */
  required: string[];
  /** Who the catalog says calls this: agent, owner, operator or public. */
  caller: string;
}

/**
 * Capabilities `invoke` refuses to run, by id.
 *
 * `aimeat_invoke` itself, because a dispatcher that can dispatch to itself is a loop with a network
 * hop in it, and nothing is gained by allowing it. The two provenance-carrying pseudo-parameters are
 * handled by the dispatch table's own wrapper, not by a capability.
 */
export const NON_INVOKABLE: ReadonlySet<string> = new Set(['aimeat_invoke']);

/** `aimeat_memory_write` → `memory`. The family a person or a model would group it under. */
function segmentOf(id: string): string {
  const rest = id.startsWith('aimeat_') ? id.slice('aimeat_'.length) : id;
  const head = rest.split('_')[0];
  return head || 'other';
}

let cache: NodeCapability[] | null = null;

/**
 * Every capability this node can run by name.
 *
 * Built once. The two sources are module constants assembled at import, so a second walk would
 * produce an identical array and this is called on every discover.
 */
export function listNodeCapabilities(): NodeCapability[] {
  if (cache) return cache;
  const dispatchable = new Set(CONNECT_CLI_TOOLS.map(t => t.name));
  cache = CLI_FALLBACK_TOOL_DEFINITIONS
    .filter(def => dispatchable.has(def.name) && !NON_INVOKABLE.has(def.name))
    .map(def => ({
      id: def.name,
      // The catalog has no separate title. The id without its prefix, in words, is a better label
      // than repeating the first sentence of the description.
      title: def.name.replace(/^aimeat_/, '').replace(/_/g, ' '),
      description: def.description,
      segment: segmentOf(def.name),
      input: def.input ?? {},
      required: Object.entries(def.input ?? {}).filter(([, f]) => f.required).map(([k]) => k),
      caller: def.caller,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return cache;
}

export function findNodeCapability(id: string): NodeCapability | undefined {
  return listNodeCapabilities().find(c => c.id === id);
}

/**
 * The capabilities matching a free-text query, best first.
 *
 * Deliberately a plain substring score and not an index: the catalogue is a few hundred entries of
 * static text in memory, and an index would be a second thing to keep in step with the catalog for
 * no measurable gain. An id match outranks a description match, because somebody typing `memory
 * write` means the tool and not every sentence mentioning it.
 */
export function searchNodeCapabilities(q: string | undefined, segment?: string, limit = 20): NodeCapability[] {
  const all = listNodeCapabilities().filter(c => !segment || c.segment === segment);
  const needle = (q ?? '').trim().toLowerCase();
  if (!needle) return all.slice(0, limit);
  const words = needle.split(/\s+/).filter(Boolean);
  const scored = all.map(c => {
    const id = c.id.toLowerCase();
    const text = `${c.id} ${c.description}`.toLowerCase();
    let score = 0;
    for (const w of words) {
      if (id.includes(w)) score += 10;
      else if (text.includes(w)) score += 1;
    }
    return { c, score };
  }).filter(x => x.score > 0);
  scored.sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  return scored.slice(0, limit).map(x => x.c);
}
