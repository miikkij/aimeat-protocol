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
import { useViewCSS } from '/components/useViewCSS.js';
import { num, dt, Empty, useToast, Toast } from './shared.js';
import { useConfirm } from '/components/Modal.js';
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
  try { return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }
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
  useViewCSS('/css/views/admin-boards.css');
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

  const wrap = (inner) => html`<div class="og adm-brd">
    ${toast && html`<${Toast} ...${toast} onDismiss=${clearToast} />`}
    ${inner}
    <${ConfirmUI} />
  </div>`;

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
    return wrap(html`<section class="og-sec og-sec--first">
      <div class="og-sec-h"><h2>${S('title')}<small>01</small></h2>
        <button type="button" class="adm-btn" onClick=${() => setView('make')}>${S('make')}</button></div>
      <${Empty} text=${S('empty')} />
    </section>`);
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

  const chip = (key, label) => html`
    <button type="button" class="adm-brd-chip ${filter === key ? 'on' : ''} ${key === 'silent' ? 'bad' : ''}"
      onClick=${() => setFilter(key)}>${label}</button>`;

  return wrap(html`
    <div class="og-strip">
      <div><b>${num(m.total)}</b><span>${S('cntAll')}</span><small>${S('cntAllSub')}</small></div>
      <div><b>${num(m.open)}</b><span>${S('cntOpen')}</span><small>${S('cntOpenSub', { shared: num(m.shared), rest: num(m.total - m.open - m.shared) })}</small></div>
      <div><b>${num(m.notices)}</b><span>${S('cntNotices')}</span><small>${S('cntNoticesSub')}</small></div>
      <div class="adm-brd-quiet"><b>${num(m.silent)}</b><span>${S('cntSilent')}</span><small>${S('cntSilentSub')}</small></div>
    </div>

    <section class="og-sec og-sec--first">
      <div class="og-sec-h">
        <h2>${S('title')}<small>01</small></h2>
        <button type="button" class="adm-btn" onClick=${() => setView('make')}>${S('make')}</button>
      </div>

      <div class="adm-brd-top">
        <div>
          <div class="adm-brd-lbl">${S('heroLabel')}</div>
          <div class="adm-brd-hero">${S('hero', { n: num(m.silent), total: num(m.total) })}</div>
          <p class="adm-brd-hero-sub">${S('heroSub')}</p>
        </div>
        <div><p class="adm-brd-lead">${S('lead')}</p></div>
      </div>

      <div class="adm-brd-tools">
        <div class="adm-brd-find">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="M16 16 L21 21"></path></svg>
          <input type="text" value=${find} onInput=${e => setFind(e.target.value)} placeholder=${S('findPlaceholder')} />
        </div>
        <div class="adm-brd-chips">
          ${chip('all', S('chipAll', { n: num(m.total) }))}
          ${chip('open', S('chipOpen', { n: num(m.open) }))}
          ${chip('shared', S('chipShared', { n: num(m.shared) }))}
          ${chip('roster', S('chipRoster', { n: num(m.roster) }))}
          ${chip('silent', S('chipSilent', { n: num(m.silent) }))}
        </div>
      </div>

      <div class="adm-brd-rows">
        <div class="adm-brd-hrow">
          <span>${S('colBoard')}</span><span>${S('colWhose')}</span><span>${S('colWhoReads')}</span>
          <span class="r">${S('colNotices')}</span><span class="r">${S('colMade')}</span><span></span>
        </div>
        ${shown.map(b => {
    const roster = (b.allowed_gaiis || []).length;
    return html`
          <div class="adm-brd-row" key=${b.id}>
            <span class="adm-brd-name">${b.name || b.id}<em>${b.id}</em></span>
            <span class="adm-brd-who">${b.owner_gaii
    ? html`<b>${ownerOf(b.owner_gaii)}</b><em>${roster > 0 ? S('plusRoster', { n: num(roster) }) : S('andItsAgents')}</em>`
    : html`<em>${S('unknownOwner')}</em>`}</span>
            <span><span class="adm-brd-chipcell">${S('vis.' + b.visibility)}</span></span>
            <span class="adm-brd-posts r ${b.posts ? '' : 'is-none'}">
              ${b.posts ? num(b.posts) : '—'}
              <em>${b.posts ? S('lastPost', { ago: since(b.last_post_at) }) : S('nothingYet')}</em>
            </span>
            <span class="adm-brd-made">${day(b.created_at)}</span>
            <span class="adm-brd-doors">
              <button type="button" class="adm-brd-door" onClick=${() => openBoard(b)}>${S('openIt')}</button>
              <button type="button" class="adm-brd-door is-quiet" onClick=${() => remove(b)}>${S('delete')}</button>
            </span>
          </div>`;
  })}
      </div>

      <div class="adm-brd-foot">
        <span>${S('shown', { n: num(shown.length), total: num(m.total) })}</span>
        <span>${S('organismNote')}</span>
      </div>
    </section>`);
}

/* ── One board ───────────────────────────────────────────────────────────────────────────────── */

function One({ board, posts, authors, total, busy, onBack, onFlip, onDelete, onAdd, onDrop }) {
  const [newMember, setNewMember] = useState('');
  const roster = board.allowed_gaiis || [];
  const rules = board.rules || {};
  const isPublic = board.visibility === 'public';

  return html`
    <div class="adm-brd-page">
      <div class="adm-brd-crumb">
        <button type="button" onClick=${onBack}>${S('title')}</button> · ${board.name || board.id}
      </div>

      <div class="adm-brd-head">
        <h2>${board.name || board.id}<i>${board.id}${total ? ' · ' + S('nNotices', { n: num(total) }) : ''}</i></h2>
        <div class="adm-brd-doors">
          <button type="button" class="adm-brd-door is-quiet" onClick=${onDelete}>${S('delete')}</button>
        </div>
      </div>
      ${board.description && html`<p class="adm-brd-what">${board.description}</p>`}
      <p class="adm-brd-made-line">${S('madeBy', { who: ownerOf(board.owner_gaii), when: dt(board.created_at) })}</p>

      <div class="adm-brd-two">
        <div>
          <div class="adm-brd-phead">${S('newestNotices')}</div>
          ${posts.length === 0
    ? html`<p class="adm-brd-hint">${S('noNotices')}</p>`
    : posts.map(p => {
      const standing = authors[p.author_gaii];
      return html`
            <div class="adm-brd-post" key=${p.id}>
              <div class="adm-brd-ptop">
                <span class="adm-brd-ptitle">${p.title || S('untitled')}</span>
                <span class="adm-brd-pwhen">${since(p.created_at)}</span>
              </div>
              ${p.body && html`<p class="adm-brd-pbody">${p.body}</p>`}
              <div class="adm-brd-pfoot">
                <span class="adm-brd-pwho">${p.author_gaii}
                  ${standing && html`<em>${S('standing', {
    posts: num(standing.posts ?? 0), thanks: num(standing.thanks ?? 0),
  })}${standing.since ? ' · ' + S('standingSince', { when: day(standing.since) }) : ''}</em>`}
                </span>
                ${p.category && html`<span class="adm-brd-ptag">${p.category}</span>`}
                <span class="adm-brd-pmeta">${p.replies
    ? S('nReplies', { n: num(p.replies) })
    : S('noReplies')}${reactionCount(p) ? ' · ' + S('nThanks', { n: num(reactionCount(p)) }) : ''}</span>
              </div>
            </div>`;
    })}
          ${total > posts.length && html`
            <p class="adm-brd-more">${S('moreNotices', { shown: num(posts.length), total: num(total) })}</p>`}
        </div>

        <div>
          <dl class="adm-brd-facts">
            <div class="adm-brd-fact">
              <dt>${S('factWhoReads')}</dt>
              <dd>
                <span class="adm-brd-vis">
                  <span class="adm-brd-visnow">${S('vis.' + board.visibility)}</span>
                  ${board.visibility !== 'system' && html`
                    <button type="button" class="adm-brd-visgo" disabled=${busy} onClick=${onFlip}>
                      ${isPublic ? S('makeShared') : S('makePublic')}
                    </button>`}
                </span>
                <em>${S('visWhy.' + board.visibility)}</em></dd>
            </div>
            <div class="adm-brd-fact">
              <dt>${S('factWhoPosts')}</dt>
              <dd>${S('posting.' + (rules.posting || 'anyone'))}<em>${S('factWhoPostsWhy')}</em></dd>
            </div>
            <div class="adm-brd-fact">
              <dt>${S('factLives')}</dt>
              <dd>${rules.defaultTtlHours
    ? S('livesHours', { n: num(rules.defaultTtlHours) })
    : S('livesForever')}</dd>
            </div>
            <div class="adm-brd-fact">
              <dt>${S('factCosts')}</dt>
              <dd>${rules.postCost ? S('costsMorsels', { n: num(rules.postCost) }) : S('costsNothing')}
                ${!rules.postCost && html`<em>${S('costsNothingWhy')}</em>`}</dd>
            </div>
            <div class="adm-brd-fact">
              <dt>${S('factCategories')}</dt>
              <dd>${rules.categories?.length
    ? html`<code>${rules.categories.join(' · ')}</code><em>${S('categoriesWhy')}</em>`
    : S('categoriesAny')}</dd>
            </div>
            <div class="adm-brd-fact">
              <dt>${S('factFederation')}</dt>
              <dd>${board.federate ? S('federateOn') : S('federateOff')}
                <em>${S('federateWhy')}</em></dd>
            </div>
          </dl>

          <div class="adm-brd-roster">
            <div class="adm-brd-lbl">${S('rosterTitle')}</div>
            <p class="adm-brd-rwhy">${S('rosterWhy')}</p>
            ${roster.length === 0
    ? html`<p class="adm-brd-hint">${S('rosterEmpty')}</p>`
    : roster.map(g => html`
              <div class="adm-brd-rrow" key=${g}>
                <span class="adm-brd-rgaii">${g}</span>
                <button type="button" class="adm-brd-rkill" disabled=${busy} onClick=${() => onDrop(g)}>${S('takeOff')}</button>
              </div>`)}
            <div class="adm-brd-radd">
              <input type="text" value=${newMember} placeholder=${S('rosterPlaceholder')}
                onInput=${e => setNewMember(e.target.value)}
                onKeyDown=${e => { if (e.key === 'Enter' && newMember.trim()) { onAdd(newMember.trim()); setNewMember(''); } }} />
              <button type="button" class="adm-brd-raddgo" disabled=${busy || !newMember.trim()}
                onClick=${() => { onAdd(newMember.trim()); setNewMember(''); }}>${S('add')}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

/** How many thanks a notice carries. The reactions map is emoji → the gaiis that gave it. */
function reactionCount(post) {
  const thanks = post.reactions?.thanks;
  return Array.isArray(thanks) ? thanks.length : 0;
}

/* ── Making one ──────────────────────────────────────────────────────────────────────────────── */

function Make({ form, setForm, onMake, busy, onCancel }) {
  const opt = (key, on) => html`
    <button type="button" class="adm-brd-opt ${form.visibility === key ? 'on' : ''} ${on ? '' : 'is-off'}"
      disabled=${!on} onClick=${() => on && setForm({ ...form, visibility: key })}>
      <b>${S('vis.' + key)}</b>${S('visWhy.' + key)}
    </button>`;

  return html`
    <div class="adm-brd-page">
      <div class="adm-brd-head">
        <h2>${S('makeTitle')}<small>02</small></h2>
        <button type="button" class="adm-brd-door" onClick=${onCancel}>${t('common.cancel')}</button>
      </div>
      <p class="adm-brd-lead">${S('makeLead')}</p>

      <div class="adm-brd-two adm-brd-two--make">
        <div>
          <div class="adm-brd-field">
            <div class="adm-brd-lbl">${S('fieldName')}</div>
            <div class="adm-brd-fld">
              <input type="text" value=${form.name} placeholder=${S('namePlaceholder')}
                onInput=${e => setForm({ ...form, name: e.target.value })} />
            </div>
            <p class="adm-brd-hint">${S('nameHint')}</p>
          </div>

          <div class="adm-brd-field">
            <div class="adm-brd-lbl">${S('fieldWhatFor')}</div>
            <div class="adm-brd-fld">
              <input type="text" value=${form.description} placeholder=${S('whatForPlaceholder')}
                onInput=${e => setForm({ ...form, description: e.target.value })} />
            </div>
            <p class="adm-brd-hint">${S('whatForHint')}</p>
          </div>

          <div class="adm-brd-field">
            <div class="adm-brd-lbl">${S('fieldWhoReads')}</div>
            <div class="adm-brd-choice">
              ${opt('public', true)}
              ${opt('shared', true)}
              ${opt('private', true)}
              ${opt('system', false)}
            </div>
            <p class="adm-brd-hint">${S('whoReadsHint')}</p>
          </div>

          <div class="adm-brd-act">
            <button class="adm-btn" disabled=${busy || !form.name.trim()} onClick=${onMake}>
              ${busy ? t('common.loading') : S('makeIt')}
            </button>
          </div>
        </div>

        <div>
          <div class="adm-brd-aside">
            <b>${S('asideTitle')}</b>
            <p>${S('asideBody')}</p>
          </div>

          <div class="adm-brd-starts">
            <div class="adm-brd-starts-l">${S('startsWith')}</div>
            <dl>
              <div class="adm-brd-srow"><dt>${S('factWhoPosts')}</dt><dd>${S('posting.anyone')}<em>${S('changeableOnBoard')}</em></dd></div>
              <div class="adm-brd-srow"><dt>${S('factLives')}</dt><dd>${S('livesForever')}</dd></div>
              <div class="adm-brd-srow"><dt>${S('factCosts')}</dt><dd>${S('costsNothing')}</dd></div>
              <div class="adm-brd-srow"><dt>${S('factCategories')}</dt><dd>${S('categoriesAny')}</dd></div>
              <div class="adm-brd-srow"><dt>${S('rosterTitle')}</dt><dd>${S('rosterEmptyShort')}</dd></div>
              <div class="adm-brd-srow"><dt>${S('factFederation')}</dt><dd>${S('federateOff')}</dd></div>
            </dl>
          </div>
        </div>
      </div>
    </div>`;
}
