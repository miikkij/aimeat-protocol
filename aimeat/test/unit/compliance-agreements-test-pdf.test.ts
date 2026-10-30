/**
 * @file test/unit/compliance-agreements-test-pdf.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A PDF signed elsewhere whose only valid signatures chain to the EU reference wallet's
 *   test roots has no legal effect, the same as a test wallet signature. Its review and the signature
 *   the operator's acceptance records carry the level `test`, never `advanced`; on production settings
 *   the version it completes is `test-signed` and not in force, and the history says the signature is
 *   a test. A PDF with a real valid signature keeps its level as before (secaudit2026oct26 outside-02b).
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-agreements-test-pdf.test.ts
 * @version-history
 *   2026-10-31 — Initial (secaudit2026oct26 outside-02b).
 */
import { describe, it, expect } from 'vitest';
import { acceptedCopyLevel, completeIfSigned, signedPdfLevel } from '../../src/services/compliance-agreements-sign.js';
import { OptionsSchema, ReviewSchema, type Agreement, type AgreementSignature, type AgreementVersion } from '../../src/services/compliance-agreements-schemas.js';

const now = '2026-10-31T10:00:00.000Z';
const valid = (level: string, source: string | null) => ({ level, trust: { source } });

function version(n: number, status: AgreementVersion['status'], signatures: AgreementSignature[]): AgreementVersion {
  return {
    n, status, sources: {}, options: OptionsSchema.parse({}), createdAt: now, createdBy: 'op@n', signatures, remindersSent: [],
    ...(status === 'signed' ? { signedAt: now, effectiveFrom: now } : {}),
    annexes: {
      I: { controller: { name: 'Asiakas Oy' }, processor: { name: 'Overscale Solutions Oy' } },
      II: { subjects: ['käyttäjät'], categories: ['tilit'], sensitive: 'Ei.', nature: 'Hostaus.', purposes: 'Palvelu.', duration: 'Sopimuksen ajan.' },
      III: { measures: [{ area: 'transmission', text: 'HTTPS.', source: 'evidence' }], assistance: 'Vienti ja poisto.' },
      IV: { subprocessors: [] },
    },
  };
}
function agreement(versions: AgreementVersion[]): Agreement {
  return {
    id: 'dpa-abcdef123456', type: 'dpa-art28', template: 'eu-scc-2021-915', language: 'fi', ourRole: 'processor', product: 'place',
    subject: 'Palvelu', counterparty: { name: 'Asiakas Oy' }, versions, history: [], createdAt: now, updatedAt: now,
  };
}
const sig = (party: 'controller' | 'processor', method: AgreementSignature['method'], level: AgreementSignature['level']): AgreementSignature =>
  ({ party, method, level, signer: `${party}@n`, at: now });

describe('the level of a PDF signed elsewhere', () => {
  it('is test when its only valid signatures chain to the EU reference wallet test roots', () => {
    expect(signedPdfLevel([valid('unknown', 'eudi-test-anchor')])).toBe('test');
    expect(signedPdfLevel([valid('qualified', 'eudi-test-anchor'), valid('advanced', 'eudi-test-anchor')])).toBe('test');
  });

  it('keeps the level of a real signature beside a test one, as before', () => {
    expect(signedPdfLevel([valid('unknown', 'eudi-test-anchor'), valid('advanced', 'eu-trusted-list')])).toBe('advanced');
    expect(signedPdfLevel([valid('qualified', 'eu-trusted-list')])).toBe('qualified');
    expect(signedPdfLevel([valid('advanced', 'operator-anchor')])).toBe('advanced');
    // A qualified level on a test chain does not lift a real advanced one to qualified.
    expect(signedPdfLevel([valid('qualified', 'eudi-test-anchor'), valid('advanced', 'eu-trusted-list')])).toBe('advanced');
  });

  it('a PDF with no valid signature reads advanced as before (its check fails, so nothing is recorded)', () => {
    expect(signedPdfLevel([])).toBe('advanced');
  });

  it('a review may carry the level test', () => {
    expect(ReviewSchema.shape.level.safeParse('test').success).toBe(true);
  });
});

describe('the signature an accepted copy records', () => {
  it('a PDF reviewed as test is recorded as test, never advanced', () => {
    expect(acceptedCopyLevel({ kind: 'pdf', level: 'test' })).toBe('test');
  });

  it('the other copies keep their levels', () => {
    expect(acceptedCopyLevel({ kind: 'pdf', level: 'qualified' })).toBe('qualified');
    expect(acceptedCopyLevel({ kind: 'pdf', level: 'advanced' })).toBe('advanced');
    expect(acceptedCopyLevel({ kind: 'pdf' })).toBe('advanced');
    expect(acceptedCopyLevel({ kind: 'scan', level: 'scanned' })).toBe('scanned');
  });
});

describe('a version completed by a test-certificate PDF', () => {
  it('on production settings is signed in test and not in force, and says it is a test certificate', () => {
    const v1 = version(1, 'signed', [sig('controller', 'aimeat', 'aimeat'), sig('processor', 'aimeat', 'aimeat')]);
    const v2 = version(2, 'sent', [sig('controller', 'external-pdf', 'test'), sig('processor', 'aimeat', 'aimeat')]);
    const out = completeIfSigned(agreement([v1, v2]), v2, now, { testSignaturesInForce: false });
    expect(out.versions[1]!.status).toBe('test-signed');
    expect(out.versions[0]!.status).toBe('signed');
    const last = out.history[out.history.length - 1]!;
    expect(last.event).toBe('test-signed');
    expect(last.detail).toMatch(/test certificate with no legal effect/);
  });

  it('on test settings comes into force as a test wallet signature does, and names the test', () => {
    const v = version(1, 'sent', [sig('controller', 'external-pdf', 'test'), sig('processor', 'aimeat', 'aimeat')]);
    const out = completeIfSigned(agreement([v]), v, now, { testSignaturesInForce: true });
    expect(out.versions[0]!.status).toBe('signed');
    expect(out.history[out.history.length - 1]!.detail).toMatch(/no legal effect/);
  });
});
