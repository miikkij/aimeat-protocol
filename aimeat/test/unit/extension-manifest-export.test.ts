/**
 * @file test/unit/extension-manifest-export.test.ts
 * @description An installed extension written back out as a manifest installs again as the same
 *   extension: buildExtensionRecordFromManifest(manifestOfRecord(record)) gives the record it came
 *   from, config types, schedules, the snake_case limits, network, workspace, the AI provider block,
 *   the secrets list and every action's pricing and marks included. A secret's value never leaves
 *   the record, and the node's own config keys are not written.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-manifest-export.test.ts
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6: ext/update-live-extension-without-its-source-manifest).
 */
import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { buildExtensionRecordFromManifest } from '../../src/services/extension/manifest.js';
import { manifestOfRecord } from '../../src/services/extension/manifest-export.js';
import type { AimeatConfig } from '../../src/config.js';

const config = {
    nodeId: 'test-node',
    extensionMaxCodeSizeKb: 512,
    extensionMaxMemoryMb: 64,
    extensionTimeoutMs: 30_000,
    extensionMaxApiCalls: 100,
    extensionMaxDebitPerCall: 100,
    extensionMaxPayMorsels: 1000,
} as unknown as AimeatConfig;

const RICH = `
metadata:
  name: alice-notes
  version: 2.1.0
  description: "Notes: kept per person"
  author: alice
required_apis: [memory]
capabilities: [network, ai]
network:
  hosts: [api.example.com]
  host_fields:
    SERVER_HOST: optional
workspace:
  read: true
  write: true
uses_secrets:
  - name: EXAMPLE_KEY
    hosts: [api.example.com]
    why: Reads the notes service.
config:
  title:
    type: string
    default: My notes
  pageSize:
    type: number
    default: 25
  verbose:
    type: boolean
    default: false
  apiKey:
    type: secret
    description: The service key
  SERVER_HOST:
    description: The address of your server
    default: notes.example.org
schedules:
  - cron: "0 7 * * *"
    action: digest
    input:
      since: 1d
limits:
  memory_mb: 32
  timeout_ms: 8000
  max_api_calls: 50
  fetch_max_mb: 8
federation:
  advertise: true
  capabilities: [notes]
instances:
  supported: true
  config_per_instance:
    type: object
    properties:
      room:
        type: string
actions:
  - id: digest
    method: POST
    path: /digest
    script: digest.js
    input:
      type: object
      properties:
        since:
          type: string
    output:
      type: object
  - id: approve
    method: POST
    path: /approve
    script: approve.js
    decision: person
  - id: peek
    method: GET
    path: /peek
    script: peek.js
    public: true
`;

const SCRIPTS = {
    'digest.js': 'export default async function (ctx, input) { return { since: input.since }; }',
    'approve.js': 'export default async function (ctx) { return { ok: true }; }',
    'peek.js': 'export default async function () { return { count: 1 }; }',
};

function build(manifest: string, scripts: Record<string, string>) {
    const out = buildExtensionRecordFromManifest(manifest, scripts, config, 'alice', '2026-11-21T00:00:00.000Z');
    if (!out.ok) throw new Error(`${out.code}: ${out.message}`);
    return out.record;
}

describe('manifestOfRecord', () => {
    it('installs again as the same record', () => {
        const record = build(RICH, SCRIPTS);
        const { manifest, scripts } = manifestOfRecord(record);
        const again = build(manifest, scripts);
        expect(again).toEqual(record);
    });

    it('writes the limits in snake_case, the config with its types, and the secret without a value', () => {
        const record = build(RICH, SCRIPTS);
        record.config.apiKey = 'v1:enc:not-for-anyone';
        const doc = parseYaml(manifestOfRecord(record).manifest);
        expect(doc.limits).toEqual({ memory_mb: 32, timeout_ms: 8000, max_api_calls: 50, fetch_max_mb: 8 });
        expect(doc.config.pageSize).toEqual({ type: 'number', default: 25 });
        expect(doc.config.verbose).toEqual({ type: 'boolean', default: false });
        expect(doc.config.apiKey).toEqual({ type: 'secret' });
        expect(manifestOfRecord(record).manifest).not.toContain('not-for-anyone');
        expect(doc.schedules).toEqual([{ cron: '0 7 * * *', action: 'digest', input: { since: '1d' } }]);
    });

    it('leaves the node\'s own config keys and markers out', () => {
        const record = build(RICH, SCRIPTS);
        record.config.emailPolicy = 'unrestricted';
        record.config.__keepsPreAuditFirstUse = true;
        const doc = parseYaml(manifestOfRecord(record).manifest);
        expect(Object.keys(doc.config)).not.toContain('emailPolicy');
        expect(Object.keys(doc.config).some((k: string) => k.startsWith('__'))).toBe(false);
    });

    it('an AI provider block round-trips with its prices in the manifest\'s spelling', () => {
        const provider = [
            'metadata:', '  name: example-ai', '  version: 1.0.0', '  description: Example AI', '  author: alice',
            'provides:', '  ai_provider:', '    ops: [text]',
            '    models:', '      - id: m1', '        name: Model one', '        caps: { textIn: true }', '        price: { in_per_mtok: 1, out_per_mtok: 2.5 }',
            '    data_statement: "The text goes to Example AI in the EU."', '    hosts: [api.example-ai.com]', '    auth_header: x-api-key',
            'actions:', '  - id: ai.text', '    method: POST', '    path: /ai.text', '    script: ai.js',
        ].join('\n');
        const record = build(provider, { 'ai.js': 'export default async function () { return { text: "x" }; }' });
        const { manifest, scripts } = manifestOfRecord(record);
        expect(parseYaml(manifest).provides.ai_provider.models[0].price).toEqual({ in_per_mtok: 1, out_per_mtok: 2.5 });
        expect(build(manifest, scripts)).toEqual(record);
    });

    it('a minimal extension round-trips too', () => {
        const minimal = 'metadata:\n  name: tiny\n  version: 1.0.0\n  description: Tiny\n  author: bob\nactions:\n  - id: echo\n    method: POST\n    path: /echo\n    script: e.js\n';
        const record = build(minimal, { 'e.js': 'export default async function (ctx, input) { return input; }' });
        const { manifest, scripts } = manifestOfRecord(record);
        expect(build(manifest, scripts)).toEqual(record);
    });
});
