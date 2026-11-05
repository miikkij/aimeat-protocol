/**
 * @file test/unit/credential-strategies-table-2.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The credential table, second part: the credential kinds that were still verified inside
 *   handlers after the first part (credential-strategies-table.test.ts), sent valid, absent, malformed,
 *   for another door or from another key, to every route that takes them, and each answer compared
 *   with the answer the code gave before the routes declared a credential strategy
 *   (src/auth/credential-strategies.ts; codebase analysis 2026-11-03, decision 2 of 2026-11-05).
 *
 *   The families: an intake visitor's conversation token, an EU wallet's session, an outside party
 *   buying again on EXCHANGE, a federation peer's signed message, and a package seller's or claimant's
 *   signed request.
 *
 *   HOW THE BEFORE IS KEPT. Each family has its own fixture, test/fixtures/credential-strategies/
 *   table-2/<family>.json, recorded by running this file with CREDENTIAL_TABLE_RECORD=<family> on the
 *   code before that family's routes declared a strategy, and committed as data. Without the variable
 *   every family is compared (test/unit/credential-table-harness.ts says what is compared).
 *
 *   The routers run in this process over a fresh SQLite storage with a JSON body parser, as the node
 *   parses bodies. The global auth middleware is not mounted: it is not what changed, and none of
 *   these callers carries a node session.
 * @version-history
 *   v1.0.0 — 2026-11-05 — Initial (codebase analysis 2026-11-03, decision 2 of 2026-11-05).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import { createHash, webcrypto } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SignJWT, decodeJwt } from 'jose';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage, OrganismRecord, OrganismMembershipRecord } from '../../src/storage/interface.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { setThisNodeId } from '../../src/utils/gaii.js';
import { generateKeyPair, sign, type KeyPair } from '../../src/auth/keypair.js';
import type { PeerInfo } from '../../src/services/federation.js';
import { audienceProof, deliveryProof, audienceHeaders } from '../../src/services/signed-node-request.js';
import { reactionPayload } from '../../src/services/message-reactions.js';
import { trustNoticeSignString } from '../../src/services/federation-trust-notice.js';
import { federationAuthPayload } from '../../src/services/federation-auth-payload.js';
import { signedSaleHeaders, CLAIM_PURPOSE } from '../../src/services/packages/sale/package-sale-auth.js';
import { newThreadToken, threadIdOf } from '../../src/services/intake-thread.js';
import { createRequest } from '../../src/services/docsign/records.js';
import { startWalletSignature } from '../../src/services/docsign/eudi.js';
import { callerFromAuth } from '../../src/services/caller-context.js';
import { initPartyTokenKeys, mintPartyToken } from '../../src/services/parties/token.js';
import { insertParty } from '../../src/services/parties/store.js';
import { hashPartyKey } from '../../src/services/parties/keys.js';
import type { PartyRecord } from '../../src/services/parties/contract.js';
import { federationSyncRouter } from '../../src/routes/federation-sync.js';
import { federationSettlementsRouter } from '../../src/routes/federation-settlements.js';
import { federationAuthRouter } from '../../src/routes/federation-auth.js';
import { registerPackageSaleRoutes } from '../../src/routes/package-sales.js';
import { exchangePartyBuyRouter } from '../../src/routes/exchange-party-buy.js';
import { organismsRouter } from '../../src/routes/organisms.js';
import { docsignWalletRouter } from '../../src/routes/docsign-wallet.js';
import { compareFamily, listen, sendProbe, type Probe } from './credential-table-harness.js';

/** The families to record, comma separated (CREDENTIAL_TABLE_RECORD=intake-visitor,docsign-wallet). */
const RECORDING = new Set((process.env.CREDENTIAL_TABLE_RECORD ?? '').split(',').map(s => s.trim()).filter(Boolean));
const HERE = dirname(fileURLToPath(import.meta.url));
const fixtureOf = (family: string) => join(HERE, '..', 'fixtures', 'credential-strategies', 'table-2', `${family}.json`);

const NODE = 'node-cs2';
const OWNER = 'alice';
const ALICE = `${OWNER}@${NODE}`;
const STAMP = '2026-11-05T08:00:00.000Z';
const PARTY_KEY = 'party-key-of-matti-0123456789abcdef';
const STOPPED_KEY = 'party-key-of-pekka-0123456789abcdef';

let storage: Storage & { close?: () => void | Promise<void> };
let config: AimeatConfig;
let base = '';
const servers: Server[] = [];
const peers = new Map<string, PeerInfo>();
const keys: Record<string, KeyPair> = {};
let partyKeys: { privateKey: CryptoKey; publicKey: CryptoKey };

const off = <K extends keyof AimeatConfig>(key: K, value: AimeatConfig[K]) => () => {
    const was = config[key];
    config[key] = value;
    return () => { config[key] = was; };
};
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

// ── intake visitor ────────────────────────────────────────────────────────────

const ORG = 'org-cs2';
const WS = 'ws1';
let threadToken = '';
let otherFormToken = '';

function intakeProbes(): Probe[] {
    const routes = [
        { name: 'read', path: `/v1/intake/${ORG}/${WS}/f1/thread/read` },
        { name: 'read, an ordinary form', path: `/v1/intake/${ORG}/${WS}/f2/thread/read` },
        { name: 'read, a form switched off', path: `/v1/intake/${ORG}/${WS}/f3/thread/read` },
        { name: 'read, no such form', path: `/v1/intake/${ORG}/${WS}/f9/thread/read` },
        // forget last: the valid row deletes the conversation.
        { name: 'forget', path: `/v1/intake/${ORG}/${WS}/f1/thread/forget` },
    ];
    const creds: Array<{ name: string; body: () => unknown }> = [
        { name: 'no token', body: () => ({}) },
        { name: 'token null', body: () => ({ token: null }) },
        { name: 'token a number', body: () => ({ token: 42 }) },
        { name: 'token malformed', body: () => ({ token: 'not a token' }) },
        { name: 'token unknown', body: () => ({ token: newThreadToken() }) },
        { name: 'token of another form\'s conversation', body: () => ({ token: otherFormToken }) },
        { name: 'token valid', body: () => ({ token: threadToken }) },
        { name: 'token valid, extra fields', body: () => ({ token: threadToken, text: 'x' }) },
    ];
    return routes.flatMap(r => creds.map(c => ({ id: `POST ${r.name} :: ${c.name}`, method: 'POST', path: () => r.path, body: c.body })));
}

async function seedIntake(): Promise<void> {
    for (const name of ['alice', 'bob']) {
        await storage.createGHII({ username: name, nodeId: NODE, ghii: `${name}@${NODE}`, displayName: name === 'alice' ? 'Alice Example' : 'Bob', ownerName: name, verificationLevel: 0, totpEnabled: false, createdAt: STAMP, updatedAt: STAMP } as never);
    }
    await storage.createOrganism({
        id: ORG, name: 'Org', description: 'x', type: 'project', interests: [], creatorGhii: ALICE, createdBy: ALICE, owners: [ALICE],
        admins: [ALICE], members: [ALICE], agentGaiis: [], boardId: 'b1', joinPolicy: 'invite_only', maxMembers: 10, visibility: 'private',
        moderationConfig: { flagsEnabled: false, autoHideThreshold: 5, appealsEnabled: false },
        memoryNamespace: `organism.${ORG}`, createdAt: STAMP, updatedAt: STAMP,
    } as OrganismRecord);
    await storage.createMembership({ id: 'm-alice', organismId: ORG, ghii: 'alice', role: 'creator', status: 'active', joinedAt: STAMP } as OrganismMembershipRecord);
    const put = (key: string, value: unknown) => storage.setMemory({
        key, ownerGaii: ALICE, value, visibility: 'owner', tags: [], ttlHours: null, version: 1, createdAt: STAMP, updatedAt: STAMP,
    } as never);
    await put(`organism.${ORG}.meta.workspaces`, { workspaces: [{ id: WS, name: 'Desk', createdAt: STAMP, createdBy: 'alice' }] });
    await put(`organism.${ORG}.w.${WS}.meta.manifest`, { manifestVersion: '1', name: 'Desk', kind: 'project', objectTypes: [] });
    const thread = { replyNamespace: 'replies', signalNamespace: 'signals', maxTurns: 10, maxChars: 2000, ttlDays: 30, maxAgentTurnsPerDay: 50 };
    const form = (formId: string, extra: Record<string, unknown>) => ({ formId, namespace: 'threads', ownerGhii: ALICE, enabled: true, honeypotField: null, maxPerDay: null, thread, ...extra });
    await put(`organism.${ORG}.w.${WS}.meta.intake.f1`, form('f1', {}));
    await put(`organism.${ORG}.w.${WS}.meta.intake.f2`, form('f2', { thread: null }));
    await put(`organism.${ORG}.w.${WS}.meta.intake.f3`, form('f3', { enabled: false }));
    threadToken = newThreadToken();
    otherFormToken = newThreadToken();
    for (const [token, formId] of [[threadToken, 'f1'], [otherFormToken, 'f7']] as const) {
        const id = threadIdOf(token)!;
        await put(`organism.${ORG}.w.${WS}.threads.${id}.latest`, { id, form_id: formId, started_at: STAMP, updated_at: STAMP, turns: [{ text: 'hello', at: STAMP }], signalled_turn: 1 });
    }
    await put(`organism.${ORG}.w.${WS}.replies.${threadIdOf(threadToken)}.latest`, { id: threadIdOf(threadToken), turns: [{ text: 'hi back', at: STAMP }], handler: 'agent' });
}

// ── docsign wallet ────────────────────────────────────────────────────────────

const wallet = { s1: { id: '', state: '', doc: '' }, s2: { id: '', state: '' }, s3: { id: '', state: '' } };

async function seedWallet(): Promise<void> {
    const pdf = Buffer.from('%PDF-1.4\n% credential table\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    const caller = callerFromAuth({ sub: OWNER, owner: OWNER, roles: ['owner'], scopes: ['*'] }, NODE, storage);
    const ctx = { storage, config };
    const rec = await createRequest(ctx, caller, {
        title: 'Agreement', parties: [ALICE],
        document: { sha256: createHash('sha256').update(pdf).digest('hex'), name: 'agreement.pdf', size: pdf.length, mediaType: 'application/pdf' },
    });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await startWalletSignature(ctx, caller, rec.id, { bytes: pdf })).session_id);
    // What a wallet learns from the request object: the state and the document address.
    const opened = await Promise.all(ids.map(async (id) => {
        const jws = await (await fetch(`${base}/v1/docsign/wallet/${id}/request`)).text();
        const claims = decodeJwt(jws) as { state: string; documentLocations: Array<{ uri: string }> };
        return { id, state: claims.state, doc: claims.documentLocations[0]!.uri.split('/').pop()! };
    }));
    wallet.s1 = opened[0]!;
    wallet.s2 = opened[1]!;
    wallet.s3 = opened[2]!;
}

function walletProbes(): Probe[] {
    const unknown = 'ab'.repeat(16);
    const get = (id: string, path: () => string, tweak?: Probe['tweak']): Probe => ({ id, method: 'GET', path, ...(tweak ? { tweak } : {}) });
    const post = (id: string, path: () => string, form: () => Record<string, string>): Probe => ({ id, method: 'POST', path, form });
    return [
        get('GET request :: session valid', () => `/v1/docsign/wallet/${wallet.s1.id}/request`),
        get('GET request :: session unknown', () => `/v1/docsign/wallet/${unknown}/request`),
        get('GET request :: session malformed', () => '/v1/docsign/wallet/abc/request'),
        get('GET request :: signing switched off', () => `/v1/docsign/wallet/${wallet.s1.id}/request`, off('docsignEnabled', false)),
        get('GET document :: wrong token', () => `/v1/docsign/wallet/${wallet.s1.id}/document/wrong-token`),
        get('GET document :: unknown session', () => `/v1/docsign/wallet/${unknown}/document/${wallet.s1.doc}`),
        get('GET document :: token of the session', () => `/v1/docsign/wallet/${wallet.s1.id}/document/${wallet.s1.doc}`),
        get('GET document :: token of the session, again', () => `/v1/docsign/wallet/${wallet.s1.id}/document/${wallet.s1.doc}`),
        post('POST response :: no state', () => `/v1/docsign/wallet/${wallet.s1.id}/response`, () => ({ error: 'user_cancelled' })),
        post('POST response :: wrong state', () => `/v1/docsign/wallet/${wallet.s1.id}/response`, () => ({ state: 'wrong', error: 'user_cancelled' })),
        post('POST response :: state of another session', () => `/v1/docsign/wallet/${wallet.s1.id}/response`, () => ({ state: wallet.s2.state, error: 'user_cancelled' })),
        post('POST response :: unknown session', () => `/v1/docsign/wallet/${unknown}/response`, () => ({ state: wallet.s1.state })),
        post('POST response :: malformed session', () => '/v1/docsign/wallet/abc/response', () => ({ state: wallet.s1.state })),
        post('POST response :: valid, no document', () => `/v1/docsign/wallet/${wallet.s1.id}/response`, () => ({ state: wallet.s1.state, error: 'user_cancelled' })),
        post('POST response :: valid, after the session closed', () => `/v1/docsign/wallet/${wallet.s1.id}/response`, () => ({ state: wallet.s1.state, error: 'user_cancelled' })),
        get('GET request :: session closed', () => `/v1/docsign/wallet/${wallet.s1.id}/request`),
        post('POST by state :: no state', () => '/v1/docsign/wallet/response', () => ({ error: 'user_cancelled' })),
        post('POST by state :: wrong state', () => '/v1/docsign/wallet/response', () => ({ state: 'wrong' })),
        post('POST by state :: state of a closed session', () => '/v1/docsign/wallet/response', () => ({ state: wallet.s1.state })),
        post('POST by state :: valid', () => '/v1/docsign/wallet/response', () => ({ state: wallet.s2.state, error: 'user_cancelled' })),
        post('POST by state :: valid, again', () => '/v1/docsign/wallet/response', () => ({ state: wallet.s2.state, error: 'user_cancelled' })),
        post('POST / :: wrong state', () => '/', () => ({ state: 'wrong' })),
        post('POST / :: valid', () => '/', () => ({ state: wallet.s3.state, error: 'user_cancelled' })),
        { id: 'POST / :: not a form', method: 'POST', path: () => '/', body: () => ({ state: wallet.s3.state }) },
    ];
}

// ── an outside party buying again ─────────────────────────────────────────────

function party(name: string, uid: string, keyId: string, key: string, status: 'active' | 'stopped'): PartyRecord {
    return {
        uid, name, displayName: name, kind: 'program', status, createdAt: STAMP, createdBy: ALICE,
        keys: [{ id: keyId, hash: hashPartyKey(key), createdAt: STAMP, lastUsedAt: null }], failedAttempts: 0, lastSeenAt: null,
    };
}
async function partyJwt(claims: Record<string, unknown>, expSecondsFromNow: number): Promise<string> {
    const iat = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({ typ: 'party', ...claims }).setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
        .setIssuedAt(iat - 3600).setExpirationTime(iat + expSecondsFromNow).sign(partyKeys.privateKey);
    return `aimeat_party_${jwt}`;
}

function buyProbes(): Probe[] {
    const creds: Array<{ name: string; headers: () => Promise<Record<string, string>> | Record<string, string> }> = [
        { name: 'missing', headers: () => ({}) },
        { name: 'basic valid', headers: () => ({ Authorization: basic(`${OWNER}/matti`, PARTY_KEY) }) },
        { name: 'basic wrong key', headers: () => ({ Authorization: basic(`${OWNER}/matti`, 'wrong-key') }) },
        { name: 'basic unknown party', headers: () => ({ Authorization: basic(`${OWNER}/nobody`, PARTY_KEY) }) },
        { name: 'basic malformed user', headers: () => ({ Authorization: basic('alice', PARTY_KEY) }) },
        { name: 'basic stopped party', headers: () => ({ Authorization: basic(`${OWNER}/pekka`, STOPPED_KEY) }) },
        { name: 'token valid', headers: async () => ({ Authorization: `Bearer ${await mintPartyToken({ owner: OWNER, uid: 'p-matti', kid: 'k-matti' })}` }) },
        { name: 'token expired', headers: async () => ({ Authorization: `Bearer ${await partyJwt({ owner: OWNER, uid: 'p-matti', kid: 'k-matti' }, -60)}` }) },
        { name: 'token of an app party', headers: async () => ({ Authorization: `Bearer ${await mintPartyToken({ owner: OWNER, uid: 'ap-liisa', kid: 'app', app: `${OWNER}/notes.html`, ep: 0 })}` }) },
        { name: 'token not signed here', headers: () => ({ Authorization: 'Bearer aimeat_party_e30.e30.AAAA' }) },
        { name: 'node bearer (another kind)', headers: () => ({ Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.AAAA' }) },
    ];
    const bodies: Array<{ name: string; body: unknown }> = [
        { name: '{}', body: {} },
        { name: 'months not a number', body: { months: 'x' } },
    ];
    return bodies.flatMap(b => creds.map(c => ({
        id: `POST /v1/exchange/offerings/off-unknown/buy ${b.name} :: ${c.name}`, method: 'POST',
        path: () => '/v1/exchange/offerings/off-unknown/buy', headers: c.headers, body: () => b.body,
    })));
}

// ── a federation peer's signed message ────────────────────────────────────────

interface FedDoor {
    method: 'POST' | 'GET';
    path: string;
    /** The body field naming the sending node ('x-source-node' for a signed GET). */
    from: string;
    fields: (node: string, ts: string) => Record<string, unknown>;
    signed: (b: Record<string, unknown>) => string;
    proof: 'audience' | 'delivery';
}
let tracking = 0;
const json = (...names: string[]) => (b: Record<string, unknown>) => JSON.stringify(Object.fromEntries(names.map(n => [n, b[n]])));
const FED_DOORS: FedDoor[] = [
    { method: 'POST', path: '/v1/federation/replicate', from: 'source_node', proof: 'delivery',
        fields: (n, ts) => ({ source_node: n, gaii: `claude#bob@${n}`, key: 'notes.shared', value: { text: 'hi' }, visibility: 'public', version: 1, timestamp: ts }),
        signed: json('source_node', 'gaii', 'key', 'value', 'visibility', 'version', 'timestamp') },
    { method: 'POST', path: '/v1/federation/message', from: 'source_node', proof: 'audience',
        fields: (n, ts) => ({ source_node: n, message: { id: `m-${n}`, senderGhii: `bob@${n}`, recipientGhii: ALICE, body: 'hi', createdAt: ts }, timestamp: ts }),
        signed: json('source_node', 'message', 'timestamp') },
    { method: 'POST', path: '/v1/federation/broadcast', from: 'source_node', proof: 'audience',
        fields: (n, ts) => ({ source_node: n, broadcast: { senderGhii: `bob@${n}`, body: 'news', broadcastId: 'b-1' }, timestamp: ts }),
        signed: json('source_node', 'broadcast', 'timestamp') },
    { method: 'POST', path: '/v1/federation/message/receipt', from: 'source_node', proof: 'delivery',
        fields: (n, ts) => ({ source_node: n, message_id: 'm-1', kind: 'delivered', timestamp: ts }),
        signed: json('source_node', 'message_id', 'kind', 'timestamp') },
    { method: 'POST', path: '/v1/federation/storage/grant', from: 'source_node', proof: 'audience',
        fields: (n, ts) => ({ source_node: n, message_id: 'm-1', conversation_id: 'c-1', storage_key: 'files/a.txt', owner_ghii: ALICE, recipient_ghii: `bob@${n}`, timestamp: ts }),
        signed: json('source_node', 'message_id', 'conversation_id', 'storage_key', 'owner_ghii', 'recipient_ghii', 'timestamp') },
    { method: 'POST', path: '/v1/federation/retract', from: 'source_node', proof: 'audience',
        fields: (n, ts) => ({ source_node: n, gaii: `claude#bob@${n}`, key: 'notes.shared', reason: 'gone', timestamp: ts }),
        signed: json('source_node', 'gaii', 'key', 'reason', 'timestamp') },
    { method: 'POST', path: '/v1/federation/message/reaction', from: 'source_node', proof: 'audience',
        fields: (n, ts) => ({ source_node: n, message_id: 'm-1', reaction: 'ok', reactor: `bob@${n}`, op: 'add', timestamp: ts }),
        signed: b => JSON.stringify(reactionPayload(String(b.source_node), String(b.message_id), { reaction: String(b.reaction), reactorGhii: String(b.reactor), removed: false }, String(b.timestamp))) },
    { method: 'POST', path: '/v1/federation/catalogue-sync', from: 'source_node', proof: 'delivery',
        fields: n => ({ source_node: n, actions: [], since_timestamp: null, catalogue_hash: 'h1' }),
        signed: json('source_node', 'actions', 'since_timestamp', 'catalogue_hash') },
    { method: 'POST', path: '/v1/federation/trust-advisory', from: 'source_node', proof: 'audience',
        fields: (n, ts) => ({ source_node: n, target_node: 'node-z', advisory_type: 'warning', reason: 'spam', timestamp: ts }),
        signed: b => trustNoticeSignString({ source_node: String(b.source_node), target_node: String(b.target_node), advisory_type: String(b.advisory_type), reason: String(b.reason), timestamp: String(b.timestamp) }) },
    { method: 'POST', path: '/v1/federation/memory/list', from: 'requesting_node', proof: 'audience',
        fields: (n, ts) => ({ requesting_node: n, gaii: ALICE, timestamp: ts }),
        signed: json('requesting_node', 'gaii', 'timestamp') },
    { method: 'POST', path: '/v1/federation/auth/verify', from: 'requesting_node', proof: 'audience',
        fields: (n, ts) => ({ username: OWNER, password: 'not-the-password', requesting_node: n, timestamp: ts }),
        signed: b => federationAuthPayload({ username: String(b.username), requesting_node: String(b.requesting_node), timestamp: String(b.timestamp) }) },
    { method: 'POST', path: '/v1/federation/settle', from: 'from_node', proof: 'audience',
        fields: (n, ts) => ({ from_node: n, to_node: NODE, gaii: ALICE, amount: 1, tracking_code: `t-${++tracking}`, reason: 'r', timestamp: ts }),
        signed: json('from_node', 'to_node', 'gaii', 'amount', 'tracking_code', 'reason', 'timestamp') },
    { method: 'GET', path: '/v1/federation/templates', from: 'x-source-node', proof: 'audience',
        fields: (n, ts) => ({ source_node: n, timestamp: ts }), signed: json('source_node', 'timestamp') },
];

type Variant = { name: string; node: string; key: string; sig: 'valid' | 'none' | 'number' | 'other-text'; age?: number; empty?: boolean };
const VARIANTS: Variant[] = [
    { name: 'missing fields', node: 'peer-a', key: 'peer-a', sig: 'valid', empty: true },
    { name: 'unknown peer', node: 'nobody.example', key: 'peer-a', sig: 'valid' },
    { name: 'peer suspended', node: 'peer-suspended', key: 'peer-suspended', sig: 'valid' },
    { name: 'peer of the contact tier', node: 'peer-contact', key: 'peer-contact', sig: 'valid' },
    { name: 'peer with no key', node: 'peer-nokey', key: 'peer-a', sig: 'valid' },
    { name: 'peer depeering', node: 'peer-leaving', key: 'peer-leaving', sig: 'valid' },
    { name: 'unsigned', node: 'peer-a', key: 'peer-a', sig: 'none' },
    { name: 'signature not text', node: 'peer-a', key: 'peer-a', sig: 'number' },
    { name: 'signed by another key', node: 'peer-a', key: 'stranger', sig: 'valid' },
    { name: 'signed over other text', node: 'peer-a', key: 'peer-a', sig: 'other-text' },
    { name: 'signed ten minutes ago', node: 'peer-a', key: 'peer-a', sig: 'valid', age: 600_000 },
    { name: 'signed now', node: 'peer-a', key: 'peer-a', sig: 'valid' },
];

async function fedRequest(door: FedDoor, v: Variant): Promise<{ headers: Record<string, string>; body?: Record<string, unknown> }> {
    if (v.empty) return door.method === 'GET' ? { headers: {} } : { headers: {}, body: {} };
    const ts = new Date(Date.now() - (v.age ?? 0)).toISOString();
    const fields = door.fields(v.node, ts);
    const signed = door.signed(fields);
    const pk = keys[v.key]!.privateKey;
    const signature = v.sig === 'none' ? undefined : v.sig === 'number' ? 12345 : await sign(pk, v.sig === 'other-text' ? `${signed}x` : signed);
    if (door.method === 'GET') {
        return { headers: {
            'x-source-node': v.node, 'x-timestamp': ts,
            ...(typeof signature === 'string' ? { 'x-signature': signature } : signature !== undefined ? { 'x-signature': String(signature) } : {}),
            ...await audienceHeaders(pk, signed, NODE),
        } };
    }
    const proof = door.proof === 'delivery' ? await deliveryProof(pk, signed, NODE) : await audienceProof(pk, signed, NODE);
    return { headers: {}, body: { ...fields, ...(signature !== undefined ? { signature } : {}), ...proof } };
}

function federationProbes(): Probe[] {
    const probes: Probe[] = [];
    for (const door of FED_DOORS) {
        for (const v of VARIANTS) {
            let built: Promise<{ headers: Record<string, string>; body?: Record<string, unknown> }> | null = null;
            const once = () => (built ??= fedRequest(door, v));
            probes.push({
                id: `${door.method} ${door.path} :: ${v.name}`, method: door.method, path: () => door.path,
                headers: async () => (await once()).headers,
                ...(door.method === 'POST' ? { body: async () => (await once()).body } : {}),
            });
        }
    }
    return probes;
}

// ── a package seller's or claimant's signed request ───────────────────────────

const nodeKeyStore = (privateKey: string) => ({ getNodeKey: async () => ({ privateKey }) }) as unknown as Storage;
async function saleHeaders(node: string, key: string, method: string, path: string, body: unknown, purpose?: string): Promise<Record<string, string>> {
    return signedSaleHeaders(nodeKeyStore(keys[key]!.privateKey), { nodeId: node } as AimeatConfig, NODE, method, path, body, purpose);
}

function packageProbes(): Probe[] {
    const doors: Array<{ method: string; path: string; body?: unknown }> = [
        { method: 'GET', path: '/v1/federation/package-sales/g1/config-needs' },
        { method: 'GET', path: '/v1/federation/package-sales/g1/offer' },
        { method: 'PUT', path: '/v1/federation/package-sales/g1/claims', body: { note: 'x' } },
        { method: 'PUT', path: '/v1/federation/package-sales/g1/entitlements/node-z', body: { note: 'x' } },
        { method: 'DELETE', path: '/v1/federation/package-sales/g1/entitlements/node-z' },
    ];
    const creds: Array<{ name: string; headers: (d: { method: string; path: string; body?: unknown }) => Promise<Record<string, string>>; tweak?: Probe['tweak'] }> = [
        { name: 'not a repository', headers: d => saleHeaders('peer-a', 'peer-a', d.method, d.path, d.body), tweak: off('packageRepository', false) },
        { name: 'missing', headers: async () => ({}) },
        { name: 'unknown node', headers: d => saleHeaders('nobody.example', 'peer-a', d.method, d.path, d.body) },
        { name: 'signed by another key', headers: d => saleHeaders('peer-a', 'stranger', d.method, d.path, d.body) },
        { name: 'signed for another path', headers: d => saleHeaders('peer-a', 'peer-a', d.method, '/v1/federation/package-sales/g2/offer', d.body) },
        { name: 'signed, a peer that sells nothing here', headers: d => saleHeaders('peer-a', 'peer-a', d.method, d.path, d.body) },
    ];
    const probes: Probe[] = doors.flatMap(d => creds.map(c => ({
        id: `${d.method} ${d.path} :: ${c.name}`, method: d.method, path: () => d.path, headers: () => c.headers(d),
        ...(d.body !== undefined ? { body: () => d.body } : {}), ...(c.tweak ? { tweak: c.tweak } : {}),
    })));
    const claimPath = '/v1/federation/package-claims/g1';
    const claimBody = (node: string) => ({ node_id: node, public_key: keys['claimant']!.publicKey, code: 'C-1', url: 'https://claimant.example' });
    const claim = (name: string, body: () => Record<string, unknown>, headers: (b: Record<string, unknown>) => Promise<Record<string, string>>, tweak?: Probe['tweak']): Probe => {
        let b: Record<string, unknown> | null = null;
        const bodyOnce = () => (b ??= body());
        return { id: `POST ${claimPath} :: ${name}`, method: 'POST', path: () => claimPath, body: bodyOnce, headers: () => headers(bodyOnce()), ...(tweak ? { tweak } : {}) };
    };
    probes.push(
        claim('not a repository', () => claimBody('node-new'), b => saleHeaders('node-new', 'claimant', 'POST', claimPath, b, CLAIM_PURPOSE), off('packageRepository', false)),
        claim('missing', () => claimBody('node-new'), async () => ({})),
        claim('no key in the body', () => ({ node_id: 'node-new', code: 'C-1' }), b => saleHeaders('node-new', 'claimant', 'POST', claimPath, b, CLAIM_PURPOSE)),
        claim('signed by another key', () => claimBody('node-new'), b => saleHeaders('node-new', 'stranger', 'POST', claimPath, b, CLAIM_PURPOSE)),
        claim('signed as a sale, not a claim', () => claimBody('node-new'), b => saleHeaders('node-new', 'claimant', 'POST', claimPath, b)),
        claim('node_id another than the signer', () => claimBody('node-other'), b => saleHeaders('node-new', 'claimant', 'POST', claimPath, b, CLAIM_PURPOSE)),
        claim('signed with the body key', () => claimBody('node-new'), b => saleHeaders('node-new', 'claimant', 'POST', claimPath, b, CLAIM_PURPOSE)),
    );
    return probes;
}

// ── setup ─────────────────────────────────────────────────────────────────────

function peer(nodeId: string, key: string, status: string, open: boolean, tier: PeerInfo['tier'] = 'member'): PeerInfo {
    return {
        nodeId, url: `https://${nodeId}.example`, publicKey: key, status, addedAt: STAMP, lastSeen: STAMP,
        shareCatalogue: open, replicateMemory: open, allowRouting: open, allowMessaging: open, allowBroadcast: open, allowSettlement: open,
        peerMode: 'federation', allowFederatedAuth: open, federationAuthScopes: [], tier,
    } as PeerInfo;
}

const FAMILIES: Array<{ family: string; probes: () => Probe[] }> = [
    { family: 'intake-visitor', probes: intakeProbes },
    { family: 'docsign-wallet', probes: walletProbes },
    { family: 'party-optional', probes: buyProbes },
    { family: 'federation-peer', probes: federationProbes },
    { family: 'package-node', probes: packageProbes },
];

beforeAll(async () => {
    for (const k of ['peer-a', 'peer-suspended', 'peer-contact', 'peer-leaving', 'stranger', 'claimant']) keys[k] = await generateKeyPair();
    peers.set('peer-a', peer('peer-a', keys['peer-a']!.publicKey, 'active', true));
    peers.set('peer-suspended', peer('peer-suspended', keys['peer-suspended']!.publicKey, 'suspended', true));
    peers.set('peer-contact', peer('peer-contact', keys['peer-contact']!.publicKey, 'active', false, 'contact'));
    peers.set('peer-nokey', peer('peer-nokey', '', 'active', true));
    peers.set('peer-leaving', peer('peer-leaving', keys['peer-leaving']!.publicKey, 'depeering', true));

    partyKeys = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as { privateKey: CryptoKey; publicKey: CryptoKey };
    initPartyTokenKeys(partyKeys.privateKey, partyKeys.publicKey);

    storage = await createStorage({ provider: 'sqlite', sqlitePath: ':memory:' }) as typeof storage;
    const { config: loaded } = loadConfig({});
    config = {
        ...loaded, nodeId: NODE, baseUrl: 'https://localhost',
        docsignEnabled: true, docsignEudiEnabled: true,
        docsignEudiRpCredentialPath: join(HERE, '..', 'fixtures', 'docsign', 'eudi-rp-test.txt'),
        partyPurchasesPerHour: 0, packageRepository: true, packageFederationEnabled: true, contentAccess: 'open',
    } as AimeatConfig;
    setThisNodeId(NODE);

    await seedIntake();
    expect(await insertParty(storage, ALICE, party('matti', 'p-matti', 'k-matti', PARTY_KEY, 'active'))).toBe('ok');
    expect(await insertParty(storage, ALICE, party('pekka', 'p-pekka', 'k-pekka', STOPPED_KEY, 'stopped'))).toBe('ok');

    const app = express();
    app.set('trust proxy', false);
    app.use(express.json({ limit: '1mb' }));
    app.use(docsignWalletRouter(config, storage));
    app.use(organismsRouter(config, storage));
    app.use(exchangePartyBuyRouter(config, storage));
    app.use(federationSyncRouter(config, storage, peers));
    app.use(federationSettlementsRouter(config, storage, peers));
    app.use(federationAuthRouter(config, storage, peers));
    const packages = express.Router();
    registerPackageSaleRoutes(packages, config, storage, peers);
    app.use(packages);
    base = await listen(app, servers);
    await seedWallet();
}, 60_000);

afterAll(async () => {
    for (const s of servers) await new Promise<void>(r => s.close(() => r()));
    await storage?.close?.();
});

describe('credential table, part 2: every remaining credential kind on every route that verifies one', () => {
    for (const { family, probes } of FAMILIES) {
        // Every family runs in every mode, in this order, so that a family recorded alone saw the same
        // node as when all are compared; while one is recorded, a family with no fixture yet only runs.
        it(`${family}: answers each row exactly as the code before the credential strategies did`, async () => {
            const fixture = fixtureOf(family);
            expect(probes().length, `${family} has rows`).toBeGreaterThan(0);
            if (RECORDING.size && !RECORDING.has(family) && !existsSync(fixture)) { for (const p of probes()) await sendProbe(base, p); return; }
            await compareFamily(base, fixture, probes(), RECORDING.has(family));
        }, 120_000);
    }
});
