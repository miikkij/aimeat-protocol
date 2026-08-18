/**
 * @file public/components/ContactPicker.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Shared identity picker: a text input with a suggestion dropdown fed by the owner's
 *   CONTACTS (address book, lazy-loaded on focus) plus the member DIRECTORY (opt-in name search
 *   when typing ≥ 2 chars). Free text always passes through (owner names, GHIIs, emails), so any
 *   host form keeps its existing submit logic — the picker only makes finding the identity easy.
 *   Typing something email-shaped shows a resolve action (exact-match /v1/contacts/resolve): a
 *   hit fills in the owner's name; a miss calls onEmailUnresolved so the host can pivot to an
 *   email invitation.
 * @structure ContactPicker({ value, onChange, onSubmit, onEmailUnresolved, placeholder, disabled, excludeIds, autofocus })
 * @usage import { ContactPicker } from '/components/ContactPicker.js';
 *   <${ContactPicker} value=${who} onChange=${setWho} onSubmit=${submit} />
 * @version-history
 *   v1.2.0 — 2026-08-17 — TARGET-063: saved PEOPLE (kind 'mail') are excluded by DEFAULT and only
 *     suggested where a host asks for them by name. Every surface this picker feeds grants access
 *     or sends a message, and a person with no account here can receive neither — suggesting them
 *     would offer a choice that cannot work, on five of the six surfaces at once.
 *   v1.1.0 — 2026-07-16 — `kinds` prop: hosts narrow suggestions to accepted identity classes
 *     (member/grant surfaces pass ['ghii'] so agents are never suggested where only owners are valid).
 *   v1.0.0 — 2026-07-16 — Initial: contacts + directory suggestions, email resolve, freeform passthrough.
 */
import { h } from 'preact';
import { useState, useEffect, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as contactsService from '/js/services/contacts.js';
import { swallowed } from '/js/swallowed.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KIND_ICON = { ghii: '👤', gaii: '🤖', geai: '🧩', mail: '✉' };

/**
 * Identity picker input. Controlled: `value`/`onChange(text)` mirror a plain input, so hosts keep
 * their own submit logic; `onSubmit(text)` fires on Enter (when no suggestion is highlighted).
 * `onEmailUnresolved(email)` fires when an email lookup finds no account (host may offer an email
 * invitation). `excludeIds` hides ids already chosen/present (e.g. current members). `valueMode`
 * controls what a picked suggestion writes back: 'bare' (default — grant surfaces key on the bare
 * local owner name) or 'full' (messaging surfaces need the full GHII/GAII). `kinds` narrows the
 * suggestions to identity classes the host accepts (e.g. ['ghii'] on member/grant surfaces where
 * only humans are valid — suggesting an agent there just produces an OWNER_NOT_FOUND).
 */
export function ContactPicker({ value = '', onChange, onSubmit, onEmailUnresolved, placeholder, disabled, excludeIds = [], autofocus, valueMode = 'bare', kinds }) {
  const [contacts, setContacts] = useState(null);     // lazy: null until first focus
  const [dirHits, setDirHits] = useState([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(-1);                   // highlighted suggestion index
  const [resolveState, setResolveState] = useState(null); // null | 'busy' | {found, ...}
  const rootRef = useRef(null);
  const dirTimer = useRef(0);

  const bare = (id) => String(id || '').split('@')[0];
  const isEmail = EMAIL_RE.test(value.trim()) && !value.includes('#');

  const loadContacts = useCallback(async () => {
    if (contacts !== null) return;
    try { setContacts(await contactsService.listContacts()); } catch (err) { swallowed('ContactPicker', err); setContacts([]); }
  }, [contacts]);

  // Directory search (debounced) — only for name-ish input, never for emails/full ids.
  useEffect(() => {
    setResolveState(null);
    if (!open) return undefined;
    const q = value.trim();
    if (q.length < 2 || q.includes('@') || q.includes('#')) { setDirHits([]); return undefined; }
    dirTimer.current = window.setTimeout(async () => {
      const hits = await contactsService.searchDirectory(q);
      setDirHits(hits);
    }, 250);
    return () => window.clearTimeout(dirTimer.current);
  }, [value, open]);

  // Close on outside click.
  useEffect(() => {
    const close = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const q = value.trim().toLowerCase();
  const excluded = new Set((excludeIds || []).map(x => bare(x)));
  // 'mail' is opt-in, never a default suggestion: every host of this picker either grants access
  // or addresses a message, and a person with no account here can be given neither.
  const kindOk = (k) => kinds ? kinds.includes(k) : k !== 'mail';
  const fromContacts = (contacts || [])
    .filter(c => kindOk(c.kind))
    .filter(c => !excluded.has(bare(c.contact_id)))
    .filter(c => !q || c.contact_id.toLowerCase().includes(q) || (c.display_name || '').toLowerCase().includes(q))
    .slice(0, 8)
    .map(c => ({ id: c.contact_id, label: c.display_name || bare(c.contact_id), kind: c.kind, source: 'contact' }));
  const seen = new Set(fromContacts.map(s => s.id));
  const fromDirectory = (dirHits || [])
    .filter(hHit => hHit.ghii && !seen.has(hHit.ghii) && !excluded.has(bare(hHit.ghii)))
    .slice(0, 5)
    .map(hHit => ({ id: hHit.ghii, label: hHit.display_name || bare(hHit.ghii), kind: 'ghii', source: 'directory' }));
  const suggestions = [...fromContacts, ...fromDirectory];

  const pick = (s) => {
    onChange?.(valueMode === 'full' ? s.id : bare(s.id));
    setOpen(false); setHi(-1);
  };

  const doResolve = async () => {
    const email = value.trim().toLowerCase();
    setResolveState('busy');
    try {
      const r = await contactsService.resolveEmail(email);
      setResolveState(r);
      if (r.found) { onChange?.(r.owner); setOpen(false); }
      else onEmailUnresolved?.(email);
    } catch (err) { swallowed('ContactPicker', err); setResolveState(null); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(i => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(i => Math.max(i - 1, -1)); }
    else if (e.key === 'Escape') { setOpen(false); setHi(-1); }
    else if (e.key === 'Enter') {
      if (open && hi >= 0 && suggestions[hi]) { e.preventDefault(); pick(suggestions[hi]); }
      else if (isEmail && resolveState === null) { e.preventDefault(); doResolve(); }
      else onSubmit?.(value);
    }
  };

  return html`
    <div class="cp-root" ref=${rootRef}>
      <input class="input-field input-sm cp-input" autofocus=${autofocus} disabled=${disabled}
        placeholder=${placeholder || (t('contacts.pickerPlaceholder') || 'owner name, email, or pick a contact')}
        value=${value}
        onInput=${(e) => { onChange?.(e.target.value); setOpen(true); setHi(-1); }}
        onFocus=${() => { loadContacts(); setOpen(true); }}
        onKeyDown=${onKeyDown} />
      ${open && (suggestions.length || isEmail) ? html`
        <div class="cp-drop">
          ${suggestions.map((s, i) => html`
            <button type="button" class="cp-item ${i === hi ? 'cp-item-hi' : ''}" key=${s.id}
              onMouseDown=${(e) => { e.preventDefault(); pick(s); }}>
              <span class="cp-item-icon" aria-hidden="true">${KIND_ICON[s.kind] || '👤'}</span>
              <span class="cp-item-label">${s.label}</span>
              <span class="cp-item-id">${s.id}</span>
              ${s.source === 'directory' ? html`<span class="cp-item-src">${t('contacts.fromDirectory') || 'directory'}</span>` : null}
            </button>`)}
          ${isEmail ? html`
            <button type="button" class="cp-item cp-item-resolve" onMouseDown=${(e) => { e.preventDefault(); doResolve(); }}>
              <span class="cp-item-icon" aria-hidden="true">${'✉'}</span>
              <span class="cp-item-label">${resolveState === 'busy' ? (t('contacts.resolving') || 'Looking up…') : (t('contacts.resolveAction') || 'Look up this email')}</span>
            </button>` : null}
          ${resolveState && resolveState !== 'busy' && !resolveState.found ? html`
            <div class="cp-item cp-item-miss">${t('contacts.resolveMiss') || 'No account with that email — you can send an email invitation instead.'}</div>` : null}
        </div>` : null}
    </div>`;
}
