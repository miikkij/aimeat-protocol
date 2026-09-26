/**
 * @file public/views/profile/inbox-tab/panels.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Pure (hook-free) render panels for the profile Inbox tab: ThreadPanel (the open thread pane — head, bubbles, awaiting-draft
 *   bubbles, command bar/fill, composer), TrackedPanel (the Tracked Responses dashboard) and ResultsPanel
 *   (broadcast/poll results). Each is a presentational component driven entirely by props from InboxTab;
 *   the stateful container keeps all hooks. Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
 *   v2.16.1 — 2026-09-26 — The operator's broadcast audience turns coral again while it is set, as
 *     main's .inbox-bc-audience--on drew it (Select attention; fix pass).
 *   v2.16.0 — 2026-09-26 —Written on components only: the pane, its head, the reply bar and the read-only
 *     line are ConversationPane's; the broadcast form's choices, fields and drop-downs the field family's
 *     (Choice, TextField, Select); the tracked responses a List; a result's bars the Meter. No class is
 *     written here.
 *   v2.15.1 — 2026-09-26 — Reply with AI is the action link's small row cut, as main's og-door in the head row (Jouni's decision "Action link in Settings").
 *   v2.15.0 — 2026-09-26 — The thread is the Thread and Message components (components/Message.js),
 *     the suggested reply the Message's draft tone, the composer the Composer's message tone (the field
 *     over the whole width, its tools under it, as main has it), a sent broadcast's row the
 *     ConversationRow (its date on the right again); the ways on, the marks and the quiet lines are the
 *     kit (Action, Loud, Icon, Mark, Code, Note): this file writes none of their classes.
 *   v2.14.0 — 2026-09-26 — A suggested reply waiting for your yes is readable in dark mode (it no longer takes your own message's dark words for the sun), its emoji go, Reject is the danger tone (Jouni: "dark mode totally unreadable").
 *   v2.13.0 — 2026-09-26 — A broadcast recipient's ✕ is the Tag's remove mark (.poster-chip-x, poster.css): grey, coral under the pointer, where it turned red on a card ground (a unification: Jouni's decision "Remove mark").
 *   v2.12.0 — 2026-09-26 — A list of conversations is the chat's list (ThreadList's rows, .poster-thread): the name in bold, one quiet line with the time and the last message, the open one on the sun; a person's heading is its person tone (ThreadPerson) with the counts named; the row's archive square is the small icon button in the delete's place. Messages' rows, a broadcast's results list and an agent's Chat threads take it; their own row looks go (a unification: Jouni's decision "Conversation list").
 *   v2.11.0 — 2026-09-25 — Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v2.10.0 — 2026-09-25 — Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v2.9.0 — 2026-09-25 — Every small number is the Count (.poster-count waiting or tally), a unification: Jouni's decision Count.
 *   v2.8.0 — 2026-09-25 — Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v2.7.0 — 2026-09-25 — Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v2.6.0 — 2026-09-25 — Code inside a sentence or a value line is the code-inline cut of the Code block (UI consolidation phase 5, a unification).
 *   v2.5.0 — 2026-09-25 — Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v2.4.0 — 2026-09-25 — A button that is a mark, not a word (a delete or close mark, a menu's dots,
 *     an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's decision
 *     "Icon button").
 *   v2.3.0 — 2026-09-25 — Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v2.2.0 — 2026-09-25 — The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v2.1.0 — 2026-09-13 — ListPanel moved to ./list-panel.js, where the list gained its sections,
 *     closable groups, archive and selection. ThreadPanel's "…" menu carries an archive or restore
 *     item for the open conversation (`archiveItem`).
 *   v2.0.0 — 2026-08-29 — The poster face: the thread head keeps Listen and Reply-with-AI as doors and
 *     puts Notebook, link previews, show-all and the schedule behind "…"; each bubble names its writer
 *     (the `who` prop); the row marks and subject lines lost their emoji.
 *   v1.x — 2026-08-22 — A conversation row whose newest message one of my agents wrote is previewed
 *     "via <agent>: …" instead of "You: …". The copy lives in my mailbox marked outbound, so the
 *     list attributed my agent's words to me — the one thing a person needs to be able to check.
 *   v1.x — 2026-08-18 — Conversation and broadcast rows stamp with stampShort (today→time,
 *     yesterday→word, this week→weekday, older→date) with the full moment in the tooltip. A bare
 *     clock time on a week-old row read as "today".
 *   v1.7.0 — 2026-08-03 — ThreadPanel: "Show full history (N messages)" pill at the top of a thread
 *     showing only its newest page (threads now open on the newest 50 — inbox-tab v1.28.0).
 *   v1.6.0 — 2026-08-01 — Voice messages threaded through: ThreadPanel passes onTranscribe /
 *     canTranscribe to each bubble and voiceMaxSeconds to the Composer. An agent-owned ("via
 *     <agent>") thread is read-only for the owner, so it gets no transcribe action.
 *   v1.5.0 — 2026-07-31 — ThreadPanel head hosts ThreadReadAloud (./read-aloud.js): reads the whole open
 *     conversation aloud (Listen / Pause / Continue + ✕), the thread-level twin of the per-bubble 🔊.
 *   v1.4.0 — 2026-07-21 — ThreadPanel head: "Show all messages / Last 50" toggle (threadAll/
 *     toggleThreadAll), shown once a thread has ≥50 messages. Threads default to the full history;
 *     the toggle collapses to the newest 50.
 *   v1.3.0 — 2026-07-21 — ThreadPanel: link-preview toggle button in the head (showLinkPreviews /
 *     toggleLinkPreviews) + passes the flag down to each MessageBubble.
 *   v1.2.0 — 2026-07-18 — Clicking ↩ Reply on a bubble now focuses the composer (via `onQuoteReply` +
 *     `composerFocus` bump) so the cursor lands in the input; the ✕ cancel still uses the raw setter.
 *   v1.1.0 — 2026-07-17 — Reply-to with quote: ThreadPanel resolves each message's `replyToId` to the
 *     quoted original for its bubble (click scrolls + flashes it) and shows a dismissible "replying to"
 *     bar above the composer while a quoted reply is being written.
 *   v1.0.0 — 2026-07-13 — Extracted from inbox-tab.js (max-file-lines)
 */
import { h } from 'preact';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { getSession } from '/js/services/auth.js';
import { Action, Loud, Icon } from '/components/Action.js';
import { Mark, Marks, Code } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Message, Thread, ThreadDay, ThreadTop, flashMessage } from '/components/Message.js';
import { Composer } from '/components/Composer.js';
import { ConversationRow, ConversationRows } from '/components/ConversationList.js';
import { Pane, PaneHead, PaneDoor, PaneFields, ReplyBar, PaneNote, PaneScroll } from '/components/ConversationPane.js';
import { List, Row, Name, Doors, Cell } from '/components/List.js';
import { Choice } from '/components/Choice.js';
import { TextField } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Stack, Row as Line } from '/components/Layout.js';
import { Meter, Tinted } from '/components/Figure.js';
import { KebabMenu } from '../shared.js';
import { MessageBubble, CommandBar, CommandFill, SchedulePanel, PollBuilder } from './components.js';
import { ThreadReadAloud } from './read-aloud.js';
import { peerName, ownerKeyOf, isAgentPeer, ownerDisplayName, subThreadLabel, dayKey, dayLabel, trackStateLabel, trackStatusTone, tallyPoll, quoteSnippet, stampShort, stampFull } from './helpers.js';

export function ThreadPanel({
  activeConv, thread, urlMap, important, trackedByMsg, awaitingForConv, awaitingDrafts,
  schedOpen, setSchedOpen, cmdFill, agentCommands, sending, draftPrefill, prefillNonce, msgsRef,
  peerDisplay, showToast, toggleImportant, onTrackMsg, onParkMsg, onDeleteMsg, openMessageAi, submitInteractiveAnswers,
  setMdViewer, openConversationAi, openConversationNotebook, insertCommand, setCmdFill, cancelTracked, openRecord, startSuggestedReply, doSend,
  replyQuote, setReplyQuote, onQuoteReply, composerFocus, showLinkPreviews, toggleLinkPreviews,
  threadAll, toggleThreadAll, onTranscribe, canTranscribe, voiceMaxSeconds, archiveItem,
}) {
  let lastDay = '';
  // Reply-to quotes: resolve a message's `replyToId` to the original within the loaded page (a parent
  // outside the page just renders without a quote). The sender label distinguishes you vs the peer.
  const msgById = {};
  for (const m of thread) msgById[m.id] = m;
  const quoteSender = (q) => (q.direction === 'outbound' ? t('inbox.quoteYou') : peerDisplay(activeConv.peerGhii));
  // Jump to the quoted original: scroll it into view inside the thread + flash it briefly.
  const jumpTo = (id) => flashMessage(`inbox-msg-${id}`);
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
  const address = `${activeConv.peerGhii}${activeConv.groupAlias && activeConv.groupAlias !== activeConv.peerGhii
    ? ` · ${t('inbox.viaAddress')} ${activeConv.groupAlias}` : ''}${activeConv.participants?.length
    ? ` · ${t('inbox.groupParticipants', { count: String(activeConv.participants.length) })}` : ''}`;
  return html`
    <${Pane}>
      <${PaneHead} picture=${activeConv.peerGhii} name=${peerDisplay(activeConv.peerGhii)} nameTitle=${activeConv.peerGhii}
        presence=${activeConv.groupAlias ? null : activeConv.peerGhii}
        subject=${activeConv.subject || null}
        via=${viaAgentName ? `${t('inbox.sentByAgent')} ${viaAgentName}` : null}
        address=${address}>
        ${/* Two doors and the rest behind "…": the head used to carry six buttons, four of them for
              settings and second-order actions, on the row that names who you are talking to. */''}
        <${ThreadReadAloud} thread=${thread} peerLabelText=${peerDisplay(activeConv.peerGhii)} convId=${activeConv.conversationId} />
        ${!viaAgentName ? html`<${PaneDoor} label=${t('inbox.ai.replyWithAi')} title=${t('inbox.ai.replyWithAi')} onClick=${openConversationAi} />` : null}
        <${KebabMenu} label=${t('inbox.cover.more') || 'More'} trigger="…" items=${[
          !viaAgentName ? { label: t('inbox.notebook.toNotebook'), onClick: openConversationNotebook } : null,
          { label: showLinkPreviews ? t('inbox.linkPreview.hideAll') : t('inbox.linkPreview.showAll'), onClick: toggleLinkPreviews },
          (thread.length >= 50) ? { label: threadAll ? t('inbox.thread.showRecent') : t('inbox.thread.showAll'), onClick: toggleThreadAll } : null,
          (peerIsMyAgent && !viaAgentName) ? { label: t('inbox.schedTitle'), onClick: () => setSchedOpen(o => !o) } : null,
          archiveItem || null,
        ]} />
      <//>
      <${Thread} scrollRef=${msgsRef}>
        ${thread.length === 0 ? html`<${Note} kind="quiet">${t('inbox.noThread')}<//>` : null}
        ${(!threadAll && (activeConv.messageCount || 0) > thread.length) ? html`
          <${ThreadTop}>
            <${Action} tone="more" onClick=${toggleThreadAll}>↩ ${t('inbox.thread.showOlder', { count: activeConv.messageCount })}<//>
          <//>` : null}
        ${thread.map(m => {
          const dk = dayKey(m.createdAt);
          const showDay = dk !== lastDay; lastDay = dk;
          // An interactive answer already summarizes its question in the body — a quote would duplicate it.
          const quoted = (m.replyToId && m.interactive?.role !== 'answers') ? msgById[m.replyToId] : null;
          return html`
            ${showDay ? html`<${ThreadDay} key=${'d' + m.id}>${dayLabel(m.createdAt)}<//>` : null}
            <${MessageBubble} key=${m.id + m.direction} msg=${m} mine=${m.direction === 'outbound'} urlMap=${urlMap}
              who=${m.direction === 'outbound' ? t('inbox.quoteYou') : peerDisplay(m.senderGhii || activeConv.peerGhii)}
              domId=${`inbox-msg-${m.id}`} quoted=${quoted} quotedName=${quoted ? quoteSender(quoted) : ''} onJumpTo=${jumpTo}
              onQuote=${(onQuoteReply && !activeConv.viaAgent) ? onQuoteReply : null}
              starred=${important.has(m.id)} onStar=${toggleImportant} onTrack=${onTrackMsg} onPark=${onParkMsg} onReplyAi=${openMessageAi} onDelete=${onDeleteMsg} tracked=${trackedByMsg[m.id]}
              answeredWith=${m.interactive?.role === 'questions' ? answersByQ[m.id] : null}
              onAnswer=${submitInteractiveAnswers} submitting=${sending} showLinkPreviews=${showLinkPreviews}
              onTranscribe=${activeConv.viaAgent ? null : onTranscribe} canTranscribe=${canTranscribe}
              onOpenMarkdown=${(url, name) => setMdViewer({ url, name })} />`;
        })}
      <//>
      ${awaitingForConv.map(tr => html`<${Message} key=${tr.id} tone="draft" label=${t('inbox.trackReady')}
        body=${awaitingDrafts[tr.id] || tr.title || ''}
        actions=${html`
          <${Action} small onClick=${() => openRecord(tr)} title=${t('inbox.trackOpenRecord')}>${t('inbox.trackOpenRecord')}<//>
          <${Action} small tone="danger" onClick=${() => cancelTracked(tr)}>${t('inbox.trackReject')}<//>
          <${Loud} control onClick=${() => startSuggestedReply(tr)}>${t('inbox.trackApprove')}<//>`} />`)}
      ${peerIsMyAgent && schedOpen
        ? html`<${SchedulePanel} agentName=${peerAgentName} showToast=${showToast} onClose=${() => setSchedOpen(false)} />` : null}
      ${!isAnnouncement && cmdFill
        ? html`<${CommandFill} command=${cmdFill} onInsert=${insertCommand} onCancel=${() => setCmdFill(null)} />`
        : (!isAnnouncement && agentCommands
          ? html`<${CommandBar} commands=${agentCommands} onPick=${(c) =>
              (Array.isArray(c.params) && c.params.length) ? setCmdFill(c) : insertCommand(c, {})} />` : null)}
      ${viaAgentName
        ? html`<${PaneNote}>🤖 ${(t('inbox.viaAgentReadonly') || 'Sent by your agent {agent} — view only.').replace('{agent}', viaAgentName)}<//>`
        : isAnnouncement
        ? html`<${PaneNote}>📢 ${t('inbox.announcementNote')}<//>`
        : html`${replyQuote ? html`<${ReplyBar} label=${`↩ ${t('inbox.replyingTo')} ${quoteSender(replyQuote)}`}
            text=${quoteSnippet(replyQuote.body)} onJump=${() => jumpTo(replyQuote.id)}
            cancelLabel=${t('inbox.quoteCancel')} onCancel=${() => setReplyQuote?.(null)} />` : null}
          <${Composer} tone="message" key=${'c-' + activeConv.conversationId + (draftPrefill ? '-d' + prefillNonce : '')} recipient=${activeConv.peerGhii}
            sendLabel=${t('inbox.reply')} sending=${sending} onSend=${doSend} initialText=${draftPrefill}
            voiceMaxSeconds=${voiceMaxSeconds}
            focusNonce=${composerFocus} draftKey=${'aimeat.inbox.draft.' + activeConv.conversationId} />`}
    <//>`;
}

/** The broadcast / poll compose form, a page of its own on the poster face. Pure render over the
 *  container's state; moved here from inbox-tab.js unchanged (max-file-lines). */
export function renderBroadcastForm({
  bcType, setBcType, bcMode, setBcMode, bcQuestions, setBcQuestions, bcRecipients, removeBcRecipient, bcInput, setBcInput,
  addBcRecipient, myGroups, bcGroupId, setBcGroupId, isOperator, bcAudience, setBcAudience, sending, doBroadcast,
}) {
  return html`
    <${Pane} page>
      <${PaneHead} name=${t('inbox.broadcastTitle')} />
      <${PaneFields}>
        <${Stack}>
          <${Choice} boxed dot name="bctype" ariaLabel=${t('inbox.broadcastTitle')} value=${bcType} onChange=${setBcType}
            options=${[['message', t('inbox.bcTypeMessage')], ['poll', t('inbox.bcTypePoll')]]} />
          ${bcType === 'message'
            ? html`<${Choice} boxed dot name="bcmode" ariaLabel=${t('inbox.broadcastTitle')} value=${bcMode} onChange=${setBcMode}
                options=${[['broadcast', t('inbox.bcModeBroadcast')], ['announcement', t('inbox.bcModeAnnouncement')]]} />`
            : html`<${PollBuilder} questions=${bcQuestions} setQuestions=${setBcQuestions} />`}
          ${bcRecipients.length ? html`<${Marks}>
            ${bcRecipients.map(r => html`<${Mark} key=${r} onRemove=${() => removeBcRecipient(r)}
              removeLabel=${t('inbox.bcRemove')} removeGlyph="✕">${peerName(r)}<//>`)}
          <//>` : null}
          <${TextField} list="inbox-contact-suggest" placeholder=${t('inbox.bcAddPlaceholder')}
            value=${bcInput} onInput=${setBcInput} onEnter=${() => addBcRecipient()}
            actions=${html`<${Action} onClick=${() => addBcRecipient()}>${t('inbox.bcAdd')}<//>`} />
          ${myGroups.length ? html`<${Select} value=${bcGroupId} onChange=${setBcGroupId} placeholder=${t('inbox.bcNoGroup')}
            options=${myGroups.map(g => [g.id, `${g.name} (${(g.members || []).length})`])} />` : null}
          ${isOperator ? html`<${Select} attention value=${bcAudience} onChange=${setBcAudience} placeholder=${t('inbox.bcNoAudience')}
            options=${[['node-users', t('inbox.bcNodeUsers')], ['federation-users', t('inbox.bcFederationUsers')]]} />` : null}
        <//>
      <//>
      <${Composer} tone="message" key="c-bc" recipient=${(bcRecipients.length || bcGroupId || bcAudience) ? 'bc' : ''}
        sendLabel=${bcType === 'poll' ? t('inbox.pollSend') : t('inbox.bcSend')} sending=${sending} onSend=${doBroadcast} />
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
    <${Pane} page>
      <${PaneHead} name=${html`🔗 ${t('inbox.trackedTitle')} ${activeTracked.length ? html`<${Mark} kind="count" tone="waiting">${activeTracked.length}<//>` : ''}`} />
      <${PaneScroll}>
        <${List} cols="name-doors" keepCols empty=${activeTracked.length === 0 ? (doneCount ? t('inbox.trackedAllDone') : t('inbox.trackedEmpty')) : null}>
          ${activeTracked.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(tr => {
            const trk = trackStateLabel(tr.state);
            return html`<${Row} key=${tr.id}>
              <${Name} before=${html`<${Mark} kind="status" tone=${trackStatusTone(trk.tone)}>${trk.text}<//>`}
                meta=${html`${t('inbox.trackedTo')} ${peerName(tr.source?.peerGhii || '')}
                  · ${t('inbox.trackedWatching')} <${Code}>${recordLabel(tr)}<//>
                  · ${tr.response?.mode === 'auto' ? t('inbox.trackModeAuto') : t('inbox.trackModeApprove')}
                  ${tr.tracking?.lastError ? html` · <${Tinted} tone="danger">${tr.tracking.lastError}<//>` : null}`}>${tr.title || t('inbox.trackResponse')}<//>
              <${Doors}>
                ${tr.references?.organismId ? html`<${Action} onClick=${() => openRecord(tr)}>📄 ${t('inbox.trackOpenRecord')}<//>` : null}
                ${tr.state === 'awaiting-approval'
                  ? html`<${Loud} control onClick=${() => openTracked(tr)}>${t('inbox.trackApprove')}<//>`
                  : html`<${Icon} small label=${t('inbox.trackedOpenConvo')} onClick=${() => openTracked(tr)}>💬<//>`}
                <${Action} onClick=${() => cancelTracked(tr)}>${t('inbox.trackedCancel')}<//>
              <//>
            <//>`;
          })}
        <//>
        ${doneCount ? html`<${Note} kind="quiet">✓ ${(t('inbox.trackedDoneCount') || '{n} completed').replace('{n}', String(doneCount))}<//>` : null}
      <//>
    <//>`;
}

export function ResultsPanel({ resultsId, recentBroadcasts, results, openResults, setResultsId, setResults }) {
  if (!resultsId) {
    return html`<${Pane} page>
      <${PaneHead} name=${`📊 ${t('inbox.resultsTitle')}`} />
      <${PaneScroll}>
        ${recentBroadcasts.length === 0 ? html`<${Note} kind="quiet">${t('inbox.resultsEmpty')}<//>` : null}
        ${recentBroadcasts.length > 0 ? html`<${ConversationRows}>${recentBroadcasts.map(b => html`
          <${ConversationRow} key=${b.id} title=${`${b.type === 'poll' ? '📊' : '📨'} ${b.title}`}
            date=${b.createdAt ? stampShort(b.createdAt) : ''} dateTitle=${b.createdAt ? stampFull(b.createdAt) : ''}
            onOpen=${() => openResults(b.id)} />`)}<//>` : null}
      <//>
    <//>`;
  }
  const r = results;
  const isPoll = r?.interactive?.role === 'questions';
  const tallies = isPoll ? tallyPoll(r.interactive, r.recipients || []) : [];
  return html`<${Pane} page>
    <${PaneHead} before=${html`<${Icon} small label=${t('inbox.back')} onClick=${() => { setResultsId(null); setResults(null); }}>←<//>`}
      name=${`📊 ${t('inbox.resultsTitle')}`} />
    <${PaneScroll}>
      ${!r ? html`<${Note} kind="quiet">…<//>` : html`
        <${Note} kind="meta">
          ${t('inbox.resultsRecipients')}: ${r.total} · ${t('inbox.resultsDelivered')}: ${r.delivered} · ${t('inbox.resultsRead')}: ${r.read}${isPoll ? ` · ${t('inbox.resultsAnswered')}: ${r.answered}` : ''}
        <//>
        ${tallies.map(({ q, counts, others }) => html`
          <${Stack} key=${q.id}>
            <b>${q.prompt}</b>
            ${(q.options || []).map(o => {
              const n = counts[o.id] || 0;
              const pct = r.answered ? Math.round((n / r.answered) * 100) : 0;
              return html`<${Stack} key=${o.id} gap="tight">
                <${Line} justify="between"><span>${o.label}</span><span>${n}</span><//>
                <${Meter} thin pct=${pct} />
              <//>`;
            })}
            ${others.length ? html`<${Note} kind="meta">${t('inbox.answer.other')}: ${others.join(', ')}<//>` : null}
          <//>`)}
        ${!isPoll ? html`<${List} cols="name-state" keepCols dense>
          ${(r.recipients || []).map(rec => html`<${Row} key=${rec.recipient}><${Name}>${peerName(rec.recipient)}<//><${Cell} dim>${rec.status}<//><//>`)}
        <//>` : null}
      `}
    <//>
  <//>`;
}
