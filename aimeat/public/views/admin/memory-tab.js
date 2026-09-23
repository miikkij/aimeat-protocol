/**
 * @file public/views/admin/memory-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Memory page in the poster face (design canvas "Admin Memory Page").
 *   Every memory record on the node, across every owner.
 *
 *   WHY THIS IS A SEARCH AND NOT A LIST. Every other admin page enumerates a set a person can read
 *   through: 57 boards, 143 agents, 61 owners. Memory holds 140 records in a fresh install and runs
 *   a ceiling of 100 000 per account on aimeat.io, in no meaningful order. Fifty rows of keys in
 *   alphabetical order answers no question anybody arrives with. So the page opens on the question —
 *   a node-wide search of what is WRITTEN in the records — and the listing is what the filters leave
 *   when there is nothing to search for.
 *
 * @structure
 *   - default MemoryTab(): the model, the loads, the three views
 *   - Find: the audience strip, the search, the filters, the five questions, the results
 *   - Row: one record on the list, with the matched excerpt when it came from a search
 *   - Record / Reach: imported from memory-tab.record.js
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared set and admin-memory.css deleted: the finder is
 *     a Section with a NumeralBand for the audiences, a shared Field for the search, a Toolbar for
 *     the two narrowing fields and the filters, an aside for the questions, and each record a
 *     ListRow with its chips and its key in mono (nameKind); the results are a Section with the shared pager actions.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.1.0 -- 2026-09-13 -- Compose the results heading and audience row from poster.css.
 *   v2.0.0 — 2026-09-12 — Rebuilt around the question. The node-wide content search the FTS
 *     primitive has always backed and no admin surface called; a record opened whole instead of
 *     nine of its twenty fields; the audience named rather than the visibility word printed; the
 *     six audiences filterable rather than four, so records readable by every member of the node
 *     could be singled out at all; the breakdown counted node-wide instead of tallied from the
 *     fifty rows on screen and shown beside a node-wide total; a deleted record saying it can be
 *     taken back and until when; archived records reachable; a value stored as a string of JSON
 *     opened before it is shown. Four labels that rendered as raw key paths are translated.
 *   v1.1.0 — 2026-06-02 — Admin design unification: fix the broken useToast wiring
 *     (array hook was used as an object via .show()/.current/.dismiss — toasts never
 *     rendered and delete threw); now canonical [msg,showErr,showOk,clear] + correct
 *     <Toast>. The bespoke adm-mem-stat summary → canonical <StatsGrid>.
 *   v1.0.0 — 2026-03-16 — Initial implementation
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { dt, Empty, useToast, Toast } from './shared.js';
import { Section, Stack, Toolbar, Field, NumeralBand, ListRow, Surface, Action, Chip, Text } from '/components/poster-parts.js';
import { useConfirm } from '/components/Modal.js';
import {
  getAdminMemory, searchAdminMemory, getAdminMemoryRecord, deleteAdminMemory, restoreAdminMemory,
} from '/js/services/admin.js';
import { Record, Reach, REACH, size } from './memory-tab.record.js';

const S = (key, params) => t('admin.mem.' + key, params);
const PAGE = 50;

/** The five questions an operator actually arrives with, and the filter each one sets. */
const QUESTIONS = [
  { id: 'outside', set: { vis: 'public', q: '' } },
  { id: 'flagged', set: { flagged: true, q: '' } },
  { id: 'filling', set: { oldest: false, q: '' } },
  { id: 'archived', set: { archived: 'only', q: '' } },
];

/** When a record was last written, short. */
function when(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const min = Math.round(ms / 60000);
  if (min < 1) return S('justNow');
  if (min < 60) return S('minsAgo', { n: min });
  const hrs = Math.round(min / 60);
  if (hrs < 24) return S('hoursAgo', { n: hrs });
  try { return fmtDate(iso, { day: 'numeric', month: 'short' }); }
  catch { return String(iso).slice(0, 10); }
}

/** Who a record's visibility actually admits — the id when it names one, the word when it does not. */
function audience(r) {
  if (r.visibility === 'group' && r.group_id) return r.group_id;
  if (r.visibility === 'workspace' && r.workspace_ref) return r.workspace_ref;
  return null;
}

/** One record on the results list. `excerpt` is present only when a search put it there. */
function Row({ r, onOpen, binView, onRestore }) {
  const who = audience(r);
  return html`
    <${ListRow} name=${r.key} nameKind="mono" detail=${r.owner_gaii}
      actions=${binView
        ? html`<${Action} kind="text" onClick=${() => onRestore(r)}>${S('putBack')}<//>`
        : html`<${Action} kind="text" onClick=${() => onOpen(r)}>${S('open')}<//>`}>
      <${Stack} density="compact">
        ${r.excerpt && html`
          <${Text}>${r.excerpt.before}<strong>${r.excerpt.hit}</strong>${r.excerpt.after}<//>`}

        <${Stack} direction="wrap" density="compact" align="center">
          ${binView
            ? html`
              <${Chip} tone="coral">${S('inBinTag')}<//>
              <${Text} kind="mono" tone="muted">${S('deletedBy', { who: r.deleted_by || S('noActor') })}<//>
              <${Text} kind="mono" tone="muted">${r.restorable_until ? S('backUntil', { when: dt(r.restorable_until) }) : S('noWindow')}<//>
              <${Text} kind="mono" tone="muted">${size(r.byte_size)}<//>`
            : html`
              <${Chip}>${r.visibility}<//>
              ${who && html`<${Text} kind="mono">${who}<//>`}
              ${r.archived && html`<${Chip} tone="coral">${S('archivedTag')}<//>`}
              ${r.flag_count > 0 && html`<${Chip} tone="coral">${S('flagsTag', { n: r.flag_count })}<//>`}
              ${r.allowed_origins?.length > 0 && html`<${Chip}>${S('originsTag', { n: r.allowed_origins.length })}<//>`}
              <${Text} kind="mono" tone="muted">${size(r.byte_size)}<//>
              <${Text} kind="mono" tone="muted">v${r.version}<//>
              <${Text} kind="mono" tone="muted">${when(r.updated_at)}<//>`}
        <//>
      <//>
    <//>`;
}

export default function MemoryTab() {
  // What is being asked
  const [draft, setDraft]   = useState('');
  const [q, setQ]           = useState('');
  const [owner, setOwner]   = useState('');
  const [prefix, setPrefix] = useState('');
  const [vis, setVis]       = useState('');
  const [archived, setArch] = useState('exclude');
  const [flagged, setFlag]  = useState(false);
  const [bin, setBin]       = useState(false);
  const [oldest, setOldest] = useState(false);
  const [offset, setOffset] = useState(0);

  // What came back
  const [rows, setRows]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [counts, setCounts] = useState(null);
  const [grace, setGrace]   = useState(7);
  const [loading, setLoad]  = useState(false);

  // Where we are
  const [open, setOpen]     = useState(null);   // the record being read
  const [reach, setReach]   = useState(null);   // {counts, total} — its own read, see openReach
  const [busy, setBusy]     = useState(false);

  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();

  const load = useCallback(async (off = 0, { spinner = true } = {}) => {
    if (spinner) setLoad(true);
    try {
      let r;
      if (bin) {
        // No owner needed: the bin reads across every owner, because the question after a delete is
        // "where did it go", not "whose was it". The owner and prefix fields still narrow it.
        r = await getAdminMemory({
          bin: true, owner: owner.trim() || undefined, prefix: prefix.trim() || undefined,
          limit: PAGE, offset: off,
        });
      } else if (q.trim()) {
        r = await searchAdminMemory({
          q: q.trim(), owner: owner.trim() || undefined, prefix: prefix.trim() || undefined,
          visibility: vis || undefined, archived, maxFlags: flagged ? undefined : undefined, limit: PAGE,
        });
      } else {
        r = await getAdminMemory({
          owner: owner.trim() || undefined, prefix: prefix.trim() || undefined,
          visibility: vis || undefined, archived, oldest, counts: true, limit: PAGE, offset: off,
        });
      }
      const d = r.data || {};
      let items = d.items || [];
      // The flag filter is a page-side narrowing: the listing primitive has no maxFlags and the
      // search primitive's is a CEILING, not a floor. Said here rather than implied by an empty list.
      if (flagged && !bin) items = items.filter(x => (x.flag_count || 0) > 0);
      setRows(items);
      setTotal(d.total ?? items.length);
      if (d.counts) setCounts(d.counts);
      if (d.grace_days) setGrace(d.grace_days);
      setOffset(off);
    } catch (e) {
      showErr(e.message);
    }
    setLoad(false);
  }, [q, owner, prefix, vis, archived, flagged, bin, oldest, showErr]);

  useEffect(() => { load(0); }, [load]);
  useEffect(() => onLiveUpdate(['memory'], () => load(offset, { spinner: false })), [load, offset]);

  async function openRecord(r) {
    setBusy(true);
    try {
      const res = await getAdminMemoryRecord(r.owner_gaii, r.key);
      setOpen(res.data);
    } catch (e) { showErr(e.message); }
    setBusy(false);
  }

  const removeRecord = (rec) => confirm(
    S('deleteAsk', { key: rec.key, owner: rec.owner_gaii, days: grace }),
    async () => {
      setBusy(true);
      try {
        const res = await deleteAdminMemory(rec.owner_gaii, rec.key);
        const until = res.data?.restorable_until;
        // The one thing a person needs after pressing delete, and the one thing "deleted: true"
        // never told them: that it can be taken back, and until when.
        showOk(until ? S('deletedUntil', { when: dt(until) }) : S('deleted'));
        setOpen(null);
        load(offset);
      } catch (e) { showErr(e.message); }
      setBusy(false);
    },
    { danger: true },
  );

  /**
   * The reach view reads its own counts rather than borrowing the finder's.
   *
   * The finder's `total` is whatever the last question returned — 18 matches for a search, 50 rows
   * of one owner — and the reach board is a statement about the whole set the filters describe. It
   * borrowed that total once and said "0 of 18" about a store of 140.
   */
  async function openReach() {
    setBusy(true);
    try {
      const r = await getAdminMemory({
        owner: owner.trim() || undefined, prefix: prefix.trim() || undefined,
        archived, counts: true, limit: 1,
      });
      setReach({ counts: r.data?.counts || {}, total: r.data?.total ?? 0 });
    } catch (e) { showErr(e.message); }
    setBusy(false);
  }

  async function putBack(r) {
    setBusy(true);
    try {
      await restoreAdminMemory(r.owner_gaii, r.key);
      showOk(S('restored'));
      load(offset);
    } catch (e) { showErr(e.message); }
    setBusy(false);
  }

  function ask(id) {
    const spec = QUESTIONS.find(x => x.id === id);
    if (!spec) return;
    setQ(''); setDraft('');
    setVis(spec.set.vis ?? '');
    setArch(spec.set.archived ?? 'exclude');
    setFlag(!!spec.set.flagged);
    setOldest(!!spec.set.oldest);
    setBin(false);
    setReach(null);
  }

  function clearAll() {
    setQ(''); setDraft(''); setOwner(''); setPrefix(''); setVis('');
    setArch('exclude'); setFlag(false); setBin(false); setOldest(false);
  }

  // ── one record ──
  if (open) {
    return html`
      ${toast && html`<${Toast} type=${toast.type} text=${toast.text} onDismiss=${clearToast} />`}
      <${ConfirmUI} />
      <${Record} rec=${open} busy=${busy} graceDays=${grace}
        onBack=${() => setOpen(null)}
        onDelete=${() => removeRecord(open)} />`;
  }

  // ── who can read what ──
  if (reach) {
    return html`
      ${toast && html`<${Toast} type=${toast.type} text=${toast.text} onDismiss=${clearToast} />`}
      <${Reach} counts=${reach.counts} total=${reach.total} originCount=${reach.counts?.with_origins}
        onBack=${() => setReach(null)}
        onPick=${(v) => { setReach(null); setVis(v); setQ(''); setDraft(''); }} />`;
  }

  // ── the finder ──
  const pages = Math.ceil(total / PAGE);
  const page = Math.floor(offset / PAGE) + 1;
  const searching = !!q.trim();
  const narrowed = !!(owner || prefix || vis || flagged || bin || archived !== 'exclude' || searching);

  const filters = [
    { id: 'any', label: S('whoAny'), selected: !vis, onClick: () => setVis('') },
    ...REACH.slice().reverse().map(v => ({
      id: 'vis-' + v, label: `${v}${counts?.[v] !== undefined ? ' ' + counts[v] : ''}`, selected: vis === v,
      onClick: () => setVis(vis === v ? '' : v),
    })),
    { id: 'flagged', label: S('flaggedOnly'), selected: flagged, onClick: () => setFlag(!flagged) },
    { id: 'archived', label: S('archivedOnly'), selected: archived === 'only', onClick: () => setArch(archived === 'only' ? 'exclude' : 'only') },
    { id: 'bin', label: S('binChip'), selected: bin, onClick: () => setBin(!bin) },
  ];

  return html`
    <${Stack}>
      ${toast && html`<${Toast} type=${toast.type} text=${toast.text} onDismiss=${clearToast} />`}
      <${ConfirmUI} />

      <${Text} kind="label">${S('eyebrow')}<//>
      <${Section} title=${S('title')} description=${S('lead')}>
        <!-- who can read what, before anything is asked -->
        <${NumeralBand} tone="plain" size="small" items=${[
          { label: S('records'), value: total },
          { label: S('stripPublic'), value: counts?.public ?? 0, tone: 'coral' },
          { label: S('stripMembers'), value: counts?.members ?? 0 },
          { label: S('stripPrivate'), value: counts?.private ?? 0 },
          { label: S('stripArchived'), value: counts?.archived ?? 0 },
        ]} actions=${html`<${Action} onClick=${openReach}>${S('reachDoor')}<//>`} />

        <!-- the search: this is the page -->
        <form onSubmit=${e => { e.preventDefault(); setQ(draft); setBin(false); }}>
          <${Toolbar} label=${S('searchLabel')} count=${S('ranked')}>
            <${Field} type="search" label=${S('searchLabel')} value=${draft} placeholder=${S('searchPlaceholder')}
              hint=${S('searchHint')} onInput=${e => setDraft(e.target.value)} />
          <//>
        </form>

        <!-- narrow it -->
        <${Toolbar} label=${S('ownerLabel')} filters=${filters}>
          <${Field} label=${S('ownerLabel')} value=${owner} placeholder=${S('ownerAny')} onInput=${e => setOwner(e.target.value)} />
          <${Field} label=${S('prefixLabel')} value=${prefix} placeholder=${S('prefixAny')} onInput=${e => setPrefix(e.target.value)} />
        <//>

        <!-- the questions -->
        <${Surface} kind="aside">
          <${Stack} density="compact">
            <${Text} kind="label">${S('startFrom')}<//>
            <${Stack} direction="wrap">
              ${QUESTIONS.map(x => html`
                <${Action} key=${x.id} onClick=${() => ask(x.id)}>${S('q_' + x.id)}<//>`)}
              <${Action} onClick=${openReach}>${S('q_reach')}<//>
              ${narrowed && html`<${Action} kind="text" onClick=${clearAll}>${S('clear')}<//>`}
            <//>
          <//>
        <//>
      <//>

      <!-- results -->
      <${Section} title=${bin ? S('binTitle') : searching ? S('matches') : S('theRecords')} count=${total}
        description=${bin ? S('binNote', { days: grace })
          : searching ? S('searchedNote')
          : oldest ? S('byKey') : S('newestFirst')}>
        ${loading && rows.length === 0 && html`<${Empty} text=${S('loading')} />`}
        ${!loading && rows.length === 0 && html`
          <${Empty} text=${bin ? S('binEmpty') : searching ? S('noMatches') : S('noRecords')} />`}

        ${rows.map(r => html`
          <${Row} key=${r.owner_gaii + ' ' + r.key} r=${r} binView=${bin}
            onOpen=${openRecord} onRestore=${putBack} />`)}

        ${!searching && pages > 1 && html`
          <${Stack} direction="wrap" align="between">
            <${Text} kind="mono" tone="muted">${S('showing', { from: offset + 1, to: Math.min(offset + PAGE, total), total })}<//>
            <${Stack} direction="horizontal" align="center">
              <${Action} disabled=${offset === 0}
                onClick=${() => load(Math.max(0, offset - PAGE))}>${S('back')}<//>
              <${Text} kind="mono">${page} / ${pages}<//>
              <${Action} disabled=${offset + PAGE >= total}
                onClick=${() => load(offset + PAGE)}>${S('onward')}<//>
            <//>
          <//>`}
      <//>
    <//>`;
}
