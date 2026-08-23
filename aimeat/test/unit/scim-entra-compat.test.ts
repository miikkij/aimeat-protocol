/**
 * @file scim-entra-compat.test.ts
 * @description Entra's default SCIM client is not RFC 7644 clean — op verbs arrive capitalised
 *   ("Replace") and booleans arrive as the STRINGS "True"/"False" unless the tenant opted into
 *   `aadOptscim062020`. The PARSER is SCIMMY's, so the claim under test is OUR coupling to it:
 *   the normalisation shim (services/scim-users.ts normalizeEntraPatchBody) plus the real router
 *   (routes/scim.ts) driven end-to-end with Entra-shaped bodies against in-memory SQLite —
 *   create with the UPN, filter with the UPN verbatim (R11), capitalised-op PATCH with string
 *   booleans through deactivation and back, and the R13 operator refusal.
 * @usage cd aimeat && pnpm exec vitest run test/unit/scim-entra-compat.test.ts
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 3).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { scimRouter } from '../../src/routes/scim.js';
import { normalizeEntraPatchBody } from '../../src/services/scim-users.js';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import { loadConfig, type AimeatConfig } from '../../src/config.js';
import { generateKeyPair } from '../../src/auth/keypair.js';
import { initNodeKeys, initRevocationStorage } from '../../src/auth/jwt.js';

const NODE_ID = 'aimeat-local-001-dev';
const CONN = 'entra-conn';
const TOKEN = 'aimeat_scim_test_token_for_entra_compat';

describe('SCIM door with Entra-shaped requests', () => {
  let storage: SqliteStorage;
  let server: http.Server;
  let base: string;
  let config: AimeatConfig;

  const H = { 'Content-Type': 'application/scim+json', Authorization: `Bearer ${TOKEN}` };
  const req = async (method: string, path: string, body?: unknown, headers: Record<string, string> = H) => {
    const res = await fetch(`${base}/v1/scim/v2/${CONN}${path}`, {
      method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:');
    config = { ...loadConfig().config, nodeId: NODE_ID, ssoEnabled: true };
    const kp = await generateKeyPair();
    await initNodeKeys(kp.publicKey, kp.privateKey);
    initRevocationStorage(storage);

    const now = new Date().toISOString();
    await storage.createSsoConnection({
      id: CONN, name: 'Entra Compat Oy', organismId: null, domains: ['contoso.com'],
      saml: null, allowIdpInitiated: false, loginVisibility: 'hidden',
      scimTokenHash: createHash('sha256').update(TOKEN).digest('hex'), scimTokenCreatedAt: now,
      createdBy: 'op', createdAt: now, updatedAt: now,
    });

    const app = express();
    app.use(scimRouter(config, storage));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
    config.baseUrl = base;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    storage.close();
  });

  // ── The shim itself, on the exact shapes Entra sends ──

  it('normalises "True"/"False" strings on active, in both path and complex-value form', () => {
    const body = {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [
        { op: 'Replace', path: 'active', value: 'False' },
        { op: 'Replace', value: { active: 'True', displayName: 'Keep Me' } },
        { op: 'Replace', path: 'displayName', value: 'False' },   // NOT active — must stay a string
      ],
    };
    normalizeEntraPatchBody(body);
    expect(body.Operations[0].value).toBe(false);
    expect((body.Operations[1].value as Record<string, unknown>).active).toBe(true);
    expect((body.Operations[1].value as Record<string, unknown>).displayName).toBe('Keep Me');
    expect(body.Operations[2].value).toBe('False');
  });

  // ── The door, end to end ──

  let userId = '';

  it('POST /Users with a UPN creates a managed, verified-email account', async () => {
    const r = await req('POST', '/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'Ville.Virtanen@contoso.com', externalId: 'objectid-1',
      displayName: 'Ville Virtanen', active: true,
      emails: [{ value: 'ville.virtanen@contoso.com', primary: true }],
    });
    expect(r.status).toBe(201);
    userId = r.body.id;
    const owner = await storage.getOwner(userId);
    expect(owner?.managedBy).toBe(CONN);
    expect(owner?.roles).toEqual(['owner']);   // first owner, and STILL not operator (provisioning)
    const ghii = await storage.getGHIIByOwner(userId);
    expect(ghii?.emailVerifiedAt).toBeTruthy();
    expect(ghii?.externalIdentities).toMatchObject({ [`scimuser:${CONN}`]: 'Ville.Virtanen@contoso.com', [`scim:${CONN}`]: 'objectid-1' });
  });

  it('R11: the filter matches the UPN Entra sent, not the derived owner name', async () => {
    const r = await req('GET', `/Users?filter=${encodeURIComponent('userName eq "Ville.Virtanen@contoso.com"')}`);
    expect(r.status).toBe(200);
    expect(r.body.totalResults).toBe(1);
    expect(r.body.Resources[0].id).toBe(userId);
  });

  it('a capitalised-op PATCH with a string "False" deactivates; "True" brings the account back', async () => {
    const off = await req('PATCH', `/Users/${userId}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: 'False' }],
    });
    expect(off.status).toBe(200);
    expect(off.body.active).toBe(false);
    expect((await storage.getOwner(userId))?.disabledAt).toBeTruthy();

    const on = await req('PATCH', `/Users/${userId}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', value: { active: 'True' } }],
    });
    expect(on.status).toBe(200);
    expect(on.body.active).toBe(true);
    expect((await storage.getOwner(userId))?.disabledAt).toBeFalsy();
  });

  it('a duplicate POST answers 409 uniqueness', async () => {
    const r = await req('POST', '/Users', {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      userName: 'Ville.Virtanen@contoso.com',
    });
    expect(r.status).toBe(409);
    expect(r.body.scimType).toBe('uniqueness');
  });

  it('R13: deactivating an operator-role owner through provisioning is refused', async () => {
    // Make the managed account an operator by hand — the scenario is "the org synced its own admin".
    const owner = await storage.getOwner(userId);
    await storage.updateOwner(userId, { roles: [...owner!.roles, 'operator'] });
    const r = await req('PATCH', `/Users/${userId}`, {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
      Operations: [{ op: 'Replace', path: 'active', value: 'False' }],
    });
    expect(r.status).toBe(403);
    expect((await storage.getOwner(userId))?.disabledAt).toBeFalsy();
    const del = await req('DELETE', `/Users/${userId}`);
    expect(del.status).toBe(403);
    await storage.updateOwner(userId, { roles: ['owner'] });
  });

  it('DELETE deactivates — the account and its knowledge remain (R3)', async () => {
    const del = await req('DELETE', `/Users/${userId}`);
    expect(del.status).toBe(204);
    const owner = await storage.getOwner(userId);
    expect(owner).not.toBeNull();            // not erased
    expect(owner?.disabledAt).toBeTruthy();  // cannot act
  });
});
