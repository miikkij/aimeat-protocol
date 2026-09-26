/**
 * @file shared.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared components and utilities for profile tab modules.
 *   Exports: LoadingLine, recipientBadge, isExpiringSoon, VisibilityPill, ToggleSwitch, GlassCard,
 *   KebabMenu, TagInput.
 * @version-history
 *   v1.8.0 -- 2026-09-26 -- TagInput's × is the Tag's remove mark (.poster-chip-x, poster.css): grey, coral under the pointer, where it turned red (a unification: Jouni's decision "Remove mark").
 *   v1.7.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.6.0 -- 2026-09-25 -- The visibility pill is the Tag (.poster-chip), on the sun when public, as the memory cover draws visibility; it stays a button (a unification: Jouni's decision "Tag").
 *   v1.5.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.1.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   2026-09-25 -- KebabMenu's delete row keeps its danger colour, as the menu row's danger tone.
 *   2026-09-25 -- KebabMenu's rows are the menu row (.poster-menu-row), a unification: Jouni's decision "Menu row"; a danger item reads like the others, as the notification's Approve does.
 *   2026-09-13 -- V2t: compose card and section top rules from poster.css.
 *   v1.0.0 — 2026-03-07 — Initial shared helpers (Spinner, recipientBadge, isExpiringSoon)
 *   v1.1.0 — 2026-03-17 — Add VisibilityPill, ToggleSwitch, GlassCard components; refactor recipientBadge to CSS classes
 *   v1.2.0 — 2026-06-02 — Component unification (§2): Spinner now delegates to the
 *     canonical /components/Spinner.js (single source of the .spinner markup).
 *   v1.3.0 — 2026-06-02 — Component unification (#22): GlassCard now delegates to the
 *     canonical /components/Card.js via variant="glass" (.card-glass); call sites unchanged.
 *   v1.3.1 — 2026-06-19 — JSDoc type annotations for frontend type-checking
 *   v1.4.0 — 2026-06-19 — Promote KebabMenu (generic "…" actions menu) and TagInput (tag-chip
 *     input) out of organisms-tab.js into the profile shared layer so any profile view can reuse
 *     them; markup/CSS classes unchanged (.pj-menu* / .pj-taginput*), so the look is identical.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Card } from '/components/Card.js';

/** The loading line: the quiet sentence with the blinking Loading mark
 *  (css/components/loading-mark.css), the look most Settings tabs use for "this is loading".
 *  Without a text it says the profile's default "Loading…". */
export function LoadingLine({ text }) {
  return html`<p class="poster-quiet loading-mark">${text || t('profile.loading')}</p>`;
}

/** The recipient's kind as a Tag; "anyone" is the one to notice. */
export function recipientBadge(recipient) {
  const r = recipient || '';
  let label, cls = '';
  if (r === '*')                        { label = t('permissions.badgeWildcard'); cls = 'poster-chip--coral'; }
  else if (r.startsWith('ghii:'))       { label = t('permissions.badgeGhii'); }
  else if (r.startsWith('organism.'))   { label = t('permissions.badgeOrganism'); }
  else if (r.startsWith('domain:'))     { label = t('permissions.badgeDomain'); }
  else if (r.startsWith('node:'))       { label = t('permissions.badgeNode'); }
  else                                  { label = t('permissions.badgeGaii'); }
  return html`<span class=${`poster-chip ${cls}`}>${label}</span>`;
}

/** Check if a consent is expiring within 7 days. */
export function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const diff = +new Date(expiresAt) - Date.now();
  return diff > 0 && diff < 7 * 86400000;
}

/** Shared visibility tag (memory-tab, organisms): the Tag, on the sun when public, and a button. */
export function VisibilityPill({ visibility, onClick }) {
  return html`<button class=${`poster-chip vis-pill ${visibility === 'public' ? 'poster-chip--sun' : ''}`} onClick=${onClick}>
    ${t('profile.visibility.' + visibility)}
  </button>`;
}

/** Shared toggle switch — relocated to the canonical /components/ToggleSwitch.js (#14);
 *  re-exported here so notifications-tab/email-tab imports are unchanged. */
export { ToggleSwitch } from '/components/ToggleSwitch.js';

/** Glass-style card container (email-tab, notifications-tab) — delegates to the
 *  canonical /components/Card.js (variant="glass" → .card-glass); call sites unchanged. */
export function GlassCard({ children }) {
  return html`<${Card} variant="glass" className="poster-row--thing" hoverable=${false}>${children}<//>`;
}

/** "…" actions menu — items: { label, icon?, danger?, divider?, onClick } (falsy items are
 *  skipped). Closes on outside click. Default trigger is a ⋮ icon button; pass trigger/btnClass
 *  for a labelled button. Generic profile-shared primitive (promoted from organisms-tab.js).
 * @param {{ items: Array<{ label?: string, icon?: string, danger?: boolean, divider?: boolean,
 *   onClick?: () => void }|false|null|undefined>, label?: string, trigger?: any, btnClass?: string }} props */
export function KebabMenu({ items, label, trigger, btnClass }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);
  // .filter(Boolean) drops falsy entries but TS doesn't narrow the union — cast to the item shape.
  const visible = /** @type {Array<{ label?: string, icon?: string, danger?: boolean, divider?: boolean, onClick?: () => void }>} */ (
    (items || []).filter(Boolean)
  );
  if (visible.length === 0) return null;
  return html`
    <div class="pj-menu" ref=${ref}>
      <button class=${btnClass || 'poster-icon poster-icon--small'} title=${label} aria-haspopup="menu" aria-expanded=${open}
        onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }}>${trigger || '⋮'}</button>
      ${open ? html`
        <div class="pj-menu-pop" role="menu" onClick=${(e) => e.stopPropagation()}>
          ${visible.map((it, i) => it.divider
            ? html`<div class="pj-menu-sep" key=${'sep' + i}></div>`
            : html`
            <button class=${`poster-menu-row${it.danger ? ' poster-menu-row--danger' : ''}`} role="menuitem" key=${it.label}
              onClick=${() => { setOpen(false); it.onClick?.(); }}>${it.icon ? `${it.icon} ` : ''}${it.label}</button>`)}
        </div>` : null}
    </div>`;
}

/** Tag chips + inline input — Enter/comma adds, × or Backspace-on-empty removes, blur commits.
 *  Shows immediately how the value parses (vs. a raw "comma separated" text field). Generic
 *  profile-shared primitive (promoted from organisms-tab.js).
 * @param {{ tags: string[], onChange: (tags: string[]) => void, placeholder?: string }} props */
export function TagInput({ tags, onChange, placeholder }) {
  const [val, setVal] = useState('');
  const add = () => { const v = val.trim().replace(/,+$/, ''); if (v && !tags.includes(v)) onChange([...tags, v]); setVal(''); };
  const onKey = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
    else if (e.key === 'Backspace' && !val && tags.length) onChange(tags.slice(0, -1));
  };
  return html`
    <div class="pj-taginput">
      ${tags.map(tag => html`
        <span class="poster-chip pj-tag" key=${tag}>${(tag)}
          <button class="poster-chip-x" title="×" onClick=${() => onChange(tags.filter(x => x !== tag))}>×</button>
        </span>`)}
      <input class="pj-taginput-field" value=${val} placeholder=${placeholder || 'Add…'}
        onInput=${(e) => setVal(e.target.value)} onKeyDown=${onKey} onBlur=${add} />
    </div>`;
}
