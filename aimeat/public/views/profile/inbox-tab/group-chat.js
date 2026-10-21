/**
 * @file public/views/profile/inbox-tab/group-chat.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Group chat on the Messages page (wish-ryhm-keskustelu-viestit-puolelle): the pane
 *   that opens a group (members, a name, the first message), the members strip in an open group
 *   (who is in it, who is invited, add and remove for the manager, leave for everybody), and the
 *   invitations over the list (join or decline). The rules are the server's
 *   (services/conversation-group-manage.ts): a person whose contacts accept you joins at once, anybody
 *   else is invited, a member who joins later sees what is written from then on.
 * @structure isChatGroup · useGroupChat · GroupComposePane · GroupMembersStrip · GroupInvitations
 * @usage const group = useGroupChat({ showToast, loadLists, activeConv, openConversation, confirm, goIdle });
 * @version-history
 *   v1.0.0 — 2026-10-21 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import * as messages from '/js/services/messages.js';
import { Action } from '/components/Action.js';
import { Mark, Marks } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Composer } from '/components/Composer.js';
import { ContactPicker } from '/components/ContactPicker.js';
import { TextField } from '/components/TextField.js';
import { Pane, PaneHead, PaneFields, PaneStrip } from '/components/ConversationPane.js';
import { ConversationRequests, ConversationRequest } from '/components/ConversationList.js';
import { List, Row, Name, Doors } from '/components/List.js';
import { Stack, Row as Line } from '/components/Layout.js';
import { swallowed } from '/js/swallowed.js';
import { peerName } from './helpers.js';

/** The Members door's mark: a pane narrower than 620 px hides the door's word and keeps only this. */
const PEOPLE_ICON = html`<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
  <circle cx="6" cy="5" r="2.5" /><path d="M1.5 14c0-2.8 2-4.5 4.5-4.5s4.5 1.7 4.5 4.5" />
  <circle cx="11.5" cy="5.5" r="2" /><path d="M11 9.6c2 .1 3.5 1.6 3.5 4.4" /></svg>`;

/** A group a person opened (the server names its copies `group:<id>`), not a named address such as support. */
export function isChatGroup(conv) {
  return String(conv?.groupAlias || '').startsWith('group:');
}

/** The open conversation shape for a group that has just been opened or joined. */
function groupConv(id, subject, participants) {
  return { conversationId: id, peerGhii: `group:${id}`, groupAlias: `group:${id}`, subject, participants, messageCount: 0 };
}

/** One sentence on what happened to the names given, or '' when everybody joined. */
function membersOutcome(members, peerDisplay) {
  const invited = members.filter(m => m.result === 'invited');
  const refused = members.filter(m => m.result === 'refused');
  const parts = [];
  if (invited.length) parts.push(t('inbox.group.someInvited', { count: String(invited.length) }));
  if (refused.length) parts.push(t('inbox.group.someRefused', { count: String(refused.length), names: refused.map(m => `${peerDisplay(m.identity)} (${m.message})`).join(', ') }));
  return parts.join(' ');
}

/**
 * The page's group state: the open invitations, and the members of the group that is open. Both are
 * read again on every `messages` live event, the event a membership change sends to its members.
 */
export function useGroupChat({ showToast, loadLists, activeConv, openConversation, confirm, goIdle, peerDisplay }) {
  const [invitations, setInvitations] = useState([]);
  const [view, setView] = useState(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const openId = isChatGroup(activeConv) ? activeConv.conversationId : null;
  const openIdRef = useRef(openId); openIdRef.current = openId;

  const loadInvitations = useCallback(() => messages.listGroupInvitations()
    .then(setInvitations).catch(err => swallowed('group-chat: invitations', err)), []);
  const loadView = useCallback(() => {
    const id = openIdRef.current;
    if (!id) { setView(null); return; }
    messages.getGroup(id).then(v => { if (openIdRef.current === id) setView(v); })
      .catch(err => { swallowed('group-chat: view', err); if (openIdRef.current === id) setView(null); });
  }, []);

  useEffect(() => { loadInvitations(); }, [loadInvitations]);
  useEffect(() => { setMembersOpen(false); loadView(); }, [openId, loadView]);
  useEffect(() => {
    const handler = (e) => {
      const domains = e?.detail?.domains;
      if (domains && !domains.has('messages')) return;
      loadInvitations(); loadView();
    };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [loadInvitations, loadView]);

  const answer = async (inv, accept) => {
    try {
      await messages.answerGroupInvitation(inv.conversation_id, accept);
      showToast?.(t(accept ? 'inbox.group.joinedToast' : 'inbox.group.declinedToast'));
      await loadInvitations(); await loadLists();
      if (accept) openConversation(groupConv(inv.conversation_id, inv.subject, [...inv.participants, ...inv.invitees]));
    } catch (err) { swallowed('group-chat: answer', err); showToast?.(err?.message || t('inbox.failed'), true); }
  };

  const changeMembers = async (patch) => {
    if (!openId) return false;
    try {
      const r = await messages.changeGroupMembers(openId, patch);
      const note = membersOutcome(r?.data?.members || [], peerDisplay);
      showToast?.(note || t('inbox.group.membersSaved'));
      loadView(); loadLists();
      return true;
    } catch (err) { swallowed('group-chat: members', err); showToast?.(err?.message || t('inbox.failed'), true); return false; }
  };

  const leave = () => {
    if (!openId) return;
    const id = openId;
    const name = activeConv?.subject || view?.subject || '';
    confirm(t('inbox.group.leaveConfirm', { name }), async () => {
      try {
        await messages.leaveGroup(id);
        showToast?.(t('inbox.group.leftToast'));
        goIdle(); loadLists();
      } catch (err) { swallowed('group-chat: leave', err); showToast?.(err?.message || t('inbox.failed'), true); }
    }, { title: t('inbox.group.leave'), confirmLabel: t('inbox.group.leave'), danger: true });
  };

  const opened = (data, members) => {
    const note = membersOutcome(members || [], peerDisplay);
    showToast?.(note ? `${t('inbox.group.created')} ${note}` : t('inbox.group.created'));
    loadLists();
    openConversation(groupConv(data.conversation_id, data.subject, data.participants));
  };

  return {
    invitations, answer, opened,
    // Everybody this state names, so the page resolves their display names like any other peer's.
    ids: [...invitations.flatMap(i => [i.invited_by, ...i.participants]), ...(view ? [...view.participants, ...view.invited] : [])],
    door: openId ? { label: t('inbox.group.membersDoor'), mark: PEOPLE_ICON, pressed: membersOpen, onClick: () => setMembersOpen(o => !o) } : null,
    strip: openId && membersOpen && view
      ? html`<${GroupMembersStrip} view=${view} peerDisplay=${peerDisplay} changeMembers=${changeMembers} leave=${leave} />` : null,
  };
}

/** The pane that opens a group: who is in it, its name, and the first message. */
export function GroupComposePane({ showToast, sending: outerSending, onOpened, peerDisplay }) {
  const [members, setMembers] = useState([]);
  const [input, setInput] = useState('');
  const [name, setName] = useState('');
  const [sending, setSending] = useState(false);
  const add = (raw) => {
    const v = String(raw ?? input).trim();
    if (v && !members.includes(v)) setMembers([...members, v]);
    setInput('');
  };
  const send = async (_recipient, text, files, reset) => {
    if (sending || outerSending) return;
    if (files?.length) { showToast?.(t('inbox.group.filesLater'), true); return; }
    if (!members.length) { showToast?.(t('inbox.group.needMembers'), true); return; }
    if (!name.trim()) { showToast?.(t('inbox.group.needName'), true); return; }
    const body = String(text || '').trim();
    if (!body) return;
    setSending(true);
    try {
      const r = await messages.createGroup({ members, subject: name.trim(), body });
      reset?.();
      onOpened(r.data, r.data?.members);
    } catch (err) {
      swallowed('group-chat: create', err);
      const refused = err?.response?.error?.details?.members;
      showToast?.(refused?.length ? `${err.message} ${membersOutcome(refused, peerDisplay)}` : (err?.message || t('inbox.failed')), true);
    }
    setSending(false);
  };
  return html`
    <${Pane}>
      <${PaneHead} name=${t('inbox.group.title')} />
      <${PaneFields}>
        <${Stack}>
          <${TextField} placeholder=${t('inbox.group.namePlaceholder')} value=${name} onInput=${setName} />
          ${members.length ? html`<${Marks}>
            ${members.map(m => html`<${Mark} key=${m} onRemove=${() => setMembers(members.filter(x => x !== m))}
              removeLabel=${t('inbox.group.remove')} removeGlyph="✕">${peerDisplay(m)}<//>`)}
          <//>` : null}
          <${Line}>
            <${ContactPicker} value=${input} onChange=${setInput} onSubmit=${add} valueMode="full"
              excludeIds=${members} placeholder=${t('inbox.group.addPlaceholder')} />
            <${Action} onClick=${() => add()}>${t('inbox.group.add')}<//>
          <//>
          <${Note} kind="quiet">${t('inbox.group.howItWorks')}<//>
        <//>
      <//>
      <${Composer} tone="message" key="c-group" recipient=${members.length && name.trim() ? 'group' : ''}
        sendLabel=${t('inbox.group.start')} sending=${sending || outerSending} onSend=${send} draftKey="aimeat.inbox.draft.group" />
    <//>`;
}

/** Who is in the open group, who is invited, and what this reader may do about it. */
export function GroupMembersStrip({ view, peerDisplay, changeMembers, leave }) {
  const [input, setInput] = useState('');
  const add = async (raw) => {
    const v = String(raw ?? input).trim();
    if (!v) return;
    if (await changeMembers({ add: [v] })) setInput('');
  };
  // Every row has its doors cell, empty when there is nothing to do: the list is a two-column grid, and a
  // row without the cell moved every Remove after it one row down, beside the wrong person.
  const row = (id, invited) => html`<${Row} key=${id}>
    <${Name} meta=${id === view.manager ? t('inbox.group.manager') : invited ? t('inbox.group.invitedMark') : peerName(id)}>${peerDisplay(id)}<//>
    <${Doors}>${view.you_manage && id !== view.manager ? html`
      <${Action} small tone="danger" ariaLabel=${`${t('inbox.group.remove')}: ${peerDisplay(id)}`}
        onClick=${() => changeMembers({ remove: [id] })}>${t('inbox.group.remove')}<//>` : null}<//>
  <//>`;
  return html`
    <${PaneStrip} grey>
      <${Stack}>
        <${List} cols="name-doors" keepCols dense>
          ${view.participants.map(id => row(id, false))}
          ${view.invited.map(id => row(id, true))}
        <//>
        ${view.you_manage ? html`
          <${Line}>
            <${ContactPicker} value=${input} onChange=${setInput} onSubmit=${add} valueMode="full"
              excludeIds=${[...view.participants, ...view.invited]} placeholder=${t('inbox.group.addPlaceholder')} />
            <${Action} onClick=${() => add()}>${t('inbox.group.add')}<//>
          <//>
          <${Note} kind="quiet">${t('inbox.group.youManage')}<//>` : null}
        <${Line}><${Action} small tone="danger" onClick=${leave}>${t('inbox.group.leave')}<//><//>
      <//>
    <//>`;
}

/** The open invitations over the conversation list, beside the contact requests. */
export function GroupInvitations({ invitations, answer, peerDisplay }) {
  if (!invitations?.length) return null;
  return html`
    <${ConversationRequests} label=${t('inbox.group.invitations')} count=${invitations.length}>
      ${invitations.map(inv => html`<${ConversationRequest} key=${inv.conversation_id} picture=${`group:${inv.conversation_id}`}
        name=${inv.subject || t('inbox.group.untitled')} address=${t('inbox.group.invitedBy', { name: peerDisplay(inv.invited_by), count: String(inv.participants.length) })}
        preview=${inv.participants.map(peerDisplay).join(', ')}>
        <${Action} onClick=${() => answer(inv, true)}>${t('inbox.group.join')}<//>
        <${Action} onClick=${() => answer(inv, false)}>${t('inbox.group.decline')}<//>
      <//>`)}
    <//>`;
}
