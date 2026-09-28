/**
 * @file test/unit/extension-ai-provider-manifest.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The manifest's `provides.ai_provider` declaration (System 2 plan V6), validated by
 *   buildExtensionRecordFromManifest (services/extension-manifest.ts) and read back by
 *   aiProviderDeclarationOf (services/extension-ai-provider-declaration.ts): the accepted shape and
 *   how it is stored, and each refusal naming its field.
 * @usage cd aimeat && pnpm exec vitest run test/unit/extension-ai-provider-manifest.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-28 — System 2 plan, V6: initial.
 */
import { describe, it, expect } from 'vitest';
import { buildExtensionRecordFromManifest } from '../../src/services/extension-manifest.js';
import {
    AI_PROVIDER_DECLARATION_KEY, AI_OP_ACTION_PREFIX, aiProviderDeclarationOf,
} from '../../src/services/extension-ai-provider-declaration.js';
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

const SCRIPTS = { 'ai.js': 'export default async function (ctx, input) { return { text: "x" }; }' };

/** A manifest with actions `ai.text` and `ai.embed` and the given `provides` block (YAML lines). */
function manifest(provides: string[], opts: { actions?: string[]; config?: string[] } = {}): string {
    const actions = opts.actions ?? ['ai.text', 'ai.embed'];
    return [
        'metadata:',
        '  name: example-ai',
        '  version: 1.0.0',
        '  description: Example AI as a provider',
        '  author: alice',
        ...(opts.config ?? []),
        ...provides,
        'actions:',
        ...actions.flatMap(id => [`  - id: ${id}`, '    method: POST', `    path: /${id}`, '    script: ai.js']),
    ].join('\n');
}

const GOOD = [
    'provides:',
    '  ai_provider:',
    '    ops: [text, embed]',
    '    models:',
    '      - id: my-model-1',
    '        name: My model',
    '        caps: { textIn: true, textOut: true }',
    '        price: { in_per_mtok: 1, out_per_mtok: 2.5 }',
    '      - { id: my-embed-1, name: My embedder, price: { in_per_mtok: 0 } }',
    '    data_statement: "The text goes to Example AI in the EU."',
    '    hosts: [api.example-ai.com, EU.Example-AI.com]',
    '    auth_header: x-api-key',
];

function build(yaml: string) {
    return buildExtensionRecordFromManifest(yaml, SCRIPTS, config, 'alice', '2026-09-28T00:00:00.000Z');
}

/** Replace one line of GOOD (matched by its start) with other lines. */
function goodWith(prefix: string, ...replacement: string[]): string[] {
    const i = GOOD.findIndex(l => l.trimStart().startsWith(prefix));
    if (i === -1) throw new Error(`no line starts with ${prefix}`);
    return [...GOOD.slice(0, i), ...replacement, ...GOOD.slice(i + 1)];
}

function refusal(yaml: string): string {
    const out = build(yaml);
    expect(out.ok, 'the manifest was accepted').toBe(false);
    if (out.ok) return '';
    expect(out.code).toBe('INVALID_MANIFEST');
    expect(out.status).toBe(400);
    return out.message;
}

describe('provides.ai_provider: the accepted shape', () => {
    it('is stored normalized under config.__aiProvider and read back by aiProviderDeclarationOf', () => {
        const out = build(manifest(GOOD));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        const expected = {
            ops: ['text', 'embed'],
            models: [
                { id: 'my-model-1', name: 'My model', caps: { textIn: true, textOut: true }, price: { inPerMtok: 1, outPerMtok: 2.5 } },
                { id: 'my-embed-1', name: 'My embedder', price: { inPerMtok: 0 } },
            ],
            dataStatement: 'The text goes to Example AI in the EU.',
            hosts: ['api.example-ai.com', 'eu.example-ai.com'],
            authHeader: 'x-api-key',
        };
        expect(out.record.config[AI_PROVIDER_DECLARATION_KEY]).toEqual(expected);
        expect(aiProviderDeclarationOf(out.record)).toEqual(expected);
        expect(AI_OP_ACTION_PREFIX).toBe('ai.');
    });

    it('accepts action ids with a dot (ai.text), which the action validation does not restrict', () => {
        const out = build(manifest(GOOD));
        expect(out.ok && out.record.actions.map(a => a.id)).toEqual(['ai.text', 'ai.embed']);
    });

    it('leaves authHeader out when auth_header is absent', () => {
        const out = build(manifest(GOOD.filter(l => !l.includes('auth_header'))));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(aiProviderDeclarationOf(out.record)).not.toHaveProperty('authHeader');
    });

    it('stores nothing for a manifest without provides', () => {
        const out = build(manifest([]));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.record.config).not.toHaveProperty(AI_PROVIDER_DECLARATION_KEY);
        expect(aiProviderDeclarationOf(out.record)).toBeNull();
    });

    it('a manifest config block cannot set __aiProvider itself', () => {
        const out = build(manifest([], { config: [
            'config:',
            '  __aiProvider:',
            '    default: { ops: [text], models: [{ id: m, name: m }], dataStatement: x, hosts: [evil.example] }',
        ] }));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(out.record.config).not.toHaveProperty(AI_PROVIDER_DECLARATION_KEY);
        expect(aiProviderDeclarationOf(out.record)).toBeNull();
        expect(out.warnings?.join(' ')).toContain('__aiProvider');
    });

    it('with both config.__aiProvider and provides, the stored value is the validated provides', () => {
        const out = build(manifest(GOOD, { config: [
            'config:',
            '  __aiProvider: { ops: [text], models: [{ id: m, name: m }], dataStatement: x, hosts: [evil.example] }',
        ] }));
        expect(out.ok).toBe(true);
        if (!out.ok) return;
        expect(aiProviderDeclarationOf(out.record)?.hosts).toEqual(['api.example-ai.com', 'eu.example-ai.com']);
    });
});

describe('provides: each refusal names its field', () => {
    it('provides that is not a map', () => {
        expect(refusal(manifest(['provides: [ai_provider]']))).toMatch(/^provides must be a map/);
    });
    it('an unknown key under provides', () => {
        expect(refusal(manifest(['provides:', '  ai_provider_x: {}']))).toMatch(/provides declares unknown field\(s\) ai_provider_x/);
    });
    it('ai_provider that is not a map', () => {
        expect(refusal(manifest(['provides:', '  ai_provider: yes']))).toMatch(/^provides\.ai_provider must be a map/);
    });
    it('an unknown key under ai_provider', () => {
        expect(refusal(manifest([...GOOD, '    key_in_query: true']))).toMatch(/provides\.ai_provider declares unknown field\(s\) key_in_query/);
    });

    it('ops missing or empty', () => {
        expect(refusal(manifest(GOOD.filter(l => !l.includes('ops:'))))).toMatch(/provides\.ai_provider\.ops must be a non-empty list/);
        expect(refusal(manifest(goodWith('ops:', '    ops: []')))).toMatch(/provides\.ai_provider\.ops must be a non-empty list/);
    });
    it('an op that is not one of the five', () => {
        expect(refusal(manifest(goodWith('ops:', '    ops: [text, video]')))).toMatch(/provides\.ai_provider\.ops: string \("video"\) is not an op/);
    });
    it('a duplicated op', () => {
        expect(refusal(manifest(goodWith('ops:', '    ops: [text, text]')))).toMatch(/provides\.ai_provider\.ops lists "text" twice/);
    });
    it('an op without its ai.<op> action names the missing action id', () => {
        const msg = refusal(manifest(goodWith('ops:', '    ops: [text, transcribe]')));
        expect(msg).toMatch(/provides\.ai_provider\.ops declares "transcribe"/);
        expect(msg).toContain('"ai.transcribe"');
    });

    it('models missing or empty', () => {
        expect(refusal(manifest(goodWith('models:', '    models: []').filter(l => !l.startsWith('      '))))).toMatch(/provides\.ai_provider\.models must be a non-empty list/);
    });
    it('a model without an id, or with an empty name', () => {
        expect(refusal(manifest(goodWith('- { id: my-embed-1', '      - { name: No id }')))).toMatch(/provides\.ai_provider\.models\[1\]\.id must be a non-empty string/);
        expect(refusal(manifest(goodWith('- { id: my-embed-1', '      - { id: x, name: "" }')))).toMatch(/provides\.ai_provider\.models\[1\]\.name must be a non-empty string/);
    });
    it('a model id over 200 characters', () => {
        expect(refusal(manifest(goodWith('- { id: my-embed-1', `      - { id: ${'m'.repeat(201)}, name: Long }`)))).toMatch(/models\[1\]\.id must be a non-empty string of at most 200/);
    });
    it('a duplicated model id', () => {
        expect(refusal(manifest(goodWith('- { id: my-embed-1', '      - { id: my-model-1, name: Again }')))).toMatch(/models\[1\]\.id "my-model-1" is listed twice/);
    });
    it('an unknown key on a model', () => {
        expect(refusal(manifest(goodWith('- { id: my-embed-1', '      - { id: e, name: E, context: 8000 }')))).toMatch(/models\[1\] declares unknown field\(s\) context/);
    });
    it('caps that are not a map of booleans', () => {
        expect(refusal(manifest(goodWith('caps:', '        caps: [textIn]')))).toMatch(/models\[0\]\.caps must be a map of booleans/);
        expect(refusal(manifest(goodWith('caps:', '        caps: { textIn: "yes" }')))).toMatch(/models\[0\]\.caps\.textIn must be a boolean/);
    });
    it('a negative, non-numeric or unknown price field', () => {
        expect(refusal(manifest(goodWith('price:', '        price: { in_per_mtok: -1 }')))).toMatch(/models\[0\]\.price\.in_per_mtok must be a non-negative number/);
        expect(refusal(manifest(goodWith('price:', '        price: { out_per_mtok: "2" }')))).toMatch(/models\[0\]\.price\.out_per_mtok must be a non-negative number/);
        expect(refusal(manifest(goodWith('price:', '        price: { inPerMtok: 1 }')))).toMatch(/models\[0\]\.price declares unknown field inPerMtok/);
    });

    it('data_statement missing, empty or over 500 characters', () => {
        expect(refusal(manifest(GOOD.filter(l => !l.includes('data_statement'))))).toMatch(/provides\.ai_provider\.data_statement must be a non-empty string/);
        expect(refusal(manifest(goodWith('data_statement', '    data_statement: "  "')))).toMatch(/data_statement must be a non-empty string/);
        expect(refusal(manifest(goodWith('data_statement', `    data_statement: "${'x'.repeat(501)}"`)))).toMatch(/data_statement must be a non-empty string of at most 500/);
    });

    it('hosts missing, empty or over 20', () => {
        expect(refusal(manifest(GOOD.filter(l => !l.includes('hosts:'))))).toMatch(/provides\.ai_provider\.hosts must be a list of 1 to 20/);
        expect(refusal(manifest(goodWith('hosts:', '    hosts: []')))).toMatch(/hosts must be a list of 1 to 20/);
        const many = Array.from({ length: 21 }, (_, i) => `h${i}.example.com`).join(', ');
        expect(refusal(manifest(goodWith('hosts:', `    hosts: [${many}]`)))).toMatch(/hosts must be a list of 1 to 20/);
    });
    it.each([
        ['https://api.example.com', /without a scheme/],
        ['api.example.com/v1', /without a path/],
        ['*.example.com', /wildcards are not accepted/],
        ['api.example.com:8443', /without a port/],
        ['[::1]', /never an IPv6 address/],
        ['127.0.0.1', /an IP address is not accepted/],
        ['2130706433', /an IP address is not accepted/],
        ['10.0.0.0x1', /an IP address is not accepted/],
        ['api..example.com', /only lowercase letters, digits, hyphens and dots/],
        ['-api.example.com', /only lowercase letters, digits, hyphens and dots/],
        ['api_x.example.com', /only lowercase letters, digits, hyphens and dots/],
    ])('refuses the host %s and says why', (host, why) => {
        const msg = refusal(manifest(goodWith('hosts:', `    hosts: [${JSON.stringify(host)}]`)));
        expect(msg).toMatch(/^provides\.ai_provider\.hosts: ".*" is refused, /);
        expect(msg).toMatch(why);
    });

    it('an auth_header that is not a header name', () => {
        expect(refusal(manifest(goodWith('auth_header', '    auth_header: "x api key"')))).toMatch(/provides\.ai_provider\.auth_header must be an HTTP header name/);
        expect(refusal(manifest(goodWith('auth_header', '    auth_header: [x-api-key]')))).toMatch(/auth_header must be an HTTP header name/);
    });
    it.each(['host', 'Cookie', 'content-length', 'Transfer-Encoding', 'connection', 'set-cookie'])(
        'refuses auth_header %s', (name) => {
            expect(refusal(manifest(goodWith('auth_header', `    auth_header: ${name}`)))).toMatch(new RegExp(`auth_header "${name}" is refused`));
        });
});
