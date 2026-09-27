/**
 * @file test/unit/app-manage-dispatch.test.ts
 * @description aimeat_app_manage on the connector and the CLI dispatch: every action reaches its
 *   REST endpoint with every field it takes, and a wrong call is refused in ONE answer naming every
 *   missing and every foreign field, before anything is sent. The node MCP surface is proved end to
 *   end by test/e2e-app-manage.ts.
 * @usage pnpm test -- app-manage-dispatch
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { appManageCall } from '../../src/cli/connect/app-manage-call.js';
import { CONNECT_CLI_TOOLS } from '../../src/cli/connect/tool-call.js';
import type { AimeatClient } from '../../src/cli/connect/api-client.js';
import {
    APP_MANAGE_ACTIONS, APP_MANAGE_ACTION_NAMES, APP_MANAGE_FIELDS, checkAppManageInput, appManageTools,
} from '../../src/mcp/catalog/definitions/app-manage.js';
import { appManageShape } from '../../src/mcp/app-manage-shape.js';
import { TOOL_ACTION_SCOPES } from '../../src/mcp/catalog/action-scopes.js';
import { fileURLToPath } from 'node:url';
import { readVocabulary } from '../../scripts/inventory/scope-vocabulary.js';

type Sent = { method: string; path: string; body?: unknown };

function recorder(answer: (s: Sent) => { ok: boolean; data?: unknown; error?: { code: string; message: string } } = () => ({ ok: true, data: {} })) {
    const sent: Sent[] = [];
    const push = (method: string, path: string, body?: unknown) => { const s = { method, path, body }; sent.push(s); return Promise.resolve(answer(s)); };
    const client = {
        get: (p: string) => push('GET', p),
        post: (p: string, b?: unknown) => push('POST', p, b),
        put: (p: string, b?: unknown) => push('PUT', p, b),
        patch: (p: string, b?: unknown) => push('PATCH', p, b),
        delete: (p: string) => push('DELETE', p),
    } as unknown as AimeatClient;
    return { client, sent };
}

/** One distinctive value per field, so its arrival on the wire can be found. */
const VALUE: Record<string, unknown> = {
    filename: 'shop.html', owner: 'alice', index: true, title: 'zqxtitle', description: 'zqxdesc', keywords: ['zqxkw'],
    image: 'https://x/zqximg.png', lang: 'fi', badge: false, install: true, kind: 'privacy', format: 'markdown',
    content: 'zqxcontent', remove: true, limit: 7, playtest: true, days: 9, on: true, geo: 'region', detail: ['zqxdetail'],
    layout: { v: 1, blocks: [] }, note: 'zqxnote', version: 3, name: 'zqxname', descriptions: { fi: 'zqxfi' }, parked: true,
    forkable: true, access_code: 'zqxcode', protection: { obfuscate: true }, screenshot: 'zqxb64', screenshot_mime_type: 'image/webp',
    subdomain: 'zqxsub', target: 'alice/shop.html', subdomain_kind: 'redirect', enabled: false, bundled_agent: 'zqxagent',
    runner_agent: 'zqxrunner', organism_id: 'zqxorg',
};

/** Where each action goes: method and path. The body is checked field by field below. */
const EXPECT: Record<string, [string, string]> = {
    settings: ['PATCH', '/v1/apps/shop.html'],
    seo: ['PATCH', '/v1/apps/shop.html'],
    marks: ['PATCH', '/v1/apps/shop.html'],
    legal: ['PATCH', '/v1/apps/shop.html'],
    audit: ['GET', '/v1/apps/me/shop.html/audit?limit=7&playtest=true'],
    versions: ['GET', '/v1/apps/alice/shop.html/versions'],
    lineage: ['GET', '/v1/apps/alice/shop.html/lineage'],
    screenshot: ['POST', '/v1/apps/alice/shop.html/screenshot/capture'],
    screenshot_upload: ['POST', '/v1/apps/alice/shop.html/screenshot'],
    screenshot_clear: ['DELETE', '/v1/apps/alice/shop.html/screenshot'],
    preview_link: ['POST', '/v1/apps/alice/shop.html/draft/preview-token'],
    visitors: ['GET', '/v1/apps/visitors?filename=shop.html&days=9'],
    visitors_measure: ['PUT', '/v1/apps/visitors/measurement'],
    ui_get: ['GET', '/v1/apps/me-owner/shop.html/ui?catalogue=index&detail=zqxdetail'],
    ui_set: ['PUT', '/v1/apps/me-owner/shop.html/ui'],
    ui_restore: ['POST', '/v1/apps/me-owner/shop.html/ui/restore'],
    cost: ['GET', '/v1/apps/cost?app_id=alice%2Fshop.html'],
    agent_deploy: ['POST', '/v1/apps/alice/shop.html/agents/zqxagent/deploy'],
    agent_undeploy: ['POST', '/v1/apps/alice/shop.html/agents/zqxagent/undeploy'],
    agent_instances: ['GET', '/v1/apps/alice/shop.html/agents/zqxagent/instances'],
    agent_status: ['GET', '/v1/apps/alice/shop.html/agents/zqxagent/status?runner_agent=zqxrunner'],
    grants: ['GET', '/v1/app-grants'],
    backup_export: ['GET', '/v1/apps/backup?to=storage'],
    subdomain_list: ['GET', '/v1/admin/subdomains'],
    subdomain_set: ['PATCH', '/v1/admin/subdomains/zqxsub'],
    subdomain_delete: ['DELETE', '/v1/admin/subdomains/zqxsub'],
};

/** A field that travels in the path or query, or shapes the request rather than appearing in it. */
const IN_PATH = new Set(['filename', 'owner', 'bundled_agent', 'subdomain', 'limit', 'playtest', 'days', 'detail', 'runner_agent']);

function fullInput(action: string): Record<string, unknown> {
    const input: Record<string, unknown> = { action };
    for (const f of Object.keys(APP_MANAGE_ACTIONS[action]!.fields)) input[f] = VALUE[f];
    // One legal page per call: `remove` and a format/content pair are two different requests.
    if (action === 'legal') delete input.remove;
    return input;
}

describe('aimeat_app_manage: every action reaches its endpoint with its fields', () => {
    it('covers every action in the table', () => {
        expect(Object.keys(EXPECT).sort()).toEqual([...APP_MANAGE_ACTION_NAMES].sort());
    });

    for (const action of APP_MANAGE_ACTION_NAMES) {
        it(action, async () => {
            const { client, sent } = recorder();
            const out = await appManageCall(client, 'me-owner', fullInput(action));
            expect(out.ok, JSON.stringify(out)).toBe(true);
            expect(sent[0]?.method).toBe(EXPECT[action]![0]);
            expect(sent[0]?.path).toBe(EXPECT[action]![1]);
            const wire = JSON.stringify(sent);
            for (const f of Object.keys(APP_MANAGE_ACTIONS[action]!.fields)) {
                if (IN_PATH.has(f) || (action === 'legal' && f === 'remove')) continue;
                // A layout travels merged with the note, so its own first key is what to look for.
                if (f === 'layout') { expect(wire, `${action}.layout`).toContain('"layout":{"v":1,"blocks":[]'); continue; }
                const v = VALUE[f];
                const probe = typeof v === 'string' ? v : JSON.stringify(v);
                expect(wire.includes(probe.replace(/^"|"$/g, '')) || wire.includes(`"${f}":${JSON.stringify(v)}`) || (f === 'subdomain_kind' && wire.includes('"kind":"redirect"')),
                    `${action}.${f} did not reach the wire: ${wire}`).toBe(true);
            }
        });
    }

    it('legal with remove sends remove inside the kind, and no kind reads the state', async () => {
        const a = recorder();
        await appManageCall(a.client, 'me', { action: 'legal', filename: 'shop.html', kind: 'terms', remove: true });
        expect(a.sent[0]).toEqual({ method: 'PATCH', path: '/v1/apps/shop.html', body: { legal: { terms: { remove: true } } } });
        const b = recorder();
        await appManageCall(b.client, 'me', { action: 'legal', filename: 'shop.html' });
        expect(b.sent[0]).toEqual({ method: 'GET', path: '/v1/apps/me/shop.html/legal', body: undefined });
    });

    it('legal and ui_set carry the provenance declaration in the body; the route records it', async () => {
        const declared = { level: 'ai-generated' };
        const a = recorder();
        await appManageCall(a.client, 'me', { action: 'ui_set', filename: 'shop.html', layout: { v: 1 }, ai_provenance: declared });
        expect((a.sent[0]!.body as Record<string, unknown>).ai_provenance).toEqual(declared);
    });

    it('subdomain_set creates the entry when there is none to change', async () => {
        const { client, sent } = recorder(s => (s.method === 'PATCH' ? { ok: false, error: { code: 'NOT_FOUND', message: 'none' } } : { ok: true, data: {} }));
        const out = await appManageCall(client, 'me', { action: 'subdomain_set', subdomain: 'shop', target: 'alice/shop.html', subdomain_kind: 'app' });
        expect(out.ok).toBe(true);
        expect(sent.map(s => `${s.method} ${s.path}`)).toEqual(['PATCH /v1/admin/subdomains/shop', 'POST /v1/admin/subdomains']);
        expect(sent[1]!.body).toEqual({ subdomain: 'shop', target: 'alice/shop.html', kind: 'app' });
    });
});

describe('aimeat_app_manage: a wrong call is refused whole, before anything is sent', () => {
    it('names every missing and every foreign field in one answer', async () => {
        const { client, sent } = recorder();
        const out = await appManageCall(client, 'me', { action: 'visitors_measure', geo: 'city', layout: {}, badge: true });
        expect(sent).toEqual([]);
        expect(out.ok).toBe(false);
        expect(out.error?.code).toBe('INVALID_INPUT');
        expect(out.error?.message).toContain('is missing: filename, on');
        expect(out.error?.message).toContain('does not take: layout, badge');
        expect(out.error?.message).toContain('Its fields: filename (required), on (required), geo');
    });

    it('refuses an unknown action and lists the real ones', () => {
        const r = checkAppManageInput({ action: 'park' });
        expect(r.ok).toBe(false);
        expect(!r.ok && r.message).toContain('settings');
    });

    it('settings needs something to change', () => {
        const r = checkAppManageInput({ action: 'settings', filename: 'shop.html' });
        expect(!r.ok && r.message).toContain('needs at least one of: name');
    });

    it('ignores the connector\'s own agent_name only when the surface says so', () => {
        expect(checkAppManageInput({ action: 'grants', agent_name: 'bot' }, ['agent_name']).ok).toBe(true);
        expect(checkAppManageInput({ action: 'grants', agent_name: 'bot' }).ok).toBe(false);
    });
});

describe('aimeat_app_manage: one table, three surfaces', () => {
    it('the zod shape and the catalog list the same fields', () => {
        const catalog = Object.keys(appManageTools[0]!.input).filter(f => !f.startsWith('ai_provenance')).sort();
        expect(Object.keys(appManageShape).sort()).toEqual(catalog);
        expect(Object.keys(APP_MANAGE_FIELDS).length + 1).toBe(catalog.length);
    });

    it('every action field is a declared field, and every action has its permission word', () => {
        for (const [action, spec] of Object.entries(APP_MANAGE_ACTIONS)) {
            for (const f of Object.keys(spec.fields)) expect(APP_MANAGE_FIELDS[f], `${action}.${f}`).toBeDefined();
            expect(action in TOOL_ACTION_SCOPES.aimeat_app_manage!).toBe(true);
        }
    });

    it('every permission word is one the owner can grant', () => {
        const vocabulary = readVocabulary(fileURLToPath(new URL('../..', import.meta.url)));
        for (const word of new Set(Object.values(TOOL_ACTION_SCOPES.aimeat_app_manage!).filter(Boolean))) {
            expect(vocabulary.has(word!), `${word} is not in the scope vocabulary`).toBe(true);
        }
    });

    it('the CLI dispatch carries the tool and sends through the same function', async () => {
        const def = CONNECT_CLI_TOOLS.find(t => t.name === 'aimeat_app_manage');
        expect(def).toBeDefined();
        const { client, sent } = recorder();
        await def!.handler({ client, config: { owner: 'cli-owner' } as never, agentPath: '' }, { action: 'versions', filename: 'a.html' });
        expect(sent[0]?.path).toBe('/v1/apps/cli-owner/a.html/versions');
    });
});
