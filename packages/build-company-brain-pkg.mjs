/**
 * @file build-company-brain-pkg.mjs
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generator for aimeat/src/data/company-brain-package.ts. Reads the sources in
 *   packages/company-brain/ and inlines them into the installable package definition, so installing
 *   "company-brain" registers the brain itself, the caretaker that keeps its sources honest, and the
 *   cortex lib the app reaches the caretaker through — as one transaction that rolls back if any
 *   part of it fails.
 *
 *   ORDER MATTERS. The extension and the cortex register first, and the app declares them as
 *   dependencies, because installing rewrites `/v1/ext/<name>/`, `/v1/cortex/<name>/` and
 *   `ext:<name>` in the app and in the cortex lib to the per-instance names. An app registered
 *   before its extension would keep the author's short name and 404.
 *
 *   THERE IS NO MEMORY COMPONENT, and that is deliberate. A memory component writes to keys the
 *   AUTHOR chose, with no per-instance short id in them, so a second install would overwrite the
 *   first one's records while its app happily duplicated. One owner installing this once per
 *   company is the whole point, so the failure would be certain rather than latent. Digital signage
 *   dropped its own memory component in v2.0.0 for exactly this.
 *
 *   Edit the sources in packages/company-brain/, then re-run:
 *     node packages/build-company-brain-pkg.mjs
 * @usage node packages/build-company-brain-pkg.mjs   (run from the repo root)
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-071).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const src = resolve(here, 'company-brain');
const read = (p) => readFileSync(resolve(src, p), 'utf8');

/** Escape a string for safe embedding inside a JS template literal. */
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const appBrain = read('app-brain.html');

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
    libs: { 'company-brain.js': read('cortex/company-brain.js') },
});

/**
 * The app is emitted as its own module. Inlined beside the extension and the cortex it takes the
 * package file most of the way to the repo's 800-line ceiling, and the rule for that is a pure
 * extraction rather than a shorter file: the HTML is one coherent group.
 */
writeFileSync(resolve(root, 'aimeat/src/data/company-brain-app.ts'), `/**
 * @file company-brain-app.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The company brain app of the COMPANY BRAIN package, inlined for install.
 *
 *   GENERATED FILE — do not edit by hand. Edit packages/company-brain/app-brain.html and re-run
 *   \`node packages/build-company-brain-pkg.mjs\`.
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-071).
 */
export const APP_BRAIN = \`${esc(appBrain)}\`;
`);

const out = `/**
 * @file company-brain-package.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Installable package "company-brain" — a company that remembers, after one install.
 *   Installing it registers three components under the owner's own identity: the brain itself, the
 *   sandboxed caretaker that keeps the source register honest, and the cortex lib the app reaches
 *   the caretaker through.
 *
 *   IT HANGS OFF A COMPANY, AND IT KNOWS WHICH ONE FROM ITS ADDRESS. Served at
 *   \`{slug}.co.<apex>\`, the first label of the host IS the company slug, and one pass over
 *   GET /v1/companies turns it into the record. That is what lets one owner install this once per
 *   company with no configuration channel at all — and there is none: install takes \`version\`,
 *   \`label\` and \`dry_run\`, and none of the three reaches a component. The address is the parameter.
 *
 *   THE KNOWLEDGE IS NOT SEEDED INTO ANYBODY'S MEMORY. Facts, entities, gaps and findings live in
 *   the owner's OWN organism as workspace records, and the app finds that workspace by the CONTRACT
 *   its manifest declares rather than by a stored id. The company's twelve registered fields become
 *   its first anchored facts, each pointing back at the entry the owner wrote themselves.
 *
 *   THE CARETAKER COSTS NOTHING TO RUN. A \`kind: extension\` schedule executes a sandbox action
 *   server-side with no model call, so the weekly check spends no tokens and needs no key of the
 *   owner's. It maintains the source register, which is why that register lives in the extension's
 *   own private namespace: a sandboxed extension can read an owner's memory only where it is
 *   public, so a register kept in the workspace would be invisible to the one job that exists to
 *   check it.
 *
 *   THE APP NEVER CALLS /v1/ext/. An app may only ask for the scopes in the app-grant vocabulary and
 *   there is no \`ext:\` word in it; reaching an extension is cortex's job. The app trusts cortex,
 *   cortex trusts the extension, and no layer skips the one below.
 *
 *   GENERATED FILE — do not edit by hand. Edit the sources in packages/company-brain/ and re-run
 *   \`node packages/build-company-brain-pkg.mjs\`.
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (TARGET-071).
 */
import type { ExamplePackageDef } from './example-packages.js';
// The app lives in its own generated module: inlined here as well it takes this file most of the
// way to the 800-line ceiling, and the split is a pure extraction (one coherent group).
import { APP_BRAIN } from './company-brain-app.js';

const EXT_BRAIN = \`${esc(extension)}\`;

const CORTEX_BRAIN = \`${esc(cortex)}\`;

export function companyBrainPackage(): ExamplePackageDef {
  return {
    name: 'company-brain',
    description: 'What your company knows, where each piece came from, and what needs looking at again. Your registered details become its first facts. It says out loud what its sources do NOT cover, and it tells you when something that fed it goes quiet.',
    category: 'knowledge',
    tags: ['company', 'knowledge', 'provenance', 'company-brain', 'memory'],
    visibility: 'public',
    components: [
      // The caretaker and the lib register FIRST: the app's \`/v1/ext/\`, \`/v1/cortex/\` and \`ext:\`
      // references are rewritten to these components' per-instance names as the app registers.
      { id: 'ext-brain', type: 'extension', label: 'Caretaker', content: EXT_BRAIN, dependencies: [] },
      { id: 'cortex-brain', type: 'cortex', label: 'Brain lib', content: CORTEX_BRAIN, dependencies: ['ext-brain'] },
      // THE .html SUFFIX IS LOAD-BEARING, not decoration. An installed app's filename is
      // package-owner-shortId-componentId, and the app-origin path form treats a request as an app
      // only when the filename ends in .html (routes/subdomains.ts). An extensionless component id
      // therefore produces an app that can never be opened on its own origin — the only place the
      // SSO bridge works — and never gets a subdomain minted for it.
      { id: 'app-brain.html', type: 'app', label: 'Company brain', content: APP_BRAIN, dependencies: ['ext-brain', 'cortex-brain'] },
    ],
    templateListing: {
      title: 'Company brain',
      description: 'One page that answers three questions: what does this company know, where did each piece come from, and what is waiting for me. Your registration details are its first facts. Every source says what it does not cover, and a weekly check that costs nothing tells you when one goes quiet. Your own AI can feed it from any chat.',
      category: 'knowledge',
      tags: ['company', 'knowledge', 'provenance', 'memory'],
    },
  };
}
`;

const target = resolve(root, 'aimeat/src/data/company-brain-package.ts');
writeFileSync(target, out);
console.log(
    'wrote aimeat/src/data/company-brain-package.ts', out.length, 'bytes',
    '(app', appBrain.length, 'ext', extension.length, 'cortex', cortex.length, ')',
);
