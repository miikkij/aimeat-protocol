/**
 * @file input-limits.test.ts
 * @description The shared input limits and text helpers (models/input-limits.ts), the field errors
 *   they produce (models/validation-issues.ts), the request-level junk guard
 *   (middleware/input-junk.ts) and the bound a coarse catalog string gets (tool-catalog/field-limits.ts).
 * @usage cd aimeat && pnpm exec vitest run test/unit/input-limits.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (wish wish-sy-tteiden-validointi-pituusrajat-ja-roskan-torjunta-palveli).
 */
import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { INPUT_LIMITS, safeText, requiredText, boundedText, documentText, hasLoneSurrogate } from '../../src/models/input-limits.js';
import { validationDetails, validationFailure } from '../../src/models/validation-issues.js';
import { findJunk } from '../../src/middleware/input-junk.js';
import { limitClassFor } from '../../src/tool-catalog/field-limits.js';
import { zodShapeFor } from '../../src/tool-catalog/zod-shape.js';

const LONE = String.fromCharCode(0xd800);
const PAIR = '\u{1F600}';

describe('text helpers', () => {
    it('safeText refuses a control character and keeps tab and line breaks', () => {
        assert.equal(safeText(10).safeParse('a\tb\nc\r').success, true);
        const r = safeText(10).safeParse('a\u0007b');
        assert.equal(r.success, false);
        assert.equal((r.error!.issues[0] as { params?: { reason?: string } }).params?.reason, 'control_char');
    });

    it('every helper refuses NUL and a lone surrogate, and keeps a surrogate pair', () => {
        for (const s of [boundedText(10), safeText(10), documentText()]) {
            assert.equal(s.safeParse('a\u0000').success, false);
            assert.equal(s.safeParse(`a${LONE}`).success, false);
            assert.equal(s.safeParse(`a${PAIR}`).success, true);
        }
        assert.equal(hasLoneSurrogate(`x${LONE}y`), true);
        assert.equal(hasLoneSurrogate(PAIR), false);
    });

    it('requiredText refuses only white space; boundedText keeps a control character', () => {
        assert.equal(requiredText(10).safeParse('   ').success, false);
        assert.equal(requiredText(10).safeParse(' a ').success, true);
        assert.equal(boundedText(10).safeParse('\u001b[0m').success, true);
    });

    it('a limit is refused one character past it', () => {
        const s = safeText(INPUT_LIMITS.title);
        assert.equal(s.safeParse('x'.repeat(INPUT_LIMITS.title)).success, true);
        assert.equal(s.safeParse('x'.repeat(INPUT_LIMITS.title + 1)).success, false);
    });
});

describe('field errors', () => {
    const schema = z.strictObject({ title: requiredText(5), count: z.number(), note: safeText(20).optional() });

    it('names each field with its code and limit, in the caller\'s language', () => {
        const body = { title: 'too long a title', note: 'a\u0001', extra: 1 };
        const r = schema.safeParse(body);
        assert.equal(r.success, false);
        const en = validationDetails(r.error!.issues, body, 'en');
        const by = Object.fromEntries(en.map(d => [d.path, d]));
        assert.equal(by.title.code, 'too_long');
        assert.equal(by.title.max, 5);
        assert.equal(by.title.message, 'Too long: at most 5 characters.');
        assert.equal(by.count.code, 'required');
        assert.equal(by.note.code, 'control_char');
        assert.equal(by.extra.code, 'unknown_field');
        const fi = validationDetails(r.error!.issues, body, 'fi');
        assert.equal(fi.find(d => d.path === 'title')!.message, 'Liian pitkä: enintään 5 merkkiä.');
    });

    it('a wrong type that was sent is invalid_type, not required', () => {
        const body = { title: 'ok', count: 'seven' };
        const r = schema.safeParse(body);
        const d = validationDetails(r.error!.issues, body, 'en');
        assert.deepEqual(d.map(x => [x.path, x.code]), [['count', 'invalid_type']]);
    });

    it('the envelope is a 400 VALIDATION_ERROR whose message names the one field', () => {
        const env = validationFailure('n', [{ path: 'title', code: 'too_long', max: 5, message: 'Too long: at most 5 characters.' }], 'en');
        assert.equal(env.ok, false);
        assert.equal(env.error?.code, 'VALIDATION_ERROR');
        assert.equal(env.error?.message, 'title: Too long: at most 5 characters.');
        assert.equal((env.error?.details as unknown[]).length, 1);
    });
});

describe('request junk guard', () => {
    it('finds NUL and lone surrogates in values and keys at any depth, with their paths', () => {
        const found = findJunk({ a: 'ok', b: [{ c: 'x\u0000' }], [`k${LONE}`]: 1, d: { e: `y${LONE}` } });
        const paths = found.map(f => `${f.path}:${f.reason}`).sort();
        assert.deepEqual(paths, ['b.0.c:nul_byte', `d.e:invalid_unicode`, `k${LONE}:invalid_unicode`].sort());
    });

    it('reads a body nested deeper than the call stack without throwing', () => {
        let deep: unknown = 'x\u0000';
        for (let i = 0; i < 200_000; i++) deep = [deep];
        assert.equal(findJunk(deep).length, 1);
    });

    it('passes ordinary text, emoji and control characters a document may hold', () => {
        assert.deepEqual(findJunk({ t: `hello ${PAIR}\u001b[0m\f` }), []);
    });
});

describe('coarse catalog strings', () => {
    it('take the class their name says', () => {
        assert.equal(limitClassFor('title'), 'title');
        assert.equal(limitClassFor('organism_id'), 'id');
        assert.equal(limitClassFor('storage_key'), 'key');
        assert.equal(limitClassFor('content'), 'document');
        assert.equal(limitClassFor('data_base64'), 'document');
        assert.equal(limitClassFor('owner_token'), 'text');
        assert.equal(limitClassFor('something_new'), 'text');
    });

    it('an MCP tool refuses a too-long coarse field and publishes maxLength', () => {
        const shape = z.object(zodShapeFor('aimeat_agent_description_set') as Record<string, z.ZodType>);
        const json = z.toJSONSchema(shape) as { properties: Record<string, { maxLength?: number }> };
        assert.equal(json.properties.target_agent_name.maxLength, INPUT_LIMITS.name);
        const r = shape.safeParse({ target_agent_name: 'x'.repeat(INPUT_LIMITS.name + 1), description: 'd' });
        assert.equal(r.success, false);
    });
});
