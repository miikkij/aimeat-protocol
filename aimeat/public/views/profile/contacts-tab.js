/**
 * @file contacts-tab.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Profile › Contacts: the owner's address book, read through people. Loads the
 *   merged list with what each person and the owner share and which invitations are open; holds
 *   the handlers the cover, a person's page and the add fold call (add by name or email, write a
 *   person down and invite them in the same move, edit what is known, invite into an organism,
 *   the message door, remove); renders the poster face (contacts/cover.js).
 * @structure ContactsTab (default) — state, loads, handlers, the ctx bag, render
 * @usage Registered in views/profile.js TABS as id 'contacts'.
 * @version-history
 *   v2.0.0 — 2026-08-30 — The poster face (design canvas "AIMEAT Kontaktien sivu", direction A).
 *     People, people without an account and agents under their people are three sections instead
 *     of two lists; a person has a page; tags, links and the name are editable; an invitation
 *     goes out without an organism; the chat prompt is on the page.
 *   v1.2.0 — 2026-08-17 — TARGET-063: save a PERSON who has no account here.
 *   v1.1.0 — 2026-07-18 — Card-cohesion pass.
 *   v1.0.0 — 2026-07-16 — Initial.
 */
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { t } from '/js/i18n.js';
import { onLiveUpdate } from '/lib/live-updates.js';
import { copyToClipboard } from '/js/utils.js';
import { useConfirm } from '/components/Modal.js';
import * as contactsService from '/js/services/contacts.js';
import * as messagesService from '/js/services/messages.js';
import { listOrganisms, inviteMember } from '/js/services/organisms.js';
import { swallowed } from '/js/swallowed.js';
import { c, nameOf, parts } from './contacts/frame.js';
import { renderContactsView } from './contacts/cover.js';

const EMPTY_FORM = { name: '', email: '', relation: '', relationOther: false, tags: [], tagInput: '', links: [], note: '', invite: false, inviteMessage: '' };
const openTabEvent = (tabId) => window.dispatchEvent(new CustomEvent('aimeat-open-tab', { detail: { tabId } }));

export default function ContactsTab({ showToast }) {
  const { confirm, ConfirmUI } = useConfirm();
  const [contacts, setContacts] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [blockedCount, setBlockedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState({ kind: 'cover' });
  const [folds, setFolds] = useState({ add: false, where: false, perm: false });
  const [road, setRoad] = useState('name');
  const [who, setWho] = useState('');
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [peopleFilter, setPeopleFilter] = useState('all');
  const [showAll, setShowAll] = useState(false);
  const [agentsFilter, setAgentsFilter] = useState('others');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formResolve, setFormResolve] = useState(null);   // null = not asked; { found, ... }
  const [editing, setEditing] = useState(false);
  const [personData, setPersonData] = useState(null);    // { id, together, thread }
  const [orgChooser, setOrgChooser] = useState(false);
  const [myOrganisms, setMyOrganisms] = useState(null);

  const me = (() => { try { return JSON.parse(localStorage.getItem('aimeat_session') || '{}'); } catch (err) { swallowed('contacts-tab: session', err); return {}; } })();
  const myGhii = me.owner && contacts.length ? (contacts.find(r => r.owner && parts(r.owner).owner === me.owner)?.owner || `${me.owner}@${parts(contacts[0].contact_id).node}`) : (me.owner || '');

  const fail = (e, fallback) => showToast?.(e?.error?.message || e?.response?.error?.message || e?.message || fallback || t('contacts.addFailed'), true);

  const load = useCallback(async ({ showSpinner = true } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const [list, blocked] = await Promise.all([
        contactsService.listContacts({ include: 'together,invites' }),
        contactsService.listContacts({ state: 'blocked' }).catch(err => { swallowed('contacts-tab: blocked', err); return []; }),
      ]);
      setContacts(list);
      setTruncated(false);
      setBlockedCount(blocked.length);
    } catch (err) { swallowed('contacts-tab', err); }
    finally { setLoading(false); }
  }, []);

  const loadPerson = useCallback(async (id) => {
    const row = contacts.find(r => r.contact_id === id);
    setPersonData({ id, together: null, thread: null });
    const [together, thread] = await Promise.all([
      row?.kind === 'ghii' ? contactsService.together(id).catch(err => { swallowed('contacts-tab: together', err); return { organisms: [], workspaces: [], agents: [] }; }) : Promise.resolve(null),
      row?.conversation_id ? messagesService.getConversation(row.conversation_id).catch(err => { swallowed('contacts-tab: thread', err); return []; }) : Promise.resolve([]),
    ]);
    setPersonData(d => (d?.id === id ? { id, together, thread } : d));
  }, [contacts]);

  useEffect(() => { load(); }, [load]);
  const liveRef = useRef(null);
  liveRef.current = () => { load({ showSpinner: false }); };
  useEffect(() => onLiveUpdate(['messages', 'organisms'], () => liveRef.current()), []);
  useEffect(() => { if (view.kind === 'person' && contacts.length && personData?.id !== view.id) loadPerson(view.id); }, [view, contacts.length]);   // eslint-disable-line react-hooks/exhaustive-deps -- loadPerson changes with contacts; the id guard stops a loop

  const rowOf = useCallback((id) => contacts.find(r => r.contact_id === id) || null, [contacts]);
  const personOf = useCallback((ghii) => (ghii ? contacts.find(r => r.contact_id === ghii) || null : null), [contacts]);
  const people = contacts.filter(r => r.kind === 'ghii');
  const noAccount = contacts.filter(r => r.kind === 'mail');
  const agents = contacts.filter(r => r.kind === 'gaii' || r.kind === 'geai');

  const pickView = useCallback((v) => {
    setView(v);
    setEditing(false); setOrgChooser(false);
    setFolds(f => ({ ...f, perm: false }));
    const box = document.querySelector('.page-content') || document.querySelector('.pf-content');
    if (box) box.scrollTo({ top: 0 });
  }, []);
  const openPerson = (id) => pickView({ kind: 'person', id });
  const setFold = (k, open) => setFolds(f => ({ ...f, [k]: open }));
  const openAdd = (which) => { setRoad(which); setFold('add', true); setTimeout(() => document.getElementById('ct-add')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); };
  const resetForm = () => { setForm({ ...EMPTY_FORM }); setFormResolve(null); };

  /* ── doors to other pages ── */
  const openTab = (tabId) => openTabEvent(tabId);
  const message = (id) => { window.location.assign(`/v1/profile?tab=messages&to=${encodeURIComponent(id)}`); };
  // The inbox opens the thread named in this hint when the tab opens (the same road the bell uses).
  const openConversation = (conversationId) => { try { sessionStorage.setItem('aimeat.inbox.open', conversationId); } catch (err) { swallowed('contacts-tab: inbox hint', err); } openTabEvent('messages'); };

  /* ── add by name or email ── */
  async function add(target) {
    const id = (target ?? who).trim();
    if (!id) return;
    setBusy(true);
    try {
      const r = await contactsService.addContact(id);
      if (r?.ok === false) throw r;
      showToast?.(t('contacts.added'));
      setWho('');
      await load({ showSpinner: false });
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  const emailUnresolved = (email) => { setForm({ ...EMPTY_FORM, email }); setFormResolve({ found: false }); setRoad('person'); setFold('add', true); };

  /* ── the person form ── */
  async function resolveForm() {
    const email = form.email.trim();
    if (!email || !email.includes('@')) { setFormResolve(null); return; }
    try { setFormResolve(await contactsService.resolveEmail(email)); }
    catch (err) { swallowed('contacts-tab: resolve', err); setFormResolve(null); }
  }
  const cardOf = (f) => ({
    name: f.name.trim(), email: f.email.trim(), note: f.note.trim() || null, relation: f.relation.trim() || null,
    tags: (f.tags || []).map(x => x.trim()).filter(Boolean),
    links: (f.links || []).map(l => ({ label: (l.label || '').trim(), url: (l.url || '').trim() })).filter(l => l.url),
  });
  async function savePerson() {
    setBusy(true);
    try {
      const r = await contactsService.savePerson(cardOf(form));
      if (r?.ok === false) throw r;
      let note = t('contacts.added');
      if (form.invite && r?.data?.kind === 'mail') {
        const inv = await contactsService.invite(form.email.trim(), form.inviteMessage.trim());
        if (inv?.ok === false) { fail(inv); note = t('contacts.added'); }
        else note = inv?.data?.email_sent ? c('invitedSent', { email: form.email.trim() }) : c('invitedNoMail');
      }
      showToast?.(note);
      resetForm();
      await load({ showSpinner: false });
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  const startEdit = (row) => {
    setForm({ ...EMPTY_FORM, name: row.saved_name || row.display_name || '', email: row.email || '', relation: row.relation || '', tags: row.tags || [], links: (row.links || []).map(l => ({ ...l })), note: row.note || '' });
    setFormResolve(null);
    setEditing(true);
  };
  async function saveEdit() {
    const row = rowOf(view.id);
    if (!row) return;
    setBusy(true);
    try {
      const card = cardOf(form);
      // A person with an account keeps their own name and address; the owner edits the rest.
      const patch = row.kind === 'mail' ? card : { note: card.note, tags: card.tags, links: card.links, relation: card.relation };
      let r;
      if (row.kind === 'ghii' && !row.email && !row.saved_name && !row.note && !(row.tags || []).length && !(row.links || []).length && !row.relation) {
        // No card behind this identity yet: the first edit creates one with the address it needs.
        r = card.email ? await contactsService.savePerson(card) : { ok: false, error: { message: c('needEmailForCard') } };
      } else {
        r = await contactsService.updatePerson(row.contact_id, patch);
      }
      if (r?.ok === false) throw r;
      showToast?.(t('contacts.updated'));
      setEditing(false);
      await load({ showSpinner: false });
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  /* ── invitations ── */
  async function invite(row) {
    if (!row.email) return;
    confirm(c('inviteConfirm', { email: row.email }), async () => {
      setBusy(true);
      try {
        const r = await contactsService.invite(row.email);
        if (r?.ok === false) throw r;
        showToast?.(r?.data?.email_sent ? c('invitedSent', { email: row.email }) : c('invitedNoMail'));
        if (!r?.data?.email_sent && r?.data?.accept_url) copyToClipboard(r.data.accept_url);
        await load({ showSpinner: false });
      } catch (e) { fail(e); }
      finally { setBusy(false); }
    });
  }
  async function toggleOrgChooser() {
    const next = !orgChooser;
    setOrgChooser(next);
    if (next && !myOrganisms) {
      try {
        const r = await listOrganisms({ member: 'me' });
        // Ownership is plural: `owners` is the truth, creatorGhii its older mirror, admins beside them.
        const mine = me.owner;
        const list = (r?.data?.organisms || r?.data || []).filter(o => o && ((o.owners || []).includes(mine) || o.creatorGhii === mine || (o.admins || []).includes(mine)));
        setMyOrganisms(list);
      } catch (err) { swallowed('contacts-tab: organisms', err); setMyOrganisms([]); }
    }
  }
  async function inviteToOrganism(org, row) {
    setBusy(true);
    try {
      const r = await inviteMember(org.id, parts(row.contact_id).owner);
      if (r?.ok === false) throw r;
      showToast?.(c('invitedToOrganism', { name: nameOf(row), org: org.name }));
      setOrgChooser(false);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  /* ── remove ── */
  function remove(row) {
    confirm(row.has_messages ? c('removeConfirmHistory', { name: nameOf(row) }) : c('removeConfirm', { name: nameOf(row) }), async () => {
      setBusy(true);
      try {
        const r = await contactsService.removeContact(row.contact_id);
        if (r?.ok === false) throw r;
        showToast?.(t('contacts.removed'));
        pickView({ kind: 'cover' });
        await load({ showSpinner: false });
      } catch (e) { fail(e); }
      finally { setBusy(false); }
    }, { danger: true });
  }

  /* ── the prompt ── */
  async function copyPrompt() {
    try {
      const text = await contactsService.getPrompt();
      if (!text) throw new Error(c('promptUnavailable'));
      copyToClipboard(text);
      showToast?.(c('promptCopied'));
    } catch (e) { fail(e, c('promptUnavailable')); }
  }

  const ctx = {
    contacts, people, noAccount, agents, truncated, blockedCount, loading, view, folds, road, who, busy, q, searchOpen, peopleFilter, showAll, agentsFilter,
    form, formResolve, editing, personData, orgChooser, myOrganisms, me: myGhii, ConfirmUI,
    rowOf, personOf, pickView, openPerson, setFold, openAdd, setRoad, setWho, setQ, setSearchOpen, setPeopleFilter, setShowAll, setAgentsFilter,
    setForm, resetForm, setEditing, openTab, message, openConversation,
    add, emailUnresolved, resolveForm, savePerson, startEdit, saveEdit, invite, toggleOrgChooser, inviteToOrganism, remove, copyPrompt,
  };
  return renderContactsView(ctx);
}
