/**
 * @file test/unit/credential-strategies-table.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The credential table: every credential kind a handler-verified route takes (a Dataspace
 *   Protocol participant, an outside party, an app party, a UCP platform), sent valid, expired, for
 *   another audience, malformed and missing, to every route that takes it, and the answer compared with
 *   the answer the code gave before the routes declared a credential strategy
 *   (src/auth/credential-strategies.ts; codebase analysis 2026-11-03, item B8).
 *
 *   HOW THE BEFORE IS KEPT. The fixture test/fixtures/credential-strategies/table.json was recorded by
 *   running this file with CREDENTIAL_TABLE_RECORD=1 on the code before the strategies existed, and is
 *   committed as data. Without the variable the test compares: the same status, the same refusal body
 *   (with its timestamp and request id masked), the same Cache-Control and WWW-Authenticate. A 2xx body
 *   carries new random values on every run (a new key, a new id), so for a 2xx the body's shape is
 *   compared (its keys, recursively, and each value's type).
 *
 *   The routers run in this process over a fresh SQLite storage, with the node's own JSON parser setup
 *   (src/server.ts keeps the raw body for /ucp/). The global auth middleware is not mounted: it is not
 *   what changed, and the E2E suites of each surface run the whole chain.
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial (codebase analysis 2026-11-03, item B8).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';
import { SignJWT, exportJWK } from 'jose';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { dspRouter } from '../../src/routes/dsp/index.js';
import { partiesRouter } from '../../src/routes/parties.js';
import { appPartiesRouter } from '../../src/routes/app-parties.js';
import { ucpCheckoutRouter } from '../../src/routes/ucp-checkout.js';
import { initPartyTokenKeys, mintPartyToken } from '../../src/services/parties/token.js';
import { insertParty } from '../../src/services/parties/store.js';
import { hashPartyKey } from '../../src/services/parties/keys.js';
import { changeAppParties } from '../../src/services/app-parties/store.js';
import type { PartyRecord } from '../../src/services/parties/contract.js';
import type { AppPartyRecord } from '../../src/services/app-parties/contract.js';
import { clearDidCache } from '../../src/services/dataspace/did-resolve.js';

const RECORD = process.env.CREDENTIAL_TABLE_RECORD === '1';
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, '..', 'fixtures', 'credential-strategies', 'table.json');

const NODE = 'node-cs';
const OWNER = 'alice';
const OWNER_GHII = `${OWNER}@${NODE}`;
const APP = 'notes.html';
const OTHER_APP = 'other.html';
const PARTY_KEY = 'party-key-of-matti-0123456789abcdef';
const STOPPED_KEY = 'party-key-of-pekka-0123456789abcdef';
const STATIC_TOKEN = 'static-secret-of-consumer-x';

type Row = { id: string; status: number; cacheControl: string | null; wwwAuthenticate: string | null; body: unknown };
type Cred = { name: string; headers: () => Promise<Record<string, string>>; tweak?: (c: AimeatConfig) => () => void };
type Route = { method: string; path: string; body?: unknown };

let storage: Storage & { close?: () => void | Promise<void> };
let config: AimeatConfig;
let base = '';
let didOrigin = '';
const servers: Server[] = [];
let partyKeys: { privateKey: CryptoKey; publicKey: CryptoKey };
let dcpKey: { privateKey: CryptoKey; publicKey: CryptoKey };
let did = '';

const ed = async () => await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as { privateKey: CryptoKey; publicKey: CryptoKey };
const listen = async (app: express.Express): Promise<{ server: Server; origin: string }> => {
    const server = createServer(app);
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
    servers.push(server);
    return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

const now = () => new Date().toISOString();
function party(name: string, uid: string, keyId: string, key: string, status: 'active' | 'stopped'): PartyRecord {
    return {
        uid, name, displayName: name, kind: 'program', status, createdAt: now(), createdBy: OWNER_GHII,
        keys: [{ id: keyId, hash: hashPartyKey(key), createdAt: now(), lastUsedAt: null }], failedAttempts: 0, lastSeenAt: null,
    };
}
function appParty(name: string, uid: string, status: AppPartyRecord['status'], epoch: number): AppPartyRecord {
    return {
        uid, name, displayName: name, kind: 'person', status, createdAt: now(), createdBy: OWNER_GHII, keys: [], failedAttempts: 0,
        lastSeenAt: null, app: `${OWNER}/${APP}`, emailHash: `hash-${name}`, verifiedAt: now(), link: null, epoch,
    };
}

/** A party token signed with the node's party key, `expSecondsFromNow` seconds from now (negative: already expired). */
async function partyJwt(claims: Record<string, unknown>, expSecondsFromNow: number): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({ typ: 'party', ...claims }).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setIssuedAt(iat - 3600).setExpirationTime(iat + expSecondsFromNow).sign(partyKeys.privateKey);
    return `aimeat_party_${jwt}`;
}
let jti = 0;
/** A DCP self-issued token of the test DID, addressed to `aud`, expiring `expSecondsFromNow` from now. */
async function dcpJwt(aud: string, expSecondsFromNow: number): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    return new SignJWT({ jti: `jti-${process.pid}-${++jti}` }).setProtectedHeader({ alg: 'EdDSA', kid: `${did}#key-1` })
        .setIssuer(did).setSubject(did).setAudience(aud).setIssuedAt(iat - 3600).setExpirationTime(iat + expSecondsFromNow)
        .sign(dcpKey.privateKey);
}
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

/** Mask what changes on every run: the envelope's time and request id, the test DID server's port. */
function maskRefusal(v: unknown): unknown {
    if (typeof v === 'string') return v.replace(/127\.0\.0\.1(%3A|:)\d+/g, '127.0.0.1$1<port>');
    if (Array.isArray(v)) return v.map(maskRefusal);
    if (v && typeof v === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, x] of Object.entries(v)) out[k] = k === 'timestamp' || k === 'request_id' ? '<masked>' : maskRefusal(x);
        return out;
    }
    return v;
}
/** The shape of a 2xx body: keys, recursively, and each leaf's type. */
function shapeOf(v: unknown): unknown {
    if (Array.isArray(v)) return v.length ? [shapeOf(v[0])] : [];
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, shapeOf((v as Record<string, unknown>)[k])]));
    return v === null ? 'null' : typeof v;
}

async function send(route: Route, cred: Cred): Promise<Row> {
    const restore = cred.tweak?.(config);
    try {
        const headers: Record<string, string> = { ...(await cred.headers()) };
        if (route.body !== undefined) headers['Content-Type'] = 'application/json';
        const res = await fetch(`${base}${route.path}`, {
            method: route.method, headers, ...(route.body !== undefined ? { body: JSON.stringify(route.body) } : {}),
        });
        const text = await res.text();
        let body: unknown = text;
        try { body = JSON.parse(text); } catch { /* a non-JSON body is compared as text */ }
        const ok = res.status >= 200 && res.status < 300;
        return {
            id: `${route.method} ${route.path}${route.body !== undefined ? ` ${JSON.stringify(route.body)}` : ''} :: ${cred.name}`, status: res.status,
            cacheControl: res.headers.get('cache-control'), wwwAuthenticate: res.headers.get('www-authenticate'),
            body: ok ? shapeOf(body) : maskRefusal(body),
        };
    } finally { restore?.(); }
}

const off = <K extends keyof AimeatConfig>(key: K, value: AimeatConfig[K]) => (c: AimeatConfig) => {
    const was = c[key];
    c[key] = value;
    return () => { c[key] = was; };
};

// ── The routes and the credentials each family takes ──

const PID = 'urn:uuid:4c1f0b3e-0000-4000-8000-000000000001';
const DSP_ROUTES: Route[] = [
    { method: 'POST', path: '/dsp/2025-1/catalog/request', body: { '@context': ['https://w3id.org/dspace/2025/1/context.jsonld'], '@type': 'CatalogRequestMessage', filter: [] } },
    { method: 'GET', path: '/dsp/2025-1/catalog/datasets/urn:aimeat:dataset:alice:budget' },
    { method: 'POST', path: '/dsp/2025-1/negotiations/request', body: {} },
    { method: 'GET', path: `/dsp/2025-1/negotiations/${PID}` },
    { method: 'POST', path: `/dsp/2025-1/negotiations/${PID}/request`, body: {} },
    { method: 'POST', path: `/dsp/2025-1/negotiations/${PID}/events`, body: {} },
    { method: 'POST', path: `/dsp/2025-1/negotiations/${PID}/agreement/verification`, body: {} },
    { method: 'POST', path: `/dsp/2025-1/negotiations/${PID}/termination`, body: {} },
    { method: 'POST', path: '/dsp/2025-1/transfers/request', body: {} },
    { method: 'GET', path: `/dsp/2025-1/transfers/${PID}` },
    { method: 'POST', path: `/dsp/2025-1/transfers/${PID}/start`, body: {} },
    { method: 'POST', path: `/dsp/2025-1/transfers/${PID}/completion`, body: {} },
    { method: 'POST', path: `/dsp/2025-1/transfers/${PID}/suspension`, body: {} },
    { method: 'POST', path: `/dsp/2025-1/transfers/${PID}/termination`, body: {} },
];
const DSP_CREDS: Cred[] = [
    { name: 'missing', headers: async () => ({}) },
    { name: 'static valid', headers: async () => ({ Authorization: `Bearer ${STATIC_TOKEN}` }) },
    { name: 'static unknown', headers: async () => ({ Authorization: 'Bearer not-a-static-token' }) },
    { name: 'dcp valid', headers: async () => ({ Authorization: `Bearer ${await dcpJwt('did:web:node.example.com', 300)}` }) },
    { name: 'dcp expired', headers: async () => ({ Authorization: `Bearer ${await dcpJwt('did:web:node.example.com', -3600)}` }) },
    { name: 'dcp wrong audience', headers: async () => ({ Authorization: `Bearer ${await dcpJwt('did:web:elsewhere.example', 300)}` }) },
    { name: 'party credential (another kind)', headers: async () => ({ Authorization: basic(`${OWNER}/matti`, PARTY_KEY) }) },
    { name: 'dataspace off', headers: async () => ({ Authorization: `Bearer ${STATIC_TOKEN}` }), tweak: off('dataspaceEnabled', false) },
];

// rotate last: it replaces the key the valid credentials name, which every later row would see.
const PARTY_ROUTES: Route[] = [
    { method: 'GET', path: '/v1/parties/me' },
    { method: 'GET', path: '/v1/parties/me/shares/s-unknown/connection' },
    { method: 'POST', path: '/v1/parties/me/shares/s-unknown/accept', body: {} },
    { method: 'POST', path: '/v1/parties/me/shares/s-unknown/decline', body: {} },
    { method: 'POST', path: '/v1/parties/me/shares/s-unknown/accept', body: { extra: true } },
    { method: 'POST', path: '/v1/parties/me/keys/rotate', body: {} },
];
const PARTY_CREDS: Cred[] = [
    { name: 'missing', headers: async () => ({}) },
    { name: 'basic valid', headers: async () => ({ Authorization: basic(`${OWNER}/matti`, PARTY_KEY) }) },
    { name: 'basic wrong key', headers: async () => ({ Authorization: basic(`${OWNER}/matti`, 'wrong-key') }) },
    { name: 'basic unknown party', headers: async () => ({ Authorization: basic(`${OWNER}/nobody`, PARTY_KEY) }) },
    { name: 'basic no colon', headers: async () => ({ Authorization: `Basic ${Buffer.from('alice/matti').toString('base64')}` }) },
    { name: 'basic malformed user', headers: async () => ({ Authorization: basic('alice', PARTY_KEY) }) },
    { name: 'basic stopped party', headers: async () => ({ Authorization: basic(`${OWNER}/pekka`, STOPPED_KEY) }) },
    { name: 'token valid', headers: async () => ({ Authorization: `Bearer ${await mintPartyToken({ owner: OWNER, uid: 'p-matti', kid: 'k-matti' })}` }) },
    { name: 'token expired', headers: async () => ({ Authorization: `Bearer ${await partyJwt({ owner: OWNER, uid: 'p-matti', kid: 'k-matti' }, -60)}` }) },
    { name: 'token of an app party (another audience)', headers: async () => ({ Authorization: `Bearer ${await mintPartyToken({ owner: OWNER, uid: 'ap-liisa', kid: 'app', app: `${OWNER}/${APP}`, ep: 0 })}` }) },
    { name: 'token not signed here', headers: async () => ({ Authorization: 'Bearer aimeat_party_e30.e30.AAAA' }) },
    { name: 'node bearer (another kind)', headers: async () => ({ Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.AAAA' }) },
];

// signout last: it moves the epoch, which ends every token the valid rows send.
const APP_PARTY_ROUTES: Route[] = [
    { method: 'GET', path: `/v1/apps/${OWNER}/${APP}/parties/me` },
    { method: 'GET', path: `/v1/apps/${OWNER}/${APP}/party-data/notes` },
    { method: 'PUT', path: `/v1/apps/${OWNER}/${APP}/party-data/notes`, body: { value: { text: 'hello' } } },
    { method: 'PUT', path: `/v1/apps/${OWNER}/${APP}/party-data/notes`, body: { wrong: 1 } },
    { method: 'DELETE', path: `/v1/apps/${OWNER}/${APP}/party-data/notes` },
    { method: 'GET', path: `/v1/apps/${OWNER}/missing.html/parties/me` },
    { method: 'GET', path: `/v1/apps/${OWNER}/bad..name/parties/me` },
    { method: 'POST', path: `/v1/apps/${OWNER}/${APP}/parties/signout`, body: { extra: 1 } },
    { method: 'POST', path: `/v1/apps/${OWNER}/${APP}/parties/signout`, body: {} },
];
const appToken = (claims: Partial<{ uid: string; app: string; ep: number; owner: string }> = {}) =>
    mintPartyToken({ owner: claims.owner ?? OWNER, uid: claims.uid ?? 'ap-liisa', kid: 'app', app: claims.app ?? `${OWNER}/${APP}`, ep: claims.ep ?? 0 });
const APP_PARTY_CREDS: Cred[] = [
    { name: 'missing', headers: async () => ({}) },
    { name: 'token valid', headers: async () => ({ Authorization: `Bearer ${await appToken()}` }) },
    { name: 'token valid, app origin', headers: async () => ({ Authorization: `Bearer ${await appToken()}`, Origin: 'https://node.example.com' }) },
    { name: 'token valid, foreign origin', headers: async () => ({ Authorization: `Bearer ${await appToken()}`, Origin: 'https://evil.example' }) },
    { name: 'token expired', headers: async () => ({ Authorization: `Bearer ${await partyJwt({ owner: OWNER, uid: 'ap-liisa', kid: 'app', app: `${OWNER}/${APP}`, ep: 0 }, -60)}` }) },
    { name: 'token for another app', headers: async () => ({ Authorization: `Bearer ${await appToken({ app: `${OWNER}/${OTHER_APP}` })}` }) },
    // On the missing.html row this is the token of that app, which reaches the "no such app" answer.
    { name: 'token naming missing.html', headers: async () => ({ Authorization: `Bearer ${await appToken({ app: `${OWNER}/missing.html` })}` }) },
    { name: 'outside party token (another audience)', headers: async () => ({ Authorization: `Bearer ${await mintPartyToken({ owner: OWNER, uid: 'p-matti', kid: 'k-matti' })}` }) },
    { name: 'token of an old epoch', headers: async () => ({ Authorization: `Bearer ${await appToken({ ep: 7 })}` }) },
    { name: 'token of a stopped party', headers: async () => ({ Authorization: `Bearer ${await appToken({ uid: 'ap-ville' })}` }) },
    { name: 'basic party credential (another kind)', headers: async () => ({ Authorization: basic(`${OWNER}/matti`, PARTY_KEY) }) },
    { name: 'registration off', headers: async () => ({ Authorization: `Bearer ${await appToken()}` }), tweak: off('partySelfRegistration', 'off') },
];

const UCP = '/ucp/2026-08-25';
const UCP_ROUTES: Route[] = [
    { method: 'POST', path: `${UCP}/checkout-sessions`, body: { line_items: [] } },
    { method: 'GET', path: `${UCP}/checkout-sessions/cs_unknown` },
    { method: 'PUT', path: `${UCP}/checkout-sessions/cs_unknown`, body: { line_items: [] } },
    { method: 'POST', path: `${UCP}/checkout-sessions/cs_unknown/complete`, body: {} },
    { method: 'POST', path: `${UCP}/checkout-sessions/cs_unknown/cancel`, body: {} },
    { method: 'GET', path: `${UCP}/orders/ord_unknown` },
];
const PROFILE = 'profile="https://platform.example/profile.json"';
const UCP_CREDS: Cred[] = [
    { name: 'missing UCP-Agent', headers: async () => ({}) },
    { name: 'profile, unsigned', headers: async () => ({ 'UCP-Agent': PROFILE }) },
    { name: 'profile not https', headers: async () => ({ 'UCP-Agent': 'profile="ftp://platform.example/p"' }) },
    { name: 'signed, profile on a private address', headers: async () => ({ 'UCP-Agent': 'profile="https://127.0.0.1/profile.json"', 'Signature-Input': 'sig1=("@method");keyid="k1";alg="ed25519"', Signature: 'sig1=:AAAA:' }) },
    { name: 'commerce off', headers: async () => ({ 'UCP-Agent': PROFILE }), tweak: off('commerceEnabled', false) },
    { name: 'party credential (another kind)', headers: async () => ({ Authorization: basic(`${OWNER}/matti`, PARTY_KEY) }) },
];

const TABLE: Array<{ family: string; routes: Route[]; creds: Cred[] }> = [
    { family: 'dsp-participant', routes: DSP_ROUTES, creds: DSP_CREDS },
    { family: 'party', routes: PARTY_ROUTES, creds: PARTY_CREDS },
    { family: 'app-party', routes: APP_PARTY_ROUTES, creds: APP_PARTY_CREDS },
    { family: 'ucp-platform', routes: UCP_ROUTES, creds: UCP_CREDS },
];

beforeAll(async () => {
    partyKeys = await ed();
    dcpKey = await ed();
    initPartyTokenKeys(partyKeys.privateKey, partyKeys.publicKey);

    // The DCP participant's did:web document, served from this process.
    const didApp = express();
    let didDoc: Record<string, unknown> = {};
    didApp.get('/.well-known/did.json', (_req, res) => { res.json(didDoc); });
    const didServer = await listen(didApp);
    didOrigin = didServer.origin;
    did = `did:web:${encodeURIComponent(didOrigin.slice('http://'.length))}`;
    didDoc = {
        id: did,
        verificationMethod: [{ id: `${did}#key-1`, type: 'JsonWebKey2020', controller: did, publicKeyJwk: await exportJWK(dcpKey.publicKey) }],
        capabilityInvocation: [`${did}#key-1`],
    };
    clearDidCache();

    storage = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as typeof storage;
    const { config: loaded } = loadConfig({});
    config = {
        ...loaded, nodeId: NODE, baseUrl: 'https://node.example.com',
        dataspaceEnabled: true, dataspaceAuth: 'dcp,static', dataspaceStaticTokens: `urn:x:consumer=${STATIC_TOKEN}`,
        dataspaceCallbackOrigins: didOrigin, dataspaceParticipantId: '', dataspaceTrustedIssuers: '', dataspaceTckMode: false,
        commerceEnabled: true, partySelfRegistration: 'on', contentAccess: 'open',
    } as AimeatConfig;
    setThisNodeId(NODE);

    expect(await insertParty(storage, OWNER_GHII, party('matti', 'p-matti', 'k-matti', PARTY_KEY, 'active'))).toBe('ok');
    expect(await insertParty(storage, OWNER_GHII, party('pekka', 'p-pekka', 'k-pekka', STOPPED_KEY, 'stopped'))).toBe('ok');
    for (const filename of [APP, OTHER_APP]) {
        await storage.createApp({
            ownerGaii: OWNER_GHII, ownerName: OWNER, filename, versionNumber: 1,
            manifest: { name: filename, description: 'Credential table fixture', version: '1', category: 'tool', tags: [], authorDisplay: OWNER, usesCortex: [] },
            mimeType: 'text/html', size: 4, data: Buffer.from('test'), createdAt: now(),
        } as never);
    }
    await changeAppParties(storage, OWNER_GHII, `${OWNER}/${APP}`, () => ({
        registration: { state: 'open', role: 'member', updatedAt: now() },
        parties: [appParty('liisa', 'ap-liisa', 'active', 0), appParty('ville', 'ap-ville', 'stopped', 0)],
    }));

    const app = express();
    app.set('trust proxy', false);
    app.use((req, res, next) => {
        const keepRaw = req.path.startsWith('/ucp/')
            ? (r: express.Request, _res: express.Response, buf: Buffer) => { (r as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buf); }
            : undefined;
        express.json({ limit: '1mb', ...(keepRaw ? { verify: keepRaw as never } : {}) })(req, res, next);
    });
    app.use(dspRouter(config, storage));
    app.use(partiesRouter(config, storage));
    app.use(appPartiesRouter(config, storage));
    app.use(ucpCheckoutRouter(config, storage));
    base = (await listen(app)).origin;
}, 60_000);

afterAll(async () => {
    for (const s of servers) await new Promise<void>(r => s.close(() => r()));
    await storage?.close?.();
});

describe('credential table: every credential kind on every route that verifies one', () => {
    it('answers each row exactly as the code before the credential strategies did', async () => {
        const rows: Row[] = [];
        for (const { routes, creds } of TABLE) {
            for (const route of routes) for (const cred of creds) rows.push(await send(route, cred));
        }
        if (RECORD) {
            mkdirSync(dirname(FIXTURE), { recursive: true });
            writeFileSync(FIXTURE, JSON.stringify(rows, null, 2) + '\n', 'utf-8');
            return;
        }
        expect(existsSync(FIXTURE), `${FIXTURE} is missing: record it on the code before the change`).toBe(true);
        const before = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as Row[];
        expect(rows.map(r => r.id)).toEqual(before.map(r => r.id));
        for (let i = 0; i < rows.length; i++) expect(rows[i], rows[i]!.id).toEqual(before[i]);
    }, 120_000);
});
