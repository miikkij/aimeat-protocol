/**
 * @file public/components/MenuFind.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The find field at the top of a side menu (Settings & Controls, the admin pages). While
 *   nothing is typed it shows the field and the menu under it. Typing narrows the menu to the places
 *   whose name, other words or group match, with the sections inside a page whose name matches under
 *   their page, and the other side's places last under one title. The part of a name that matched is
 *   underlined, a place found by another word says which word, the best fit is chosen, ↑ and ↓ move
 *   the choice, Enter opens it and Escape clears the field. The / key anywhere on the page outside a
 *   field moves into the find. With nothing found it says so and offers the content search.
 *   The matching is js/menu-find.js; the look is css/components/menu-find.css; the catalogue entry is
 *   `menu-find` (design: claude.ai/artifact/ExfoqqeSCQuguJVRdcfWuA, approved by Jouni 2026-10-14).
 * @structure MenuFind({ tone, label, placeholder, groups, other, otherTitle, hiddenNote, onOpen, onWake, onContentSearch, initialQuery, children })
 *   (`initialQuery`: words already in the field when it appears, for the design lab's demos)
 * @usage html`<${MenuFind} label=${t('menuFind.labelSettings')} placeholder=${t('menuFind.placeholderSettings')}
 *   groups=${groups} other=${adminGroups} otherTitle=${t('menuFind.otherOperator')} onOpen=${openRow}>${menu}<//>`
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-pikahaku-settings-controls-ja-admin-sivuille).
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { findInMenu } from '/js/menu-find.js';

const html = htm.bind(h);
let seq = 0;

/**
 * A key press in a field, a list or while a dialog is open is not a / for the find. The first
 * element of the event's path is the one typed in, also inside a shadow root (the sign-in dialog's
 * password field), where `target` is only the host.
 */
function typingElsewhere(e) {
  const el = /** @type {HTMLElement|null} */ ((e.composedPath && e.composedPath()[0]) || e.target);
  if (el && el.closest && (el.isContentEditable || el.closest('input, textarea, select, [contenteditable="true"]'))) return true;
  return !!document.querySelector('dialog[open]');
}

/**
 * Keep a row in sight inside the menu's own scrolling column, below the field that stays at its top
 * (`head`), and move nothing else.
 */
function keepInView(el, head) {
  let box = el?.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  if (!box || !el) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  const top = Math.max(b.top, head ? head.getBoundingClientRect().bottom : b.top);
  if (r.top < top) box.scrollTop -= top - r.top + 8;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + 8;
}

const glass = html`<svg class="menu-find-glass" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none"
  stroke="currentColor" stroke-width="2"><circle cx="7" cy="7" r="4.5"></circle><path d="M10.5 10.5 14 14"></path></svg>`;

/**
 * @param {{ tone?: 'settings'|'operator', label: string, placeholder?: string,
 *   groups: import('/js/menu-find.js').FindGroup[], other?: import('/js/menu-find.js').FindGroup[], otherTitle?: string,
 *   hiddenNote?: string, onOpen: (row: import('/js/menu-find.js').FindRow, words: string) => void, onWake?: () => void,
 *   onContentSearch?: (words: string) => void, initialQuery?: string, children?: any }} props
 */
export function MenuFind({ tone = 'settings', label, placeholder, groups, other, otherTitle, hiddenNote, onOpen, onWake, onContentSearch, initialQuery = '', children }) {
  const [q, setQ] = useState(initialQuery);
  const [sel, setSel] = useState(-1);
  const inputRef = useRef(/** @type {HTMLInputElement|null} */ (null));
  const listRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const headRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const idRef = useRef('');
  if (!idRef.current) idRef.current = `menu-find-${++seq}`;
  const id = idRef.current;

  const found = useMemo(() => findInMenu(groups, q, { other, otherTitle }), [groups, other, otherTitle, q]);
  const chosen = sel >= 0 && sel < found.rows.length ? sel : found.best;

  // New words, a new choice: the best fit.
  useEffect(() => { setSel(-1); }, [found.query]);

  // The / key anywhere outside a field moves into the find.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented || typingElsewhere(e)) return;
      e.preventDefault();
      onWake?.();
      setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onWake]);

  // The field sticks under the scrolling column's top padding, and the rows passing through that
  // strip would show above it: while it is stuck, its ground also covers the strip (is-stuck, and
  // --menu-find-lift the column's own top padding, measured).
  useEffect(() => {
    const head = headRef.current;
    let box = head?.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!head || !box) return undefined;
    const scroller = box;
    const onScroll = () => {
      const pad = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
      const stuck = scroller.scrollTop > 0 && head.getBoundingClientRect().top <= scroller.getBoundingClientRect().top + pad + 1;
      head.style.setProperty('--menu-find-lift', `${pad}px`);
      head.classList.toggle('is-stuck', stuck);
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

  // The chosen row stays in sight as ↑ and ↓ move it, and when new words choose a new best fit.
  useEffect(() => {
    keepInView(listRef.current?.querySelector('.menu-find-row.is-sel'), headRef.current);
  }, [chosen, found.query]);

  const open = (row) => { if (row) onOpen(row, q.trim()); };
  const clear = () => { setQ(''); inputRef.current?.focus(); };
  const onKeyDown = (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' && found.rows.length) { e.preventDefault(); setSel(Math.min(chosen + 1, found.rows.length - 1)); }
    else if (e.key === 'ArrowUp' && found.rows.length) { e.preventDefault(); setSel(Math.max(chosen - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); open(found.rows[chosen]); }
    else if (e.key === 'Escape') { e.preventDefault(); if (q) setQ(''); else inputRef.current?.blur(); }
  };

  const searching = !!found.query;
  const n = found.places;
  const s = found.sections;
  const count = [
    n === 1 ? t('menuFind.placesOne') : t('menuFind.placesMany', { n }),
    s ? (s === 1 ? t('menuFind.sectionsOne') : t('menuFind.sectionsMany', { n: s })) : '',
  ].filter(Boolean).join(t('menuFind.and'));

  const row = (r) => {
    const isSel = r.index === chosen;
    const cls = `menu-find-row${r.kind !== 'place' ? ' menu-find-row--section' : ''}${isSel ? ' is-sel' : ''}`;
    const words = r.kind === 'more' ? t('menuFind.more', { n: r.more })
      : r.cut ? html`${r.cut.before}<mark class="menu-find-hit">${r.cut.hit}</mark>${r.cut.after}` : r.label;
    return html`
      ${/* The pointer chooses a row only when it moves: a list that scrolls under a resting pointer
            (↓ at the foot of the menu) must not take the keyboard's choice away. */''}
      <button type="button" key=${r.key} class=${cls} aria-current=${isSel ? 'true' : undefined}
        onMouseMove=${() => { if (!isSel) setSel(r.index); }} onClick=${() => open(r)}>
        ${r.num ? html`<span class="menu-find-num">${r.num}</span>` : null}
        <span class="menu-find-words">
          <span>${words}</span>
          ${r.via ? html`<span class="menu-find-via">${t('menuFind.matches', { word: r.via })}</span>` : null}
        </span>
        ${r.tail ? html`<span class="menu-find-tail">${r.tail}</span>` : null}
        ${isSel ? html`<span class="menu-find-enter" aria-hidden="true">↩</span>` : null}
      </button>`;
  };

  return html`
    <div class=${`menu-find${tone === 'operator' ? ' menu-find--operator' : ''}`}>
      <div class="menu-find-box" ref=${headRef}>
        <label class="poster-label poster-label--block menu-find-label" for=${id}>${label}</label>
        <div class="menu-find-field">
          ${glass}
          <input id=${id} ref=${inputRef} class="menu-find-input" type="text" value=${q} placeholder=${placeholder}
            autocomplete="off" spellcheck=${false} aria-describedby=${searching ? `${id}-count` : undefined}
            onInput=${(e) => setQ(e.currentTarget.value)} onKeyDown=${onKeyDown} />
          ${q
            ? html`<button type="button" class="poster-icon poster-icon--small menu-find-clear" aria-label=${t('menuFind.clear')} onClick=${clear}>✗</button>`
            : html`<kbd class="poster-chip menu-find-key" title=${t('menuFind.slashHint')}>/</kbd>`}
        </div>
        ${searching && found.rows.length ? html`
          <div class="menu-find-count" id=${`${id}-count`} aria-live="polite">
            <b>${count}</b>. ${t('menuFind.keys')}${found.hidden && hiddenNote ? ` ${hiddenNote}` : ''}
          </div>` : null}
      </div>
      ${!searching ? children : found.rows.length ? html`
        <div class="menu-find-results" ref=${listRef}>
          ${found.groups.map((g) => html`
            <div class="menu-find-group" key=${g.key}>
              ${g.title ? html`<div class=${`menu-find-title${g.other ? ' menu-find-title--other' : ''}`}>${g.title}</div>` : null}
              ${g.rows.map(row)}
            </div>`)}
        </div>` : html`
        <div class="poster-aside poster-aside--small menu-find-none" aria-live="polite">
          <p class="menu-find-none-words">${t('menuFind.nothing', { q: q.trim() })}</p>
          ${onContentSearch ? html`
            <button type="button" class="poster-action poster-action--small" onClick=${() => onContentSearch(q.trim())}>
              ${t('menuFind.contentSearch', { q: q.trim() })}
            </button>
            <kbd class="poster-chip menu-find-key">Ctrl K</kbd>` : null}
        </div>`}
    </div>`;
}

export default MenuFind;
