/**
 * @file build-digital-signage-pkg.mjs
 * @description Generator for aimeat/src/data/digital-signage-package.ts. Reads the two standalone
 *   signage app sources in this folder and inlines them (escaped for a JS template literal) into the
 *   installable package definition, so installing "digital-signage" from Profile > Packages registers
 *   a per-instance copy of BOTH apps (admin + kiosk). Edit the .html sources here, then re-run:
 *     node packages/build-digital-signage-pkg.mjs
 * @usage node packages/build-digital-signage-pkg.mjs   (run from the repo root)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const admin = readFileSync(resolve(here, 'digital-signage/app-signage-admin.html'), 'utf8');
const kiosk = readFileSync(resolve(here, 'digital-signage/app-signage-kiosk.html'), 'utf8');

// Escape a string for safe embedding inside a JS template literal.
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

const out = `/**
 * @file digital-signage-package.ts
 * @description Installable package for "digital-signage" — the AGENT-FACED digital signage system
 *   (Template 3, documents edition). Installing it from Profile > Packages registers a per-instance
 *   copy of BOTH apps (admin + kiosk); the owner launches the admin and configures WHICH organism +
 *   workspace it manages (the admin guides creating a private one if none exists). Content lives as
 *   shared workspace DOCUMENTS (one screen = one public document), edited identically by the app and
 *   by any MCP agent, and read by the kiosk with no login. Nothing is seeded into the installer's
 *   memory — signage data lives in the owner's OWN organism (per-user isolation).
 *
 *   GENERATED FILE — do not edit by hand. Edit the sources packages/digital-signage/*.html and re-run
 *   \`node packages/build-digital-signage-pkg.mjs\`.
 * @version-history
 *   v2.0.0 — 2026-07-11 — Rebuilt from the legacy memory-key package to the agent-faced document model
 *     (TARGET-029). Two apps, no CSM/memory/cortex seeding, per-user organism.
 */
import type { ExamplePackageDef } from './example-packages.js';

const APP_ADMIN = \`${esc(admin)}\`;

const APP_KIOSK = \`${esc(kiosk)}\`;

export function digitalSignagePackage(): ExamplePackageDef {
  return {
    name: 'digital-signage',
    description: 'Agent-faced digital signage: manage screens from the admin app OR from any AI chat/agent, and display them on a kiosk TV with no login. Each screen is one shared workspace document; content lives in your own private organism.',
    category: 'iot',
    tags: ['signage', 'kiosk', 'display', 'agent-faced', 'announcements'],
    visibility: 'public',
    components: [
      { id: 'app-admin', type: 'app', label: 'Signage Admin', content: APP_ADMIN, dependencies: [] },
      { id: 'app-kiosk', type: 'app', label: 'Signage Kiosk', content: APP_KIOSK, dependencies: [] },
    ],
    templateListing: {
      title: 'Digital Signage (agent-faced)',
      description: 'Two apps: a Signage Admin to create and edit screens (also editable by any AIMEAT agent — same documents), and a full-screen Kiosk that shows a screen with no login. Each screen is one public workspace document in your own private organism; the admin guides you to create it on first run.',
      category: 'iot',
      tags: ['signage', 'kiosk', 'display', 'agent-faced'],
    },
  };
}
`;

writeFileSync(resolve(root, 'aimeat/src/data/digital-signage-package.ts'), out);
console.log('wrote aimeat/src/data/digital-signage-package.ts', out.length, 'bytes (admin', admin.length, 'kiosk', kiosk.length, ')');
