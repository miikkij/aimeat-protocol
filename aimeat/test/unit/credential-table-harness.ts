/**
 * @file test/unit/credential-table-harness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a credential table needs besides its rows: a server on a free port, one request
 *   sent and its answer reduced to what can be compared between two runs, and the fixture of one
 *   family recorded or compared (test/unit/credential-strategies-table-2.test.ts; codebase analysis
 *   2026-11-03, decision 2 of 2026-11-05).
 *
 *   WHAT IS COMPARED. The status, the Cache-Control and WWW-Authenticate headers, and the body: a
 *   refusal's body whole, with what changes on every run masked (the envelope's time and request id,
 *   a time or a UUID inside a sentence, a port of this process); a 2xx body by its shape (keys,
 *   recursively, and each value's type), because it carries new random values on every run.
 * @structure listen · maskRefusal · shapeOf · Probe · sendProbe · compareFamily
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 2 of 2026-11-05).
 */
import { expect } from 'vitest';
import type express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Row = { id: string; status: number; cacheControl: string | null; wwwAuthenticate: string | null; body: unknown };

/** One request of the table: its stable name, and how to build it at the moment it is sent. */
export interface Probe {
    id: string;
    method: string;
    path: () => string;
    headers?: () => Promise<Record<string, string>> | Record<string, string>;
    /** A JSON body, or `{ form }` for an application/x-www-form-urlencoded one. */
    body?: () => Promise<unknown> | unknown;
    form?: () => Record<string, string>;
    /** A config change for this request only; returns its undo. */
    tweak?: () => () => void;
}

export async function listen(app: express.Express, servers: Server[]): Promise<string> {
    const server = createServer(app);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const ISO_TIME = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Mask what changes on every run: the envelope's time and request id, a time, a UUID or a local port in a sentence. */
export function maskRefusal(v: unknown): unknown {
    if (typeof v === 'string') {
        return v.replace(/127\.0\.0\.1(%3A|:)\d+/g, '127.0.0.1$1<port>').replace(ISO_TIME, '<time>').replace(UUID, '<uuid>');
    }
    if (Array.isArray(v)) return v.map(maskRefusal);
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[k] = k === 'timestamp' || k === 'request_id' ? '<masked>' : maskRefusal(x);
        return out;
    }
    return v;
}

/** The shape of a 2xx body: keys, recursively, and each leaf's type. */
export function shapeOf(v: unknown): unknown {
    if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, shapeOf((v as Record<string, unknown>)[k])]));
    return v === null ? 'null' : typeof v;
}

export async function sendProbe(base: string, p: Probe): Promise<Row> {
    const restore = p.tweak?.();
    try {
        const headers: Record<string, string> = { ...(await p.headers?.() ?? {}) };
        let body: string | undefined;
        if (p.form) {
            headers['Content-Type'] = 'application/x-www-form-urlencoded';
            body = new URLSearchParams(p.form()).toString();
        } else if (p.body) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(await p.body());
        }
        const res = await fetch(`${base}${p.path()}`, { method: p.method, headers, ...(body !== undefined ? { body } : {}) });
        const text = await res.text();
        let parsed: unknown = text;
        try { parsed = JSON.parse(text); } catch { /* a non-JSON body is compared as text */ }
        const ok = res.status >= 200 && res.status < 300;
        return {
            id: p.id, status: res.status,
            cacheControl: res.headers.get('cache-control'), wwwAuthenticate: res.headers.get('www-authenticate'),
            body: ok ? shapeOf(parsed) : maskRefusal(parsed),
        };
    } finally { restore?.(); }
}

/**
 * Send a family's probes in order and compare them with its fixture, or, when `record` is true, write
 * the fixture instead. A family is recorded on the code before its routes declare a strategy.
 */
export async function compareFamily(base: string, fixture: string, probes: Probe[], record: boolean): Promise<void> {
    const rows: Row[] = [];
    for (const p of probes) rows.push(await sendProbe(base, p));
    if (record) {
        mkdirSync(dirname(fixture), { recursive: true });
        writeFileSync(fixture, JSON.stringify(rows, null, 2) + '\n', 'utf-8');
        return;
    }
    expect(existsSync(fixture), `${fixture} is missing: record it on the code before the change`).toBe(true);
    const before = JSON.parse(readFileSync(fixture, 'utf-8')) as Row[];
    expect(rows.map(r => r.id)).toEqual(before.map(r => r.id));
    for (let i = 0; i < rows.length; i++) expect(rows[i], rows[i]!.id).toEqual(before[i]);
}
