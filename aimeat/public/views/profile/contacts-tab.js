/**
 * @file contacts-tab.js
 * @description Profile → Contacts tab — the owner's address book. Two groups: SAVED contacts
 *   (explicitly added; removable) and MESSAGED people (DM conversation peers / gate rows; one
 *   click saves them). An add box takes an owner name, a member-directory pick, or an email
 *   (exact-match resolve → add; miss → the person panel, so the answer to "they have no account"
 *   is writing them down rather than a dead end). Blocked contacts are managed in Messages — this
 *   tab only counts them and links over.
 * @structure ContactsTab (default export)
 * @usage Registered in views/profile.js TABS as id 'contacts'.
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial.
 *   v1.1.0 — 2026-07-18 — Vaihe 3 card-cohesion: the two contact groups (saved / messaged) are now
 *     each framed in a `.pf-agd-card` with a canonical `.pf-agd-section-label` header (were bare
 *     `.detail-label` text over unframed border-bottom row lists). The loose rows now read as two
 *     cohesive cards instead of a ragged column.
 *   v1.2.0 — 2026-08-17 — TARGET-063: save a PERSON who has no account here (name, email, note,
 *     relation, one link), show their card on the row, and edit note/relation in place. An
 *     unresolved email now opens that panel prefilled instead of only hinting at an organism.
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
import { swallowed } from '/js/swallowed.js';

const KIND_ICON = { ghii: '👤', gaii: '🤖', geai: '🧩', mail: '✉' };
const bare = (id) => String(id || '').split('@')[0];
const initials = (id) => bare(id).slice(0, 2).toUpperCase();
const EMPTY_PERSON = { name: '', email: '', note: '', relation: '', link: '' };

export default function ContactsTab({ showToast }) {
  const [contacts, setContacts] = useState(null);
  const [blockedCount, setBlockedCount] = useState(0);
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [emailMiss, setEmailMiss] = useState(null);   // unresolved email → the person panel
  const [person, setPerson] = useState(null);         // null = panel closed
  const [editing, setEditing] = useState(null);       // contact_id whose card is open
  const [edit, setEdit] = useState({ note: '', relation: '' });

  const load = useCallback(async () => {
    try {
      const [list, blocked] = await Promise.all([
        contactsService.listContacts(),
        contactsService.listContacts({ state: 'blocked' }),
      ]);
      setContacts(list);
      setBlockedCount(blocked.length);
    } catch (err) { swallowed('contacts-tab', err); setContacts([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(load); liveRef.current = load;
  useEffect(() => onLiveUpdate(['messages'], () => liveRef.current()), []);

  const fail = (e, key, fallback) => showToast((e && e.message) || (t(key) || fallback), true);

  const add = async (target) => {
    const id = (target ?? who).trim();
    if (!id) return;
    setBusy(true);
    try {
      const r = await contactsService.addContact(id);
      if (r?.ok === false) showToast(r?.error?.message || (t('contacts.addFailed') || 'Could not add the contact'), true);
      else { showToast(t('contacts.added') || 'Contact saved'); setWho(''); setEmailMiss(null); }
      await load();
    } catch (e) { fail(e, 'contacts.addFailed', 'Could not add the contact'); }
    finally { setBusy(false); }
  };

  // An email nobody here owns is not a dead end: it is a person worth writing down. The panel
  // opens with the address already filled so the only thing left to type is who they are.
  const openPersonFor = (email) => { setEmailMiss(email); setPerson({ ...EMPTY_PERSON, email }); };

  const savePerson = async () => {
    if (!person?.name.trim() || !person?.email.trim()) return;
    setBusy(true);
    try {
      const r = await contactsService.savePerson({
        name: person.name.trim(), email: person.email.trim(),
        note: person.note.trim() || null,
        relation: person.relation.trim() || null,
        links: person.link.trim() ? [{ label: '', url: person.link.trim() }] : undefined,
      });
      if (r?.ok === false) showToast(r?.error?.message || (t('contacts.addFailed') || 'Could not add the contact'), true);
      else { showToast(t('contacts.added') || 'Contact saved'); setPerson(null); setEmailMiss(null); setWho(''); }
      await load();
    } catch (e) { fail(e, 'contacts.addFailed', 'Could not add the contact'); }
    finally { setBusy(false); }
  };

  const saveCard = async (id) => {
    setBusy(true);
    try {
      const r = await contactsService.updatePerson(id, { note: edit.note.trim() || null, relation: edit.relation.trim() || null });
      if (r?.ok === false) showToast(r?.error?.message || (t('contacts.updateFailed') || 'Could not update the contact'), true);
      else { showToast(t('contacts.updated') || 'Contact updated'); setEditing(null); }
      await load();
    } catch (e) { fail(e, 'contacts.updateFailed', 'Could not update the contact'); }
    finally { setBusy(false); }
  };

  const remove = async (id) => {
    setBusy(true);
    try {
      const r = await contactsService.removeContact(id);
      if (r?.ok === false) showToast(r?.error?.message || (t('contacts.removeFailed') || 'Could not remove the contact'), true);
      else showToast(t('contacts.removed') || 'Contact removed');
      await load();
    } catch (e) { fail(e, 'contacts.removeFailed', 'Could not remove the contact'); }
    finally { setBusy(false); }
  };

  const filter = (list) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter(c => c.contact_id.toLowerCase().includes(needle)
      || (c.display_name || '').toLowerCase().includes(needle)
      || (c.email || '').toLowerCase().includes(needle));
  };
  const all = contacts || [];
  const saved = filter(all.filter(c => c.origin === 'saved'));
  const messaged = filter(all.filter(c => c.origin !== 'saved'));

  const kindBadge = (kind) => kind === 'gaii' ? (t('contacts.kindAgent') || 'agent')
    : kind === 'geai' ? (t('contacts.kindApp') || 'app')
      : (t('contacts.kindPerson') || 'no account yet');

  const row = (c, actions) => html`
    <div class="pf-ct-row" key=${c.contact_id}>
      <div class="pf-ct-avatar" aria-hidden="true">${c.kind === 'ghii' ? initials(c.contact_id) : (KIND_ICON[c.kind] || '👤')}</div>
      <div class="pf-ct-main">
        <div class="pf-ct-name">
          ${c.display_name || bare(c.contact_id)}
          ${c.kind === 'ghii' ? html` <${PresenceDot} ghii=${c.contact_id} />` : null}
          ${c.kind !== 'ghii' ? html`<span class="badge badge-info">${kindBadge(c.kind)}</span>` : null}
          ${c.relation ? html`<span class="badge">${c.relation}</span>` : null}
        </div>
        <div class="pf-ct-id">${c.kind === 'mail' ? c.email : c.contact_id}${c.has_messages ? ` · ${t('contacts.hasMessages') || 'messaged'}` : ''}</div>
        ${(c.email && c.kind !== 'mail') || c.note || (c.links || []).length ? html`
          <div class="pf-ct-card">
            ${c.email && c.kind !== 'mail' ? html`<span class="pf-ct-id">${c.email}</span>` : null}
            ${(c.links || []).length ? html`
              <span class="pf-ct-links">
                ${c.links.map(l => html`<a href=${l.url} target="_blank" rel="noopener noreferrer">${l.label || l.url}</a>`)}
              </span>` : null}
            ${c.note ? html`<span class="pf-ct-card-note">${c.note}</span>` : null}
          </div>` : null}
        ${editing === c.contact_id ? html`
          <div class="pf-ct-edit">
            <input class="input-field input-sm" placeholder=${t('contacts.notePlaceholder') || 'What should you remember about them?'}
              value=${edit.note} onInput=${(e) => setEdit({ ...edit, note: e.target.value })} />
            <input class="input-field input-sm" placeholder=${t('contacts.relationPlaceholder') || 'following, to invite, colleague…'}
              value=${edit.relation} onInput=${(e) => setEdit({ ...edit, relation: e.target.value })} />
            <button class="btn-primary btn-sm" disabled=${busy} onClick=${() => saveCard(c.contact_id)}>${t('contacts.saveCard') || 'Save'}</button>
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => setEditing(null)}>${t('common.cancel') || 'Cancel'}</button>
          </div>` : null}
      </div>
      ${actions}
    </div>`;

  return html`
    <div class="pf-ct">
      <div class="section-title">${t('contacts.title') || 'Contacts'}</div>
      <div class="section-desc">${t('contacts.desc') || 'Your address book: people you trust and people you have messaged. Contacts feed the identity pickers everywhere you grant access — organisms, workspaces, and apps.'}</div>

      <div class="pf-ct-addrow">
        <${ContactPicker} value=${who} onChange=${setWho} onSubmit=${() => add()} valueMode="full"
          onEmailUnresolved=${openPersonFor}
          placeholder=${t('contacts.addPlaceholder') || 'owner name or email'} disabled=${busy} />
        <button class="btn-primary btn-sm" disabled=${busy || !who.trim()} onClick=${() => add()}>${'+ '}${t('contacts.add') || 'Add'}</button>
        <button class="btn-outline btn-sm" disabled=${busy}
          onClick=${() => setPerson(person ? null : { ...EMPTY_PERSON })}>${t('contacts.addPerson') || 'Add someone without an account'}</button>
        <input class="input-field input-sm pf-ct-filter" placeholder=${t('contacts.filterPlaceholder') || 'Filter…'}
          value=${q} onInput=${(e) => setQ(e.target.value)} />
      </div>

      ${person ? html`
        <div class="pf-ct-person">
          <div class="pf-ct-person-grid">
            <input class="input-field input-sm" placeholder=${t('contacts.personName') || 'Name'}
              value=${person.name} onInput=${(e) => setPerson({ ...person, name: e.target.value })} />
            <input class="input-field input-sm" type="email" placeholder=${t('contacts.personEmail') || 'Email'}
              value=${person.email} onInput=${(e) => setPerson({ ...person, email: e.target.value })} />
            <input class="input-field input-sm" placeholder=${t('contacts.relationPlaceholder') || 'following, to invite, colleague…'}
              value=${person.relation} onInput=${(e) => setPerson({ ...person, relation: e.target.value })} />
            <input class="input-field input-sm" placeholder=${t('contacts.personLink') || 'Link (LinkedIn, site…)'}
              value=${person.link} onInput=${(e) => setPerson({ ...person, link: e.target.value })} />
            <input class="input-field input-sm" placeholder=${t('contacts.notePlaceholder') || 'What should you remember about them?'}
              value=${person.note} onInput=${(e) => setPerson({ ...person, note: e.target.value })} />
          </div>
          <div class="pf-ct-person-actions">
            <button class="btn-primary btn-sm" disabled=${busy || !person.name.trim() || !person.email.trim()}
              onClick=${savePerson}>${t('contacts.savePerson') || 'Save person'}</button>
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => { setPerson(null); setEmailMiss(null); }}>${t('common.cancel') || 'Cancel'}</button>
            <span class="pf-ct-person-hint">${t('contacts.personHint') || 'If they open an account with this address later, this entry becomes them and nothing you wrote is lost.'}</span>
          </div>
        </div>` : null}

      ${emailMiss && !person ? html`
        <div class="section-desc pf-ct-miss">
          ${(t('contacts.inviteHint') || 'No account for {email} yet — invite them by email from an organism\'s Members tab (they get an account and the access you choose in one step).').replace('{email}', emailMiss)}
        </div>` : null}

      ${contacts === null ? html`<div class="section-desc">${t('contacts.loading') || 'Loading…'}</div>` : html`
        <div class="pf-agd-card pf-ct-group">
          <div class="pf-agd-section-label">${t('contacts.savedGroup') || 'Saved contacts'} <span class="pf-ct-count">${saved.length}</span></div>
          ${saved.length ? saved.map(c => row(c, html`
            ${c.email ? html`<button class="btn-ghost btn-sm" disabled=${busy}
              onClick=${() => { setEditing(editing === c.contact_id ? null : c.contact_id); setEdit({ note: c.note || '', relation: c.relation || '' }); }}>${t('contacts.edit') || 'Edit'}</button>` : null}
            <button class="btn-ghost btn-sm" disabled=${busy} onClick=${() => remove(c.contact_id)}>${t('contacts.remove') || 'Remove'}</button>
          `)) : html`<div class="section-desc">${t('contacts.savedEmpty') || 'Nobody saved yet — add someone above, or save a messaged person below.'}</div>`}
        </div>

        <div class="pf-agd-card pf-ct-group">
          <div class="pf-agd-section-label">${t('contacts.messagedGroup') || 'People you\'ve messaged'} <span class="pf-ct-count">${messaged.length}</span></div>
          ${messaged.length ? messaged.map(c => row(c, html`
            <button class="btn-outline btn-sm" disabled=${busy} onClick=${() => add(c.contact_id)}>${t('contacts.save') || 'Save'}</button>
          `)) : html`<div class="section-desc">${t('contacts.messagedEmpty') || 'Direct-message conversations show up here automatically.'}</div>`}
        </div>

        ${blockedCount > 0 ? html`
          <div class="section-desc pf-ct-blocked">
            ${(t('contacts.blockedNote') || '{n} blocked contact(s) — manage them in the Messages tab.').replace('{n}', String(blockedCount))}
          </div>` : null}
      `}
    </div>`;
}
