/**
 * @file contacts-tab.js
 * @description Profile → Contacts tab — the owner's address book. Two groups: SAVED contacts
 *   (explicitly added; removable) and MESSAGED people (DM conversation peers / gate rows; one
 *   click saves them). An add box takes an owner name, a member-directory pick, or an email
 *   (exact-match resolve → add; miss → hint to invite via an organism). Blocked contacts are
 *   managed in Messages — this tab only counts them and links over.
 * @structure ContactsTab (default export)
 * @usage Registered in views/profile.js TABS as id 'contacts'.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { PresenceDot } from '/components/PresenceDot.js';
import * as contactsService from '/js/services/contacts.js';

const KIND_ICON = { ghii: '👤', gaii: '🤖', geai: '🧩' };
const bare = (id) => String(id || '').split('@')[0];
const initials = (id) => bare(id).slice(0, 2).toUpperCase();

export default function ContactsTab({ showToast }) {
  const [contacts, setContacts] = useState(null);
  const [blockedCount, setBlockedCount] = useState(0);
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [emailMiss, setEmailMiss] = useState(null);   // unresolved email → invite hint

  const load = useCallback(async () => {
    try {
      const [list, blocked] = await Promise.all([
        contactsService.listContacts(),
        contactsService.listContacts({ state: 'blocked' }),
      ]);
      setContacts(list);
      setBlockedCount(blocked.length);
    } catch { setContacts([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['messages'], () => liveRef.current()), []);

  const add = async (target) => {
    const id = (target ?? who).trim();
    if (!id) return;
    setBusy(true);
    try {
      const r = await contactsService.addContact(id);
      if (r?.ok === false) showToast(r?.error?.message || (t('contacts.addFailed') || 'Could not add the contact'), true);
      else { showToast(t('contacts.added') || 'Contact saved'); setWho(''); setEmailMiss(null); }
      await load();
    } catch (e) { showToast((e && e.message) || (t('contacts.addFailed') || 'Could not add the contact'), true); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      const r = await contactsService.removeContact(id);
      if (r?.ok === false) showToast(r?.error?.message || (t('contacts.removeFailed') || 'Could not remove the contact'), true);
      else showToast(t('contacts.removed') || 'Contact removed');
      await load();
    } catch (e) { showToast((e && e.message) || (t('contacts.removeFailed') || 'Could not remove the contact'), true); }
    finally { setBusy(false); }
  };

  const filter = (list) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(c => c.contact_id.toLowerCase().includes(needle) || (c.display_name || '').toLowerCase().includes(needle));
  };
  const all = contacts || [];
  const saved = filter(all.filter(c => c.origin === 'saved'));
  const messaged = filter(all.filter(c => c.origin !== 'saved'));

  const row = (c, actions) => html`
    <div class="pf-ct-row" key=${c.contact_id}>
      <div class="pf-ct-avatar" aria-hidden="true">${KIND_ICON[c.kind] === '👤' ? initials(c.contact_id) : (KIND_ICON[c.kind] || '👤')}</div>
      <div class="pf-ct-main">
        <div class="pf-ct-name">
          ${c.display_name || bare(c.contact_id)}
          ${c.kind === 'ghii' ? html` <${PresenceDot} ghii=${c.contact_id} />` : null}
          ${c.kind !== 'ghii' ? html`<span class="badge badge-info">${c.kind === 'gaii' ? (t('contacts.kindAgent') || 'agent') : (t('contacts.kindApp') || 'app')}</span>` : null}
        </div>
        <div class="pf-ct-id">${c.contact_id}${c.has_messages ? ` · ${t('contacts.hasMessages') || 'messaged'}` : ''}</div>
      </div>
      ${actions}
    </div>`;

  return html`
    <div class="pf-ct">
      <div class="section-title">${t('contacts.title') || 'Contacts'}</div>
      <div class="section-desc">${t('contacts.desc') || 'Your address book: people you trust and people you have messaged. Contacts feed the identity pickers everywhere you grant access — organisms, workspaces, and apps.'}</div>

      <div class="pf-ct-addrow">
        <${ContactPicker} value=${who} onChange=${setWho} onSubmit=${() => add()} valueMode="full"
          onEmailUnresolved=${(email) => setEmailMiss(email)}
          placeholder=${t('contacts.addPlaceholder') || 'owner name or email'} disabled=${busy} />
        <button class="btn-primary btn-sm" disabled=${busy || !who.trim()} onClick=${() => add()}>${'+ '}${t('contacts.add') || 'Add'}</button>
        <input class="input-field input-sm pf-ct-filter" placeholder=${t('contacts.filterPlaceholder') || 'Filter…'}
          value=${q} onInput=${(e) => setQ(e.target.value)} />
      </div>
      ${emailMiss ? html`
        <div class="section-desc pf-ct-miss">
          ${(t('contacts.inviteHint') || 'No account for {email} yet — invite them by email from an organism\'s Members tab (they get an account and the access you choose in one step).').replace('{email}', emailMiss)}
        </div>` : null}

      ${contacts === null ? html`<div class="section-desc">${t('contacts.loading') || 'Loading…'}</div>` : html`
        <div class="detail-label">${t('contacts.savedGroup') || 'Saved contacts'} <span class="pf-ct-count">${saved.length}</span></div>
        ${saved.length ? saved.map(c => row(c, html`
          <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => remove(c.contact_id)}>${t('contacts.remove') || 'Remove'}</button>
        `)) : html`<div class="section-desc">${t('contacts.savedEmpty') || 'Nobody saved yet — add someone above, or save a messaged person below.'}</div>`}

        <div class="detail-label">${t('contacts.messagedGroup') || 'People you\'ve messaged'} <span class="pf-ct-count">${messaged.length}</span></div>
        ${messaged.length ? messaged.map(c => row(c, html`
          <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => add(c.contact_id)}>${t('contacts.save') || 'Save'}</button>
        `)) : html`<div class="section-desc">${t('contacts.messagedEmpty') || 'Direct-message conversations show up here automatically.'}</div>`}

        ${blockedCount > 0 ? html`
          <div class="section-desc pf-ct-blocked">
            ${(t('contacts.blockedNote') || '{n} blocked contact(s) — manage them in the Messages tab.').replace('{n}', String(blockedCount))}
          </div>` : null}
      `}
    </div>`;
}
