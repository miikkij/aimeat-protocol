/**
 * @file test/unit/csm-infer.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description inferCsmFromSample (services/csm/infer.ts): the CSM a draft infers from one sample
 *   parses with parseCsm, validates with validateCsm, and compiles to a JSON Schema the sample itself
 *   passes, with the types the rules name: integer and number, boolean, date-time with a zone, date,
 *   nested objects with every property required, arrays from their first element, a null key optional,
 *   and no guessed limits.
 * @version-history
 *   v1.0.0 — 2026-11-07 — Initial (CSM draft from a sample; Jouni, 2026-11-07).
 */
import { describe, it, expect } from 'vitest';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { inferCsmFromSample, inferField, MAX_DEPTH } from '../../src/services/csm/infer.js';
import { parseCsm, validateCsm, csmToJsonSchema } from '../../src/services/csm-parser.js';

const SAMPLE = {
    device: 'ruuvi-01',
    temperature: 21.5,
    humidity: 40,
    battery_ok: true,
    measured_at: '2026-11-07T10:00:00Z',
    day: '2026-11-07',
    location: { room: 'kitchen', floor: 2 },
    readings: [{ t: 21.4, at: '2026-11-07T09:59:00+02:00' }],
    tags: ['home', 'sensor'],
    note: null,
};

function compiles(sample: unknown) {
    const inferred = inferCsmFromSample('alice.ruuvi', sample);
    if (!inferred.ok) throw new Error(inferred.error);
    const def = parseCsm(inferred.yaml);
    return { inferred, def, schema: csmToJsonSchema(def) };
}

describe('inferCsmFromSample', () => {
    it('answers YAML that parses and validates, under the name it was given', () => {
        const { def } = compiles(SAMPLE);
        expect(validateCsm(def)).toEqual([]);
        expect(def.service.name).toBe('alice.ruuvi');
        expect(def.service.type).toBe('data');
        expect(def.schemaMode).toBe('open');
    });

    it('types each value by the rules', () => {
        const { def } = compiles(SAMPLE);
        const r = def.dataSchema.required;
        expect(r.device).toEqual({ type: 'string' });
        expect(r.temperature).toEqual({ type: 'number' });
        expect(r.humidity).toEqual({ type: 'integer' });
        expect(r.battery_ok).toEqual({ type: 'boolean' });
        expect(r.measured_at).toEqual({ type: 'string', format: 'date-time' });
        expect(r.day).toEqual({ type: 'string', format: 'date' });
        expect(r.location).toEqual({ type: 'object', properties: { room: { type: 'string' }, floor: { type: 'integer' } } });
        expect(r.tags).toEqual({ type: 'array', items: { type: 'string' } });
        expect((r.readings!.items as { properties: Record<string, unknown> }).properties.at).toEqual({ type: 'string', format: 'date-time' });
    });

    it('makes every present key required and a null one optional, with no guessed limits', () => {
        const { def, schema } = compiles(SAMPLE);
        expect(Object.keys(def.dataSchema.required).sort()).toEqual(
            ['battery_ok', 'day', 'device', 'humidity', 'location', 'measured_at', 'readings', 'tags', 'temperature']);
        expect(Object.keys(def.dataSchema.optional)).toEqual(['note']);
        expect((schema.properties as Record<string, Record<string, unknown>>).location!.required).toEqual(['room', 'floor']);
        expect(JSON.stringify(schema)).not.toMatch(/minLength|maxLength|minimum|maximum|minItems|maxItems|enum/);
    });

    it('compiles to a schema the sample passes and a wrong type fails', () => {
        const { schema } = compiles(SAMPLE);
        const ajv = new Ajv2020({ allErrors: true });
        (addFormats as unknown as (a: unknown) => void)(ajv);
        const check = ajv.compile(schema);
        const withoutNull: Record<string, unknown> = { ...SAMPLE };
        delete withoutNull.note;
        expect(check(withoutNull)).toBe(true);
        expect(check({ ...withoutNull, humidity: 'forty' })).toBe(false);
        expect(check({ ...withoutNull, measured_at: 'yesterday' })).toBe(false);
        const missing = { ...withoutNull };
        delete missing.device;
        expect(check(missing)).toBe(false);
    });

    it('keeps a date-time without a zone a plain string, since the schema check would refuse it', () => {
        expect(inferField('2026-11-07T10:00:00')).toEqual({ type: 'string' });
        expect(inferField('2026-11-07T10:00:00.123+02:00')).toEqual({ type: 'string', format: 'date-time' });
    });

    it('answers an empty array as an array of anything, and stops nesting at MAX_DEPTH', () => {
        expect(inferField([])).toEqual({ type: 'array' });
        let deep: Record<string, unknown> = { leaf: 1 };
        for (let i = 0; i < MAX_DEPTH + 2; i++) deep = { inner: deep };
        expect(() => compiles({ deep })).not.toThrow();
        expect(inferField({ a: 1 }, MAX_DEPTH)).toEqual({ type: 'object' });
    });

    it('takes a service type and a description when given', () => {
        const out = inferCsmFromSample('alice.x', { a: 1 }, { serviceType: 'telemetry', description: 'Sensor rows' });
        expect(out.ok && parseCsm(out.yaml).service).toMatchObject({ type: 'telemetry', description: 'Sensor rows' });
    });

    it('refuses a sample that is not an object, or has no value that is not null', () => {
        for (const bad of [null, 1, 'x', [1, 2], {}, { a: null }]) {
            const out = inferCsmFromSample('alice.x', bad);
            expect(out.ok).toBe(false);
        }
    });
});
