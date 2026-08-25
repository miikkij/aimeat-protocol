/**
 * @file src/data/app-templates/workstation.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The workstation project scaffold: the files that keep a large app editable on the
 *   author's own machine, and assemble the ONE HTML file the node serves.
 *
 *   WHY IT IS A TEMPLATE AND NOT ADVICE. The advice already exists in the skill, and advice gets
 *   re-derived: every app in aimeat-apps that outgrew one file grew its own build script, each with
 *   a different set of guards, and the guards are the part that matters. Two of them catch failures
 *   that are otherwise INVISIBLE — a syntax error in the assembled file ships as a blank page, and a
 *   duplicate top-level declaration passes `node --check` while the last one silently wins. Handing
 *   over the scripts hands over the guards.
 *
 *   THE SIZE LINE IS THE POINT. `build.mjs` prints the artefact's size against the node's ceiling on
 *   every single build. The app that prompted this work reached 3.18 MB without its author ever
 *   seeing a number, and a number you see every build is a number that never surprises you.
 *
 *   NO TEMPLATE LITERALS IN THE SCAFFOLD. The scaffold is carried inside a template literal, so any
 *   backtick or `${` in the generated JavaScript would have to be escaped, and an escape missed is a
 *   file that looks right and is not. The scripts below use plain string concatenation for that
 *   reason — not because it reads better.
 * @structure PROJECT_WORKSTATION — the multi-file scaffold, files separated by `=== file: <path> ===`
 * @usage import { PROJECT_WORKSTATION } from './app-templates/workstation.js';
 * @version-history
 *   v1.0.0 — 2026-08-25 — Initial.
 */

export const PROJECT_WORKSTATION = `A project layout for an app that outgrew one editable file. Copy these files into a directory,
put your app in src/, and publish what build.mjs produces. Files are separated by a line reading
"=== file: <path> ===". Node 20+ and an agent token in AIMEAT_AGENT_TOKEN; nothing else to install.

What stays true: the node serves ONE self-contained HTML file with no module system and no external
CDN. The build step is yours, on your machine, and it produces exactly that file.

=== file: README.md ===
# <app name>

    node build.mjs            assemble dist/<app>.html and print its size
    node build.mjs --check    fail if dist/ is not what src/ produces (for CI / a pre-commit hook)
    node publish.mjs          publish dist/<app>.html to the node
    node verify.mjs           check that what the node serves is what you published

Sources live in src/. Nothing is edited in dist/ — it is generated, and build.mjs --check is what
proves it.

Assets do NOT live in this repository or in the app source. Upload each one once
(aimeat_storage_upload, visibility public) and reference it as
https://<node>/v1/pub/<your-ghii>/<key>. An inlined data URI is carried in the source forever and
re-uploaded on every publish.

=== file: app.json ===
{
  "filename": "myapp.html",
  "name": "My App",
  "description": "One line. This is what the catalogue shows.",
  "category": "tool",
  "tags": ["tag-one", "tag-two"],
  "icon": "\\u2728",
  "node": "https://aimeat.io"
}

=== file: src/index.html ===
<!DOCTYPE html>
<!-- AIMEAT App Manifest
name: My App
version: 1.0.0
description: One line. This is what the catalogue shows.
entry: index.html
-->
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content" />
  <title>My App</title>
  <link href="/lib/daisyui@5.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-theme.css" rel="stylesheet" type="text/css" />
  <link href="/lib/aimeat-daisyui-bridge.css" rel="stylesheet" type="text/css" />
  <script src="/lib/tailwindcss@4.js"></script>
  <style>/*__APP_CSS__*/</style>
</head>
<body class="bg-base-100 text-base-content min-h-screen flex flex-col overflow-x-clip">
  <nav class="navbar bg-base-200 px-4 shadow-sm sticky top-0 z-50">
    <div class="flex-1"><span class="text-lg font-bold">My App</span></div>
    <div class="flex-none"><span id="login"></span></div>
  </nav>
  <main id="app" class="flex-1 w-full max-w-3xl mx-auto p-4 flex flex-col gap-4"></main>

  <script src="/v1/libs/aimeat-auth.js"></script>
  <script src="/v1/libs/aimeat-data.js"></script>
  <script>
/*__APP_JS__*/
  </script>
</body>
</html>

=== file: src/app.css ===
/* Your styles. Theme tokens and daisyUI classes first; a hardcoded colour is a bug in two themes. */

=== file: src/00-state.js ===
// One concern per file, and the ORDER array in build.mjs decides how they are concatenated.
// These are NOT modules: no import, no export. They share one scope, which is why build.mjs
// refuses two top-level declarations of the same name.
var state = { session: null, items: [] };

=== file: src/10-boot.js ===
async function boot() {
  state.session = await AIMEAT.auth.mount('#login');
  render();
}

=== file: src/90-render.js ===
function render() {
  var app = document.getElementById('app');
  app.textContent = state.session ? 'Signed in.' : 'Signed out.';
}

document.addEventListener('DOMContentLoaded', boot);

=== file: build.mjs ===
/**
 * Assemble src/ into dist/<filename> — the one file the node serves.
 *
 * Guards, each for a failure that is invisible without it:
 *   1. a source file not named in ORDER is not a syntax error, it is a ReferenceError in production
 *   2. two top-level declarations of one name pass node --check and the LAST one silently wins
 *   3. an unsubstituted marker ships a comment where the app was meant to be
 *   4. a syntax error in the assembled script ships as a blank page
 * And the size line, which is the number that stops an app from surprising its author.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = import.meta.dirname;
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');
const CHECK = process.argv.includes('--check');
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));

// The concatenation order. Numeric prefixes keep it readable; the array is what decides.
const ORDER = ['00-state.js', '10-boot.js', '90-render.js'];

const onDisk = fs.readdirSync(SRC).filter((f) => f.endsWith('.js'));
const missing = onDisk.filter((f) => !ORDER.includes(f));
if (missing.length) throw new Error('src/*.js not in ORDER: ' + missing.join(', '));

const parts = ORDER.map((f) => fs.readFileSync(path.join(SRC, f), 'utf8'));
const js = parts.join('\\n\\n');

// Guard 2: every top-level declaration, across all files, must be unique.
const names = new Map();
for (let i = 0; i < ORDER.length; i++) {
  const re = /^(?:function|const|let|var|class)\\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm;
  let m;
  while ((m = re.exec(parts[i]))) {
    const seen = names.get(m[1]);
    if (seen) throw new Error('duplicate top-level name "' + m[1] + '" in ' + seen + ' and ' + ORDER[i]);
    names.set(m[1], ORDER[i]);
  }
}

const css = fs.readFileSync(path.join(SRC, 'app.css'), 'utf8');
let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
// Guard 3 is checked BEFORE the replace as well as after. A marker that survived would ship a
// comment where the app should be; a marker that is MISSING — renamed, or edited away — would ship
// a page with no code at all and no error, which is the worse of the two.
for (const marker of ['/*__APP_CSS__*/', '/*__APP_JS__*/']) {
  if (!html.includes(marker)) throw new Error('src/index.html has no ' + marker + ' to put the build into');
}
html = html.replace('/*__APP_CSS__*/', () => css).replace('/*__APP_JS__*/', () => js);
if (html.includes('__APP_')) throw new Error('a marker survived the build');

// Guard 4: the assembled script has to parse.
fs.mkdirSync(DIST, { recursive: true });
const probe = path.join(DIST, '.syntax-probe.js');
fs.writeFileSync(probe, js);
try { execFileSync(process.execPath, ['--check', probe]); } finally { fs.rmSync(probe, { force: true }); }

const out = path.join(DIST, app.filename);
const prev = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : null;
if (CHECK) {
  if (prev !== html) { console.error('dist/ is not what src/ produces — run node build.mjs'); process.exit(1); }
  console.log('dist/ is in sync');
  process.exit(0);
}
fs.writeFileSync(out, html);

// The size line. CEILING_MB is this node's app limit — the operator can change it, so read it from
// your own node's /v1/admin/config (quota.app_max_size_mb) if you are not on the default.
const CEILING_MB = 5;
const bytes = Buffer.byteLength(html);
const share = Math.round((bytes / (CEILING_MB * 1024 * 1024)) * 100);
const delta = prev === null ? '' : '  (' + (bytes - Buffer.byteLength(prev) >= 0 ? '+' : '') + (bytes - Buffer.byteLength(prev)) + ' bytes)';
console.log(app.filename + ': ' + (bytes / 1048576).toFixed(2) + ' MB, ' + share + '% of the ' + CEILING_MB + ' MB ceiling' + delta);
if (share >= 60) console.log('Assets belong in storage, not in the source. See node:aimeat-app-workstation.');

=== file: publish.mjs ===
/**
 * Publish dist/<filename> to the node, presigned — the door for anything over about 1 kB.
 * Needs AIMEAT_AGENT_TOKEN in the environment.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const token = process.env.AIMEAT_AGENT_TOKEN;
if (!token) throw new Error('AIMEAT_AGENT_TOKEN is not set');

const file = path.join(ROOT, 'dist', app.filename);
const html = fs.readFileSync(file);

const open = await fetch(app.node + '/v1/apps', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    filename: app.filename, mode: 'presigned',
    name: app.name, description: app.description,
    category: app.category, tags: app.tags, icon: app.icon,
  }),
});
const opened = await open.json();
if (!open.ok) throw new Error('publish refused: ' + JSON.stringify(opened));

const put = await fetch(opened.data.upload_url, {
  method: 'PUT', headers: { 'Content-Type': 'text/html' }, body: html,
});
const done = await put.json();
if (!put.ok) throw new Error('upload refused: ' + JSON.stringify(done));

// What the node says about what you just published. next_steps.size is the one to read on a
// growing app: bytes, share of the ceiling, growth per day, and the date that rate meets it.
const steps = done.data && done.data.next_steps;
if (steps && steps.size) console.log(steps.size.note || (steps.size.bytes + ' bytes, ' + Math.round(steps.size.share_of_ceiling * 100) + '% of the ceiling'));
console.log('published version ' + (done.data && done.data.version_number));

=== file: verify.mjs ===
/**
 * Is what the node serves what you published? Compares a marker rather than the bytes: the node
 * adds its own chrome (the AI-disclosure label, the attribution badge) at serve time, so the served
 * file is legitimately longer than the one you uploaded.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = import.meta.dirname;
const app = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const local = fs.readFileSync(path.join(ROOT, 'dist', app.filename), 'utf8');

// Anything unique to THIS build. A version string in the manifest comment is the usual choice.
const marker = (local.match(/^version:\\s*(.+)$/m) || [])[1];
if (!marker) throw new Error('no version line in the built file to verify against');

const started = Date.now();
const res = await fetch(app.node.replace('https://', 'https://' + app.filename.replace(/\\.html$/, '') + '.apps.'));
const served = await res.text();
console.log('served ' + served.length + ' bytes in ' + (Date.now() - started) + ' ms');
if (!served.includes(marker)) {
  console.error('the node is serving a different version than dist/ — marker "' + marker + '" not found');
  process.exit(1);
}
console.log('the node is serving this build');
`;
