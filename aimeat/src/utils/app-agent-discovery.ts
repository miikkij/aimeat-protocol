/**
 * @file app-agent-discovery.ts
 * @description Inject a static, script-free DISCOVERY block into an inline-served published app, so
 *   an agent that has nothing but the app's URL can find what the app sells and how to call it.
 *   Every published app is a single-file SPA: its <body> is empty until JavaScript runs, so a
 *   fetching agent (web_fetch and friends run a markdown/text extraction over the raw HTML, without
 *   a JS engine) sees the meta tags and nothing else. Measured on a live app: the fetch returned the
 *   title and one word of body text, the agent concluded there was nothing agent-facing here, and
 *   went off to download 184 kB of source to work it out. Everything it needed already existed —
 *   `/.well-known/mcp.json`, the WebMCP listing, the priced-tool manifest, the x402 402 handshake —
 *   and nothing in the document pointed at any of it.
 *
 *   The block is <noscript>, so it costs a human reader nothing (the app's own UI paints over it the
 *   moment JS runs) while staying in the extracted text for anything that does not execute scripts.
 *   The identifiers are stated literally because the app id is a FILENAME and carries its extension
 *   while the app's own subdomain does not: an agent reading `nuotta.apps.aimeat.io` guesses
 *   "nuotta", and every tool lookup for it misses.
 * @structure injectAgentDiscovery(html, spec) — pure string transform, returns a Buffer.
 * @usage const body = injectAgentDiscovery(injectAimeatBadge(app.data), { owner, filename, ... });
 * @version-history
 *   v1.1.0 — 2026-07-28 — Optional WebMCP bridge tag (`spec.webmcp`): the same block can now make the
 *     app's tools CALLABLE in the browser, not merely findable. Pointing at a document is what the
 *     v1.0.0 block did, and an in-browser agent that can read "there are five tools" still had no way
 *     to invoke one.
 *   v1.0.0 — 2026-07-27 — Initial: <link rel="mcp-server"> + a <noscript> pointer block naming the
 *     owner, the app id with its extension, the tool manifest, the WebMCP endpoint and the
 *     agent-face markdown rendering.
 */
import { injectBeforeClosingTag } from './html-inject.js';

/** What the serving route knows about the app being sent. */
export interface AppDiscoverySpec {
  /** Bare owner name — the `owner` argument of every app-tool call. */
  owner: string;
  /** The app id: a filename WITH its extension (`nuotta.html`), never the subdomain label. */
  filename: string;
  /** Display name, for the human-readable first line. */
  appName?: string | null;
  /** One-line description from the app manifest. */
  description?: string | null;
  /** Absolute base URL of the node (no trailing slash), e.g. `https://aimeat.io`. */
  baseUrl: string;
  /** Names of the app's sellable tools, when a manifest is published. Empty = no priced surface. */
  toolNames?: string[];
  /**
   * Also load the WebMCP bridge, so a browser-resident agent gets this app's tools as CALLABLE
   * functions (plus `about-this-app`) instead of only a document telling it they exist. Off for
   * apps that carry their own bridge call, and for those that opt out.
   */
  webmcp?: boolean;
}

const MARK = 'id="aimeat-agent-discovery"';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Append the discovery block before the LAST closing tag. Returns the input unchanged when the
 * payload is not an HTML document or already carries the block (idempotent — a served document can
 * be re-served through the same path).
 *
 * Nothing here executes: a `<link>` and a `<noscript>` need no CSP allowance beyond what a static
 * document already has, which is why this can ride on every app rather than being opt-in.
 */
export function injectAgentDiscovery(data: Buffer | Uint8Array | string, spec: AppDiscoverySpec): Buffer {
  const text = typeof data === 'string' ? data : Buffer.from(data).toString('utf-8');
  if (!/<\/body\s*>/i.test(text) && !/<\/html\s*>/i.test(text)) return Buffer.from(text, 'utf-8');
  if (text.includes(MARK)) return Buffer.from(text, 'utf-8');

  const base = spec.baseUrl.replace(/\/+$/, '');
  const appRef = `${spec.owner}/${spec.filename}`;
  const name = spec.appName || spec.filename;
  const tools = (spec.toolNames ?? []).filter(Boolean);

  const lines: string[] = [];
  lines.push(`${name} — an app on AIMEAT.`);
  if (spec.description) lines.push(spec.description);
  lines.push('');
  lines.push('FOR AN AGENT READING THIS PAGE');
  lines.push('');
  // The single most valuable fact, because it is the one that is guessed wrong.
  lines.push(`owner:  ${spec.owner}`);
  lines.push(`app_id: ${spec.filename}   (a filename — it keeps its extension; the subdomain drops it)`);
  lines.push('');
  if (tools.length) {
    lines.push(`This app sells ${tools.length} tool${tools.length === 1 ? '' : 's'}: ${tools.join(', ')}.`);
    lines.push('Each carries a full input and output schema, so nothing has to be inferred from this page.');
    lines.push('');
  }
  lines.push('What to read, in order:');
  lines.push(`  ${base}/v1/apps/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.filename)}/webmcp`);
  lines.push('      the callable tools of THIS app, with their schemas and prices');
  lines.push(`  /.well-known/mcp.json`);
  lines.push('      this node\'s MCP server card (served on this host too)');
  lines.push(`  ?format=md`);
  lines.push('      this app\'s own agent-facing description, as markdown');
  lines.push(`  ${base}/v1/apps/${encodeURIComponent(spec.owner)}/${encodeURIComponent(spec.filename)}/skills`);
  lines.push('      skills bound to this app — the method, not just the API');
  lines.push('');
  lines.push('A priced tool answers an unpaid POST with 402 and an x402 `accepts` block stating how to');
  lines.push('pay, so the calling convention can be learned from the service itself.');

  const block =
    `<link rel="mcp-server" href="/.well-known/mcp.json">`
    + `<link rel="alternate" type="text/markdown" href="?format=md" title="Agent-facing description">`
    + `<noscript ${MARK}><pre>${esc(lines.join('\n'))}</pre></noscript>`
    // A machine-readable twin of the same facts, for a reader that prefers structure to prose.
    + `<script type="application/json" id="aimeat-app-ref">`
    + esc(JSON.stringify({ owner: spec.owner, app_id: spec.filename, app: appRef, tools }))
    + `</script>`
    // The WebMCP bridge, from THIS origin (not the apex): an app author's own
    // `script-src 'self'` then still allows it. `defer` runs it after the ref block above exists,
    // and `?expose=app` makes it self-activating — the app needs no code of its own.
    + (spec.webmcp
      ? `<script src="/v1/libs/aimeat-webmcp.js?expose=app" data-owner="${esc(spec.owner)}"`
        + ` data-app="${esc(spec.filename)}" defer></script>`
      : '');

  return Buffer.from(injectBeforeClosingTag(text, block), 'utf-8');
}
