/**
 * @file test/unit/name-bound-grants-erasure.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An operator's beneficiary approval and an accountant grant name a person by
 *   `name@node`, and an erased name is released for reuse. Neither passes to the next person who
 *   registers the name: the erasure removes them (services/name-bound-grants-erasure.ts), and an
 *   entry an older erasure left is refused at the time of use (services/account-instance.ts). The
 *   usage cases pass before and after: a live verified beneficiary stays payable, a live accountant
 *   reads the client's books, and the operator and the client can name the new holder explicitly.
 *   Runs on SQLite in memory, and on PostgreSQL too when DATABASE_URL is set.
 * @usage cd aimeat && pnpm exec vitest run test/unit/name-bound-grants-erasure.test.ts
 * @version-history
 *   2026-10-27 -- Initial (secaudit2026oct26: beneficiary-release and accountant-access name reuse).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { requirePostgresWhenAsked } from './postgres-arm.js';
import { createStorage } from '../../src/storage/storage-factory.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { eraseOwner } from '../../src/services/owner-erasure.js';
import { beneficiaryEligibility, putApproval } from '../../src/commerce/beneficiary-release.js';
import { grantAccountant, listAccountants, resolveFinanceOwner } from '../../src/services/finance/accountant-access.js';
import { writeNewAgreement } from '../../src/services/compliance-agreements.js';
import { counterpartyHolds } from '../../src/services/compliance-agreements-access.js';
import { OptionsSchema, type Agreement } from '../../src/services/compliance-agreements-schemas.js';

requirePostgresWhenAsked('name-bound-grants-erasure');

type TestStorage = Storage & { close(): void | Promise<void> };
const names = ['sqlite', ...(process.env.DATABASE_URL ? ['postgres-kysely'] : [])];
const providers = new Map<string, TestStorage>();
beforeAll(async () => {
  for (const name of names) providers.set(name, await createStorage({
    provider: name === 'sqlite' ? 'sqlite' : 'postgres-kysely', sqlitePath: ':memory:', dbUrl: process.env.DATABASE_URL,
  }) as TestStorage);
}, 60_000);
afterAll(async () => { for (const s of providers.values()) await s.close(); });

const NODE = `nbg-${randomUUID().slice(0, 6)}`;
const config = { nodeId: NODE } as AimeatConfig;
const OLD = '2026-01-01T00:00:00.000Z';

async function account(s: Storage, name: string, createdAt: string): Promise<void> {
  await s.createOwner({ name, displayName: name, publicKey: 'pk', roles: ['owner'], createdAt });
  await s.createGHII({ ghii: `${name}@${NODE}`, username: name, nodeId: NODE, ownerName: name, displayName: name,
    verificationLevel: 0, totpEnabled: false, createdAt, updatedAt: createdAt });
}
const asReader = (reader: string, client: string) => ({ auth: { owner: reader }, query: { owner: client } }) as unknown as Request;
const reads = (s: Storage, reader: string, client: string) => resolveFinanceOwner(config, s, asReader(reader, client)).then(() => true, () => false);

describe.each(names)('%s: a beneficiary approval and an accountant grant stay with the erased person', provider => {
  const tag = () => randomUUID().slice(0, 6);

  it('erased through the account erasure: the next holder of the name is neither payable nor a reader', async () => {
    const s = providers.get(provider)!;
    const alice = `alice${tag()}`, bob = `bob${tag()}`;
    await account(s, alice, OLD); await account(s, bob, OLD);
    await putApproval(s, { ghii: `${bob}@${NODE}`, state: 'verified', method: 'contract-on-file', verifiedBy: `op@${NODE}` });
    await grantAccountant(config, s, `${alice}@${NODE}`, bob);
    expect((await beneficiaryEligibility(s, config, `${bob}@${NODE}`)).eligible).toBe(true);
    expect(await reads(s, bob, alice)).toBe(true);

    await eraseOwner(s, NODE, bob);
    await account(s, bob, new Date().toISOString());
    const gate = await beneficiaryEligibility(s, config, `${bob}@${NODE}`);
    expect(gate.eligible).toBe(false);
    expect(gate.reason).toBe('BENEFICIARY_UNVERIFIED');
    expect(await reads(s, bob, alice)).toBe(false);
    expect(await listAccountants(s, `${alice}@${NODE}`)).not.toContain(`${bob}@${NODE}`);

    // The operator and the client can name the new holder explicitly.
    await putApproval(s, { ghii: `${bob}@${NODE}`, state: 'verified', method: 'contract-on-file', verifiedBy: `op@${NODE}` });
    expect((await beneficiaryEligibility(s, config, `${bob}@${NODE}`)).eligible).toBe(true);
    await grantAccountant(config, s, `${alice}@${NODE}`, bob);
    expect(await reads(s, bob, alice)).toBe(true);
  });

  it('left by an older erasure: the entries stay stored, and the next holder is still refused at use', async () => {
    const s = providers.get(provider)!;
    const alice = `alice${tag()}`, carl = `carl${tag()}`;
    await account(s, alice, OLD); await account(s, carl, OLD);
    await putApproval(s, { ghii: `${carl}@${NODE}`, state: 'verified', method: 'contract-on-file', verifiedBy: `op@${NODE}` });
    await grantAccountant(config, s, `${alice}@${NODE}`, carl);
    // An erasure from before this step: the account goes, the others' records stay.
    await s.deleteGHII(`${carl}@${NODE}`);
    await s.deleteOwner(carl);
    await new Promise(r => setTimeout(r, 20));
    await account(s, carl, new Date().toISOString());
    expect((await beneficiaryEligibility(s, config, `${carl}@${NODE}`)).eligible).toBe(false);
    expect(await reads(s, carl, alice)).toBe(false);
  });

  it('an agreement from before the naming time: its counterparty is the account that held the name then', async () => {
    const s = providers.get(provider)!;
    const ella = `ella${tag()}`, finn = `finn${tag()}`;
    await account(s, ella, OLD); await account(s, finn, OLD);
    const agreementOf = (account: string): Agreement => ({
      id: `dpa-${randomUUID().replace(/-/g, '').slice(0, 12)}`, type: 'dpa-art28', template: 'eu-scc-2021-915', language: 'en', ourRole: 'processor', product: 'custom',
      subject: 'Test', counterparty: { name: 'Customer Ltd', account },
      versions: [{
        n: 1, status: 'draft', sources: {}, options: OptionsSchema.parse({}), createdAt: OLD, createdBy: 'op', signatures: [], remindersSent: [],
        annexes: {
          I: { controller: { name: 'Customer Ltd' }, processor: { name: 'Operator Ltd' } },
          II: { subjects: ['users'], categories: ['accounts'], sensitive: 'No.', nature: 'Hosting.', purposes: 'Service.', duration: 'Term.' },
          III: { measures: [], assistance: 'Export.' }, IV: { subprocessors: [] },
        },
      }],
      history: [{ at: '2026-02-01T00:00:00.000Z', by: 'op', event: 'created' }], createdAt: '2026-02-01T00:00:00.000Z', updatedAt: '2026-02-01T00:00:00.000Z',
    });
    const kept = await writeNewAgreement(s, NODE, agreementOf(`${ella}@${NODE}`));
    expect(await counterpartyHolds(s, kept)).toBe(true);
    const left = await writeNewAgreement(s, NODE, agreementOf(`${finn}@${NODE}`));
    await s.deleteGHII(`${finn}@${NODE}`);
    await s.deleteOwner(finn);
    await account(s, finn, new Date().toISOString());
    expect(await counterpartyHolds(s, left)).toBe(false);
  });

  it('designed use: a live verified beneficiary is payable and a live accountant reads the books', async () => {
    const s = providers.get(provider)!;
    const alice = `alice${tag()}`, dora = `dora${tag()}`;
    await account(s, alice, OLD); await account(s, dora, OLD);
    await putApproval(s, { ghii: `${dora}@${NODE}`, state: 'verified', method: 'contract-on-file', verifiedBy: `op@${NODE}` });
    await grantAccountant(config, s, `${alice}@${NODE}`, dora);
    expect((await beneficiaryEligibility(s, config, `${dora}@${NODE}`)).eligible).toBe(true);
    expect(await reads(s, dora, alice)).toBe(true);
    expect(await listAccountants(s, `${alice}@${NODE}`)).toEqual([`${dora}@${NODE}`]);
  });
});
