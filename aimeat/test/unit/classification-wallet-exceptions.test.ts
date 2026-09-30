/**
 * @file test/unit/classification-wallet-exceptions.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The exceptions list on the Data Wallet and the admin Security page (Jouni's decisions
 *   of 2026-09-30), executed as the browser runs them: makeException sends the item's address with
 *   the act, the trimmed reason and the last day; withdrawException names the exception; an
 *   exception's act and state in words; and an exception row of the audit log said as its event,
 *   act and reason instead of the server's ids. The words are Finnish, from locales/fi.json served to
 *   the page's own loadTranslations, so a row that fell back to the key would fail. The group's
 *   vnodes are walked without a DOM: the filters pick the rows, and only a person's exception in
 *   force has "Peru poikkeus".
 * @usage cd aimeat && pnpm exec vitest run test/unit/classification-wallet-exceptions.test.ts
 * @version-history
 *   v1.1.0 — 2026-09-30 — A withdrawn row is not faded: a grey "peruttu" status mark, the act in grey
 *     words, and "peruttu {pvm}, perui {name}"; each filter's own empty line.
 *   v1.0.0 — 2026-09-30 — Initial (Jouni's decisions of 2026-09-30).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiPost = vi.fn(async (_path: string, _body: unknown) => ({ data: { id: 'x' } }));
const apiDelete = vi.fn(async (_path: string) => ({ data: { id: 'x', withdrawnAt: 'now' } }));
const apiGet = vi.fn(async (_path: string) => ({ data: { exceptions: [{ id: 'a' }] } }));
vi.mock('/js/api.js', () => ({
  apiGet: (p: string) => apiGet(p), apiPut: vi.fn(), apiPost: (p: string, b: unknown) => apiPost(p, b), apiDelete: (p: string) => apiDelete(p),
}));

const cls = await import('../../public/js/services/classification.js');
const { t, loadTranslations } = await import('../../public/js/i18n.js');
const W = (key: string, vars?: Record<string, unknown>) => t('classification.exc.' + key, vars);

// The Finnish words as a person reads them: the locale files served to loadTranslations.
const here = dirname(fileURLToPath(import.meta.url));
vi.stubGlobal('fetch', async (url: string) => {
  const file = /\/locales\/([a-z]+)\.json/.exec(url)?.[1];
  const body = file ? readFileSync(join(here, '../../locales', `${file}.json`), 'utf-8') : '{}';
  return { ok: !!file, json: async () => JSON.parse(body) };
});
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
vi.stubGlobal('document', { documentElement: {}, cookie: '', addEventListener: () => undefined, removeEventListener: () => undefined });
await loadTranslations('fi');
const { exceptionsGroup, exceptionDialog } = await import('../../public/views/profile/data-wallet/classification-exceptions.js');

/** Every vnode under `v`, depth first, children and props that hold vnodes included. */
function* walk(v: any): Generator<any> {
  if (!v || typeof v !== 'object') return;
  if (Array.isArray(v)) { for (const c of v) yield* walk(c); return; }
  yield v;
  for (const [k, p] of Object.entries(v.props ?? {})) if (k === 'children' || (p && typeof p === 'object')) yield* walk(p);
}
const text = (v: any): string => [...walk(v)].flatMap(n => [n.props?.children].flat().filter(c => typeof c === 'string' || typeof c === 'number')).join(' ');

describe("the exceptions list's client (decided 2026-09-30)", () => {
  beforeEach(() => { apiPost.mockClear(); apiDelete.mockClear(); apiGet.mockClear(); });

  it('makeException sends the address, the act, the trimmed reason and the last day; a row by its organism', async () => {
    await cls.makeException({ kind: 'memory', key: 'clsa.hidden', owner: 'bot#alice@n' }, { action: 'ai-send', reason: '  For IT support.  ', until: '2026-10-01T20:59:59.000Z' });
    expect(apiPost).toHaveBeenLastCalledWith('/v1/classification/exceptions',
      { kind: 'memory', key: 'clsa.hidden', owner: 'bot#alice@n', action: 'ai-send', reason: 'For IT support.', until: '2026-10-01T20:59:59.000Z' });
    await cls.makeException({ kind: 'row', key: 'ws1/deals/r1', organismId: 'o1' }, { action: 'leave', reason: 'Approved.', until: null });
    expect(apiPost).toHaveBeenLastCalledWith('/v1/classification/exceptions',
      { kind: 'row', organism_id: 'o1', ws: 'ws1', space: 'deals', row_id: 'r1', action: 'leave', reason: 'Approved.' });
  });

  it('readExceptions reads one level, and withdrawException names the exception', async () => {
    expect(await cls.readExceptions('node', { limit: 500 })).toEqual([{ id: 'a' }]);
    expect(apiGet).toHaveBeenLastCalledWith('/v1/classification/exceptions?level=node&limit=500');
    await cls.withdrawException('2026-09.abc/def');
    expect(apiDelete).toHaveBeenLastCalledWith('/v1/classification/exceptions/2026-09.abc%2Fdef');
  });

  it("says a person's act and an app's act in words, and where each exception stands", () => {
    expect(cls.exceptionActWord({ action: 'leave' })).toBe(W('act.leave'));
    expect(cls.exceptionActWord({ action: 'ai-send' })).toBe(W('act.aiSend'));
    expect(cls.exceptionActWord({ action: 'leave', auto: true })).toBe(W('auto.leave'));
    expect(cls.exceptionActWord({ action: 'lower', auto: true })).toBe(W('auto.lower'));
    const now = '2026-09-30T12:00:00.000Z';
    expect(cls.exceptionState({ auto: false, until: null }, now)).toBe('active');
    expect(cls.exceptionState({ auto: false, until: '2026-10-01T00:00:00.000Z' }, now)).toBe('active');
    expect(cls.exceptionState({ auto: false, until: '2026-09-29T00:00:00.000Z' }, now)).toBe('expired');
    expect(cls.exceptionState({ auto: false, withdrawnAt: '2026-09-30T10:00:00.000Z' }, now)).toBe('withdrawn');
    expect(cls.exceptionState({ auto: true }, now)).toBe('recorded');
  });

  it('the log has an exception filter, and an exception row reads as its event, act and reason', () => {
    expect(cls.ACTIONS).toContain('exception');
    const row = (purpose: string) => cls.purposeWords({ labels: [] }, { action: 'exception', purpose });
    expect(row('made 2026-09.u1 (leave): The board approved it.'))
      .toBe(W('purpose', { event: W('event.made'), act: W('act.leave'), reason: 'The board approved it.' }));
    expect(row('used 2026-09.u1 (ai-send) → export:o1: Mail it: today.'))
      .toBe(W('purposeUsed', { event: W('event.used'), act: W('act.aiSend'), reason: 'Mail it: today.', where: W('where.export') }));
    expect(row('used 2026-09.u1 (ai-send) → shown: For IT.'))
      .toBe(W('purposeUsed', { event: W('event.used'), act: W('act.aiSend'), reason: 'For IT.', where: W('where.shown') }));
    expect(row('added to 2026-09.u2 (lower, automatic): app a/b.html lowered x → y'))
      .toBe(W('purpose', { event: W('event.addedTo'), act: W('auto.lower'), reason: 'app a/b.html lowered x → y' }));
    expect(row('made (leave, automatic, not stored): app sent it'))
      .toBe(W('purpose', { event: W('event.made'), act: W('auto.leave'), reason: 'app sent it' }));
    expect(row('something else')).toBe('something else');
    // In Finnish, as the Data Wallet's log shows it.
    expect(row('used 2026-09.u1 (ai-send) → shown: Tukipalvelu tarvitsee sen.'))
      .toBe('käytetty (näytetty tekoälylle): tekoäly saa lähettää. Perustelu: Tukipalvelu tarvitsee sen.');
    expect(cls.actionWord('exception')).toBe('poikkeus');
    expect(cls.exceptionActWord({ action: 'lower', auto: true })).toBe('sovellus laski luokitusta');
  });

  it('the group filters by who made it, and offers Withdraw only on a person\'s exception in force', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const list = [
      { id: 'p1', at: '2026-09-30T08:00:00Z', by: 'alice@n', byKind: 'human', scope: 'alice@n', ownerGaii: 'alice@n', target: { kind: 'memory', key: 'a' }, action: 'ai-send', reason: 'IT tarvitsee.', auto: false, until: future },
      { id: 'p2', at: '2026-09-29T08:00:00Z', by: 'alice@n', byKind: 'human', scope: 'bot#alice@n', ownerGaii: 'alice@n', target: { kind: 'memory', key: 'b' }, action: 'leave', reason: 'Vanha.', auto: false, until: null, withdrawnAt: '2026-09-30T09:00:00Z', withdrawnBy: 'alice@n' },
      { id: 'a1', at: '2026-09-28T08:00:00Z', by: 'eco:crm#alice@n', byKind: 'app', app: 'alice/crm.html', scope: 'alice@n', ownerGaii: 'alice@n', target: { kind: 'memory', key: 'c' }, action: 'lower', reason: 'app lowered', auto: true, until: null, count: 3 },
    ];
    const ex = { list, filter: 'all', setFilter: () => undefined, busy: false, withdraw: vi.fn(), making: null };
    const listOf = (v: any) => [...walk(v)].find(n => n.props?.cols === 'name-score-desc-doors');
    const all = listOf(exceptionsGroup(ex));
    expect(all.props.rows.map((e: any) => e.id)).toEqual(['p1', 'p2', 'a1']);
    expect(listOf(exceptionsGroup({ ...ex, filter: 'people' })).props.rows.map((e: any) => e.id)).toEqual(['p1', 'p2']);
    expect(listOf(exceptionsGroup({ ...ex, filter: 'apps' })).props.rows.map((e: any) => e.id)).toEqual(['a1']);
    const [p1, p2, a1] = list.map(e => all.props.render(e));
    expect(text(p1)).toContain('Peru poikkeus');
    expect(text(p1)).toContain('tekoäly saa lähettää');
    expect(text(p2)).not.toContain('Peru poikkeus');
    // Withdrawn: the row is not faded (the reason keeps its contrast), a grey status mark says
    // "peruttu" with the act beside it in grey words, and the state line names who withdrew it.
    expect(p2.props.faded).toBeFalsy();
    const marks = [...walk(p2)].filter(n => n.props?.kind === 'status' || n.props?.kind === 'word');
    expect(marks.map(n => [n.props.kind, n.props.tone ?? null, text(n)])).toEqual([['status', 'off', 'peruttu'], ['word', null, 'saa lähteä']]);
    expect([...walk(p2)].some(n => n.props?.sub === 'Vanha.')).toBe(true);
    expect([...walk(p2)].some(n => typeof n.props?.sub === 'string' && /^ihminen · .+ · peruttu .+, perui alice$/.test(n.props.sub))).toBe(true);
    // Without withdrawnBy (a record from before it was kept) it still says when.
    const bare = all.props.render({ ...list[1], withdrawnBy: undefined });
    expect([...walk(bare)].some(n => typeof n.props?.sub === 'string' && /· peruttu [^,]+$/.test(n.props.sub))).toBe(true);
    // In force: the act on the attention ground, no second mark.
    expect([...walk(p1)].filter(n => n.props?.kind === 'status').map(n => n.props.tone)).toEqual(['attention']);
    expect([...walk(p2)].some(n => typeof n.props?.meta === 'string' && n.props.meta.includes('agentti bot (alice)'))).toBe(true);
    expect(text(a1)).not.toContain('Peru poikkeus');
    expect(text(a1)).toContain('sovellus laski luokitusta');
    expect([...walk(a1)].some(n => typeof n.props?.sub === 'string' && n.props.sub.startsWith('sovellus · ') && n.props.sub.includes('3 kertaa'))).toBe(true);
    // Withdraw calls the handler with that exception.
    const door = [...walk(p1)].find(n => typeof n.props?.onClick === 'function');
    door.props.onClick();
    expect(ex.withdraw).toHaveBeenCalledWith(list[0]);
    expect(exceptionDialog(ex)).toBeNull();
  });

  it('each filter has its own empty line, on both levels', () => {
    const listOf = (v: any) => [...walk(v)].find(n => n.props?.cols === 'name-score-desc-doors');
    const base = { list: [], filter: 'all', setFilter: () => undefined, busy: false, withdraw: vi.fn(), making: null };
    for (const admin of [false, true]) {
      expect(listOf(exceptionsGroup({ ...base, filter: 'apps' }, { admin })).props.empty).toBe('Sovellukset eivät ole tehneet poikkeuksia.');
      expect(listOf(exceptionsGroup({ ...base, filter: 'people' }, { admin })).props.empty).toBe('Kukaan ei ole tehnyt poikkeusta.');
    }
    expect(listOf(exceptionsGroup(base)).props.empty).toBe(W('empty'));
    expect(listOf(exceptionsGroup(base, { admin: true })).props.empty).toBe(W('emptyNode'));
    // Only people's exceptions on the list: the apps filter still says its own line, not the general one.
    const onlyPeople = [{ id: 'p', at: '2026-09-30T08:00:00Z', by: 'alice@n', byKind: 'human', scope: 'alice@n', target: { kind: 'memory', key: 'a' }, action: 'leave', reason: 'x', auto: false, until: null }];
    const apps = listOf(exceptionsGroup({ ...base, list: onlyPeople, filter: 'apps' }));
    expect(apps.props.rows).toEqual([]);
    expect(apps.props.empty).toBe('Sovellukset eivät ole tehneet poikkeuksia.');
  });
});
