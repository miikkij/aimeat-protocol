/**
 * @file public/views/profile/inbox-tab/panels.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Render panels for the profile Inbox tab: ThreadPanel (the open thread pane — head,
 *   messages, awaiting-draft messages, command bar/fill, composer), the broadcast form,
 *   TrackedPanel (the Tracked Responses dashboard) and ResultsPanel (broadcast/poll results). Each
 *   is driven by props from InboxTab, which keeps the state; ThreadPanel holds only which message
 *   a quote just jumped to. Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
 *   v3.1.0 -- 2026-09-22 -- ThreadPanel takes `fill`: on a workspace page (a phone) the thread fills
 *     the screen between its head and the composer instead of scrolling inside a fixed box.
 *   v3.0.0 -- 2026-09-22 -- Composed from the shared component set: the thread is the set's Thread,
 *     DayDivider and Message, scrolling in its own Surface; the head a ListRow with its actions and
 *     a Menu; the dashboards ListRows, the poll tallies Meters, the broadcast form Fields and radio
 *     tabs; the page title names each dashboard, so no second heading repeats it. A jumped-to quote flashes through Message's `flash` instead of a class. The emoji left
 *     the headings and notes. Every handler is unchanged.
 *   v2.1.0 — 2026-09-13 — ListPanel moved to ./list-panel.js, where the list gained its sections,
 *     closable groups, archive and selection. ThreadPanel's "…" menu carries an archive or restore
 *     item for the open conversation (`archiveItem`).
 *   v2.0.0 — 2026-08-29 — The poster face: the thread head keeps Listen and Reply-with-AI as doors and
 *     puts Notebook, link previews, show-all and the schedule behind "…"; each bubble names its writer
 *     (the `who` prop); the row marks and subject lines lost their emoji.
 *   v1.x — 2026-08-22 — A conversation row whose newest message one of my agents wrote is previewed
 *     "via <agent>: …" instead of "You: …".
 *   v1.x — 2026-08-18 — Conversation and broadcast rows stamp with stampShort, the full moment in the tooltip.
 *   v1.7.0 — 2026-08-03 — ThreadPanel: "Show full history (N messages)" at the top of a thread
 *     showing only its newest page (threads now open on the newest 50 — inbox-tab v1.28.0).
 *   v1.6.0 — 2026-08-01 — Voice messages threaded through: transcribe on each bubble, voiceMaxSeconds
 *     to the Composer. An agent-owned ("via <agent>") thread gets no transcribe action.
 *   v1.5.0 — 2026-07-31 — ThreadPanel head hosts ThreadReadAloud (./read-aloud.js).
 *   v1.4.0 — 2026-07-21 — ThreadPanel head: "Show all messages / Last 50" toggle.
 *   v1.3.0 — 2026-07-21 — ThreadPanel: link-preview toggle in the head.
 *   v1.2.0 — 2026-07-18 — The reply action on a bubble focuses the composer.
 *   v1.1.0 — 2026-07-17 — Reply-to with quote: the quoted original on each message (click scrolls +
 *     flashes it) and a dismissible "replying to" bar above the composer.
 *   v1.0.0 — 2026-07-13 — Extracted from inbox-tab.js (max-file-lines)
 */
import { h } from 'preact';
import { useState } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { getSession } from '/js/services/auth.js';
import { Thread, DayDivider, Message, ListRow, Action, Menu, Chip, Field, Meter, Stack, Surface, Text } from '/components/poster-parts.js';
import { Avatar, MessageBubble, Composer, CommandBar, CommandFill, SchedulePanel, PollBuilder, TRACK_TONE } from './components.js';
import { ThreadReadAloud } from './read-aloud.js';
import { peerName, ownerKeyOf, isAgentPeer, ownerDisplayName, subThreadLabel, dayKey, dayLabel, trackStateLabel, tallyPoll, quoteSnippet, stampShort, stampFull } from './helpers.js';

export function ThreadPanel({
  activeConv, thread, urlMap, important, trackedByMsg, awaitingForConv, awaitingDrafts,
  schedOpen, setSchedOpen, cmdFill, agentCommands, sending, draftPrefill, prefillNonce, msgsRef,
  peerDisplay, showToast, toggleImportant, onTrackMsg, onParkMsg, onDeleteMsg, openMessageAi, submitInteractiveAnswers,
  setMdViewer, openConversationAi, openConversationNotebook, insertCommand, setCmdFill, cancelTracked, openRecord, startSuggestedReply, doSend,
  replyQuote, setReplyQuote, onQuoteReply, composerFocus, showLinkPreviews, toggleLinkPreviews,
  threadAll, toggleThreadAll, onTranscribe, canTranscribe, voiceMaxSeconds, archiveItem, fill = false,
}) {
  // The message a quote just jumped to, marked for a moment so the eye finds it.
  const [flashId, setFlashId] = useState(null);
  let lastDay = '';
  // Reply-to quotes: resolve a message's `replyToId` to the original within the loaded page (a parent
  // outside the page just renders without a quote). The sender label distinguishes you vs the peer.
  const msgById = {};
  for (const m of thread) msgById[m.id] = m;
  const quoteSender = (q) => (q.direction === 'outbound' ? t('inbox.quoteYou') : peerDisplay(activeConv.peerGhii));
  // Jump to the quoted original: scroll it into view inside the thread + flash it briefly.
  const jumpTo = (id) => {
    const el = document.getElementById(`inbox-msg-${id}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    setTimeout(() => setFlashId((cur) => (cur === id ? null : cur)), 1400);
  };
  // Map each interactive QUESTION message id → the answers reply that fulfils it, so an answered
  // question renders its read-only summary instead of the (already-used) form.
  const answersByQ = {};
  for (const m of thread) {
    if (m.interactive?.role === 'answers' && m.interactive.answersFor) answersByQ[m.interactive.answersFor] = m.interactive;
  }
  // An announcement (a non-respondable broadcast) is read-only for the recipient — hide the composer.
  const isAnnouncement = thread.some(m => m.direction === 'inbound' && m.respondable === false);
  // An aggregated "via <agent>" thread (a DM one of the owner's own agents sent) is read-only here.
  const viaAgentName = activeConv.viaAgent ? (subThreadLabel(activeConv.viaAgent) || peerName(activeConv.viaAgent)) : null;
  // Agent capabilities in chat: command chips for any agent peer (public chat.commands); the schedule
  // panel only for the human's OWN agents (the scheduler routes resolve under the caller's owner).
  const peerIsAgent = isAgentPeer(activeConv.peerGhii);
  const peerAgentName = peerIsAgent ? subThreadLabel(activeConv.peerGhii) : null;
  const peerIsMyAgent = peerIsAgent && ownerDisplayName(ownerKeyOf(activeConv.peerGhii)) === getSession()?.owner;
  const sub = `${activeConv.peerGhii}${activeConv.groupAlias && activeConv.groupAlias !== activeConv.peerGhii
    ? ` · ${t('inbox.viaAddress')} ${activeConv.groupAlias}` : ''}${activeConv.participants?.length
    ? ` · ${t('inbox.groupParticipants', { count: String(activeConv.participants.length) })}` : ''}`;
  const parts = html`
      ${/* Two actions and the rest behind the menu: the head used to carry six buttons, four of them
            for settings and second-order actions, on the row that names who you are talking to. */''}
      <${ListRow} density="compact" mark=${html`<${Avatar} seed=${activeConv.peerGhii} size=${36} />`}
        name=${html`${peerDisplay(activeConv.peerGhii)} ${activeConv.groupAlias ? null : html`<${PresenceDot} ghii=${activeConv.peerGhii} label=${true} />`}`}
        nameTitle=${activeConv.peerGhii} detail=${sub}
        actions=${html`
          <${ThreadReadAloud} thread=${thread} peerLabelText=${peerDisplay(activeConv.peerGhii)} convId=${activeConv.conversationId} />
          ${!viaAgentName ? html`<${Action} onClick=${openConversationAi} title=${t('inbox.ai.replyWithAi')}>${t('inbox.ai.replyWithAi')}<//>` : null}
          <${Menu} label=${t('inbox.cover.more')} items=${[
            !viaAgentName ? { label: t('inbox.notebook.toNotebook'), onClick: openConversationNotebook } : null,
            { label: showLinkPreviews ? t('inbox.linkPreview.hideAll') : t('inbox.linkPreview.showAll'), onClick: toggleLinkPreviews },
            (thread.length >= 50) ? { label: threadAll ? t('inbox.thread.showRecent') : t('inbox.thread.showAll'), onClick: toggleThreadAll } : null,
            (peerIsMyAgent && !viaAgentName) ? { label: t('inbox.schedTitle'), onClick: () => setSchedOpen(o => !o) } : null,
            archiveItem || null,
          ]} />`}>
        ${activeConv.subject || viaAgentName ? html`<${Stack} density="compact">
          ${activeConv.subject ? html`<${Text} kind="lead">${activeConv.subject}<//>` : null}
          ${viaAgentName ? html`<${Text} kind="caption" tone="muted">${t('inbox.sentByAgent')} ${viaAgentName}<//>` : null}
        <//>` : null}
      <//>
      <${Surface} kind="plain" density="flush" height=${fill ? 'fill' : 'scroll'} surfaceRef=${msgsRef}>
        <${Thread} label=${peerDisplay(activeConv.peerGhii)}>
          ${thread.length === 0 ? html`<${Text} tone="muted">${t('inbox.noThread')}<//>` : null}
          ${(!threadAll && (activeConv.messageCount || 0) > thread.length) ? html`
            <${Stack} align="center"><${Action} kind="text" onClick=${toggleThreadAll}>
              ↩ ${t('inbox.thread.showOlder', { count: activeConv.messageCount })}<//><//>` : null}
          ${thread.map(m => {
            const dk = dayKey(m.createdAt);
            const showDay = dk !== lastDay; lastDay = dk;
            // An interactive answer already summarizes its question in the body — a quote would duplicate it.
            const quoted = (m.replyToId && m.interactive?.role !== 'answers') ? msgById[m.replyToId] : null;
            return html`
              ${showDay ? html`<${DayDivider} key=${'d' + m.id} label=${dayLabel(m.createdAt)} />` : null}
              <${MessageBubble} key=${m.id + m.direction} msg=${m} mine=${m.direction === 'outbound'} urlMap=${urlMap}
                who=${m.direction === 'outbound' ? t('inbox.quoteYou') : peerDisplay(m.senderGhii || activeConv.peerGhii)}
                domId=${`inbox-msg-${m.id}`} flash=${flashId === m.id} quoted=${quoted} quotedName=${quoted ? quoteSender(quoted) : ''} onJumpTo=${jumpTo}
                onQuote=${(onQuoteReply && !activeConv.viaAgent) ? onQuoteReply : null}
                starred=${important.has(m.id)} onStar=${toggleImportant} onTrack=${onTrackMsg} onPark=${onParkMsg} onReplyAi=${openMessageAi} onDelete=${onDeleteMsg} tracked=${trackedByMsg[m.id]}
                answeredWith=${m.interactive?.role === 'questions' ? answersByQ[m.id] : null}
                onAnswer=${submitInteractiveAnswers} submitting=${sending} showLinkPreviews=${showLinkPreviews}
                onTranscribe=${activeConv.viaAgent ? null : onTranscribe} canTranscribe=${canTranscribe}
                onOpenMarkdown=${(url, name) => setMdViewer({ url, name })} />`;
          })}
        <//>
      <//>
      ${awaitingForConv.length ? html`<${Thread} label=${t('inbox.trackReady')}>${awaitingForConv.map(tr => html`
        <${Message} key=${tr.id} side="mine" state="draft" who=${t('inbox.trackReady')}
          actions=${html`
            <${Action} kind="text" onClick=${() => openRecord(tr)} title=${t('inbox.trackOpenRecord')}>${t('inbox.trackOpenRecord')}<//>
            <${Action} kind="text" tone="danger" onClick=${() => cancelTracked(tr)}>${t('inbox.trackReject')}<//>
            <${Action} kind="text" tone="success" onClick=${() => startSuggestedReply(tr)}>${t('inbox.trackApprove')}<//>`}>
          <${Markdown} text=${awaitingDrafts[tr.id] || tr.title || ''} />
        <//>`)}<//>` : null}
      ${peerIsMyAgent && schedOpen
        ? html`<${SchedulePanel} agentName=${peerAgentName} showToast=${showToast} onClose=${() => setSchedOpen(false)} />` : null}
      ${!isAnnouncement && cmdFill
        ? html`<${CommandFill} command=${cmdFill} onInsert=${insertCommand} onCancel=${() => setCmdFill(null)} />`
        : (!isAnnouncement && agentCommands
          ? html`<${CommandBar} commands=${agentCommands} onPick=${(c) =>
              (Array.isArray(c.params) && c.params.length) ? setCmdFill(c) : insertCommand(c, {})} />` : null)}
      ${viaAgentName
        ? html`<${Surface} kind="aside" density="compact"><${Text}>${(t('inbox.viaAgentReadonly') || 'Sent by your agent {agent} — view only.').replace('{agent}', viaAgentName)}<//><//>`
        : isAnnouncement
        ? html`<${Surface} kind="aside" density="compact"><${Text}>${t('inbox.announcementNote')}<//><//>`
        : html`${replyQuote ? html`<${Stack} direction="horizontal" align="between">
            <${Action} kind="text" onClick=${() => jumpTo(replyQuote.id)}>
              ↩ ${t('inbox.replyingTo')} ${quoteSender(replyQuote)}: ${quoteSnippet(replyQuote.body)}<//>
            <${Action} kind="text" onClick=${() => setReplyQuote?.(null)} title=${t('inbox.quoteCancel')} label=${t('inbox.quoteCancel')}>✗<//>
          <//>` : null}
          <${Composer} key=${'c-' + activeConv.conversationId + (draftPrefill ? '-d' + prefillNonce : '')} recipient=${activeConv.peerGhii}
            sendLabel=${t('inbox.reply')} sending=${sending} onSend=${doSend} initialText=${draftPrefill}
            voiceMaxSeconds=${voiceMaxSeconds}
            focusNonce=${composerFocus} draftKey=${'aimeat.inbox.draft.' + activeConv.conversationId} />`}`;
  // On a workspace page (a phone) the parts sit straight in its column, so the thread takes the
  // height that is left and the composer stays at the bottom; beside the list they stack.
  return fill ? parts : html`<${Stack}>${parts}<//>`;
}

/** One pair of either-or choices as radio tabs. */
const RadioPair = ({ name, value, set, choices }) => html`
  <${Stack} direction="wrap" role="radiogroup" label=${name}>
    ${choices.map(([id, label]) => html`<${Action} key=${id} kind="tab" semantics="radio" selected=${value === id}
      onClick=${() => set(id)}>${label}<//>`)}
  <//>`;

/** The broadcast / poll compose form, a page of its own on the poster face. Pure render over the
 *  container's state; moved here from inbox-tab.js unchanged (max-file-lines). */
export function renderBroadcastForm({
  bcType, setBcType, bcMode, setBcMode, bcQuestions, setBcQuestions, bcRecipients, removeBcRecipient, bcInput, setBcInput,
  addBcRecipient, myGroups, bcGroupId, setBcGroupId, isOperator, bcAudience, setBcAudience, sending, doBroadcast,
}) {
  return html`
    <${Stack}>
      <${Stack}>
        <${RadioPair} name="bctype" value=${bcType} set=${setBcType}
          choices=${[['message', t('inbox.bcTypeMessage')], ['poll', t('inbox.bcTypePoll')]]} />
        ${bcType === 'message'
          ? html`<${RadioPair} name="bcmode" value=${bcMode} set=${setBcMode}
              choices=${[['broadcast', t('inbox.bcModeBroadcast')], ['announcement', t('inbox.bcModeAnnouncement')]]} />`
          : html`<${PollBuilder} questions=${bcQuestions} setQuestions=${setBcQuestions} />`}
        ${bcRecipients.length ? html`<${Stack} direction="wrap" align="center" density="compact">
          ${bcRecipients.map(r => html`<${Stack} direction="horizontal" align="center" density="compact" key=${r}>
            <${Chip}>${peerName(r)}<//>
            <${Action} kind="text" title=${t('inbox.bcRemove')} label=${t('inbox.bcRemove')} onClick=${() => removeBcRecipient(r)}>✗<//>
          <//>`)}
        <//>` : null}
        <${Stack} direction="horizontal" align="end">
          <${Field} list="inbox-contact-suggest" ariaLabel=${t('inbox.bcAddPlaceholder')} placeholder=${t('inbox.bcAddPlaceholder')}
            value=${bcInput} onInput=${(e) => setBcInput(e.target.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); addBcRecipient(); } }} />
          <${Action} onClick=${() => addBcRecipient()}>${t('inbox.bcAdd')}<//>
        <//>
        ${myGroups.length ? html`<${Field} type="select" ariaLabel=${t('inbox.bcNoGroup')} value=${bcGroupId} onChange=${(e) => setBcGroupId(e.target.value)}
          options=${[{ value: '', label: t('inbox.bcNoGroup') }, ...myGroups.map(g => ({ value: g.id, label: `${g.name} (${(g.members || []).length})` }))]} />` : null}
        ${isOperator ? html`<${Field} type="select" ariaLabel=${t('inbox.bcNoAudience')} value=${bcAudience} onChange=${(e) => setBcAudience(e.target.value)}
          options=${[{ value: '', label: t('inbox.bcNoAudience') }, { value: 'node-users', label: t('inbox.bcNodeUsers') }, { value: 'federation-users', label: t('inbox.bcFederationUsers') }]} />` : null}
        <${Composer} key="c-bc" recipient=${(bcRecipients.length || bcGroupId || bcAudience) ? 'bc' : ''}
          sendLabel=${bcType === 'poll' ? t('inbox.pollSend') : t('inbox.bcSend')} sending=${sending} onSend=${doBroadcast} />
      <//>
    <//>`;
}

export function TrackedPanel({ activeTracked, doneCount, openRecord, openTracked, cancelTracked }) {
  const recordLabel = (tr) => {
    const rec = tr.references?.records?.[0];
    if (rec?.namespace) return `${rec.namespace}/${rec.id}`;
    const k = tr.watch?.key || '';
    const parts = k.split('.');
    return parts.slice(-2).join('.') || k;
  };
  return html`
    <${Surface} kind="plain" density="flush">
      ${activeTracked.length === 0 ? html`<${Text} tone="muted">${doneCount ? t('inbox.trackedAllDone') : t('inbox.trackedEmpty')}<//>` : null}
      ${activeTracked.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(tr => {
        const trk = trackStateLabel(tr.state);
        return html`
          <${ListRow} key=${tr.id} density="compact" detailKind="text"
            name=${html`<${Chip} tone=${TRACK_TONE[trk.tone] || 'plain'}>${trk.text}<//> ${tr.title || t('inbox.trackResponse')}`}
            detail=${html`${t('inbox.trackedTo')} ${peerName(tr.source?.peerGhii || '')}
              · ${t('inbox.trackedWatching')} <${Text} kind="mono">${recordLabel(tr)}<//>
              · ${tr.response?.mode === 'auto' ? t('inbox.trackModeAuto') : t('inbox.trackModeApprove')}
              ${tr.tracking?.lastError ? html` · <${Text} kind="mono" tone="danger">${tr.tracking.lastError}<//>` : null}`}
            actions=${html`
              ${tr.references?.organismId ? html`<${Action} kind="text" onClick=${() => openRecord(tr)}>${t('inbox.trackOpenRecord')}<//>` : null}
              ${tr.state === 'awaiting-approval'
                ? html`<${Action} kind="text" tone="success" onClick=${() => openTracked(tr)}>${t('inbox.trackApprove')}<//>`
                : html`<${Action} kind="text" onClick=${() => openTracked(tr)} title=${t('inbox.trackedOpenConvo')}>${t('inbox.trackedOpenConvo')}<//>`}
              <${Action} kind="text" tone="danger" onClick=${() => cancelTracked(tr)}>${t('inbox.trackedCancel')}<//>`} />`;
      })}
      ${doneCount ? html`<${Text} tone="muted">✓ ${(t('inbox.trackedDoneCount') || '{n} completed').replace('{n}', String(doneCount))}<//>` : null}
    <//>`;
}

export function ResultsPanel({ resultsId, recentBroadcasts, results, openResults, setResultsId, setResults }) {
  if (!resultsId) {
    return html`<${Surface} kind="plain" density="flush">
      ${recentBroadcasts.length === 0 ? html`<${Text} tone="muted">${t('inbox.resultsEmpty')}<//>` : null}
      ${recentBroadcasts.map(b => html`
        <${ListRow} key=${b.id} density="compact" name=${b.title} onOpen=${() => openResults(b.id)}
          value=${html`<span title=${b.createdAt ? stampFull(b.createdAt) : ''}>${b.createdAt ? stampShort(b.createdAt) : ''}</span>`} />`)}
    <//>`;
  }
  const r = results;
  const isPoll = r?.interactive?.role === 'questions';
  const tallies = isPoll ? tallyPoll(r.interactive, r.recipients || []) : [];
  return html`<${Stack}>
    <${Stack} direction="horizontal"><${Action} kind="text" onClick=${() => { setResultsId(null); setResults(null); }}>↩ ${t('inbox.back')}<//><//>
    ${!r ? html`<${Text} tone="muted">…<//>` : html`
      <${Stack}>
        <${Text} kind="mono">
          ${t('inbox.resultsRecipients')}: ${r.total} · ${t('inbox.resultsDelivered')}: ${r.delivered} · ${t('inbox.resultsRead')}: ${r.read}${isPoll ? ` · ${t('inbox.resultsAnswered')}: ${r.answered}` : ''}
        <//>
        ${tallies.map(({ q, counts, others }) => html`
          <${Stack} density="compact" key=${q.id}>
            <${Text} kind="heading" size="small">${q.prompt}<//>
            ${(q.options || []).map(o => {
              const n = counts[o.id] || 0;
              const pct = r.answered ? Math.round((n / r.answered) * 100) : 0;
              return html`<${Stack} density="compact" key=${o.id}>
                <${Stack} direction="horizontal" align="between"><${Text}>${o.label}<//><${Text} kind="mono">${n}<//><//>
                <${Meter} kind="progress" value=${pct} label=${o.label} />
              <//>`;
            })}
            ${others.length ? html`<${Text} kind="caption" tone="muted">${t('inbox.answer.other')}: ${others.join(', ')}<//>` : null}
          <//>`)}
        ${!isPoll ? html`<${Surface} kind="plain" density="flush">
          ${(r.recipients || []).map(rec => html`<${ListRow} key=${rec.recipient} density="compact" name=${peerName(rec.recipient)} value=${rec.status} />`)}
        <//>` : null}
      <//>`}
  <//>`;
}
