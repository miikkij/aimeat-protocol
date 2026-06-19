/**
 * @file shared.js
 * @description Shared components and utilities for profile tab modules.
 *   Exports: Spinner, recipientBadge, isExpiringSoon, VisibilityPill, ToggleSwitch, GlassCard,
 *   KebabMenu, TagInput.
 * @version-history
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
import { Spinner as BaseSpinner } from '/components/Spinner.js';
import { Card } from '/components/Card.js';

/** Loading spinner — delegates to the canonical /components/Spinner.js (single
 *  source of the .spinner markup); keeps the profile default loading label so the
 *  23 profile call sites that rely on it are unchanged. */
export function Spinner({ text }) {
  return html`<${BaseSpinner} text=${text || t('profile.loading')} />`;
}

/** Render a colored recipient-type badge. */
export function recipientBadge(recipient) {
  const r = recipient || '';
  let label, cls;
  if (r === '*')                        { label = t('permissions.badgeWildcard'); cls = 'badge-wildcard'; }
  else if (r.startsWith('ghii:'))       { label = t('permissions.badgeGhii');     cls = 'badge-ghii'; }
  else if (r.startsWith('organism.'))   { label = t('permissions.badgeOrganism'); cls = 'badge-organism'; }
  else if (r.startsWith('domain:'))     { label = t('permissions.badgeDomain');   cls = 'badge-domain'; }
  else if (r.startsWith('node:'))       { label = t('permissions.badgeNode');     cls = 'badge-node'; }
  else                                  { label = t('permissions.badgeGaii');     cls = 'badge-gaii'; }
  return html`<span class="badge-label ${cls}">${label}</span>`;
}

/** Check if a consent is expiring within 7 days. */
export function isExpiringSoon(expiresAt) {
  if (!expiresAt) return false;
  const diff = +new Date(expiresAt) - Date.now();
  return diff > 0 && diff < 7 * 86400000;
}

/** Shared visibility toggle pill (memory-tab, knowledge-tab). */
export function VisibilityPill({ visibility, onClick }) {
  return html`<button class="vis-pill vis-${visibility}" onClick=${onClick}>
    ${t('profile.visibility.' + visibility)}
  </button>`;
}

/** Shared toggle switch — relocated to the canonical /components/ToggleSwitch.js (#14);
 *  re-exported here so notifications-tab/email-tab imports are unchanged. */
export { ToggleSwitch } from '/components/ToggleSwitch.js';

/** Glass-style card container (email-tab, notifications-tab) — delegates to the
 *  canonical /components/Card.js (variant="glass" → .card-glass); call sites unchanged. */
export function GlassCard({ children }) {
  return html`<${Card} variant="glass" hoverable=${false}>${children}<//>`;
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
      <button class=${btnClass || 'pj-icon-btn pj-menu-btn'} title=${label} aria-haspopup="menu" aria-expanded=${open}
        onClick=${(e) => { e.stopPropagation(); setOpen(o => !o); }}>${trigger || '⋮'}</button>
      ${open ? html`
        <div class="pj-menu-pop" role="menu" onClick=${(e) => e.stopPropagation()}>
          ${visible.map((it, i) => it.divider
            ? html`<div class="pj-menu-sep" key=${'sep' + i}></div>`
            : html`
            <button class="pj-menu-item ${it.danger ? 'pj-menu-item-danger' : ''}" role="menuitem" key=${it.label}
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
        <span class="file-tag pj-tag" key=${tag}>${(tag)}
          <button class="pj-tag-x" title="×" onClick=${() => onChange(tags.filter(x => x !== tag))}>×</button>
        </span>`)}
      <input class="pj-taginput-field" value=${val} placeholder=${placeholder || 'Add…'}
        onInput=${(e) => setVal(e.target.value)} onKeyDown=${onKey} onBlur=${add} />
    </div>`;
}
