/**
 * @file build-extension-prompt.test.ts
 * @description The canonical extension prompt (GET /v1/prompts/build-extension) against what a script
 *   is really handed. The prompt's table is headed "The ctx object, in full", and on 2026-09-13 four
 *   appdev pitfalls turned out to be that table being wrong: it had no row for ctx.ai, ctx.buy,
 *   ctx.extension or ctx.datapackage, it wrote ctx.memory.set without the visibility option and never
 *   said an ext: key is public by default, and it told authors that a scheduled run gets no ctx.files
 *   (untrue since 2026-08-15) and to guard with a return, which a scheduled run records as success.
 *
 *   The shape is read from the SANDBOX itself rather than from a list kept here: a script runs with
 *   every optional capability supplied and reports the keys of the ctx it received, so a member added
 *   to the guest object and left out of the prompt fails this file.
 * @usage pnpm exec vitest run test/unit/build-extension-prompt.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-13 — Initial: the ctx table checked against the guest ctx, the public default of
 *     ctx.memory.set, the capability map per road, and the throw rule for a failed precondition.
 */
import { describe, it, expect } from 'vitest';
import { buildExtensionPrompt } from '../../src/services/build-extension-prompt.js';
import { executeExtensionAction } from '../../src/services/extension-runtime.js';
import type { ExtensionCtx } from '../../src/services/extension-runtime.js';
import type { AimeatConfig } from '../../src/config.js';

const config = { nodeId: 'test-node', baseUrl: 'https://example.test' } as unknown as AimeatConfig;
const { body } = buildExtensionPrompt(config, { owner: 'alice' });
/** The body with its line breaks folded, for assertions about a sentence that may wrap. */
const prose = body.replace(/\s+/g, ' ');

const noop = async (): Promise<never> => null as never;

/** A context with EVERY optional capability present, so the guest builds every member it can. */
function fullCtx(): ExtensionCtx {
    return {
        memory: { get: noop, getVersioned: noop, set: noop, search: noop, delete: noop, getPublic: noop },
        fetch: noop,
        files: { read: noop, write: noop },
        datapackage: { publish: noop, validate: noop, inferSchema: noop, open: noop, rows: noop, fail: noop },
        workspace: { index: noop, get: noop, write: noop, writeDoc: noop, publish: noop },
        wallet: { consume: noop, getBalance: noop },
        buy: noop,
        ai: { start: noop },
        consent: { check: noop, require: noop },
        trust: { getScore: noop },
        caller: { gaii: 'alice@test-node', owner: 'alice', roles: ['owner'], scopes: [] },
        extension: { name: 'probe', owner: 'alice' },
        config: {},
        instance: { id: 'i1', config: {} },
        log: { info: () => {}, warn: () => {}, error: () => {} },
        notify: noop,
        email: noop,
    } as unknown as ExtensionCtx;
}

/** The lines of the prompt that talk about `ctx.<member>`. */
function linesAbout(member: string): string {
    return body.split('\n').filter(l => l.includes(`ctx.${member}`)).join('\n');
}

describe('buildExtensionPrompt: the ctx table matches the sandbox', () => {
    it('names every member of the ctx a script receives, and every method under it', async () => {
        const script = `export default async function (ctx) {
            const nested = {};
            for (const k of Object.keys(ctx)) {
                const v = ctx[k];
                if (v && (typeof v === 'object' || typeof v === 'function')) nested[k] = Object.keys(v);
            }
            return { top: Object.keys(ctx), nested };
        }`;
        const shape = await executeExtensionAction(script, fullCtx(), {},
            { memoryMb: 16, timeoutMs: 5000, maxApiCalls: 10 }) as { top: string[]; nested: Record<string, string[]> };

        // Sanity: the probe really saw the optional members, or the loop below proves nothing.
        expect(shape.top).toEqual(expect.arrayContaining(['ai', 'buy', 'extension', 'datapackage', 'workspace', 'files']));

        const missingTop = shape.top.filter(k => !body.includes(`ctx.${k}`));
        expect(missingTop, 'ctx members the prompt never names').toEqual([]);

        // caller, config and instance carry DATA whose keys are the fixture's, not the contract's.
        const dataMembers = new Set(['caller', 'config', 'instance', 'extension']);
        const missingNested: string[] = [];
        for (const [k, methods] of Object.entries(shape.nested)) {
            if (dataMembers.has(k)) continue;
            const text = linesAbout(k);
            for (const m of methods) {
                if (!new RegExp(`\\b${m}\\b`).test(text)) missingNested.push(`ctx.${k}.${m}`);
            }
        }
        expect(missingNested, 'ctx methods the prompt never names').toEqual([]);
    });

    it('documents ctx.extension as the way to write an owner-only action', () => {
        const text = linesAbout('extension');
        expect(text).toMatch(/owner/);
        expect(text).toMatch(/ctx\.caller\.owner/);
    });

    it('documents ctx.ai.start as a background call billed to the installer', () => {
        const text = linesAbout('ai');
        expect(text).toContain('ctx.ai.start');
        expect(text).toMatch(/result_key/);
        expect(text).toMatch(/on_done/);
        expect(text).toMatch(/billed|pays/i);
    });
});

describe('buildExtensionPrompt: ext: memory is public unless the write says otherwise', () => {
    it('writes the set row with its options and says what the default is', () => {
        const row = body.split('\n').find(l => l.includes('`ctx.memory.set('));
        expect(row).toBeDefined();
        expect(row).toContain('visibility');
        expect(row).toContain('ifVersion');
        expect(body).toContain("visibility: 'private'");
        expect(prose).toMatch(/readable by anyone/i);
    });

    it('says the flag has to be on every write, and that stored rows are not re-secured by a code change', () => {
        expect(prose).toMatch(/every write/i);
        expect(prose).toMatch(/already stored/i);
    });
});

describe('buildExtensionPrompt: capabilities per road, and the throw rule', () => {
    it('no longer claims a scheduled run gets no ctx.files', () => {
        // The prompt wraps its prose at 100 columns, so a sentence is compared with the breaks folded.
        expect(prose).not.toContain('a scheduled run with no caller does not get them');
    });

    it('tells the author to throw when a capability or precondition is missing', () => {
        expect(prose).toMatch(/normal return[^.]*success/i);
        expect(body).toMatch(/throw new Error/);
    });

    it('does not claim the node validates input against the action schema', () => {
        expect(prose).not.toMatch(/already validated against your action/i);
        expect(prose).not.toMatch(/validated per call/i);
    });

    it('names the wallet methods, not the wallet object, as what an unattended run lacks', () => {
        expect(body).toMatch(/ctx\.wallet\.consume/);
        expect(body).not.toMatch(/if \(!ctx\.wallet\)/);
    });
});
