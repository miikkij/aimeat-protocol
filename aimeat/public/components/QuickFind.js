/**
 * @file public/components/QuickFind.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Find a place and jump to it: a search field, a line that says how the keys work, and
 *   the places found in named groups, one of them chosen. The component owns the behaviour: the
 *   field takes the focus when it appears, ↑ and ↓ move the choice, Enter takes the chosen place, the
 *   pointer on a place chooses it, and the choice goes back to the first place whenever the places
 *   change. While it searches with nothing found yet it shows the loading line; with nothing found it
 *   says so. A page passes the words, the groups of places and what taking one does; it never writes
 *   a class. Its look is css/components/quick-find.css; a group's name is the row label (Mark.js
 *   Label).
 * @structure QuickFind({ value, onInput, placeholder, hint, groups, busy, busyLabel, emptyLabel, onPick })
 * @usage html`<${QuickFind} value=${q} onInput=${setQ} placeholder=${…} hint=${…}
 *   groups=${[{ key: 'orgs', label: t('organisms.title'), items: [{ key, mark: '🏢', label, sub, snippet }] }]}
 *   busy=${busy} busyLabel=${…} emptyLabel=${nothing ? t('search.noMatches') : null} onPick=${open} />`
 * @version-history
 *   v1.0.0 — 2026-09-27 — Initial: the command palette's list (views/command-palette.js, .cmdk*) as
 *     a component with its keys and its choice (page group G9).
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { SearchBar } from '/components/SearchBar.js';
import { Spinner } from '/components/Spinner.js';
import { EmptyState } from '/components/EmptyState.js';
import { Label } from '/components/Mark.js';

const html = htm.bind(h);

/**
 * `groups`: [{ key, label, items: [{ key, mark, label, sub, snippet, …the page's own data }] }]; a
 * group with no items is not drawn. `onPick(item)` gets the item as the page gave it. `emptyLabel`:
 * the words when nothing was found (the page passes them only when a search has run).
 */
export function QuickFind({ value, onInput, placeholder, hint, groups = [], busy, busyLabel, emptyLabel, onPick }) {
  const [sel, setSel] = useState(0);
  const boxRef = useRef(null);
  const shown = groups.filter((g) => g && g.items && g.items.length);
  const items = shown.flatMap((g) => g.items);
  const signature = items.map((it) => it.key).join('\n');

  // The field takes the focus when the finder appears (after the dialog has opened it).
  useEffect(() => {
    const tid = setTimeout(() => boxRef.current?.querySelector('input')?.focus(), 30);
    return () => clearTimeout(tid);
  }, []);
  // New places, a new choice: the first one.
  useEffect(() => { setSel(0); }, [signature]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (items[sel]) onPick?.(items[sel]); }
  };

  let idx = -1;
  const row = (it) => {
    idx++;
    const i = idx;
    return html`
      <button type="button" class=${'quick-find-item' + (i === sel ? ' is-sel' : '')} key=${it.key}
        onMouseEnter=${() => setSel(i)} onClick=${() => onPick?.(it)}>
        <span class="quick-find-label">${it.mark ? `${it.mark} ` : ''}${it.label}</span>
        ${it.sub ? html`<span class="quick-find-sub">${it.sub}</span>` : null}
        ${it.snippet ? html`<span class="quick-find-snippet">${it.snippet}</span>` : null}
      </button>`;
  };

  return html`
    <div class="quick-find" ref=${boxRef} onKeyDown=${onKeyDown}>
      <${SearchBar} value=${value} onInput=${(e) => onInput?.(e.target.value, e)} placeholder=${placeholder} />
      ${hint ? html`<div class="quick-find-hint">${hint}</div>` : null}
      <div class="quick-find-list">
        ${busy && !items.length ? html`<${Spinner} text=${busyLabel} />` : null}
        ${!busy && !items.length && emptyLabel ? html`<${EmptyState} text=${emptyLabel} />` : null}
        ${shown.map((g) => html`
          <div class="quick-find-group" key=${'g-' + g.key}><${Label}>${g.label}<//></div>
          ${g.items.map(row)}`)}
      </div>
    </div>`;
}

export default QuickFind;
