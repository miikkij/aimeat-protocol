/**
 * @file test/unit/compliance-register-step.test.ts
 * @description The publish answer's `register` step (services/compliance/register-step.ts; appdev
 *   pitfall data/personal-data-app-needs-register-and-privacy-notice): an app whose data map says it
 *   keeps personal data that others read, with no register, is told the calls that write one; an app
 *   with a register, or without personal data, gets nothing. The map is the one the compliance E2E
 *   suite uses for the same gap.
 *
 *   FIRST FAIL: registerStep did not exist; the publish answer said nothing.
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { appDataMapKey } from '../../src/services/data-map/data-map-types.js';
import { appDataMapId } from '../../src/services/app/app-ref.js';
import { writeDoc } from '../../src/services/compliance/docs.js';
import { registerStep } from '../../src/services/compliance/register-step.js';

const NODE = 'n1';
const config = { nodeId: NODE, baseUrl: 'https://node.test' } as unknown as AimeatConfig;
const APP = 'crm.html';
let storage: Storage;

const row = (personalData: string, readers = 'named-people') => ({
  what: 'crm.customers', holds: 'names and e-mail addresses', kind: 'register', usedFor: 'user-returns-to-read',
  where: 'owner-memory-private', owner: 'person', readers, writers: ['person-in-the-ui'], shape: 'collection-under-one-key',
  keptFor: 'until-deleted', lossRisk: 'only-copy', personalData, why: 'The owner keeps customers with colleagues.',
});

async function mapWith(held: unknown[]): Promise<void> {
  const now = new Date().toISOString();
  await storage.setMemory({
    key: appDataMapKey(appDataMapId(APP)), ownerGaii: `alice@${NODE}`,
    value: { spec: 'aimeat.datamap/2', what: 'A customer list.', usedFor: 'Keeping in touch.', form: 'one-person',
      arrangement: 'One record.', machinery: [], leaves: [], elsewhere: [], held },
    visibility: 'public', tags: ['datamap'], ttlHours: null, version: 1, createdAt: now, updatedAt: now,
  } as never);
}

beforeEach(() => { storage = new SqliteStorage(':memory:') as unknown as Storage; });

describe('registerStep', () => {
  it('tells an app with personal data and no register the calls that write one', async () => {
    await mapWith([row('yes')]);
    const step = await registerStep({ storage, config }, 'alice', APP);
    expect(step).toContain('aimeat_compliance_register_read { part: "registers_draft", scope: "app", app: "crm.html" }');
    expect(step).toContain('aimeat_compliance_register_write');
    expect(step).toContain('Do not guess them');
  });

  it('says nothing once the app has a personal register', async () => {
    await mapWith([row('yes')]);
    await writeDoc(storage, NODE, 'registers', { kind: 'app', ownerName: 'alice', app: APP },
      { items: [{ id: 'crm', title: 'Customers', type: 'personal', purpose: 'x', legalBasis: 'contract' }] } as never, 'alice');
    expect(await registerStep({ storage, config }, 'alice', APP)).toBeNull();
  });

  it('says nothing for an app without a map or without personal data', async () => {
    expect(await registerStep({ storage, config }, 'alice', APP)).toBeNull();
    await mapWith([row('no')]);
    expect(await registerStep({ storage, config }, 'alice', APP)).toBeNull();
  });
});
