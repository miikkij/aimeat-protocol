/**
 * @file test/unit/token-revocation.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A revoked token stays revoked however its bytes are spelled.
 *
 *   WHAT THIS PINS (secaudit 2026-09, N4). An Ed25519 signature is 64 bytes, and the 86 base64url
 *   characters that carry it hold 516 bits, so the last character has four bits nobody reads:
 *   sixteen spellings of one signature, and verifyJWT accepts every one. Revocation is keyed on what
 *   the signature covers, so the sixteen are one token, revoked together and refused together. It
 *   matters most for a token with no session behind it (an MCP OAuth access token), which nothing
 *   else can end before its expiry.
 *
 *   The first case proves the copies verify before it proves they are refused. The others prove the
 *   refusal holds where a second process reads it from storage, that it reaches the live tunnel,
 *   that it is about THIS token and no wider, and that a revocation filed before the change holds.
 *
 *   THE ACCOUNT A CREDENTIAL ACTS FOR (auth/credential-age.ts). An account name is released for reuse
 *   when the account is deleted, and every credential carries the bare name. So a credential counts
 *   only while an account holds that name, the account is not deactivated, and the account was made
 *   before the credential: to the millisecond when the token carries `iat_ms`, in whole seconds when
 *   it was minted before the claim existed. An app grant's token counts from the grant, a personal
 *   access token and an owner session's refresh from their own rows, and an ecosystem app's token is
 *   compared with its app record the same way. A token that names no owner, or an anonymous one, is
 *   asked no account.
 * @usage cd aimeat && pnpm exec vitest run test/unit/token-revocation.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-26 — The account a credential acts for: no account, a deactivated one, and one
 *     made after the credential refuse it, per credential family, and `iat_ms` is written and read.
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, N4).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { WebSocket } from 'ws';
import { SignJWT } from 'jose';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../src/services/stats.js', () => ({ getStats: () => null }));
vi.mock('../../src/services/prometheus.js', () => ({ getPromMetrics: () => null }));

import { generateKeyPair, type KeyPair } from '../../src/auth/keypair.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';

type Jwt = typeof import('../../src/auth/jwt.js');

const NODE = 'aimeat-unit-001-test';
const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The revoked-token table in miniature, shared by every "process" below as one database is. */
const rows = new Map<string, number>();
const store = {
    isTokenRevoked: async (hash: string) => rows.has(hash),
    revokeToken: async (hash: string, expiresAt: number) => { rows.set(hash, expiresAt); },
    cleanExpiredRevocations: async () => 0,
    // issueJWT asks whether the owner is deactivated before it mints.
    getOwner: async () => null,
} as unknown as Storage;

/** Every other spelling of the same signature: the last character with only its unread bits changed. */
function respellings(token: string): string[] {
    const [header, payload, sig] = token.split('.');
    const last = B64U.indexOf(sig[sig.length - 1]);
    const out: string[] = [];
    for (let i = 0; i < 64; i++) {
        // The top two of the character's six bits carry the signature; the low four are padding.
        if ((i & 0x30) !== (last & 0x30) || i === last) continue;
        out.push(`${header}.${payload}.${sig.slice(0, -1)}${B64U[i]}`);
    }
    return out;
}

let keys: KeyPair;
let jwt: Jwt;

/** A fresh copy of the module over the same table: another process of the same node, cold cache. */
async function anotherProcess(): Promise<Jwt> {
    vi.resetModules();
    const fresh = await import('../../src/auth/jwt.js');
    await fresh.initNodeKeys(keys.publicKey, keys.privateKey);
    fresh.initRevocationStorage(store);
    return fresh;
}

beforeAll(async () => {
    // initRevocationStorage starts a sweep every minute; nothing here needs it to run.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    keys = await generateKeyPair();
    jwt = await anotherProcess();
});
afterAll(() => { vi.useRealTimers(); });

/** An MCP OAuth access token as oauth.ts mints it: no session, so no jti. */
const mcpToken = (sub: string, ttl = 3600) => jwt.issueJWT({ sub, owner: 'alice', node: NODE, roles: ['agent'], scopes: ['memory:read'], mcp_client: 'Probe' }, ttl);
/** A session token: the jti names its session row. */
const sessionToken = (sub: string, sid: string, ttl = 3600) => jwt.issueJWT({ sub, owner: 'alice', node: NODE, roles: ['agent'], scopes: ['memory:read'] }, ttl, sid);
const expOf = (token: string) => (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf-8')) as { exp: number }).exp;

describe('a revoked token is refused by what it is, not by how its bytes are spelled', () => {
    it('every re-spelling of a revoked token verifies, and every one is refused as revoked', async () => {
        for (const token of [await mcpToken(`bot#alice@${NODE}`), await sessionToken(`bot#alice@${NODE}`, jwt.generateSessionId())]) {
            const variants = respellings(token);
            expect(variants).toHaveLength(15);
            // What makes this an attack and not a curiosity: the node's own verifier accepts each one.
            for (const v of variants) expect(await jwt.verifyJWT(v), `verifies as ...${v.slice(-3)}`).not.toBeNull();

            await jwt.revokeToken(token, expOf(token));
            expect(await jwt.isRevoked(token)).toBe(true);
            for (const v of variants) expect(await jwt.isRevoked(v), `re-spelled as ...${v.slice(-3)}`).toBe(true);
        }
    });

    it('revoking a re-spelled copy revokes the token it was copied from', async () => {
        // The order a thief controls: the copy may be the one that reaches the revoke door. Each case
        // mints for its own agent: Ed25519 signs deterministically, so the same claims in the same
        // second are the same token, and a case would see another case's revocation.
        const token = await mcpToken(`copy#alice@${NODE}`);
        await jwt.revokeToken(respellings(token)[0], expOf(token));
        expect(await jwt.isRevoked(token)).toBe(true);
    });

    it('another process of the node reads the revocation from storage for every spelling', async () => {
        const token = await mcpToken(`crew#alice@${NODE}`);
        await jwt.revokeToken(token, expOf(token));
        const other = await anotherProcess();
        for (const v of respellings(token)) expect(await other.isRevoked(v), `re-spelled as ...${v.slice(-3)}`).toBe(true);
        jwt = other;
    });

    it('another token stays good: a fresh one for the same agent, and one of the same session', async () => {
        const sid = jwt.generateSessionId();
        const first = await sessionToken(`bot#alice@${NODE}`, sid, 3600);
        // A session's later token carries the same jti, as an owner's web session does on every
        // refresh. Revoking one token must not end another the session was given.
        const later = await sessionToken(`bot#alice@${NODE}`, sid, 3601);
        const fresh = await mcpToken(`bot#alice@${NODE}`, 3602);
        await jwt.revokeToken(first, expOf(first));
        expect(await jwt.isRevoked(first)).toBe(true);
        expect(await jwt.isRevoked(later)).toBe(false);
        expect(await jwt.isRevoked(fresh)).toBe(false);
    });

    it('a token revoked before the change, filed under its exact string, stays refused', async () => {
        const token = await mcpToken(`old#alice@${NODE}`, 3603);
        rows.set(createHash('sha256').update(token).digest('hex'), expOf(token));
        const other = await anotherProcess();
        expect(await other.isRevoked(token)).toBe(true);
        jwt = other;
    });

    it('the live tunnel held by a re-spelled copy is told and cut when the token is revoked', async () => {
        const { revokeByToken } = await import('../../src/services/connect-tunnel-revocation.js');
        const token = await mcpToken(`tun#alice@${NODE}`, 3604);
        const conn = { principal: `tun#alice@${NODE}`, ws: {} as WebSocket, socketId: 's1', rawToken: respellings(token)[3], identity: { owner: 'alice' } };
        const sent: Array<{ type: string }> = [];
        const detached: string[] = [];
        revokeByToken(new Map([[conn.principal, conn]]), (_ws, frame) => { sent.push(frame as { type: string }); },
            (_socket, principal) => { detached.push(principal); }, token);
        expect(sent.map(f => f.type)).toEqual(['auth_revoked']);
        expect(detached).toEqual([conn.principal]);
    });
});

describe('a credential counts only while the account it acts for holds its name', () => {
    type Middleware = typeof import('../../src/auth/middleware.js');
    type Pats = typeof import('../../src/services/access-token.js');
    type OwnerSessions = typeof import('../../src/services/owner-session.js');

    /** The owners, app grants and ecosystem apps tables in miniature. */
    const owners = new Map<string, { name: string; roles: string[]; createdAt: string; disabledAt: string | null }>();
    const grants = new Map<string, { grantId: string; owner: string; createdAt: string; revoked: boolean }>();
    const ecosystemApps = new Map<string, { geai: string; status: string; createdAt: string }>();
    const accounts = {
        ...store,
        getOwner: async (name: string) => owners.get(name) ?? null,
        getAppGrant: async (id: string) => grants.get(id) ?? null,
        getEcosystemApp: async (geai: string) => ecosystemApps.get(geai) ?? null,
        isSessionRevoked: async () => false,
    } as unknown as Storage;

    let j: Jwt;
    let mw: Middleware;
    let pats: Pats;
    let sessions: OwnerSessions;

    beforeAll(async () => {
        vi.resetModules();
        j = await import('../../src/auth/jwt.js');
        await j.initNodeKeys(keys.publicKey, keys.privateKey);
        j.initRevocationStorage(accounts);
        mw = await import('../../src/auth/middleware.js');
        mw.initSessionAuth(accounts, { nodeId: NODE } as AimeatConfig);
        pats = await import('../../src/services/access-token.js');
        sessions = await import('../../src/services/owner-session.js');
    });

    const at = (ms: number) => new Date(ms).toISOString();
    /** A whole second a minute ago, so every token below is live and every time is in the past. */
    const second = () => Math.floor(Date.now() / 1000) - 60;
    const account = (name: string, createdMs: number, disabled = false) => {
        owners.set(name, { name, roles: ['owner'], createdAt: at(createdMs), disabledAt: disabled ? at(createdMs + 1) : null });
    };

    /** A token signed as issueJWT signs one, with its issue time set by the test: `ms` is its
     *  `iat_ms`, and a token without it is one minted before the claim existed. */
    async function signed(claims: { sub: string; owner: string; roles: string[] } & Record<string, unknown>, iat: number, ms?: number): Promise<string> {
        const { sub, ...rest } = claims;
        return new SignJWT({ node: NODE, scopes: ['memory:read'], ...rest, ...(ms === undefined ? {} : { iat_ms: ms }) })
            .setProtectedHeader({ alg: 'EdDSA', typ: 'JWT' })
            .setSubject(sub)
            .setIssuedAt(iat)
            .setExpirationTime(iat + 3600)
            .sign(j.getNodeCryptoKeys().privateKey);
    }
    async function refused(token: string): Promise<boolean> {
        const verified = await j.verifyJWT(token);
        expect(verified, 'the token verifies').not.toBeNull();
        return mw.credentialRevoked(token, verified!);
    }

    it('issueJWT writes the issue time in milliseconds beside iat, and verifyJWT reads it', async () => {
        account('ada', Date.now() - 60_000);
        const before = Date.now();
        const v = await j.verifyJWT(await j.issueJWT({ sub: 'ada', owner: 'ada', node: NODE, roles: ['owner'], scopes: [] }, 3600));
        const after = Date.now();
        expect(typeof v!.iatMs).toBe('number');
        expect(v!.iatMs!).toBeGreaterThanOrEqual(before);
        expect(v!.iatMs!).toBeLessThanOrEqual(after);
        expect(v!.iat).toBe(Math.floor(v!.iatMs! / 1000));
    });

    it('refuses an owner token and an agent token whose owner name no account holds', async () => {
        const s = second();
        expect(await refused(await signed({ sub: 'nobody', owner: 'nobody', roles: ['owner'] }, s, s * 1000 + 100))).toBe(true);
        expect(await refused(await signed({ sub: `bot#nobody@${NODE}`, owner: 'nobody', roles: ['agent'] }, s, s * 1000 + 100))).toBe(true);
    });

    it('refuses a token made before the account that holds its owner name now, to the millisecond', async () => {
        const s = second();
        account('dora', s * 1000 + 500); // the name registered again 300 ms after the tokens were made
        expect(await refused(await signed({ sub: 'dora', owner: 'dora', roles: ['owner'] }, s, s * 1000 + 200))).toBe(true);
        expect(await refused(await signed({ sub: `bot#dora@${NODE}`, owner: 'dora', roles: ['agent'], mcp_client: 'Probe' }, s, s * 1000 + 200))).toBe(true);
    });

    it('keeps the account\'s own tokens, also one made in the same second as the account', async () => {
        const s = second();
        account('erin', s * 1000 + 200);
        expect(await refused(await signed({ sub: 'erin', owner: 'erin', roles: ['owner'] }, s, s * 1000 + 500))).toBe(false);
        expect(await refused(await signed({ sub: `bot#erin@${NODE}`, owner: 'erin', roles: ['agent'] }, s + 5, (s + 5) * 1000))).toBe(false);
    });

    it('compares a token minted without iat_ms in whole seconds', async () => {
        const s = second();
        account('finn', s * 1000 + 500);
        // The account's own second: which came first cannot be told, and the token is kept.
        expect(await refused(await signed({ sub: 'finn', owner: 'finn', roles: ['owner'] }, s))).toBe(false);
        // A second before the account: refused.
        expect(await refused(await signed({ sub: 'finn', owner: 'finn', roles: ['owner'] }, s - 1))).toBe(true);
    });

    it('refuses the tokens of a deactivated account', async () => {
        const s = second();
        account('gail', s * 1000 - 10_000, true);
        expect(await refused(await signed({ sub: 'gail', owner: 'gail', roles: ['owner'] }, s, s * 1000))).toBe(true);
    });

    it('counts an app grant\'s token from the grant, however late the token was minted', async () => {
        const s = second();
        account('hana', s * 1000 + 5_000);
        grants.set('g-earlier', { grantId: 'g-earlier', owner: 'hana', createdAt: at(s * 1000), revoked: false });
        grants.set('g-own', { grantId: 'g-own', owner: 'hana', createdAt: at(s * 1000 + 6_000), revoked: false });
        // Both minted by a refresh ten seconds after the account was made.
        const late = (grant: string) => signed({ sub: `hana@${NODE}`, owner: 'hana', roles: ['app'], app_grant: grant }, s + 10, (s + 10) * 1000);
        expect(await refused(await late('g-earlier'))).toBe(true);
        expect(await refused(await late('g-own'))).toBe(false);
    });

    it('compares an ecosystem app\'s token with its app record to the millisecond', async () => {
        const s = second();
        account('ivan', s * 1000 - 60_000);
        const geai = `eco:drum#ivan@${NODE}`;
        ecosystemApps.set(geai, { geai, status: 'active', createdAt: at(s * 1000 + 500) });
        const eco = (ms?: number) => signed({ sub: geai, owner: 'ivan', roles: ['ecosystem'], eco_app: 'drum' }, s, ms);
        // Made 300 ms before the record that holds the identity now: the record is a later connection.
        expect(await refused(await eco(s * 1000 + 200))).toBe(true);
        expect(await refused(await eco(s * 1000 + 800))).toBe(false);
        // Minted without iat_ms in the record's own second: the order cannot be told, and it is kept.
        expect(await refused(await eco())).toBe(false);
    });

    it('asks no account of an anonymous token or of a token that names no owner', async () => {
        const s = second();
        expect(await refused(await signed({ sub: 'anon#shared@x', owner: 'no-such-account', roles: ['agent'], anonymous: true }, s, s * 1000))).toBe(false);
        expect(await refused(await signed({ sub: 'unnamed', owner: '', roles: ['agent'] }, s, s * 1000))).toBe(false);
    });

    it('resolves a personal access token only when it was made after the account that holds its name', async () => {
        const s = second();
        account('jude', s * 1000 + 500);
        const pat = (createdMs: number) => ({
            id: `pat-${createdMs}`, owner: 'jude', gaii: 'jude', label: 'probe', scopes: [], grantOwner: true, grantOperator: false,
            createdAt: at(createdMs), expiresAt: null, lastUsedAt: null, revoked: false,
        });
        const holding = (row: ReturnType<typeof pat>) => ({ ...accounts, getPatByHash: async () => row }) as unknown as Storage;
        expect(await pats.resolvePat(holding(pat(s * 1000 + 200)), 'aimeat_pat_earlier')).toBeNull();
        expect(await pats.resolvePat(holding(pat(s * 1000 + 800)), 'aimeat_pat_own')).toMatchObject({ owner: 'jude', roles: ['owner'] });
    });

    it('ends an owner session made before the account that holds its owner name now, at refresh', async () => {
        const s = second();
        account('kira', s * 1000 + 500);
        const ended: string[] = [];
        const row = (issuedMs: number) => ({
            sessionId: `sess-${issuedMs}`, gaii: 'kira', owner: 'kira', issuedAt: at(issuedMs), revoked: false,
            refreshTokenHash: sessions.hashToken('raw'), idleExpiresAt: at(Date.now() + 3_600_000), absoluteExpiresAt: at(Date.now() + 86_400_000),
        });
        const holding = (session: ReturnType<typeof row>) => ({
            ...accounts,
            getSessionByRefreshHash: async () => session,
            revokeSession: async (id: string) => { ended.push(id); },
            rotateSessionRefresh: async () => undefined,
            getGHIIByOwner: async () => null,
        }) as unknown as Storage;
        const req = { headers: { cookie: 'aimeat_rt=raw', 'x-aimeat-refresh': '1' }, secure: false } as unknown as Request;
        const res = { cookie: () => res, clearCookie: () => res } as unknown as Response;
        const config = { nodeId: NODE, accessTtlSeconds: 3600, refreshIdleDays: 14, refreshAbsoluteDays: 90, refreshGraceMs: 30_000 } as AimeatConfig;

        expect(await sessions.refreshOwnerSession(holding(row(s * 1000 + 200)), config, req, res))
            .toMatchObject({ ok: false, status: 401, code: 'SESSION_REVOKED' });
        expect(ended).toEqual([`sess-${s * 1000 + 200}`]);
        expect(await sessions.refreshOwnerSession(holding(row(s * 1000 + 800)), config, req, res)).toMatchObject({ ok: true });
    });
});
