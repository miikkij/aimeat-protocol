/**
 * @file js/services/hello-mcp.js
 * @description Hello MCP: the single check that says whether the user's MCP connection actually
 *   works. One lookup, one boolean, no computation.
 *
 *   The key is written by the user's AI over its own MCP session, so it lands in that agent's
 *   namespace and not the owner's. GET /v1/memory/:key broadens to owner-scope (GHII + agents +
 *   eco apps) for owner sessions, so this stays ONE call regardless of which agent wrote it.
 *   `soft: 1` turns "not there yet" into a 200 with exists:false rather than a console 404.
 *
 *   Nothing here is stored on the profile. The MCP-connected state is DERIVED from the key on
 *   every read, so it cannot drift from the thing it claims, and a user cannot set it by saying
 *   they are connected: only their AI can, by writing through the connection.
 * @structure HELLO_MCP_KEY · checkHelloMcp() · fetchHelloMcpPrompt() · fetchInstructionBlock()
 * @usage import { checkHelloMcp } from '/js/services/hello-mcp.js';
 * @version-history
 *   v1.0.0 — 2026-07-31 — Initial.
 */
import { apiGet } from '/js/api.js';
import { getLocale } from '/js/i18n.js';

/** Must match HELLO_MCP_KEY in src/services/hello-mcp.ts. The prompt is fetched from the node
 *  rather than written here for the same reason: one text, one key, no drift. */
export const HELLO_MCP_KEY = 'onboarding.hello_mcp';

/**
 * The whole pass condition.
 * @returns {Promise<{passed: boolean, at: string|null, tool: string|null}>}
 */
export async function checkHelloMcp() {
  const r = await apiGet(`/v1/memory/${encodeURIComponent(HELLO_MCP_KEY)}?soft=1`);
  const d = r && r.data ? r.data : r;
  // `exists:false` is the ONLY negative the soft read produces; anything else with a body is a
  // hit. Written this way rather than `if (!d.exists)` because older nodes omit the field on a
  // hit entirely, and that form read every successful check as a failure — silently, and only
  // when the connection was actually working.
  if (!d || d.exists === false) return { passed: false, at: null, tool: null };
  const v = d.value && typeof d.value === 'object' ? d.value : {};
  // The record's own updated_at is the trustworthy timestamp; the value's `at` is what the AI
  // reported and is shown only as a courtesy when the record time is missing.
  return { passed: true, at: d.updated_at || d.created_at || v.at || null, tool: typeof v.tool === 'string' ? v.tool : null };
}

/** The proof prompt, from the node (see the drift note above). */
export async function fetchHelloMcpPrompt() {
  const r = await apiGet(`/v1/prompts/hello-mcp?lang=${encodeURIComponent(getLocale())}`);
  return (r && r.data && r.data.prompt) || '';
}

/** Step 4: the prompt that has the user's AI create their organism. */
export async function fetchOrganismSetupPrompt(purpose) {
  const q = new URLSearchParams({ lang: getLocale() });
  if (purpose) q.set('purpose', purpose);
  const r = await apiGet(`/v1/prompts/organism-setup?${q.toString()}`);
  return (r && r.data && r.data.prompt) || '';
}

/**
 * Step 5 / the per-organism button: the instruction block generated from the organism's real
 * structure. Returns { blocks: {claude_md, agents_md, chat_instructions}, placement, ... }.
 */
export async function fetchInstructionBlock(orgId) {
  const r = await apiGet(`/v1/organisms/${encodeURIComponent(orgId)}/instruction-block?lang=${encodeURIComponent(getLocale())}`);
  return (r && r.data) || null;
}
