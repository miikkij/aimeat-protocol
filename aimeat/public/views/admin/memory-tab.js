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
 *   v2.2.0 — 2026-09-27 — On the library components (page group G5): the head is the Verdict with its
 *     label and lead, the audience strip the FigureStrip (the public figure in coral) with the reach
 *     door after it, the search the search field in its form (Enter asks, the ranked note beside it,
 *     the hint under it), owner and prefix Fields, the audiences the filter Tabs with their counts
 *     and the three switches Filters, the questions an aside of action links, the results a Section
 *     whose rows are the List (the key, the matched words on the sun, the facts line under the row),
 *     the pager a Row. The page sheet admin-memory.css goes; the file writes no class and no style.
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
import { Verdict } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { Section } from '/components/Section.js';
import { List, Row as ListRow, Name, Desc, Doors, Found, Filters, Filter } from '/components/List.js';
import { Action, Actions } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tabs } from '/components/Tabs.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';
import { Row as Line, Space } from '/components/Layout.js';
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
  const fact = (words) => html`<${Note} kind="meta" inline mono>${words}<//>`;
  // The facts line under the row: its tags and its readings, one line that wraps.
  const facts = html`<${Line} wrap gap="small">
    ${binView
      ? html`
        <${Mark}>${S('inBinTag')}<//>
        ${fact(S('deletedBy', { who: r.deleted_by || S('noActor') }))}
        ${fact(r.restorable_until ? S('backUntil', { when: dt(r.restorable_until) }) : S('noWindow'))}
        ${fact(size(r.byte_size))}`
      : html`
        <${Mark}>${r.visibility}<//>
        ${who && fact(who)}
        ${r.archived && html`<${Mark} tone="coral">${S('archivedTag')}<//>`}
        ${r.flag_count > 0 && html`<${Mark} tone="coral">${S('flagsTag', { n: r.flag_count })}<//>`}
        ${r.allowed_origins?.length > 0 && html`<${Mark}>${S('originsTag', { n: r.allowed_origins.length })}<//>`}
        ${fact(size(r.byte_size))}
        ${fact(`v${r.version}`)}
        ${fact(when(r.updated_at))}`}
  <//>`;
  // The matched text, which is why the row is here: the words around the hit, the hit on the sun.
  const cut = r.excerpt ? html`${r.excerpt.before}<${Found}>${r.excerpt.hit}<//>${r.excerpt.after}` : null;
  return html`
    <${ListRow} below=${facts}>
      <${Name} asKey desc=${cut}>${r.key}<//>
      <${Desc}>${r.owner_gaii}<//>
      <${Doors}>
        ${binView
          ? html`<${Action} small onClick=${() => onRestore(r)}>${S('putBack')}<//>`
          : html`<${Action} small onClick=${() => onOpen(r)}>${S('open')}<//>`}
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

  return html`
    ${toast && html`<${Toast} type=${toast.type} text=${toast.text} onDismiss=${clearToast} />`}
    <${ConfirmUI} />

    <${Verdict} label=${S('eyebrow')} word=${S('title')}>
      <${Note} kind="lead">${S('lead')}<//>
    <//>

    <!-- who can read what, before anything is asked -->
    <${FigureStrip} items=${[
      { key: 'all', n: total, label: S('records') },
      { key: 'public', n: counts?.public ?? 0, tone: 'notice', label: S('stripPublic') },
      { key: 'members', n: counts?.members ?? 0, label: S('stripMembers') },
      { key: 'private', n: counts?.private ?? 0, label: S('stripPrivate') },
      { key: 'archived', n: counts?.archived ?? 0, label: S('stripArchived') },
    ]} />
    <${Actions}>
      <${Action} small onClick=${openReach}>${S('reachDoor')}<//>
    <//>

    <!-- the search: this is the page -->
    <${Space} above="large">
      <form onSubmit=${e => { e.preventDefault(); setQ(draft); setBin(false); }}>
        <${TextField} search label=${S('searchLabel')} hint=${S('searchHint')} note=${S('ranked')}
          value=${draft} placeholder=${S('searchPlaceholder')} onInput=${setDraft} />
      </form>
    <//>

    <!-- narrow it -->
    <${Fields} cols=${2}>
      <${TextField} label=${S('ownerLabel')} value=${owner} placeholder=${S('ownerAny')} onInput=${setOwner} />
      <${TextField} label=${S('prefixLabel')} value=${prefix} placeholder=${S('prefixAny')} onInput=${setPrefix} />
    <//>
    <${Line} wrap gap="large">
      <${Tabs} tone="filter" value=${vis} onSelect=${(v) => setVis(v === '' || vis === v ? '' : v)}
        items=${[{ value: '', label: S('whoAny') },
          ...REACH.slice().reverse().map(v => ({ value: v, label: v, count: counts?.[v] !== undefined ? counts[v] : undefined }))]} />
      <${Filters}>
        <${Filter} on=${flagged} onClick=${() => setFlag(!flagged)}>${S('flaggedOnly')}<//>
        <${Filter} on=${archived === 'only'} onClick=${() => setArch(archived === 'only' ? 'exclude' : 'only')}>${S('archivedOnly')}<//>
        <${Filter} on=${bin} onClick=${() => setBin(!bin)}>${S('binChip')}<//>
      <//>
    <//>

    <!-- the questions -->
    <${Note} kind="aside">
      <${Label} block>${S('startFrom')}<//>
      <${Actions}>
        ${QUESTIONS.map(x => html`
          <${Action} small key=${x.id} onClick=${() => ask(x.id)}>${S('q_' + x.id)}<//>`)}
        <${Action} small onClick=${openReach}>${S('q_reach')}<//>
        ${narrowed && html`<${Action} small soft onClick=${clearAll}>${S('clear')}<//>`}
      <//>
    <//>

    <!-- results -->
    <${Section} id="adm-mem-results" title=${bin ? S('binTitle') : searching ? S('matches') : S('theRecords')} count=${total}
      doors=${html`<${Note} kind="meta" inline mono>${bin ? S('binNote', { days: grace })
        : searching ? S('searchedNote')
        : oldest ? S('byKey') : S('newestFirst')}<//>`}>

      ${loading && rows.length === 0 && html`<${Empty} text=${S('loading')} />`}
      ${!loading && rows.length === 0 && html`
        <${Empty} text=${bin ? S('binEmpty') : searching ? S('noMatches') : S('noRecords')} />`}

      ${rows.length > 0 && html`
        <${List} cols="name-who-doors">
          ${rows.map(r => html`
            <${Row} key=${r.owner_gaii + ' ' + r.key} r=${r} binView=${bin}
              onOpen=${openRecord} onRestore=${putBack} />`)}
        <//>`}

      ${!searching && pages > 1 && html`
        <${Line} justify="between" wrap gap="large" above="medium">
          <${Note} kind="meta" inline>${S('showing', { from: offset + 1, to: Math.min(offset + PAGE, total), total })}<//>
          <${Line} gap="large">
            <${Action} small disabled=${offset === 0}
              onClick=${() => load(Math.max(0, offset - PAGE))}>${S('back')}<//>
            <${Note} kind="meta" inline mono>${page} / ${pages}<//>
            <${Action} small disabled=${offset + PAGE >= total}
              onClick=${() => load(offset + PAGE)}>${S('onward')}<//>
          <//>
        <//>`}
    <//>`;
}
