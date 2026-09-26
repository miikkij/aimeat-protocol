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
 * @usage cd aimeat && pnpm exec vitest run test/unit/token-revocation.test.ts
 * @version-history
 *   v1.0.0 — 2026-09-26 — Initial (secaudit 2026-09, N4).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { WebSocket } from 'ws';

vi.mock('../../src/utils/logger.js', () => ({
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { generateKeyPair, type KeyPair } from '../../src/auth/keypair.js';
import type { Storage } from '../../src/storage/interface.js';

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
