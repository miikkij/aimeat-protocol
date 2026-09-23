/**
 * @file public/views/admin/boards-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Admin dashboard Boards page in the poster face (design canvas "AIMEAT Admin
 *   Boards"). Three views under one crumb: every board as a list with whose it is, who may read it
 *   and whether anyone has posted; one board with its newest notices, its facts and its roster; and
 *   making one.
 *
 * @structure
 *   - default BoardsTab({ data, reload }): the model, the three views, the writes
 *   - List: the strip, the headline, search and five chips, one row per board
 *   - One: the notices, the facts with the visibility switch, and the roster
 *   - Make: name, description, and the four visibilities with what each one means
 *   - whoOf / readWord: how a row says whose a board is and who may read it
 * @usage Mounted by the admin dashboard tab router (views/admin.js).
 * @version-history
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared set and admin-boards.css deleted: the strip is a
 *     NumeralBand, the list a Section with a Toolbar (search and five filters) over the shared Table,
 *     one board a Section with the trail (Crumbs), its notices as list rows and its facts as
 *     KeyValues, and making one shared Fields with the visibilities as choice actions.
 *   2026-09-13 -- Compose shared numeral cuts; normalize extra sizes under brief 10.7.
 *   2026-09-13 -- Compose the shared aside role and its documented cuts.
 *   v2.2.0 -- 2026-09-13 -- Compose remaining section headings and record rules from poster.css.
 *   v2.1.0 — 2026-09-13 — Compose the board-list section heading from shared poster B1.
 *   v2.0.0 — 2026-09-12 — The poster face, and the missing field that broke three things. A board
 *     has no slug — the record carries an id and GET /v1/boards never sent one — so "Slug:" was
 *     blank on every row, Show Posts fetched /v1/boards/undefined/posts and console.warned, and the
 *     member roster, the page's only write, was nested inside that expander and therefore
 *     unreachable. A notice rendered as two blanks besides: the page read p.author and p.content
 *     where the route sends author_gaii, title and body, and threw away replies, reactions, tags
 *     and each author's standing. The create form demanded a slug the route discards and offered
 *     two of the four visibilities, missing `shared`, which is what most boards here are.
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { h } from 'preact';
import { useState, useMemo, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { date as fmtDate } from '/js/format.js';
import { num, dt, Empty, useToast, Toast, DataTable } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import {
  Section, Columns, Stack, Toolbar, Field, NumeralBand, ListRow, KeyValue, Crumbs, Surface, Action, Chip, Text,
} from '/components/poster-parts.js';
import {
  getBoardPosts, patchBoardMembers, createBoard, setBoardVisibility, deleteBoard,
} from '/js/services/admin.js';

const S = (key, params) => t('admin.brd.' + key, params);

/** The owner half of a GHII or GAII ("claude#alice@node" → "alice"). */
function ownerOf(gaii) {
  const s = String(gaii || '');
  const at = s.split('@')[0];
  return at.includes('#') ? at.split('#')[1] : at;
}

/** The day a board was made. The hour is noise in a column of fifty-seven. */
function day(iso) {
  if (!iso) return '';
  try { return fmtDate(iso, { day: 'numeric', month: 'short' }); }
  catch { return String(iso).slice(0, 10); }
}

/** How long ago, in words; '' when there is no stamp. */
function since(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const days = Math.floor(ms / 86400000);
  if (days < 1) return S('agoToday');
  if (days === 1) return S('agoYesterday');
  if (days < 30) return S('agoDays', { n: num(days) });
  if (days < 365) return S('agoMonths', { n: num(Math.round(days / 30)) });
  return S('agoYears', { n: num(Math.round(days / 365)) });
}

export default function BoardsTab({ data, reload }) {
  const [toast, showErr, showOk, clearToast] = useToast();
  const { confirm, ConfirmUI } = useConfirm();
  const [view, setView] = useState('list');     // list | one | make
  const [open, setOpen] = useState(null);       // { board, posts, authors, total }
  const [find, setFind] = useState('');
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({ name: '', description: '', visibility: 'public' });
  const [busy, setBusy] = useState(false);

  const boards = useMemo(() => data.boards?.boards || [], [data.boards]);

  const showErrRef = useRef(showErr);
  showErrRef.current = showErr;

  const m = useMemo(() => ({
    total: boards.length,
    open: boards.filter(b => b.visibility === 'public').length,
    shared: boards.filter(b => b.visibility === 'shared').length,
    roster: boards.filter(b => (b.allowed_gaiis || []).length > 0).length,
    notices: boards.reduce((n, b) => n + (b.posts || 0), 0),
    silent: boards.filter(b => !b.posts).length,
  }), [boards]);

  const openBoard = useCallback(async (b) => {
    try {
      // The id is what a board is addressed by. This read used to be given b.slug, a field no
      // board has, so it asked for /v1/boards/undefined/posts and failed on every board.
      const r = await getBoardPosts(b.id, 20);
      // The id, not the board object: a write reloads the list, and an opened page holding a frozen
      // copy would keep showing the visibility and the roster as they were before the change.
      setOpen({ boardId: b.id, posts: r.data?.posts || [], authors: r.data?.authors || {}, total: r.data?.total ?? 0 });
      setView('one');
    } catch (e) { showErrRef.current(S('postsFailed') + ': ' + e.message); }
  }, []);

  async function act(fn, ok) {
    setBusy(true);
    try { await fn(); if (ok) showOk(ok); reload(); }
    catch (e) { showErr(e.message); }
    finally { setBusy(false); }
  }

  const flip = (b) => act(
    () => setBoardVisibility(b.id, b.visibility === 'public' ? 'shared' : 'public'),
    S('visibilityChanged'));

  const remove = (b) => confirm(S('deleteAsk', { name: b.name || b.id, n: num(b.posts || 0) }), async () => {
    await act(() => deleteBoard(b.id), S('deleted', { name: b.name || b.id }));
    setView('list');
    setOpen(null);
  }, { danger: true });

  const addMember = (b, gaii) => act(() => patchBoardMembers(b.id, { add: [gaii] }), S('memberAdded'));
  const dropMember = (b, gaii) => act(() => patchBoardMembers(b.id, { remove: [gaii] }), S('memberRemoved'));

  async function make() {
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      await createBoard(form.name.trim(), form.visibility, form.description.trim());
      showOk(S('made', { name: form.name.trim() }));
      setForm({ name: '', description: '', visibility: 'public' });
      setView('list');
      reload();
    } catch (e) { showErr(e.message); }
    finally { setBusy(false); }
  }

  const wrap = (inner) => html`<${Stack}>
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    ${inner}
    <${ConfirmUI} />
  <//>`;

  if (view === 'make') {
    return wrap(html`<${Make} form=${form} setForm=${setForm} onMake=${make} busy=${busy}
      onCancel=${() => setView('list')} />`);
  }

  // A board deleted while open is no longer in the list, and the page falls back to it rather than
  // rendering a board that is gone.
  const openBoardNow = open ? boards.find(b => b.id === open.boardId) : null;

  if (view === 'one' && openBoardNow) {
    const board = openBoardNow;
    return wrap(html`<${One} board=${board} posts=${open.posts} authors=${open.authors} total=${open.total}
      busy=${busy}
      onBack=${() => { setView('list'); setOpen(null); }}
      onFlip=${() => flip(board)} onDelete=${() => remove(board)}
      onAdd=${(g) => addMember(board, g)} onDrop=${(g) => dropMember(board, g)} />`);
  }

  if (boards.length === 0) {
    return wrap(html`<${Section} title=${S('title')} count="01"
      actions=${html`<${Action} kind="primary" onClick=${() => setView('make')}>${S('make')}<//>`}>
      <${Empty} text=${S('empty')} />
    <//>`);
  }

  const shown = boards.filter(b => {
    if (filter === 'open' && b.visibility !== 'public') return false;
    if (filter === 'shared' && b.visibility !== 'shared') return false;
    if (filter === 'roster' && (b.allowed_gaiis || []).length === 0) return false;
    if (filter === 'silent' && b.posts) return false;
    const q = find.trim().toLowerCase();
    if (!q) return true;
    return [b.name, b.description, b.id, b.owner_gaii].some(v => String(v || '').toLowerCase().includes(q));
  });

  const filters = [
    ['all', S('chipAll', { n: num(m.total) })],
    ['open', S('chipOpen', { n: num(m.open) })],
    ['shared', S('chipShared', { n: num(m.shared) })],
    ['roster', S('chipRoster', { n: num(m.roster) })],
    ['silent', S('chipSilent', { n: num(m.silent) })],
  ].map(([id, label]) => ({ id, label, selected: filter === id, onClick: () => setFilter(id) }));

  const headers = [S('colBoard'), S('colWhose'), S('colWhoReads'), S('colNotices'), S('colMade'), ''];
  const rows = shown.map(b => {
    const roster = (b.allowed_gaiis || []).length;
    return [
      html`<${Stack} density="compact"><strong>${b.name || b.id}</strong><${Text} kind="mono" tone="muted">${b.id}<//><//>`,
      b.owner_gaii
        ? html`<${Stack} density="compact"><strong>${ownerOf(b.owner_gaii)}</strong>
            <${Text} kind="caption" tone="muted">${roster > 0 ? S('plusRoster', { n: num(roster) }) : S('andItsAgents')}<//><//>`
        : html`<${Text} kind="caption" tone="muted">${S('unknownOwner')}<//>`,
      html`<${Chip}>${S('vis.' + b.visibility)}<//>`,
      { align: 'end', text: html`<${Stack} density="compact">
        <${Text} kind="number" size="small" tone=${b.posts ? 'plain' : 'muted'}>${b.posts ? num(b.posts) : '—'}<//>
        <${Text} kind="caption" tone="muted">${b.posts ? S('lastPost', { ago: since(b.last_post_at) }) : S('nothingYet')}<//><//>` },
      { text: day(b.created_at), mono: true },
      html`<${Stack} direction="horizontal" density="compact">
        <${Action} kind="text" onClick=${() => openBoard(b)}>${S('openIt')}<//>
        <${Action} kind="text" tone="danger" onClick=${() => remove(b)}>${S('delete')}<//><//>`,
    ];
  });

  return wrap(html`
    <${NumeralBand} tone="plain" items=${[
      { label: S('cntAll'), value: num(m.total), note: S('cntAllSub') },
      { label: S('cntOpen'), value: num(m.open), note: S('cntOpenSub', { shared: num(m.shared), rest: num(m.total - m.open - m.shared) }) },
      { label: S('cntNotices'), value: num(m.notices), note: S('cntNoticesSub') },
      { label: S('cntSilent'), value: num(m.silent), note: S('cntSilentSub'), tone: 'coral' },
    ]} />

    <${Section} title=${S('title')} count="01"
      actions=${html`<${Action} kind="primary" onClick=${() => setView('make')}>${S('make')}<//>`}>
      <${Columns}>
        <${Stack} density="compact">
          <${Text} kind="label">${S('heroLabel')}<//>
          <${Text} kind="number">${S('hero', { n: num(m.silent), total: num(m.total) })}<//>
          <${Text} tone="muted">${S('heroSub')}<//>
        <//>
        <${Text} kind="lead">${S('lead')}<//>
      <//>

      <${Toolbar} label=${S('title')} filters=${filters}
        search=${{ ariaLabel: S('findPlaceholder'), placeholder: S('findPlaceholder'), value: find, onInput: e => setFind(e.target.value) }} />

      <${DataTable} headers=${headers} rows=${rows} />

      <${Stack} direction="wrap" align="between">
        <${Text} kind="mono" tone="muted">${S('shown', { n: num(shown.length), total: num(m.total) })}<//>
        <${Text} kind="caption" tone="muted">${S('organismNote')}<//>
      <//>
    <//>`);
}

/* ── One board ───────────────────────────────────────────────────────────────────────────────── */

function One({ board, posts, authors, total, busy, onBack, onFlip, onDelete, onAdd, onDrop }) {
  const [newMember, setNewMember] = useState('');
  const roster = board.allowed_gaiis || [];
  const rules = board.rules || {};
  const isPublic = board.visibility === 'public';
  const add = () => { onAdd(newMember.trim()); setNewMember(''); };

  /** A fact's value with the sentence that says why, the way every fact on this page reads. */
  const fact = (value, why) => html`<${Stack} density="compact">${value}${why && html`<${Text} kind="caption" tone="muted">${why}<//>`}<//>`;

  return html`
    <${Crumbs} items=${[{ label: S('title'), onClick: onBack }, { label: board.name || board.id }]} />

    <${Section} title=${board.name || board.id}
      count=${board.id + (total ? ' · ' + S('nNotices', { n: num(total) }) : '')}
      description=${board.description || null}
      actions=${html`<${Action} tone="danger" onClick=${onDelete}>${S('delete')}<//>`}>
      <${Text} kind="caption" tone="muted">${S('madeBy', { who: ownerOf(board.owner_gaii), when: dt(board.created_at) })}<//>

      <${Columns} collapse=${900}>
        <${Stack}>
          <${Text} kind="label">${S('newestNotices')}<//>
          ${posts.length === 0
    ? html`<${Text} tone="muted">${S('noNotices')}<//>`
    : posts.map(p => {
      const standing = authors[p.author_gaii];
      return html`
            <${ListRow} key=${p.id} name=${p.title || S('untitled')} value=${since(p.created_at)}
              detail=${p.body || null} detailKind="text">
              <${Stack} direction="wrap" density="compact" align="center">
                <${Text} kind="mono">${p.author_gaii}<//>
                ${standing && html`<${Text} kind="caption" tone="muted">${S('standing', {
    posts: num(standing.posts ?? 0), thanks: num(standing.thanks ?? 0),
  })}${standing.since ? ' · ' + S('standingSince', { when: day(standing.since) }) : ''}<//>`}
                ${p.category && html`<${Chip} tone="muted">${p.category}<//>`}
                <${Text} kind="caption" tone="muted">${p.replies
    ? S('nReplies', { n: num(p.replies) })
    : S('noReplies')}${reactionCount(p) ? ' · ' + S('nThanks', { n: num(reactionCount(p)) }) : ''}<//>
              <//>
            <//>`;
    })}
          ${total > posts.length && html`
            <${Text} tone="muted">${S('moreNotices', { shown: num(posts.length), total: num(total) })}<//>`}
        <//>

        <${Stack}>
          <div>
            <${KeyValue} label=${S('factWhoReads')} value=${fact(html`<${Stack} direction="horizontal" align="center" density="compact">
              <${Chip} tone="sun">${S('vis.' + board.visibility)}<//>
              ${board.visibility !== 'system' && html`
                <${Action} kind="text" disabled=${busy} onClick=${onFlip}>${isPublic ? S('makeShared') : S('makePublic')}<//>`}
            <//>`, S('visWhy.' + board.visibility))} />
            <${KeyValue} label=${S('factWhoPosts')} value=${fact(S('posting.' + (rules.posting || 'anyone')), S('factWhoPostsWhy'))} />
            <${KeyValue} label=${S('factLives')} value=${rules.defaultTtlHours
    ? S('livesHours', { n: num(rules.defaultTtlHours) })
    : S('livesForever')} />
            <${KeyValue} label=${S('factCosts')} value=${fact(rules.postCost ? S('costsMorsels', { n: num(rules.postCost) }) : S('costsNothing'),
    rules.postCost ? null : S('costsNothingWhy'))} />
            <${KeyValue} label=${S('factCategories')} value=${rules.categories?.length
    ? fact(html`<${Text} kind="mono">${rules.categories.join(' · ')}<//>`, S('categoriesWhy'))
    : S('categoriesAny')} />
            <${KeyValue} label=${S('factFederation')} value=${fact(board.federate ? S('federateOn') : S('federateOff'), S('federateWhy'))} />
          </div>

          <${Stack} density="compact">
            <${Text} kind="label">${S('rosterTitle')}<//>
            <${Text} tone="muted">${S('rosterWhy')}<//>
            ${roster.length === 0
    ? html`<${Text} tone="muted">${S('rosterEmpty')}<//>`
    : roster.map(g => html`
              <${ListRow} key=${g} density="compact" name=${g}
                actions=${html`<${Action} kind="text" tone="danger" disabled=${busy} onClick=${() => onDrop(g)}>${S('takeOff')}<//>`} />`)}
            <${Toolbar} label=${S('rosterTitle')}
              actions=${html`<${Action} disabled=${busy || !newMember.trim()} onClick=${add}>${S('add')}<//>`}>
              <${Field} value=${newMember} ariaLabel=${S('rosterTitle')} placeholder=${S('rosterPlaceholder')}
                onInput=${e => setNewMember(e.target.value)}
                onKeyDown=${e => { if (e.key === 'Enter' && newMember.trim()) add(); }} />
            <//>
          <//>
        <//>
      <//>
    <//>`;
}

/** How many thanks a notice carries. The reactions map is emoji → the gaiis that gave it. */
function reactionCount(post) {
  const thanks = post.reactions?.thanks;
  return Array.isArray(thanks) ? thanks.length : 0;
}

/* ── Making one ──────────────────────────────────────────────────────────────────────────────── */

function Make({ form, setForm, onMake, busy, onCancel }) {
  const opt = (key, on) => html`
    <${Action} kind="choice" semantics="radio" selected=${form.visibility === key} disabled=${!on}
      title=${S('vis.' + key)} onClick=${() => on && setForm({ ...form, visibility: key })}>${S('visWhy.' + key)}<//>`;

  return html`
    <${Section} title=${S('makeTitle')} count="02" description=${S('makeLead')}
      actions=${html`<${Action} onClick=${onCancel}>${t('common.cancel')}<//>`}>
      <${Columns} collapse=${900}>
        <${Stack}>
          <${Field} label=${S('fieldName')} value=${form.name} placeholder=${S('namePlaceholder')} hint=${S('nameHint')}
            onInput=${e => setForm({ ...form, name: e.target.value })} />
          <${Field} label=${S('fieldWhatFor')} value=${form.description} placeholder=${S('whatForPlaceholder')} hint=${S('whatForHint')}
            onInput=${e => setForm({ ...form, description: e.target.value })} />

          <${Stack} density="compact">
            <${Text} kind="label">${S('fieldWhoReads')}<//>
            <${Stack} role="radiogroup" label=${S('fieldWhoReads')} density="compact">
              ${opt('public', true)}
              ${opt('shared', true)}
              ${opt('private', true)}
              ${opt('system', false)}
            <//>
            <${Text} kind="caption" tone="muted">${S('whoReadsHint')}<//>
          <//>

          <${Stack} direction="horizontal">
            <${Action} kind="primary" disabled=${busy || !form.name.trim()} onClick=${onMake}>
              ${busy ? t('common.loading') : S('makeIt')}<//>
          <//>
        <//>

        <${Stack}>
          <${Surface} kind="aside">
            <${Stack} density="compact">
              <${Text} kind="label">${S('asideTitle')}<//>
              <${Text}>${S('asideBody')}<//>
            <//>
          <//>

          <div>
            <${Text} kind="label">${S('startsWith')}<//>
            <${KeyValue} label=${S('factWhoPosts')} value=${html`<${Stack} density="compact">${S('posting.anyone')}<${Text} kind="caption" tone="muted">${S('changeableOnBoard')}<//><//>`} />
            <${KeyValue} label=${S('factLives')} value=${S('livesForever')} />
            <${KeyValue} label=${S('factCosts')} value=${S('costsNothing')} />
            <${KeyValue} label=${S('factCategories')} value=${S('categoriesAny')} />
            <${KeyValue} label=${S('rosterTitle')} value=${S('rosterEmptyShort')} />
            <${KeyValue} label=${S('factFederation')} value=${S('federateOff')} />
          </div>
        <//>
      <//>
    <//>`;
}
