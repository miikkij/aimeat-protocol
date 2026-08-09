/**
 * @file apps-ui.ts
 * @description The app index as an MCP App: an interactive card grid the host renders inside the
 *   conversation, instead of the person reading a JSON array of their own apps. Pairs with
 *   aimeat_app_list, which carries `_meta.ui.resourceUri` pointing here (see ./apps.ts).
 *
 *   Two constraints shape the page and are worth stating before anyone edits it:
 *   1. The host renders it in a sandboxed iframe under a deny-by-default CSP, so EVERYTHING is
 *      inline. No external stylesheet, font, image or script, and no fetch. Data arrives over
 *      postMessage. Adding an external load means declaring an origin in `_meta.ui.csp`, which is
 *      a decision, not a detail.
 *   2. The node has no build step for browser assets outside the app-catalog, so this is hand-written
 *      vanilla JS speaking the MCP Apps postMessage dialect directly. The @modelcontextprotocol/
 *      ext-apps `App` class is a convenience wrapper over the same messages; the extension spec
 *      states plainly that implementing them directly is supported.
 * @structure
 *   - APP_INDEX_UI_URI — the ui:// address aimeat_app_list points at
 *   - APP_UI_MIME — the MIME type that marks a resource as an MCP App page
 *   - APP_INDEX_HTML — the page itself; exported so a harness can load it in a real browser
 *   - registerAppIndexUi() — serves the page as an MCP resource
 * @usage
 *   import { registerAppIndexUi, APP_INDEX_UI_URI } from './apps-ui.js';
 *   registerAppIndexUi(mcp);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial. First MCP App on this node; a pilot on one tool before the rest
 *     of the catalogue is built on it.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** The ui:// address of the app-index page. Referenced by aimeat_app_list's `_meta.ui`. */
export const APP_INDEX_UI_URI = 'ui://aimeat/app-index.html';

/** What marks a resource as an MCP App page rather than ordinary HTML. */
export const APP_UI_MIME = 'text/html;profile=mcp-app';

/**
 * The page. Self-contained by necessity (see the file header). It speaks three messages:
 * it asks the host to initialize, tells the host it is ready, and then waits for the tool
 * result the host pushes in. Anything it cannot parse leaves the placeholder text in place,
 * so a shape change shows up as "no apps to show" rather than a blank frame.
 */
export const APP_INDEX_HTML = `<!DOCTYPE html>
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
<script>
(function () {
  var PROTOCOL = '2026-01-26';
  var nextId = 1;
  var grid = document.getElementById('grid');
  var empty = document.getElementById('empty');
  var countEl = document.getElementById('count');

  function send(msg) { window.parent.postMessage(Object.assign({ jsonrpc: '2.0' }, msg), '*'); }
  function text(el, value) { el.textContent = value == null ? '' : String(value); return el; }
  function make(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }

  function render(apps) {
    grid.textContent = '';
    if (!apps.length) {
      grid.appendChild(text(make('p', 'empty'), 'No apps published yet.'));
      countEl.textContent = '';
      return;
    }
    countEl.textContent = '(' + apps.length + ')';
    apps.forEach(function (app) {
      var card = make('div', 'card');

      var top = make('div', 'top');
      if (app.icon) top.appendChild(text(make('span', 'icon'), app.icon));
      top.appendChild(text(make('span', 'name'), app.name || app.filename));
      card.appendChild(top);

      if (app.description) card.appendChild(text(make('p', 'desc'), app.description));

      var tags = (app.tags || []).slice(0, 4);
      if (app.category) tags.unshift(app.category);
      if (tags.length) {
        var row = make('div', 'tags');
        tags.forEach(function (t) { row.appendChild(text(make('span', 'tag'), t)); });
        card.appendChild(row);
      }

      // The address is BOTH a link and visible text. A sandboxed iframe may refuse to open a
      // new tab, and a person who can read the address can still get there.
      if (app.url) {
        var a = make('a', 'open');
        a.href = app.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
        card.appendChild(text(a, 'Open'));
        card.appendChild(text(make('div', 'addr'), app.url));
      }

      grid.appendChild(card);
    });
  }

  // The tool answers with one text block holding { apps: [...], total }.
  function readToolResult(params) {
    try {
      var block = (params && params.content || []).filter(function (c) { return c.type === 'text'; })[0];
      if (!block) return null;
      var parsed = JSON.parse(block.text);
      return Array.isArray(parsed.apps) ? parsed.apps : null;
    } catch (err) { return null; }
  }

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;

    // The host's answer to ui/initialize. Telling it we are ready is what unlocks the data:
    // the host sends nothing before this notification.
    if (msg.id === 1 && msg.result) {
      send({ method: 'ui/notifications/initialized', params: {} });
      return;
    }

    if (msg.method === 'ui/notifications/tool-result') {
      var apps = readToolResult(msg.params);
      if (apps) render(apps);
      else text(empty, 'No apps to show.');
    }
  });

  send({
    id: nextId++,
    method: 'ui/initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'AIMEAT App Index', version: '1.0.0' },
      protocolVersion: PROTOCOL,
      appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] },
    },
  });
})();
</script>
</body>
</html>`;

/**
 * Serve the app-index page as an MCP resource. The host fetches it when a tool whose `_meta.ui`
 * names this address is called, and may fetch it earlier to have the frame ready.
 *
 * No `_meta.ui.csp` is declared, and that is the point: the page loads nothing from anywhere, so
 * the host's deny-by-default policy is already the right one. A future edit that adds an external
 * font, image or fetch has to declare its origin here and say why.
 */
export function registerAppIndexUi(mcp: McpServer): void {
    mcp.registerResource(
        'app-index-ui',
        APP_INDEX_UI_URI,
        {
            mimeType: APP_UI_MIME,
            description: 'Interactive card grid of the apps published on this node, rendered inside the conversation.',
        },
        async (uri) => ({
            contents: [{ uri: uri.toString(), mimeType: APP_UI_MIME, text: APP_INDEX_HTML }],
        }),
    );
}
