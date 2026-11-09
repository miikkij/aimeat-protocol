/**
 * @file scripts/perf/measure-server.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Times every request the Home, the Memory page and the Data Wallet make on first load,
 *   as the sandbox's first owner, and joins each with the per-request query trace that
 *   scripts/perf/trace-preload.mjs writes in the node: wall time, bytes on the wire, bytes decoded,
 *   statement count and time in the database. The first round after a node start is the cold one;
 *   the median of the later rounds is the warm one.
 *
 *   The URL lists are the requests the SPA sends, read from public/spa.html and the views on
 *   2026-11-09 (the Home's blocks, the profile shell, the Memory tab, the Data Wallet's hooks). A
 *   request the browser makes that is missing here is found by the browser measurement, which logs
 *   the real network list.
 * @structure PAGES · run() · join with trace · report
 * @usage
 *   pnpm exec tsx scripts/perf/measure-server.ts --runs=5                       # SQLite sandbox
 *   AIMEAT_SANDBOX_DB_URL=postgresql://… pnpm exec tsx scripts/perf/measure-server.ts --runs=5
 * @version-history
 *   v1.0.0 — 2026-11-09 — Initial, for the performance measurement at real account size.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AIMEAT = resolve(HERE, '..', '..');
const PG = !!process.env.AIMEAT_SANDBOX_DB_URL;
const BACKEND = PG ? 'postgres-kysely' : 'sqlite';
const STATE = JSON.parse(readFileSync(join(AIMEAT, PG ? '.sandbox-pg.json' : '.sandbox.json'), 'utf8')) as {
    baseUrl: string; owners: Array<{ name: string; token: string }>;
};
const TRACE = process.env.AIMEAT_PERF_TRACE_FILE ?? join(AIMEAT, PG ? '.perf-trace-pg.jsonl' : '.perf-trace-sqlite.jsonl');
const RUNS = Number((process.argv.find(a => a.startsWith('--runs=')) ?? '--runs=5').slice(7));
const ONLY = (process.argv.find(a => a.startsWith('--page=')) ?? '').slice(7);
const owner = STATE.owners[0].name;

const PAGES: Record<string, string[]> = {
    shell: [
        '/v1/site/header-nav', '/v1/wallet', '/changelog.json', '/v1/memory/home.news?soft=1',
        '/v1/apps?own=true&limit=1', '/v1/notifications', '/v1/open-items/count',
    ],
    home: [
        '/v1/home/state', '/v1/site/layout/home', '/v1/site/layout/home-onboarding', '/v1/chat/status',
        `/v1/organisms?member=${owner}&include=counts`, '/v1/memory/onboarding.hello_mcp?soft=1',
        '/v1/prompts/home-ideas?lang=en', '/v1/prompts/welcome-mat?lang=en', '/v1/chat-instances',
        '/v1/overview?range=7d&limit=2', '/v1/messages/inbox?per_page=1', '/v1/messages/conversations',
        '/v1/memory/home.prefs?soft=1', '/v1/home/agents?limit=5', '/v1/owner/usage', '/v1/knowledge/tab',
        '/v1/memory/app-catalog.favorites?soft=1', '/v1/apps?limit=200&offset=0', '/v1/apps?limit=200&offset=200',
        '/v1/memory?prefix=onboarding.', '/v1/home/feed', '/v1/open-items', '/v1/prompts/open-items',
    ],
    profileShell: [
        '/v1/owner/home', '/', '/data/places.json', '/v1/memory/sidebar.pins?soft=1', '/v1/messages/inbox',
    ],
    memory: [
        '/v1/memory/tab', '/v1/shares', '/v1/memory?include=meta', '/v1/memory/files', '/v1/memory/files?count=true',
        '/v1/consent', '/v1/memory',
    ],
    dataWallet: [
        '/v1/data-wallet?days=30&entry_limit=20', '/v1/ghii/me', '/v1/classification/policy?level=owner',
        '/v1/classification/audit?level=owner&limit=50', '/v1/classification/labels?pending=true&limit=100',
        '/v1/classification/labels?limit=50', '/v1/classification/exceptions?level=owner&limit=500', '/v1/content',
        '/v1/content/facts?limit=10', '/v1/content/classes', '/v1/content/proposals?status=pending',
        '/v1/parties', '/v1/dataproducts',
    ],
};

interface Sample { ms: number; status: number; decoded: number }
interface TraceLine { url: string; ms: number; bytes: number; q: number; dbMs: number; rows: number; top: Array<{ n: number; ms: number; rows: number; sql: string }> }

async function one(url: string): Promise<Sample> {
    const t0 = performance.now();
    const res = await fetch(`${STATE.baseUrl}${url}`, { headers: { Authorization: `Bearer ${STATE.owners[0].token}`, 'Accept-Encoding': 'gzip, br' } });
    const body = await res.arrayBuffer();
    return { ms: performance.now() - t0, status: res.status, decoded: body.byteLength };
}

function median(xs: number[]): number { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }

async function main(): Promise<void> {
    const traceStart = existsSync(TRACE) ? statSync(TRACE).size : 0;
    const urls = Object.entries(PAGES).filter(([p]) => !ONLY || ONLY.split(',').includes(p));
    const samples = new Map<string, Sample[]>();
    for (let r = 0; r < RUNS; r++) {
        for (const [, list] of urls) for (const u of list) {
            const s = await one(u);
            samples.set(u, [...(samples.get(u) ?? []), s]);
        }
    }
    await new Promise(r => setTimeout(r, 300));
    const lines = existsSync(TRACE)
        // The offset is in bytes, so the slice is taken from the buffer before decoding.
        ? readFileSync(TRACE).subarray(traceStart).toString('utf8').split('\n').filter(Boolean)
            .flatMap(l => { try { return [JSON.parse(l) as TraceLine & { bg?: boolean }]; } catch { return []; } }).filter(l => !l.bg)
        : [];
    const traced = new Map<string, TraceLine[]>();
    for (const l of lines) traced.set(l.url, [...(traced.get(l.url) ?? []), l]);

    const out: Record<string, unknown[]> = {};
    console.log(`\n${BACKEND}, ${RUNS} rounds, ${STATE.baseUrl}`);
    for (const [page, list] of urls) {
        console.log(`\n== ${page}`);
        console.log('  cold ms  warm ms  status  wire kB  json kB  queries  db ms  url');
        let sumCold = 0, sumWarm = 0, sumQ = 0, sumKb = 0;
        out[page] = [];
        for (const u of list) {
            const s = samples.get(u) ?? [];
            const t = traced.get(u) ?? [];
            const cold = s[0]?.ms ?? 0; const warm = median(s.slice(1).map(x => x.ms));
            const q = t[0]?.q ?? 0; const dbMs = median(t.slice(1).map(x => x.dbMs)); const wire = (t[0]?.bytes ?? 0) / 1024;
            sumCold += cold; sumWarm += warm; sumQ += q; sumKb += (s[0]?.decoded ?? 0) / 1024;
            console.log(`  ${cold.toFixed(0).padStart(7)}  ${warm.toFixed(0).padStart(7)}  ${String(s[0]?.status).padStart(6)}  ${wire.toFixed(1).padStart(7)}  ${((s[0]?.decoded ?? 0) / 1024).toFixed(1).padStart(7)}  ${String(q).padStart(7)}  ${dbMs.toFixed(0).padStart(5)}  ${u}`);
            out[page].push({ url: u, coldMs: cold, warmMs: warm, status: s[0]?.status, wireKb: wire, jsonKb: (s[0]?.decoded ?? 0) / 1024, queries: q, warmQueries: t[1]?.q, dbMsWarm: dbMs, top: t[1]?.top ?? t[0]?.top ?? [] });
        }
        console.log(`  ${sumCold.toFixed(0).padStart(7)}  ${sumWarm.toFixed(0).padStart(7)}  (sum if sent one after another)  ${sumKb.toFixed(0)} kB  ${sumQ} queries`);
    }
    mkdirSync(join(AIMEAT, '.perf'), { recursive: true });
    const file = join(AIMEAT, '.perf', `server-${BACKEND}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, JSON.stringify({ backend: BACKEND, runs: RUNS, at: new Date().toISOString(), pages: out }, null, 2));
    console.log(`\n  written ${file}`);
}

await main();
