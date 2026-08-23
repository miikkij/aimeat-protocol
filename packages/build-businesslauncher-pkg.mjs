/**
 * @file build-businesslauncher-pkg.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generator for aimeat/src/data/businesslauncher-package.ts. Reads the sources in
 *   packages/businesslauncher/ and inlines them into the installable package definition, so
 *   installing "businesslauncher" registers a shop front, a back office, the shop engine and the
 *   cortex lib both apps talk through — as one transaction that rolls back if any part of it fails.
 *
 *   ORDER MATTERS. The extension and the cortex register first, and the apps declare them as
 *   dependencies, because installing rewrites `/v1/ext/<name>/`, `/v1/cortex/<name>/` and
 *   `ext:<name>` in the apps and in the cortex lib to the per-instance names. An app registered
 *   before its extension would keep the author's short name and 404.
 *
 *   Edit the sources in packages/businesslauncher/, then re-run:
 *     node packages/build-businesslauncher-pkg.mjs
 * @usage node packages/build-businesslauncher-pkg.mjs   (run from the repo root)
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(here, 'businesslauncher');
const read = (p) => readFileSync(resolve(src, p), 'utf8');

/** Escape a string for safe embedding inside a JS template literal. */
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const appShop = read('app-shop.html');
const appBackOffice = read('app-back-office.html');

// The extension: manifest + every script beside it, in the shape the component registrar parses.
const extScripts = Object.fromEntries(
    readdirSync(resolve(src, 'ext/scripts'))
        .filter((f) => f.endsWith('.js'))
        .sort()
        .map((f) => [f, read(`ext/scripts/${f}`)]),
);
const extension = JSON.stringify({ manifest: read('ext/manifest.yaml'), scripts: extScripts });

// The cortex: manifest + the lib file it declares.
const cortex = JSON.stringify({
    manifest: read('cortex/manifest.yaml'),
    libs: { 'businesslauncher-shop.js': read('cortex/businesslauncher-shop.js') },
});

const out = `/**
 * @file businesslauncher-package.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installable package "businesslauncher" — a shop that exists after one approval.
 *   Installing it registers four components under the owner's own identity: the shop front (opens
 *   with no account), the back office, the sandboxed shop engine that holds stock and reservations,
 *   and the cortex lib both apps reach the engine through.
 *
 *   NOTHING IS SEEDED INTO THE INSTALLER'S MEMORY. Products, prices and pages live in the owner's
 *   OWN organism as workspace records, and the back office finds that workspace by the CONTRACT its
 *   manifest declares rather than by a stored id. An app cannot create an organism (role 'app' may
 *   not), so the back office hands the owner a setup prompt for that one step — the same shape the
 *   signage admin uses.
 *
 *   THE APPS NEVER CALL /v1/ext/. An app may only ask for the scopes in the app-grant vocabulary and
 *   there is no \`ext:\` word in it; reaching an extension is cortex's job. The app trusts cortex,
 *   cortex trusts the extension, and no layer skips the one below.
 *
 *   GENERATED FILE — do not edit by hand. Edit the sources in packages/businesslauncher/ and re-run
 *   \`node packages/build-businesslauncher-pkg.mjs\`.
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-070).
 */
import type { ExamplePackageDef } from './example-packages.js';

const APP_SHOP = \`${esc(appShop)}\`;

const APP_BACK_OFFICE = \`${esc(appBackOffice)}\`;

const EXT_SHOP = \`${esc(extension)}\`;

const CORTEX_SHOP = \`${esc(cortex)}\`;

export function businesslauncherPackage(): ExamplePackageDef {
  return {
    name: 'businesslauncher',
    description: 'A shop that opens without an account: what you sell, what is left, your own terms, and a way for people to get in touch. Products and prices live in your own space, and the back office shows what is still missing so you can stop and come back.',
    category: 'commerce',
    tags: ['shop', 'commerce', 'storefront', 'businesslauncher', 'stock'],
    visibility: 'public',
    components: [
      // The engine and the lib register FIRST: the apps' \`/v1/ext/\`, \`/v1/cortex/\` and \`ext:\`
      // references are rewritten to these components' per-instance names as each app registers.
      { id: 'ext-shop', type: 'extension', label: 'Shop engine', content: EXT_SHOP, dependencies: [] },
      { id: 'cortex-shop', type: 'cortex', label: 'Shop lib', content: CORTEX_SHOP, dependencies: ['ext-shop'] },
      { id: 'app-shop', type: 'app', label: 'Shop', content: APP_SHOP, dependencies: ['ext-shop', 'cortex-shop'] },
      { id: 'app-back-office', type: 'app', label: 'Back office', content: APP_BACK_OFFICE, dependencies: ['ext-shop', 'cortex-shop'] },
    ],
    templateListing: {
      title: 'Shop (BUSINESSLAUNCHER)',
      description: 'Two apps and an engine: a shop front anyone can browse without signing in, and a back office where you keep the products, the shelf, your terms and the enquiries that came in. The last unit can only be sold once. Your AI can do the same work from any chat — the back office hands you the prompt.',
      category: 'commerce',
      tags: ['shop', 'commerce', 'storefront', 'stock'],
    },
  };
}
`;

const target = resolve(root, 'aimeat/src/data/businesslauncher-package.ts');
writeFileSync(target, out);
console.log(
    'wrote aimeat/src/data/businesslauncher-package.ts', out.length, 'bytes',
    '(shop', appShop.length, 'back-office', appBackOffice.length,
    'ext', extension.length, 'cortex', cortex.length, ')',
);
