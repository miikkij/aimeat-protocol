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
 *   v2.4.0 -- 2026-10-08 -- A notice hands its ai_provenance block to BoardNotice, which shows the AI
 *     label when one is owed (aiprov D10).
 *   v2.3.0 -- 2026-09-27 -- On the library components (page group G5): the strip is the FigureStrip
 *     (the silent boards in coral), the headline the Verdict with its label and lead, the search the
 *     Search line with its magnifier, the five chips the filter Tabs (the silent one in the attention
 *     tone), the boards the List (a row answers the pointer), the board's page the Crumb, the
 *     PageHead and the Beside with its notices as BoardNotices, its facts as Facts (the visibility a
 *     sun tag with its switch) and its roster a List with the add field; making one Fields with the
 *     visibilities as the boxed Choice, the aside and the "starts with" Facts in a dim Box. The page
 *     sheet admin-boards.css goes; the file writes no class and no style.
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
import { num, dt, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
import {
  getBoardPosts, patchBoardMembers, createBoard, setBoardVisibility, deleteBoard,
} from '/js/services/admin.js';
import { Section } from '/components/Section.js';
import { Verdict } from '/components/Readings.js';
import { FigureStrip } from '/components/FigureStrip.js';
import { List, Row, Name, Who, Desc, When, Doors, SearchLine } from '/components/List.js';
import { Action, Loud } from '/components/Action.js';
import { Mark, Code, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Tabs } from '/components/Tabs.js';
import { Facts } from '/components/Facts.js';
import { Box } from '/components/Box.js';
import { Crumb } from '/components/Crumb.js';
import { PageHead } from '/components/PageHead.js';
import { BoardNotice } from '/components/BoardNotice.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Choice } from '/components/Choice.js';
import { Row as Line, Stack, Beside } from '/components/Layout.js';

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

  const wrap = (inner) => html`
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    ${inner}
    <${ConfirmUI} />`;

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

  const makeDoor = html`<${Loud} control onClick=${() => setView('make')}>${S('make')}<//>`;

  if (boards.length === 0) {
    return wrap(html`<${Section} first num="01" title=${S('title')} doors=${makeDoor}>
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

  // The five chips: one of them is on; the silent boards are the ones an operator acts on.
  const chip = (key, label) => ({ value: key, label, attention: key === 'silent' });
  const head = [S('colBoard'), S('colWhose'), S('colWhoReads'), { label: S('colNotices'), num: true }, S('colMade'), ''];

  return wrap(html`
    <${FigureStrip} wrap items=${[
      { key: 'all', n: num(m.total), label: S('cntAll'), sub: S('cntAllSub') },
      { key: 'open', n: num(m.open), label: S('cntOpen'), sub: S('cntOpenSub', { shared: num(m.shared), rest: num(m.total - m.open - m.shared) }) },
      { key: 'notices', n: num(m.notices), label: S('cntNotices'), sub: S('cntNoticesSub') },
      // The number an operator acts on is the one in coral.
      { key: 'silent', n: num(m.silent), tone: 'notice', label: S('cntSilent'), sub: S('cntSilentSub') },
    ]} />

    <${Section} first num="01" title=${S('title')} doors=${makeDoor}>
      <${Verdict} label=${S('heroLabel')} word=${S('hero', { n: num(m.silent), total: num(m.total) })} line=${S('heroSub')}>
        <${Note} kind="lead">${S('lead')}<//>
      <//>

      <${Line} wrap gap="large" align="end" above="large" below="medium">
        <${SearchLine} find text value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
        <${Tabs} tone="filter" value=${filter} onSelect=${setFilter} items=${[
          chip('all', S('chipAll', { n: num(m.total) })),
          chip('open', S('chipOpen', { n: num(m.open) })),
          chip('shared', S('chipShared', { n: num(m.shared) })),
          chip('roster', S('chipRoster', { n: num(m.roster) })),
          chip('silent', S('chipSilent', { n: num(m.silent) })),
        ]} />
      <//>

      <${List} cols="name-who-state-count-when-doors" head=${head} labels>
        ${shown.map(b => {
    const roster = (b.allowed_gaiis || []).length;
    return html`
          <${Row} key=${b.id} hover>
            <${Name} meta=${b.id}>${b.name || b.id}<//>
            ${b.owner_gaii
    ? html`<${Who} sub=${roster > 0 ? S('plusRoster', { n: num(roster) }) : S('andItsAgents')}>${ownerOf(b.owner_gaii)}<//>`
    : html`<${Desc}>${S('unknownOwner')}<//>`}
            <${Desc}><${Mark}>${S('vis.' + b.visibility)}<//><//>
            <${Desc} faint=${!b.posts} sub=${b.posts ? S('lastPost', { ago: since(b.last_post_at) }) : S('nothingYet')}>
              ${b.posts ? num(b.posts) : '—'}
            <//>
            <${When}>${day(b.created_at)}<//>
            <${Doors}>
              <${Action} small onClick=${() => openBoard(b)}>${S('openIt')}<//>
              <${Action} small soft onClick=${() => remove(b)}>${S('delete')}<//>
            <//>
          <//>`;
  })}
      <//>

      <${Line} justify="between" wrap gap="large" above="medium">
        <${Note} kind="meta" inline>${S('shown', { n: num(shown.length), total: num(m.total) })}<//>
        <${Note} kind="meta" inline>${S('organismNote')}<//>
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

  const side = html`
    <${Stack} gap="large">
      <${Facts} rows=${[
        {
          k: S('factWhoReads'),
          v: html`<${Mark} tone="sun">${S('vis.' + board.visibility)}<//>`,
          action: board.visibility !== 'system' ? html`
            <${Action} small soft disabled=${busy} onClick=${onFlip}>
              ${isPublic ? S('makeShared') : S('makePublic')}
            <//>` : null,
          sub: S('visWhy.' + board.visibility),
        },
        { k: S('factWhoPosts'), v: S('posting.' + (rules.posting || 'anyone')), sub: S('factWhoPostsWhy') },
        {
          k: S('factLives'),
          v: rules.defaultTtlHours
            ? S('livesHours', { n: num(rules.defaultTtlHours) })
            : S('livesForever'),
        },
        {
          k: S('factCosts'),
          v: rules.postCost ? S('costsMorsels', { n: num(rules.postCost) }) : S('costsNothing'),
          sub: !rules.postCost ? S('costsNothingWhy') : undefined,
        },
        {
          k: S('factCategories'),
          v: rules.categories?.length ? html`<${Code}>${rules.categories.join(' · ')}<//>` : S('categoriesAny'),
          sub: rules.categories?.length ? S('categoriesWhy') : undefined,
        },
        { k: S('factFederation'), v: board.federate ? S('federateOn') : S('federateOff'), sub: S('federateWhy') },
      ]} />

      <${Stack} gap="small">
        <${Label} block>${S('rosterTitle')}<//>
        <${Note}>${S('rosterWhy')}<//>
        ${roster.length === 0
    ? html`<${Note} kind="quiet">${S('rosterEmpty')}<//>`
    : html`<${List} cols="name-doors" dense>
            ${roster.map(g => html`
              <${Row} key=${g}>
                <${Name} code>${g}<//>
                <${Doors}><${Action} small soft disabled=${busy} onClick=${() => onDrop(g)}>${S('takeOff')}<//><//>
              <//>`)}
          <//>`}
        <${TextField} code value=${newMember} placeholder=${S('rosterPlaceholder')} ariaLabel=${S('rosterPlaceholder')}
          onInput=${setNewMember}
          onEnter=${() => { if (newMember.trim()) add(); }}
          actions=${html`<${Action} small disabled=${busy || !newMember.trim()} onClick=${add}>${S('add')}<//>`} />
      <//>
    <//>`;

  return html`
    <${Crumb} steps=${[{ label: S('title'), onClick: onBack }, board.name || board.id]} />

    <${PageHead} title=${board.name || board.id}
      sub=${`${board.id}${total ? ' · ' + S('nNotices', { n: num(total) }) : ''}`}
      desc=${board.description || null}
      actions=${html`<${Action} small soft onClick=${onDelete}>${S('delete')}<//>`} />
    <${Note}>${S('madeBy', { who: ownerOf(board.owner_gaii), when: dt(board.created_at) })}<//>

    <${Beside} wide side=${side} above="large">
      <${Label} block>${S('newestNotices')}<//>
      ${posts.length === 0
    ? html`<${Note} kind="quiet">${S('noNotices')}<//>`
    : posts.map(p => {
      const standing = authors[p.author_gaii];
      const thanks = reactionCount(p);
      return html`
            <${BoardNotice} key=${p.id}
              kind=${p.category || null}
              title=${p.title || S('untitled')}
              words=${p.body || null}
              who=${p.author_gaii}
              whoNote=${standing ? `${S('standing', {
    posts: num(standing.posts ?? 0), thanks: num(standing.thanks ?? 0),
  })}${standing.since ? ' · ' + S('standingSince', { when: day(standing.since) }) : ''}` : ''}
              time=${since(p.created_at)}
              counts=${`${p.replies
    ? S('nReplies', { n: num(p.replies) })
    : S('noReplies')}${thanks ? ' · ' + S('nThanks', { n: num(thanks) }) : ''}`}
              provenance=${p.ai_provenance} />`;
    })}
      ${total > posts.length && html`
        <${Note}>${S('moreNotices', { shown: num(posts.length), total: num(total) })}<//>`}
    <//>`;
}

/** How many thanks a notice carries. The reactions map is emoji → the gaiis that gave it. */
function reactionCount(post) {
  const thanks = post.reactions?.thanks;
  return Array.isArray(thanks) ? thanks.length : 0;
}

/* ── Making one ──────────────────────────────────────────────────────────────────────────────── */

function Make({ form, setForm, onMake, busy, onCancel }) {
  const opt = (key, on) => ({ value: key, label: S('vis.' + key), hint: S('visWhy.' + key), disabled: !on });

  const side = html`
    <${Stack} gap="large">
      <${Note} kind="aside">
        <${Stack} gap="tight">
          <b>${S('asideTitle')}</b>
          <span>${S('asideBody')}</span>
        <//>
      <//>

      <${Box} tone="dim">
        <${Label} block>${S('startsWith')}<//>
        <${Facts} rows=${[
          { k: S('factWhoPosts'), v: S('posting.anyone'), sub: S('changeableOnBoard') },
          { k: S('factLives'), v: S('livesForever') },
          { k: S('factCosts'), v: S('costsNothing') },
          { k: S('factCategories'), v: S('categoriesAny') },
          { k: S('rosterTitle'), v: S('rosterEmptyShort') },
          { k: S('factFederation'), v: S('federateOff') },
        ]} />
      <//>
    <//>`;

  return html`
    <${Section} first num="02" title=${S('makeTitle')}
      doors=${html`<${Action} small onClick=${onCancel}>${t('common.cancel')}<//>`}>
      <${Note} kind="lead">${S('makeLead')}<//>

      <${Beside} wide side=${side} above="large">
        <${Fields}>
          <${TextField} label=${S('fieldName')} hint=${S('nameHint')} value=${form.name} placeholder=${S('namePlaceholder')}
            onInput=${(v) => setForm({ ...form, name: v })} />
          <${TextField} label=${S('fieldWhatFor')} hint=${S('whatForHint')} value=${form.description} placeholder=${S('whatForPlaceholder')}
            onInput=${(v) => setForm({ ...form, description: v })} />
          <${Choice} boxed cols=${2} label=${S('fieldWhoReads')} hint=${S('whoReadsHint')} value=${form.visibility}
            options=${[opt('public', true), opt('shared', true), opt('private', true), opt('system', false)]}
            onChange=${(v) => setForm({ ...form, visibility: v })} />
        <//>

        <${FormActions}>
          <${Loud} disabled=${busy || !form.name.trim()} onClick=${onMake}>
            ${busy ? t('common.loading') : S('makeIt')}
          <//>
        <//>
      <//>
    <//>`;
}
