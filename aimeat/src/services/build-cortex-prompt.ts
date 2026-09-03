/**
 * @file src/services/build-cortex-prompt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The canonical "build a cortex" prompt, served at GET /v1/prompts/build-cortex. The
 *   Extensions tab used to carry a 4 600-character copy of this in its own JavaScript, so it could
 *   not say what the node had learned since (versions, the dependency map, the upsert door) and it
 *   told the reader to install through a menu path that no longer exists. One text in the node:
 *   the tab, an agentic coder, a skill and llms.txt read the same words.
 * @structure buildCortexPrompt(config, opts) → { full, body }
 * @usage const { full } = buildCortexPrompt(config, { owner, lang, idea });
 * @version-history
 *   v1.0.0 — 2026-09-03 — Initial: the tab's text moved here, plus versions, pinning and the map.
 */
import type { AimeatConfig } from '../config.js';

export interface CortexPromptOpts {
  owner?: string;
  lang?: string;
  idea?: string;
}

function manifestSection(owner: string): string {
  return [
    '## The manifest',
    '',
    'A cortex is one YAML file that bundles reusable building blocks an app loads in the browser:',
    'libraries (JavaScript with a documented API), prompts (instructions for the AI that builds on',
    'it), schemas (a JSON Schema locked to a memory key pattern), seed data (records written on',
    'activation), board templates and ontologies. Apps take a cortex into use with a script tag.',
    '',
    '```yaml',
    'apiVersion: cortex.aimeat.org/v1',
    'kind: Extension',
    'metadata:',
    '  name: my-cortex            # unique, lowercase, hyphens',
    `  namespace: ${owner}        # the owner's namespace`,
    '  description: "What this gives an app"',
    `  author: ${owner}`,
    '  tags: [tag1, tag2]',
    'spec:',
    '  version: "1.0.0"           # semver; every install and update keeps this version',
    '  license: MIT',
    '  components:',
    '    - type: lib',
    '      name: my-cortex.js',
    '      filename: my-cortex.js',
    '      exports: [getData, setData, search]',
    '      api_surface: |',
    '        AIMEAT.myCortex.getData({ id }) — Get one item. Returns { id, name, value } or null',
    '        AIMEAT.myCortex.setData({ id, name, value }) — Save one. Returns the saved item',
    '        AIMEAT.myCortex.search({ query }) — Search. Returns Item[]',
    '    - type: prompt',
    '      name: my-assistant',
    '      content: |',
    '        Available API: AIMEAT.myCortex.getData({ id }) — Returns { id, name, value } …',
    '    - type: schema',
    '      name: my-item',
    '      key_pattern: "mycortex.items.*"',
    '      apply_to: prefix',
    '      schema: { type: object, properties: { id: { type: string }, name: { type: string } }, required: [id, name] }',
    '    - type: seed-data',
    '      entries:',
    '        - key: mycortex.index',
    '          value: []',
    '```',
    '',
    'Required: apiVersion, kind, metadata.name, metadata.namespace, spec.version, spec.components',
    '(each with a type). A schema needs name and key_pattern; a lib needs name and filename, and its',
    'api_surface must describe every function with parameter names, types and return shapes, because',
    'that text is what an AI reads to use the library. Seed-data keys must not collide with a schema',
    'key_pattern.',
    '',
  ].join('\n');
}

function librarySection(): string {
  return [
    '## The library',
    '',
    'A lib file is plain browser JavaScript that attaches to `window.AIMEAT`:',
    '',
    '```js',
    '(function (A) {',
    '  A.myCortex = {',
    '    async getData({ id }) { return A.data.get(`mycortex.items.${id}`); },',
    '    async setData(item) { await A.data.set(`mycortex.items.${item.id}`, item); return item; },',
    '  };',
    '})(window.AIMEAT = window.AIMEAT || {});',
    '```',
    '',
    'Read and write the user\'s data through `AIMEAT.data`; read an extension\'s public data with',
    '`AIMEAT.data.getPublic(\'ext:<name>\', key)`; call a server extension with',
    '`session.fetch(\'/v1/ext/<name>@<version>/<action>\', { method: \'POST\', body })`. A cortex never',
    'reaches `/v1/ext/` internals or `/v1/memory/ext:` directly.',
    '',
  ].join('\n');
}

function installSection(url: string): string {
  return [
    '## Installing and updating',
    '',
    '```bash',
    `curl -X POST ${url}/v1/cortex -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \\`,
    `  -d '{"manifest":"<yaml>","libs":{"my-cortex.js":"<js>"}}'`,
    `curl -X POST ${url}/v1/cortex/{name}/activate -H "Authorization: Bearer $TOKEN"`,
    '```',
    '',
    `Updating: \`PUT ${url}/v1/cortex/{name}\` with the new manifest and libs replaces in place, keeps the`,
    'name, and re-runs activation for an active cortex. In chat the same acts are aimeat_cortex_install',
    'and aimeat_cortex_activate. An installed cortex that is never activated serves nothing.',
    '',
    'An app loads it with a script tag:',
    '',
    '```html',
    `<script src="${url}/v1/cortex/{name}@{version}/libs/my-cortex.js"></script>`,
    '```',
    '',
  ].join('\n');
}

function versionsSection(url: string): string {
  return [
    '## Versions, pinning and who uses what',
    '',
    'Every install and `PUT` keeps a snapshot under `spec.version`. The bare address',
    '`/v1/cortex/{name}/libs/{file}` serves the latest and is never cached;',
    '`/v1/cortex/{name}@{version}/libs/{file}` serves that kept version and is cacheable for good. An app',
    'built against one version keeps loading it after the cortex moves on. The rule, the same as for',
    'apps: a fix that changes no API keeps the version; a change that would break an app is a NEW',
    'version, and each app decides when to move. When you write a script tag, pin the version you',
    `tested against. \`GET ${url}/v1/cortex/{name}/versions\` lists the kept ones.`,
    '',
    `Before building, read \`GET ${url}/v1/dependencies\`: every cortex and extension on this node and`,
    'which apps use them, read from the published source at publish and install time, never written',
    'by hand. Reuse what exists; extend it with a new version rather than a copy. `GET /v1/cortex`',
    'carries the same as `used_by` on every row.',
    '',
  ].join('\n');
}

function taskSection(): string {
  return [
    '## Your task',
    '',
    'Ask the user what the cortex should give an app. Then design the manifest with the components it',
    'needs, write the library if apps need code, document every function in api_surface, and hand over',
    'the complete YAML and JS ready to install. Install and activate it when the user says so, and',
    'load it in one app with a pinned version to prove it works.',
    '',
  ].join('\n');
}

export function buildCortexPrompt(config: AimeatConfig, opts: CortexPromptOpts = {}): { full: string; body: string } {
  const url = config.baseUrl || 'https://aimeat.io';
  const owner = opts.owner || 'your-account';
  const lang = opts.lang || 'en';
  const body = [
    '# Build an AIMEAT cortex',
    '',
    'A cortex is a browser-side building block an app loads with a script tag: a library with a',
    'documented API, a prompt for the AI that builds on it, and optionally a schema and seed data.',
    'Several apps can load the same cortex; a cortex can call a server extension.',
    '',
    `Node: ${url}`,
    `Owner: ${owner}`,
    '',
    manifestSection(owner),
    librarySection(),
    installSection(url),
    versionsSection(url),
    taskSection(),
  ].join('\n');
  const full = [
    lang && lang !== 'en' ? `Write the cortex's own user-facing text in ${lang}. These instructions stay in English.` : '',
    opts.idea ? `What it should give an app: ${opts.idea}\n` : '',
    body,
  ].filter(Boolean).join('\n');
  return { full, body };
}
