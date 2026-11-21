/**
 * @file test/unit/sse-keepalive-contract.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The keepalive of GET /v1/events, as the code sends it and as the two texts an outside
 *   client reads describe it. The stream sends the named event `event: alive` (routes/sse.ts), which the
 *   page listens for (public/lib/live-updates.js); openapi.yaml and llms-full-template.txt said
 *   `:keepalive` comments, one every 15 s and the other every 30 s, and nothing compared them.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (wish-sopimuskorjaus-tapahtumavirran-keepalive-ja-muistilistauksen).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const AIMEAT = join(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(join(AIMEAT, rel), 'utf8');

/** The description block of the /v1/events path in openapi.yaml. */
function eventsContract(): string {
    const spec = read('../openapi.yaml');
    const start = spec.indexOf('\n  /v1/events:\n');
    expect(start, 'openapi.yaml has the /v1/events path').toBeGreaterThan(0);
    const next = spec.indexOf('\n  /v1/', start + 5);
    return spec.slice(start, next > 0 ? next : undefined);
}

describe('GET /v1/events keepalive', () => {
    it('the node sends the named event the page listens for, every 15 s', () => {
        const sse = read('src/routes/sse.ts');
        expect(sse).toContain("res.write('event: alive\\ndata: {}\\n\\n')");
        expect(sse).toMatch(/\}, 15_000\);/);
        expect(read('public/lib/live-updates.js')).toMatch(/['"]alive['"]/);
    });

    it('openapi.yaml describes that event and no keepalive comment', () => {
        const contract = eventsContract();
        expect(contract).toContain('event: alive');
        expect(contract).toContain('15 s');
        expect(contract).not.toContain(':keepalive');
    });

    it('llms-full-template.txt describes that event and no keepalive comment', () => {
        const llms = read('public/llms-full-template.txt');
        const at = llms.indexOf('/v1/events?ticket=');
        expect(at).toBeGreaterThan(0);
        const block = llms.slice(at, at + 400);
        expect(block).toContain('event: alive');
        expect(block).not.toContain(':keepalive');
    });
});
