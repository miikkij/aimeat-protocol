/**
 * @file test/unit/app-purchase-gate.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The app's own gates as POST /v1/app-store/purchase asks them
 *   (src/services/app-purchase-gate.ts; secaudit2026oct26,
 *   app-store:purchase-returns-content-past-app-gates): an app the operator hid is not found, an app
 *   open to the owner's chosen people refuses a buyer outside them, and an access code the buyer did
 *   not send keeps the copy out of the receipt. The usage half: an open app and a buyer who sends the
 *   code pass with the copy, and on an app with no gates nothing changes.
 * @usage cd aimeat && pnpm exec vitest run test/unit/app-purchase-gate.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { AimeatConfig } from '../../src/config.js';
import type { AppRecord } from '../../src/storage/interface.js';
import { appPurchaseGate } from '../../src/services/app-purchase-gate.js';

const NODE_ID = 'aimeat-local-001-dev';
const config = { nodeId: NODE_ID, accountEventWindow: 0, contentAccess: 'open' } as unknown as AimeatConfig;
const buyer = { sub: 'pgbuyer', owner: 'pgbuyer', roles: ['owner'], scopes: ['*'] };

function app(over: Partial<AppRecord> = {}): AppRecord {
  return {
    ownerGaii: `pgseller@${NODE_ID}`, ownerName: 'pgseller', filename: 'paid.html', versionNumber: 1,
    manifest: { name: 'Paid', description: '', version: '1.0.0', category: 'utility', tags: [], authorDisplay: 'pgseller', usesCortex: [], tollMorsels: 5 },
    mimeType: 'text/html', size: 4, data: Buffer.from('body'), createdAt: new Date().toISOString(), ...over,
  } as AppRecord;
}

describe('the app purchase asks the app\'s own gates', () => {
  let storage: SqliteStorage;
  beforeAll(() => { storage = new SqliteStorage(':memory:'); });
  afterAll(() => { storage.close(); });
  const deps = () => ({ storage, config });

  it('an app the operator hid is not found', async () => {
    const g = await appPurchaseGate(deps(), buyer, app({ operatorHidden: true }), undefined);
    expect(g).toMatchObject({ kind: 'refused', status: 404, code: 'NOT_FOUND' });
  });

  it('an app open to signed-in people on a signed-in node passes a signed-in buyer', async () => {
    const g = await appPurchaseGate({ storage, config: { ...config, contentAccess: 'signed-in' } as AimeatConfig }, buyer, app(), undefined);
    expect(g).toEqual({ kind: 'ok', withholdContent: false });
  });

  it('an app open to one organism refuses a buyer outside it', async () => {
    const g = await appPurchaseGate(deps(), buyer, app({ access: 'organism:org-pg-none' } as Partial<AppRecord>), undefined);
    expect(g).toMatchObject({ kind: 'refused', status: 403, code: 'ACCESS_DENIED' });
  });

  it('an access code the buyer did not send keeps the copy out of the receipt; the right code keeps it in', async () => {
    expect(await appPurchaseGate(deps(), buyer, app({ accessCode: 'pg-code' }), undefined)).toEqual({ kind: 'ok', withholdContent: true });
    expect(await appPurchaseGate(deps(), buyer, app({ accessCode: 'pg-code' }), 'wrong')).toEqual({ kind: 'ok', withholdContent: true });
    expect(await appPurchaseGate(deps(), buyer, app({ accessCode: 'pg-code' }), 'pg-code')).toEqual({ kind: 'ok', withholdContent: false });
  });

  it('an app with no gates passes with the copy, as before', async () => {
    expect(await appPurchaseGate(deps(), buyer, app(), undefined)).toEqual({ kind: 'ok', withholdContent: false });
  });
});
