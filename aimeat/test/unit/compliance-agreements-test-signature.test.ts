/**
 * @file test/unit/compliance-agreements-test-signature.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A wallet signature that chains to the EU reference wallet's test roots has no legal
 *   effect (docsign/validate.ts TEST_TRUST_ANCHOR). On a data processing agreement it is recorded with
 *   the level `test`, its history line says so, and the in-force line names it, while the flow itself
 *   is unchanged: a version both parties signed is in force as before. The other levels keep their
 *   names (secaudit2026oct26, syncDocsign:test-anchor-wallet-signature-as-advanced).
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-agreements-test-signature.test.ts
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { describe, it, expect } from 'vitest';
import { completeIfSigned, docsignLevel, signedLine } from '../../src/services/compliance-agreements-sign.js';
import { OptionsSchema, type Agreement, type AgreementSignature, type AgreementVersion } from '../../src/services/compliance-agreements-schemas.js';

const now = '2026-10-27T10:00:00.000Z';
const wallet = (level: string, test: boolean) => ({ validation: { level, test } });

function version(signatures: AgreementSignature[]): AgreementVersion {
  return {
    n: 2, status: 'sent', sources: {}, options: OptionsSchema.parse({}), createdAt: now, createdBy: 'op@n', signatures, remindersSent: [],
    annexes: {
      I: { controller: { name: 'Asiakas Oy' }, processor: { name: 'Overscale Solutions Oy' } },
      II: { subjects: ['käyttäjät'], categories: ['tilit'], sensitive: 'Ei.', nature: 'Hostaus.', purposes: 'Palvelu.', duration: 'Sopimuksen ajan.' },
      III: { measures: [{ area: 'transmission', text: 'HTTPS.', source: 'evidence' }], assistance: 'Vienti ja poisto.' },
      IV: { subprocessors: [] },
    },
  };
}
function agreement(v: AgreementVersion): Agreement {
  return {
    id: 'dpa-abcdef123456', type: 'dpa-art28', template: 'eu-scc-2021-915', language: 'fi', ourRole: 'processor', product: 'place',
    subject: 'Palvelu', counterparty: { name: 'Asiakas Oy' }, versions: [v], history: [], createdAt: now, updatedAt: now,
  };
}
const sig = (party: 'controller' | 'processor', method: AgreementSignature['method'], level: AgreementSignature['level']): AgreementSignature =>
  ({ party, method, level, signer: `${party}@n`, at: now });

describe('a test-anchored wallet signature on an agreement', () => {
  it('is recorded with the level test, never advanced', () => {
    expect(docsignLevel(wallet('unknown', true))).toBe('test');
    expect(docsignLevel(wallet('qualified', true))).toBe('test');
  });

  it('says in its history line that it is a test with no legal effect', () => {
    const line = signedLine(sig('controller', 'eudi-wallet', 'test'));
    expect(line).toMatch(/test/i);
    expect(line).toMatch(/no legal effect/);
  });

  it('still completes the version, and the in-force line names the test signature', () => {
    const v = version([sig('controller', 'eudi-wallet', 'test'), sig('processor', 'aimeat', 'aimeat')]);
    const out = completeIfSigned(agreement(v), v, now);
    expect(out.versions[0]!.status).toBe('signed');
    const last = out.history[out.history.length - 1]!;
    expect(last.event).toBe('in-force');
    expect(last.detail).toMatch(/controller/);
    expect(last.detail).toMatch(/no legal effect/);
  });
});

describe('the other levels keep working as before', () => {
  it('maps a real wallet signature and an AIMEAT signature as before', () => {
    expect(docsignLevel(wallet('qualified', false))).toBe('qualified');
    expect(docsignLevel(wallet('advanced', false))).toBe('advanced');
    expect(docsignLevel(undefined)).toBe('aimeat');
  });

  it('keeps the history lines and the in-force line word for word', () => {
    expect(signedLine(sig('processor', 'eudi-wallet', 'qualified'))).toBe('processor signed (eudi-wallet, qualified).');
    expect(signedLine(sig('processor', 'aimeat', 'aimeat'))).toBe('processor signed (aimeat, aimeat).');
    const v = version([sig('controller', 'aimeat', 'aimeat'), sig('processor', 'aimeat', 'aimeat')]);
    const out = completeIfSigned(agreement(v), v, now);
    expect(out.versions[0]!.status).toBe('signed');
    expect(out.history[out.history.length - 1]!.detail).toBe('Version 2 signed by both parties; in force.');
  });
});
