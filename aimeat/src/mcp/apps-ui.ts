/**
 * @file apps-ui.ts
 * @description The app index as an MCP App: an interactive card grid the host renders inside the
 *   conversation, instead of the person reading a JSON array of their own apps. Pairs with
 *   aimeat_app_list, whose `_meta` points here (see ./apps.ts).
 *
 *   Two constraints shape the page, and both cost a deploy before they were understood:
 *
 *   1. The host renders it in a sandboxed frame under a deny-by-default CSP, so EVERYTHING is
 *      inline. No external stylesheet, font, image or script, and no fetch. Data arrives over
 *      postMessage. Adding an external load means declaring an origin in `_meta.ui.csp`, which is
 *      a decision, not a detail.
 *   2. The postMessage side is the OFFICIAL @modelcontextprotocol/ext-apps App class, inlined,
 *      never hand-written. Hand-writing it failed twice for reasons no document states: the tool
 *      `_meta` needs the address under two different keys, and `ui/initialize` takes exactly three
 *      params with additionalProperties:false, so one stray key voids the request. Both failures
 *      look identical from outside, an empty frame with no error anywhere, and neither is
 *      reproducible without a real host. The library is the only party that knows this dialect.
 *
 *   The node has no build step for browser assets outside the app-catalog, so the library's
 *   self-contained browser bundle is read from node_modules at boot and inlined into the page.
 *   That makes the page large (~350 kB) for one resource read per app-open, which is the price of
 *   not maintaining a second implementation of somebody else's protocol.
 * @structure
 *   - APP_INDEX_UI_URI — the ui:// address aimeat_app_list points at
 *   - APP_UI_MIME — the MIME type that marks a resource as an MCP App page
 *   - uiToolMeta() — the tool `_meta` that points a host at a page, under BOTH required keys
 *   - appIndexHtml() — the page; built once, cached
 *   - registerAppIndexUi() — serves the page as an MCP resource
 * @usage
 *   import { registerAppIndexUi, APP_INDEX_UI_URI, uiToolMeta } from './apps-ui.js';
 *   registerAppIndexUi(mcp);
 * @version-history
 *   v1.1.1 — 2026-08-09 — A node that cannot build the page offers none, instead of throwing from
 *     the resource handler. Prod had not installed the new dependency yet, and the throw reached
 *     the person as "Unable to reach AIMEAT": a missing picture took the whole tool call with it.
 *     appUiAvailable() decides once; without it the tool registers with no `_meta.ui` and no
 *     resource, so the listing works exactly as it did before this file existed.
 *   v1.1.0 — 2026-08-09 — The page drives the official App class instead of a hand-written
 *     postMessage client. Two hand-rolled versions failed in Claude for undocumented reasons and
 *     neither could be reproduced without it; a bespoke implementation of another project's
 *     dialect is not something this node should own.
 *   v1.0.1 — 2026-08-09 — uiToolMeta: the tool `_meta` carries the FLAT `ui/resourceUri` key
 *     alongside the nested `ui.resourceUri`. With only the nested one Claude mounted the frame and
 *     left it empty, never requesting the page. Found by reading registerAppTool in ext-apps, which
 *     writes both and back-fills the missing one, so every example carries both and no document
 *     says either is required. Caught in a real client and NOT by the e2e, which asserted the
 *     nested key because that is the one the prose names.
 *   v1.0.0 — 2026-08-09 — Initial. First MCP App on this node; a pilot on one tool before the rest
 *     of the catalogue is built on it.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../utils/logger.js';

/** The ui:// address of the app-index page. Referenced by aimeat_app_list's `_meta`. */
export const APP_INDEX_UI_URI = 'ui://aimeat/app-index.html';

/** What marks a resource as an MCP App page rather than ordinary HTML. */
export const APP_UI_MIME = 'text/html;profile=mcp-app';

/**
 * The tool `_meta` that points a host at a page. BOTH keys are required.
 *
 * The extension's own helper (registerAppTool in @modelcontextprotocol/ext-apps) writes the
 * nested `ui.resourceUri` and the flat `ui/resourceUri` and back-fills whichever the caller
 * omitted, so every published example carries both and neither is documented as load-bearing.
 * A host reads the nested form to decide the tool HAS a page (Claude groups it under
 * "Interactive tools" on that alone) and the flat form to fetch it. With only the nested key,
 * the frame mounts and stays empty: no request for the page is ever made, so the failure looks
 * like a broken page rather than a missing field.
 */
export function uiToolMeta(resourceUri: string): Record<string, unknown> {
    return { ui: { resourceUri }, 'ui/resourceUri': resourceUri };
}

/**
 * The library's browser bundle, rewritten so an inline module can reach its App class.
 *
 * The bundle is ESM and ends in one `export { … }` naming its public bindings. An inline
 * `<script type="module">` cannot be imported from, so that statement is replaced with an
 * assignment to a global the page's own code reads. The local name behind `App` is a minified
 * identifier that changes between releases, which is why it is parsed out rather than assumed.
 */
function loadAppRuntime(): string {
    const require = createRequire(import.meta.url);
    const bundlePath = require.resolve('@modelcontextprotocol/ext-apps/app-with-deps');
    const source = readFileSync(bundlePath, 'utf8');

    const exportStatement = /export\s*\{([\s\S]*?)\}\s*;?\s*$/.exec(source);
    if (!exportStatement) throw new Error(`ext-apps bundle has no export statement: ${bundlePath}`);

    const appBinding = exportStatement[1]
        .split(',')
        .map(pair => pair.split(/\s+as\s+/).map(s => s.trim()))
        .find(pair => pair[1] === 'App');
    if (!appBinding) throw new Error(`ext-apps bundle exports no App: ${bundlePath}`);

    return source.slice(0, exportStatement.index) + `\nglobalThis.__AIMEAT_MCP_APP = ${appBinding[0]};\n`;
}

/** Styles and markup. The script that drives them is appended in appIndexHtml(). */
const PAGE_SHELL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Apps</title>
<style>
  :root {
    --bg: #ffffff; --fg: #1a1a1a; --muted: #666666;
    --card: #f7f7f8; --line: #e3e3e6; --accent: #2f6f4f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #1b1b1d; --fg: #ececee; --muted: #a0a0a6;
      --card: #242427; --line: #34343a; --accent: #7fc9a1;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 16px; background: var(--bg); color: var(--fg);
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  h1 { font-size: 15px; margin: 0 0 12px; font-weight: 600; }
  .count { color: var(--muted); font-weight: 400; }
  .grid { display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(min(100%, 240px), 1fr)); }
  .card {
    background: var(--card); border: 1px solid var(--line); border-radius: 10px;
    padding: 12px; display: flex; flex-direction: column; gap: 6px; min-width: 0;
  }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .icon { font-size: 18px; line-height: 1; flex: none; }
  .name { font-weight: 600; overflow-wrap: anywhere; }
  .desc { color: var(--muted); overflow-wrap: anywhere; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag {
    font-size: 11px; color: var(--muted); border: 1px solid var(--line);
    border-radius: 999px; padding: 1px 7px;
  }
  a.open { color: var(--accent); font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
  a.open:hover { text-decoration: underline; }
  .addr { font-size: 11px; color: var(--muted); overflow-wrap: anywhere; }
  .empty { color: var(--muted); }
</style>
</head>
<body>
<h1>Apps <span class="count" id="count"></span></h1>
<div class="grid" id="grid"><p class="empty" id="empty">Loading your apps…</p></div>
`;

/**
 * The page's own code. Runs after the library bundle in the same module script, so `App` is
 * already on globalThis. The handler is attached BEFORE connect(): the host may push the tool
 * result the moment the handshake completes, and the library warns about handlers that arrive
 * late. No backticks below this line; this is a template literal in a .ts file.
 */
const PAGE_SCRIPT = `
const App = globalThis.__AIMEAT_MCP_APP;
const grid = document.getElementById('grid');
const empty = document.getElementById('empty');
const countEl = document.getElementById('count');

const text = (el, value) => { el.textContent = value == null ? '' : String(value); return el; };
const make = (tag, cls) => { const el = document.createElement(tag); if (cls) el.className = cls; return el; };

function render(apps) {
  grid.textContent = '';
  if (!apps.length) {
    grid.appendChild(text(make('p', 'empty'), 'No apps published yet.'));
    countEl.textContent = '';
    return;
  }
  countEl.textContent = '(' + apps.length + ')';
  for (const app of apps) {
    const card = make('div', 'card');

    const top = make('div', 'top');
    if (app.icon) top.appendChild(text(make('span', 'icon'), app.icon));
    top.appendChild(text(make('span', 'name'), app.name || app.filename));
    card.appendChild(top);

    if (app.description) card.appendChild(text(make('p', 'desc'), app.description));

    // The category leads, then up to four tags that say something it did not. Plenty of apps
    // tag themselves with their own category, and printing "game game board-game" reads as a
    // bug to anyone looking at the card.
    const rest = (app.tags || []).filter(t => t && t !== app.category).slice(0, 4);
    const tags = app.category ? [app.category, ...rest] : rest;
    if (tags.length) {
      const row = make('div', 'tags');
      for (const t of tags) row.appendChild(text(make('span', 'tag'), t));
      card.appendChild(row);
    }

    // Opening goes through the HOST, not the frame. A plain target=_blank does nothing here:
    // the app runs in a sandbox that refuses to navigate or open a window, which is the whole
    // point of the sandbox. ui/open-link is the door the extension provides for exactly this,
    // and the anchor stays as the fallback for a host that does not offer it. The address is
    // also printed, so a person is never stuck with a button that goes nowhere.
    if (app.url) {
      const url = app.url;
      const a = make('a', 'open');
      a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          const { isError } = await mcpApp.openLink({ url });
          if (isError) window.open(url, '_blank', 'noopener');
        } catch {
          window.open(url, '_blank', 'noopener');
        }
      });
      card.appendChild(text(a, 'Open'));
      card.appendChild(text(make('div', 'addr'), url));
    }

    grid.appendChild(card);
  }
}

// The tool answers with one text block holding { apps: [...], total }.
function readToolResult(result) {
  try {
    const block = (result?.content || []).find(c => c.type === 'text');
    if (!block) return null;
    const parsed = JSON.parse(block.text);
    return Array.isArray(parsed.apps) ? parsed.apps : null;
  } catch { return null; }
}

const mcpApp = new App({ name: 'AIMEAT App Index', version: '1.0.0' });

mcpApp.ontoolresult = (result) => {
  const apps = readToolResult(result);
  if (apps) render(apps);
  else text(empty, 'No apps to show.');
};

try {
  await mcpApp.connect();
} catch (err) {
  // A page that cannot start says so. The failures this replaced showed nothing at all, which
  // is what made them cost three deploys to find.
  text(empty, 'This view could not start: ' + (err && err.message ? err.message : String(err)));
}
`;

let cachedPage: string | null = null;
let pageUnavailable = false;

/** The page, built once. Throws if the library bundle cannot be read or parsed. */
export function appIndexHtml(): string {
    if (cachedPage) return cachedPage;
    cachedPage = `${PAGE_SHELL}<script type="module">\n${loadAppRuntime()}\n${PAGE_SCRIPT}\n</` + `script>\n</body>\n</html>`;
    return cachedPage;
}

/**
 * Whether this node can serve the page at all, decided once and cached.
 *
 * The page needs a browser bundle from node_modules, and a node whose deploy has yet to install
 * the dependency does not have it. That must cost the CHAT ITS PICTURE AND NOTHING ELSE: the first
 * version threw from the resource handler, so a missing optional asset surfaced to the person as
 * "Unable to reach AIMEAT" and took the whole tool call with it. An enhancement that can break the
 * thing it enhances is worse than no enhancement.
 */
export function appUiAvailable(): boolean {
    if (cachedPage) return true;
    if (pageUnavailable) return false;
    try {
        appIndexHtml();
        return true;
    } catch (err) {
        pageUnavailable = true;
        logger.warn('app-index UI unavailable; aimeat_app_list keeps working without a rendered view', { error: String(err) });
        return false;
    }
}

/**
 * Serve the app-index page as an MCP resource. The host fetches it when a tool whose `_meta`
 * names this address is called, and may fetch it earlier to have the frame ready.
 *
 * No `_meta.ui.csp` is declared, and that is the point: the page loads nothing from anywhere, so
 * the host's deny-by-default policy is already the right one. A future edit that adds an external
 * font, image or fetch has to declare its origin here and say why.
 */
export function registerAppIndexUi(mcp: McpServer): void {
    // A node that cannot build the page offers no page: no resource, and (via appUiAvailable in
    // apps.ts) no `_meta.ui` on the tool either, so a host is never pointed at something absent.
    if (!appUiAvailable()) return;

    mcp.registerResource(
        'app-index-ui',
        APP_INDEX_UI_URI,
        {
            mimeType: APP_UI_MIME,
            description: 'Interactive card grid of the apps published on this node, rendered inside the conversation.',
        },
        async (uri) => ({ contents: [{ uri: uri.toString(), mimeType: APP_UI_MIME, text: appIndexHtml() }] }),
    );
}
