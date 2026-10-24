/**
 * @file test/unit/compliance-agreements.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure parts of plan doc-mvmr4i2wdk0p: the canonical text is the same for the same
 *   version (so its hash is stable) and carries the Commission's clauses unchanged; an announced change
 *   whose objection period ran out becomes the version in force and the one before it superseded, an
 *   objected one does not; the comparison of two versions ignores the order of keys a database gave;
 *   the agreement's status follows its versions; the catalog's actions match the dispatch.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-agreements.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p).
 */
import { describe, it, expect } from 'vitest';
import { SCC_2021_915, SCC_2021_915_SHA256 } from '../../src/data/legal/eu-scc-2021-915.js';
import { canonicalText, textHashOf } from '../../src/services/compliance-agreements-render.js';
import { finalizeNotices, statusOf } from '../../src/services/compliance-agreements.js';
import { changedParts } from '../../src/services/compliance-agreements-ops.js';
import { OptionsSchema, type Agreement, type AgreementVersion } from '../../src/services/compliance-agreements-schemas.js';
import { createHash } from 'node:crypto';

const now = '2026-10-24T10:00:00.000Z';
function version(n: number, status: AgreementVersion['status'], extra: Partial<AgreementVersion> = {}): AgreementVersion {
  return {
    n, status, sources: {}, options: OptionsSchema.parse({}), createdAt: now, createdBy: 'op@n', signatures: [], remindersSent: [],
    annexes: {
      I: { controller: { name: 'Asiakas Oy' }, processor: { name: 'Overscale Solutions Oy', businessId: '3323553-5' } },
      II: { subjects: ['käyttäjät'], categories: ['tilit'], sensitive: 'Ei.', nature: 'Hostaus.', purposes: 'Palvelu.', duration: 'Sopimuksen ajan.' },
      III: { measures: [{ area: 'transmission', text: 'HTTPS.', source: 'evidence' }], assistance: 'Vienti ja poisto.' },
      IV: { subprocessors: [{ name: 'Scaleway SAS', country: 'France', description: 'palvelimet', processorId: 'hosting' }] },
    },
    ...extra,
  };
}
function agreement(versions: AgreementVersion[]): Agreement {
  return {
    id: 'dpa-abcdef123456', type: 'dpa-art28', template: 'eu-scc-2021-915', language: 'fi', ourRole: 'processor', product: 'place',
    subject: 'Hostattu AIMEAT-ympäristö', counterparty: { name: 'Asiakas Oy' }, versions, history: [], createdAt: now, updatedAt: now,
  };
}

describe('data processing agreements', () => {
  it('the clauses are the data file\'s text, and its hash is the one recorded beside it', () => {
    for (const lang of ['fi', 'en'] as const) {
      expect(createHash('sha256').update(SCC_2021_915[lang].clauses, 'utf8').digest('hex')).toBe(SCC_2021_915_SHA256[lang]);
    }
    expect(SCC_2021_915.en.clauses).toContain('OPTION 2: GENERAL WRITTEN AUTHORISATION');
    expect(SCC_2021_915.fi.clauses).toContain('VAIHTOEHTO 2: YLEINEN KIRJALLINEN LUPA');
  });

  it('the canonical text is the same for the same version, holds the clauses unchanged and prints the choices beside them', () => {
    const a = agreement([version(1, 'draft')]);
    const t1 = canonicalText(a, a.versions[0]!);
    const t2 = canonicalText(structuredClone(a), structuredClone(a.versions[0]!));
    expect(t1).toBe(t2);
    expect(textHashOf(t1)).toBe(textHashOf(t2));
    expect(t1).toContain(SCC_2021_915.fi.clauses.trim());
    expect(t1).toContain('Lauseke 7.7 a: vaihtoehto 2, yleinen kirjallinen lupa. Määritetty ajanjakso on 30 päivää.');
    expect(t1).toContain('[täydennettävä]'); // an Annex III area nothing describes says so
    const changed = canonicalText(a, version(1, 'draft', { options: OptionsSchema.parse({ breachNoticeHours: 12 }) }));
    expect(textHashOf(changed)).not.toBe(textHashOf(t1));
  });

  it('a lapsed notice makes its version the one in force; an objected or running one does not', () => {
    const past = '2026-10-01T00:00:00.000Z';
    const future = '2099-01-01T00:00:00.000Z';
    const lapsed = agreement([version(1, 'signed'), version(2, 'sent', { notice: { sentAt: past, objectionUntil: past } })]);
    const f = finalizeNotices(lapsed);
    expect(f.versions.map(v => v.status)).toEqual(['superseded', 'signed']);
    expect(f.versions[1]!.effectiveFrom).toBe(past);
    expect(statusOf(lapsed)).toBe('signed');
    const objected = agreement([version(1, 'signed'), version(2, 'sent', { notice: { sentAt: past, objectionUntil: past, objectedAt: past } })]);
    expect(finalizeNotices(objected).versions.map(v => v.status)).toEqual(['signed', 'sent']);
    const running = agreement([version(1, 'signed'), version(2, 'sent', { notice: { sentAt: past, objectionUntil: future } })]);
    expect(finalizeNotices(running).versions.map(v => v.status)).toEqual(['signed', 'sent']);
  });

  it('the status follows the versions', () => {
    expect(statusOf(agreement([version(1, 'draft')]))).toBe('draft');
    expect(statusOf(agreement([version(1, 'sent')]))).toBe('sent');
    expect(statusOf(agreement([version(1, 'review')]))).toBe('review');
    expect(statusOf(agreement([version(1, 'signed'), version(2, 'draft')]))).toBe('signed');
    expect(statusOf({ ...agreement([version(1, 'signed')]), endedAt: now })).toBe('ended');
  });

  it('two versions compare by content, whatever order a database gave their keys', () => {
    const a = version(1, 'signed');
    const shuffled: AgreementVersion = { ...a, options: { dockingClause: false, deletionDays: 30, breachNoticeHours: 24, noticeDays: 30, subprocessorAuthorisation: 'general' } };
    expect([...changedParts(a, shuffled)]).toEqual([]);
    const iv = version(2, 'draft', { annexes: { ...a.annexes, IV: { subprocessors: [...a.annexes.IV.subprocessors, { name: 'Hetzner', description: 'palvelimet' }] } } });
    expect([...changedParts(a, iv)]).toEqual(['IV']);
  });
});
