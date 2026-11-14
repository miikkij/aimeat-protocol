/**
 * @file test/unit/compliance-lia.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The balancing test (legitimate interests assessment) without a server:
 *     - the rule: which register needs a test, and the named reason when one does not (an app only
 *       its user sees, a trial, a data map the node cannot read, special category data);
 *     - an approved test reads as open again when more people see the data or new regulated data
 *       appears, and never because fewer do;
 *     - the draft answers only the questions the node can see, on positive evidence;
 *     - the Excel workbook opens with the node's own spreadsheet reader and carries every question,
 *       and the PDF is a PDF;
 *     - a trial that ended: the owner is asked once per fortnight, the gap list names the open
 *       decision, and no balancing test is asked until the owner says the app goes into use.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-lia.test.ts
 * @version-history
 *   v1.1.0 — 2026-11-14 — The setting compliance.balancing_test: only required shows a gap or asks the owner; off refuses a write.
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { SqliteStorage } from '../../src/storage/providers/sqlite/index.js';
import type { Storage } from '../../src/storage/interface.js';
import type { AimeatConfig } from '../../src/config.js';
import { loadConfig } from '../../src/config.js';
import { LIA_QUESTION_IDS } from '../../src/data/compliance-lia.js';
import { liaNeedOf, liaStanding, trialState } from '../../src/services/compliance/lia-need.js';
import { factAnswers } from '../../src/services/compliance/lia-draft.js';
import { liaMarkdown, renderLiaPdf, renderLiaXlsx } from '../../src/services/compliance/lia-render.js';
import { LiaSchema, type ComplianceLia, type ComplianceLiaFacts } from '../../src/services/compliance/lia-schemas.js';
import { prepareTrialWrite } from '../../src/services/compliance/lia-write.js';
import { writeDoc, readDoc } from '../../src/services/compliance/docs.js';
import { scopeGaps } from '../../src/services/compliance/scope-gaps.js';
import { askOwnersAboutExpiredTrials } from '../../src/services/compliance/trial-job.js';
import { extractFileText } from '../../src/services/file-text/index.js';
import { NOTIF_PREFIX } from '../../src/services/notify.js';
import type { ComplianceRegister } from '../../src/services/compliance/docs-schemas.js';
import { appDataMapKey } from '../../src/services/data-map/data-map-types.js';

const reg = (over: Partial<ComplianceRegister> = {}): ComplianceRegister => ({
  id: 'team', title: 'Team contacts', type: 'personal', legalBasis: ['legitimate-interests'], ...over,
});
const need = (r: ComplianceRegister, reach: Parameters<typeof liaNeedOf>[1]['reach'], mapDomains: string[] = [], trial: Parameters<typeof liaNeedOf>[1]['trial'] = 'none') =>
  liaNeedOf(r, { reach, mapDomains, trial });

describe('when a register needs a balancing test', () => {
  it('a register on another basis, or with no personal data, is not asked the question', () => {
    expect(need(reg({ legalBasis: ['contract'] }), 'exposed')).toBeNull();
    expect(need(reg({ type: 'none' }), 'exposed')).toBeNull();
    expect(need(reg({ legalBasis: undefined }), 'shared')).toBeNull();
  });

  it('data others can see needs one; data only its user sees does not', () => {
    expect(need(reg(), 'shared')).toMatchObject({ need: 'required', reason: 'legitimate-interests' });
    expect(need(reg(), 'exposed')).toMatchObject({ need: 'required' });
    expect(need(reg(), 'self')).toMatchObject({ need: 'none', reason: 'only-its-user' });
    expect(need(reg(), 'none')).toMatchObject({ need: 'none', reason: 'only-its-user' });
    expect(need(reg(), 'unknown')).toMatchObject({ need: 'none', reason: 'reach-unknown' });
  });

  it('regulated data needs one whoever reads it, from the register or from the data map', () => {
    expect(need(reg({ domains: ['employment'] }), 'self')).toMatchObject({ need: 'required', domains: ['employment'] });
    expect(need(reg(), 'self', ['employment'])).toMatchObject({ need: 'required', domains: ['employment'] });
  });

  it('a trial exempts a shared app with no regulated data, and nothing else', () => {
    expect(need(reg(), 'shared', [], 'active')).toMatchObject({ need: 'none', reason: 'trial' });
    expect(need(reg(), 'shared', [], 'expired')).toMatchObject({ need: 'none', reason: 'trial-expired' });
    expect(need(reg(), 'shared', [], 'ended')).toMatchObject({ need: 'required' });
    expect(need(reg(), 'exposed', [], 'active')).toMatchObject({ need: 'required' });
    expect(need(reg(), 'shared', ['employment'], 'active')).toMatchObject({ need: 'required' });
  });

  it('special category data gets no test at all', () => {
    for (const d of ['health', 'biometric-genetic', 'special-category']) {
      expect(need(reg(), 'shared', [d])).toMatchObject({ need: 'not-allowed', reason: 'special-category' });
      expect(need(reg({ domains: [d] }), 'self', [], 'active')).toMatchObject({ need: 'not-allowed' });
    }
  });
});

describe('where a written test stands', () => {
  const now = Date.parse('2026-11-13T00:00:00Z');
  const approved = (over: Partial<ComplianceLia> = {}): ComplianceLia => ({
    id: 'lia-team', registerId: 'team', status: 'approved', approvedOn: { reach: 'shared', domains: ['employment'] }, reviewAt: '2027-11-13T00:00:00Z', ...over,
  });

  it('a draft is a draft; an approved one stays approved while the app is as it was', () => {
    expect(liaStanding(approved({ status: 'draft' }), now, { reach: 'exposed', domains: [] }).state).toBe('draft');
    expect(liaStanding(approved(), now, { reach: 'shared', domains: ['employment'] }).state).toBe('approved');
  });

  it('a wider reach or a new regulated domain opens it again; a narrower reach does not', () => {
    expect(liaStanding(approved(), now, { reach: 'exposed', domains: ['employment'] })).toEqual({ state: 'reopened', changed: { reachFrom: 'shared', reachTo: 'exposed' } });
    expect(liaStanding(approved(), now, { reach: 'shared', domains: ['employment', 'children'] })).toEqual({ state: 'reopened', changed: { newDomains: ['children'] } });
    expect(liaStanding(approved(), now, { reach: 'self', domains: [] }).state).toBe('approved');
  });

  it('a passed review date is due', () => {
    expect(liaStanding(approved({ reviewAt: '2026-01-01T00:00:00Z' }), now, { reach: 'shared', domains: ['employment'] }).state).toBe('review-due');
  });
});

const facts = (over: Partial<ComplianceLiaFacts> = {}): ComplianceLiaFacts => ({
  purposeText: 'Reaching colleagues.', legalBasis: ['legitimate-interests'], dataCategories: ['contacts.*: names and phone numbers'],
  minimisation: [], domains: [], subjects: [], usesAi: false, aiEvidence: [], reach: 'shared', privacyNotice: false,
  nodeSafeguards: [{ area: 'encryption', text: 'Secrets are encrypted on disk.' }], reminders: [], readAt: '2026-11-13T00:00:00Z', ...over,
});

describe('the draft', () => {
  it('answers nothing without evidence', () => {
    expect(factAnswers(facts())).toEqual({});
  });

  it('answers yes only to what the app itself shows', () => {
    expect(factAnswers(facts({ privacyNotice: true, usesAi: true, domains: ['employment'] })))
      .toEqual({ 'balance-informed': 'yes', 'balance-dependent': 'yes', 'balance-ai-profiling': 'yes' });
  });

  it('a stored test names only questions of the set', () => {
    expect(LiaSchema.safeParse({ id: 'a', registerId: 'team', answers: { 'interest-lawful': 'yes' } }).success).toBe(true);
    expect(LiaSchema.safeParse({ id: 'a', registerId: 'team', answers: { 'made-up': 'yes' } }).success).toBe(false);
    expect(LiaSchema.safeParse({ id: 'a', registerId: 'team', answers: { 'interest-lawful': 'maybe' } }).success).toBe(false);
  });
});

describe('the files', () => {
  const lia: ComplianceLia = {
    id: 'lia-team', registerId: 'team', status: 'approved', language: 'fi', facts: facts({ domains: ['employment'] }),
    answers: Object.fromEntries(LIA_QUESTION_IDS.map(q => [q, 'yes' as const])),
    notes: { basis: 'Sopimus ei kata tätä & <muuta>.' },
    outcome: { result: 'suitable', summary: 'Etu on todellinen.' },
    approvedBy: 'alice@node', approvedAt: '2026-11-13T10:00:00Z', reviewAt: '2027-11-13T10:00:00Z',
    answerSources: { 'answers.interest-lawful': 'ai', 'notes.basis': 'human', outcome: 'human' },
  };
  const ctx = { app: 'crm.html', registerTitle: 'Team contacts', standing: 'approved' as const };

  it('the workbook opens with the spreadsheet reader and carries every question, in the test\'s language', async () => {
    const bytes = await renderLiaXlsx(lia, ctx);
    const read = await extractFileText(bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'lia.xlsx');
    expect(read?.kind).toBe('spreadsheet');
    const text = read!.text;
    expect(text).toContain('Tasapainotesti');
    expect(text).toContain('Onko etu lainmukainen?');
    expect(text).toContain('Sopimus ei kata tätä & <muuta>.');
    expect(text).toContain('Oikeutettu etu soveltuu tähän käsittelyyn');
    expect(text).toContain('alice@node');
    expect(text).toContain('Työsuhde');
    // 16 questions, each on a row of its own.
    expect(text.split('\n').filter(l => l.includes('Kyllä')).length).toBeGreaterThanOrEqual(LIA_QUESTION_IDS.length);
  });

  it('the PDF is a PDF, and the Markdown says who gave each answer', async () => {
    const pdf = await renderLiaPdf(lia, ctx);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const md = liaMarkdown(lia, { ...ctx, lang: 'en' });
    expect(md).toContain('Is the interest lawful? **Yes**');
    expect(md).toContain('Source: an AI');
    expect(md).toContain('Approved by:** alice@node');
  });
});

describe('a trial that ended', () => {
  const NODE = 'lia-trial-node';
  const OWNER = 'alice';
  const GHII = `${OWNER}@${NODE}`;
  const APP = 'teamtool.html';
  const scope = { kind: 'app' as const, ownerName: OWNER, app: APP };
  const DAY = 86_400_000;
  let storage: Storage;
  let config: AimeatConfig;
  const t0 = Date.parse('2026-11-13T08:00:00Z');
  const notices = async () => (await storage.listAllMemory({ ownerPrefix: GHII, prefix: NOTIF_PREFIX, limit: 100 })).items
    .filter(r => (r.value as { type?: string })?.type === 'compliance_trial_expired');

  beforeAll(async () => {
    storage = new SqliteStorage(':memory:') as unknown as Storage;
    // A trial exempts an app from a test the server requires; under the default, optional, nothing is asked.
    config = { ...loadConfig().config, nodeId: NODE, baseUrl: 'https://node.test', balancingTest: 'required' };
    const at = new Date(t0 - DAY).toISOString();
    await storage.createOwner({ name: OWNER, displayName: OWNER, publicKey: 'pk', roles: ['owner'], createdAt: at } as never);
    const data = Buffer.from('<html></html>');
    await storage.createApp({
      ownerGaii: GHII, ownerName: OWNER, filename: APP, versionNumber: 1,
      manifest: { name: 'Team tool', description: 'd', version: '1.0.0', author: OWNER, category: 'tool', tags: [] } as never,
      mimeType: 'text/html', size: data.length, data, createdAt: at,
    });
    await storage.setMemory({
      ownerGaii: GHII, key: appDataMapKey('teamtool'), visibility: 'public', tags: ['datamap'], version: 1, createdAt: at, updatedAt: at,
      value: {
        spec: 'aimeat.datamap/2', what: 'A team tool.', usedFor: 'Reaching colleagues.', form: 'group', arrangement: 'One workspace.', machinery: [], leaves: [], elsewhere: [], source: 'declared', at,
        held: [{ what: 'contacts.*', holds: 'names and phone numbers', kind: 'register', usedFor: 'shown-as-a-list', where: 'organism-workspace', owner: 'organism', readers: 'organism-members', writers: ['person-in-the-ui'], shape: 'one-per-thing', keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'yes', why: 'The team reads it.', domains: [] }],
      },
    } as never);
    await writeDoc(storage, NODE, 'registers', scope, { items: [reg({ retentionMonths: 12, reviewedAt: at })] }, OWNER);
    const trial = await prepareTrialWrite({ storage, config }, scope, { days: 60 }, t0);
    if (!trial.ok) throw new Error(trial.message);
    await writeDoc(storage, NODE, 'trial', scope, trial.doc, OWNER);
  });

  const kinds = async (now: number) => (await scopeGaps({ storage, config }, scope, { now })).map(g => g.kind);

  it('while the trial runs: no balancing test is asked, no trial gap, and the job asks nobody', async () => {
    expect(trialState(await readDoc(storage, NODE, 'trial', scope), t0 + DAY)).toBe('active');
    const k = await kinds(t0 + DAY);
    expect(k).not.toContain('lia-missing');
    expect(k).not.toContain('app-trial-expired');
    expect(await askOwnersAboutExpiredTrials(storage, config, { now: new Date(t0 + DAY) })).toEqual({ asked: 0 });
  });

  it('after it ends: the owner is asked once, the gap names the open decision, and still no balancing test is asked', async () => {
    const later = t0 + 61 * DAY;
    expect(await askOwnersAboutExpiredTrials(storage, config, { now: new Date(later) })).toEqual({ asked: 1 });
    expect((await notices()).length).toBe(1);
    expect(await askOwnersAboutExpiredTrials(storage, config, { now: new Date(later + DAY) })).toEqual({ asked: 0 });
    expect((await notices()).length).toBe(1);
    expect(await askOwnersAboutExpiredTrials(storage, config, { now: new Date(later + 15 * DAY) })).toEqual({ asked: 1 });
    expect((await notices()).length).toBe(2);
    const k = await kinds(later);
    expect(k).toContain('app-trial-expired');
    expect(k).not.toContain('lia-missing');
  });

  it('when the owner says it goes into use: the trial gap goes and the balancing test is asked', async () => {
    const later = t0 + 62 * DAY;
    const end = await prepareTrialWrite({ storage, config }, scope, { end: true }, later);
    if (!end.ok) throw new Error(end.message);
    await writeDoc(storage, NODE, 'trial', scope, end.doc, OWNER);
    const k = await kinds(later);
    expect(k).not.toContain('app-trial-expired');
    expect(k).toContain('lia-missing');
    expect(await askOwnersAboutExpiredTrials(storage, config, { now: new Date(later + 30 * DAY) })).toEqual({ asked: 0 });
  });

  it('the setting decides: optional and off show no gap and ask nobody, off refuses a write; required asks', async () => {
    const later = t0 + 120 * DAY;
    const restart = await prepareTrialWrite({ storage, config }, scope, { days: 10 }, later - 30 * DAY);
    if (!restart.ok) throw new Error(restart.message);
    await writeDoc(storage, NODE, 'trial', scope, restart.doc, OWNER);
    const under = (mode: 'required' | 'optional' | 'off') => ({ storage, config: { ...config, balancingTest: mode } });
    for (const mode of ['optional', 'off'] as const) {
      const k = (await scopeGaps(under(mode), scope, { now: later })).map(g => g.kind);
      expect(k.filter(x => x.startsWith('lia-') || x === 'app-trial-expired')).toEqual([]);
      expect(await askOwnersAboutExpiredTrials(storage, under(mode).config, { now: new Date(later) })).toEqual({ asked: 0 });
    }
    expect(await prepareTrialWrite(under('off'), scope, { days: 5 })).toMatchObject({ ok: false, code: 'BALANCING_TEST_OFF' });
    expect((await prepareTrialWrite(under('optional'), scope, { days: 5 })).ok).toBe(true);
    const req = (await scopeGaps(under('required'), scope, { now: later })).map(g => g.kind);
    expect(req).toContain('app-trial-expired');
  });

  it('a trial is 1 to 180 days, and an app that is no trial has none to end', async () => {
    expect((await prepareTrialWrite({ storage, config }, scope, { days: 181 })).ok).toBe(false);
    expect((await prepareTrialWrite({ storage, config }, scope, { days: 0 })).ok).toBe(false);
    expect((await prepareTrialWrite({ storage, config }, scope, { expiresAt: '2099-01-01' })).ok).toBe(false);
    const other = { kind: 'app' as const, ownerName: OWNER, app: 'other.html' };
    expect(await prepareTrialWrite({ storage, config }, other, { end: true })).toMatchObject({ ok: false, code: 'NO_TRIAL' });
  });
});
