/**
 * @file public/views/profile/inbox-tab/panels.js
 * @description Pure (hook-free) render panels for the profile Inbox tab: ListPanel (conversation/request
 *   list + grouped person rows), ThreadPanel (the open thread pane — head, bubbles, awaiting-draft
 *   bubbles, command bar/fill, composer), TrackedPanel (the Tracked Responses dashboard) and ResultsPanel
 *   (broadcast/poll results). Each is a presentational component driven entirely by props from InboxTab;
 *   the stateful container keeps all hooks. Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
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
import { escHtml } from '/js/utils.js';
import { Markdown } from '/components/Markdown.js';
import { PresenceDot } from '/components/PresenceDot.js';
import { getSession } from '/js/services/auth.js';
import { Avatar, MessageBubble, Composer, CommandBar, CommandFill, SchedulePanel } from './components.js';
import { ThreadReadAloud } from './read-aloud.js';
import { peerName, ownerKeyOf, isAgentPeer, ownerDisplayName, subThreadLabel, groupConversations, timeShort, dayKey, dayLabel, trackStateLabel, tallyPoll, quoteSnippet } from './helpers.js';

export function ListPanel({ requests, conversations, activeConv, peerDisplay, accept, block, openConversation }) {
  /** One conversation row. `nested` = inside a person group (labelled by the agent/thread, indented). */
  const convRow = (c, nested) => {
    const active = activeConv?.conversationId === c.conversationId ? ' inbox-conv--active' : '';
    const sub = subThreadLabel(c.peerGhii);
    // An agent-owned conversation the owner aggregates (a DM the agent sent from its own inbox) — labelled
    // "via <agent>" and read-only. The `viaAgent` tag comes from the conversation list aggregation.
    const via = c.viaAgent ? (subThreadLabel(c.viaAgent) || peerName(c.viaAgent)) : null;
    // Nested: a subject thread shows its topic; otherwise the agent name / "Direct". Flat: the person.
    const label = via
      ? (nested ? `${t('inbox.viaAgent')} ${via}` : peerDisplay(c.peerGhii))
      : (nested ? (c.subject || (sub ? peerDisplay(c.peerGhii) : t('inbox.directThread'))) : peerDisplay(c.peerGhii));
    const icon = (via || sub) ? '🤖' : (c.subject ? '🏷' : '💬');
    return html`
      <button class=${`inbox-conv${active}${nested ? ' inbox-conv--nested' : ''}`} key=${c.conversationId} onClick=${() => openConversation(c)}>
        ${nested ? html`<span class="inbox-conv-subico">${icon}</span>` : html`<${Avatar} seed=${c.peerGhii} size=${40} />`}
        <div class="inbox-conv-main">
          <div class="inbox-conv-line1">
            <span class="inbox-name">${escHtml(label)} ${(!nested || c.peerGhii?.includes('#')) ? html`<${PresenceDot} ghii=${c.peerGhii} />` : ''}</span>
            ${!nested && via ? html`<span class="inbox-via-chip">${t('inbox.viaAgent')} ${escHtml(via)}</span>` : ''}
            <span class="inbox-conv-time">${c.updatedAt ? timeShort(c.updatedAt) : ''}</span>
          </div>
          <div class="inbox-conv-line2">
            ${(!nested && c.subject) ? html`<span class="inbox-conv-subject">🏷 ${escHtml(c.subject)}</span>` : ''}
            <span class="inbox-conv-preview">${c.lastDirection === 'outbound' ? `${t('inbox.youPrefix')} ` : ''}${escHtml(c.lastMessage || '')}</span>
            ${c.unread > 0 ? html`<span class="inbox-conv-badge">${c.unread}</span>` : null}
          </div>
        </div>
      </button>`;
  };

  return html`
    <div class="inbox-list">
      ${requests.length > 0 ? html`
        <div class="inbox-list-section">${t('inbox.requests')} <span class="inbox-count">${requests.length}</span></div>
        ${requests.map(r => html`
          <div class="inbox-request" key=${r.contactId}>
            <div class="inbox-request-top">
              <${Avatar} seed=${r.contactId} size=${36} />
              <div class="inbox-request-id">
                <div class="inbox-name">${escHtml(peerDisplay(r.contactId))} <${PresenceDot} ghii=${r.contactId} /></div>
                <div class="inbox-sub">${escHtml(r.contactId)}</div>
              </div>
            </div>
            <div class="inbox-request-preview">${escHtml(r.preview || '')}</div>
            <div class="inbox-request-actions">
              <button class="btn-success btn-sm" onClick=${() => accept(r.contactId)}>${t('inbox.accept')}</button>
              <button class="btn-outline btn-sm" onClick=${() => block(r.contactId)}>${t('inbox.block')}</button>
            </div>
          </div>`)}` : null}

      <div class="inbox-list-section">${t('inbox.conversations')}</div>
      ${conversations.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.noConversations')}</div>` : null}
      ${groupConversations(conversations).map(g => {
        // A person with a single human-only thread (no agents) renders flat, as before.
        if (g.convs.length === 1 && !isAgentPeer(g.convs[0].peerGhii)) return convRow(g.convs[0], false);
        // Otherwise: a group header for the person + a nested row per thread (human + each agent).
        const unread = g.convs.reduce((n, c) => n + (c.unread || 0), 0);
        return html`
          <div class="inbox-conv-group" key=${g.ownerKey}>
            <div class="inbox-conv-group-head">
              <${Avatar} seed=${g.ownerKey} size=${28} />
              <span class="inbox-name">${escHtml(peerDisplay(g.ownerKey))} <${PresenceDot} ghii=${g.ownerKey} /></span>
              ${unread > 0 ? html`<span class="inbox-conv-badge">${unread}</span>` : null}
            </div>
            ${g.convs.map(c => convRow(c, true))}
          </div>`;
      })}
    </div>`;
}

export function ThreadPanel({
  activeConv, thread, urlMap, important, trackedByMsg, awaitingForConv, awaitingDrafts,
  schedOpen, setSchedOpen, cmdFill, agentCommands, sending, draftPrefill, prefillNonce, msgsRef,
  peerDisplay, showToast, toggleImportant, onTrackMsg, onParkMsg, openMessageAi, submitInteractiveAnswers,
  setMdViewer, openConversationAi, openConversationNotebook, insertCommand, setCmdFill, cancelTracked, openRecord, startSuggestedReply, doSend,
  replyQuote, setReplyQuote, onQuoteReply, composerFocus, showLinkPreviews, toggleLinkPreviews,
  threadAll, toggleThreadAll,
}) {
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
    el.classList.add('inbox-row--flash');
    setTimeout(() => el.classList.remove('inbox-row--flash'), 1400);
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
  return html`
    <div class="inbox-panel">
      <div class="inbox-thread-head">
        <${Avatar} seed=${activeConv.peerGhii} size=${36} />
        <div class="inbox-thread-id">
          <div class="inbox-name">${escHtml(peerDisplay(activeConv.peerGhii))} <${PresenceDot} ghii=${activeConv.peerGhii} label=${true} /></div>
          ${activeConv.subject ? html`<div class="inbox-thread-subject">🏷 ${escHtml(activeConv.subject)}</div>` : null}
          ${viaAgentName ? html`<div class="inbox-thread-via">🤖 ${t('inbox.sentByAgent')} ${escHtml(viaAgentName)}</div>` : null}
          <div class="inbox-sub">${escHtml(activeConv.peerGhii)}</div>
        </div>
        <${ThreadReadAloud} thread=${thread} peerLabelText=${peerDisplay(activeConv.peerGhii)} convId=${activeConv.conversationId} />
        ${!viaAgentName ? html`<button class="btn-ghost btn-sm inbox-ai-btn" onClick=${openConversationAi} title=${t('inbox.ai.replyWithAi')}>✨ <span class="inbox-ai-btn-label">${t('inbox.ai.replyWithAi')}</span></button>` : null}
        ${!viaAgentName ? html`<button class="btn-ghost btn-sm inbox-ai-btn" onClick=${openConversationNotebook} title=${t('inbox.notebook.toNotebook')}>📓 <span class="inbox-ai-btn-label">${t('inbox.notebook.toNotebookShort')}</span></button>` : null}
        <button class=${`btn-ghost btn-sm inbox-linkprev-toggle${showLinkPreviews ? ' inbox-linkprev-toggle--on' : ''}`}
          aria-pressed=${!!showLinkPreviews} onClick=${toggleLinkPreviews}
          title=${showLinkPreviews ? t('inbox.linkPreview.hideAll') : t('inbox.linkPreview.showAll')}>
          <span class="inbox-ai-btn-label">${t('inbox.linkPreview.label')}</span></button>
        ${(thread.length >= 50) ? html`<button class=${`btn-ghost btn-sm inbox-linkprev-toggle${threadAll ? ' inbox-linkprev-toggle--on' : ''}`}
          aria-pressed=${!!threadAll} onClick=${toggleThreadAll}
          title=${threadAll ? t('inbox.thread.showRecent') : t('inbox.thread.showAll')}>
          <span class="inbox-ai-btn-label">${threadAll ? t('inbox.thread.showRecent') : t('inbox.thread.showAll')}</span></button>` : null}
        ${peerIsMyAgent && !viaAgentName ? html`<button class=${`btn-ghost btn-sm inbox-sched-btn${schedOpen ? ' inbox-sched-btn--on' : ''}`}
          onClick=${() => setSchedOpen(o => !o)} title=${t('inbox.schedTitle')}>📅</button>` : null}
      </div>
      <div class="inbox-msgs" ref=${msgsRef}>
        ${thread.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.noThread')}</div>` : null}
        ${thread.map(m => {
          const dk = dayKey(m.createdAt);
          const showDay = dk !== lastDay; lastDay = dk;
          // An interactive answer already summarizes its question in the body — a quote would duplicate it.
          const quoted = (m.replyToId && m.interactive?.role !== 'answers') ? msgById[m.replyToId] : null;
          return html`
            ${showDay ? html`<div class="inbox-day" key=${'d' + m.id}><span>${dayLabel(m.createdAt)}</span></div>` : null}
            <${MessageBubble} key=${m.id + m.direction} msg=${m} mine=${m.direction === 'outbound'} urlMap=${urlMap}
              domId=${`inbox-msg-${m.id}`} quoted=${quoted} quotedName=${quoted ? quoteSender(quoted) : ''} onJumpTo=${jumpTo}
              onQuote=${(onQuoteReply && !activeConv.viaAgent) ? onQuoteReply : null}
              starred=${important.has(m.id)} onStar=${toggleImportant} onTrack=${onTrackMsg} onPark=${onParkMsg} onReplyAi=${openMessageAi} tracked=${trackedByMsg[m.id]}
              answeredWith=${m.interactive?.role === 'questions' ? answersByQ[m.id] : null}
              onAnswer=${submitInteractiveAnswers} submitting=${sending} showLinkPreviews=${showLinkPreviews}
              onOpenMarkdown=${(url, name) => setMdViewer({ url, name })} />`;
        })}
      </div>
      ${awaitingForConv.map(tr => html`
        <div class="inbox-row inbox-row--mine" key=${tr.id}>
          <div class="inbox-bubble inbox-bubble--mine inbox-bubble--draft">
            <div class="inbox-draft-label">🔗 ${t('inbox.trackReady')}</div>
            <div class="inbox-bubble-body"><${Markdown} text=${awaitingDrafts[tr.id] || tr.title || ''} /></div>
            <div class="inbox-draft-actions">
              <button class="btn-ghost btn-sm" onClick=${() => openRecord(tr)} title=${t('inbox.trackOpenRecord')}>📄 ${t('inbox.trackOpenRecord')}</button>
              <button class="btn-ghost btn-sm" onClick=${() => cancelTracked(tr)}>${t('inbox.trackReject')}</button>
              <button class="btn-primary btn-sm" onClick=${() => startSuggestedReply(tr)}>${t('inbox.trackApprove')}</button>
            </div>
          </div>
        </div>`)}
      ${peerIsMyAgent && schedOpen
        ? html`<${SchedulePanel} agentName=${peerAgentName} showToast=${showToast} onClose=${() => setSchedOpen(false)} />` : null}
      ${!isAnnouncement && cmdFill
        ? html`<${CommandFill} command=${cmdFill} onInsert=${insertCommand} onCancel=${() => setCmdFill(null)} />`
        : (!isAnnouncement && agentCommands
          ? html`<${CommandBar} commands=${agentCommands} onPick=${(c) =>
              (Array.isArray(c.params) && c.params.length) ? setCmdFill(c) : insertCommand(c, {})} />` : null)}
      ${viaAgentName
        ? html`<div class="inbox-announce-note">🤖 ${(t('inbox.viaAgentReadonly') || 'Sent by your agent {agent} — view only.').replace('{agent}', viaAgentName)}</div>`
        : isAnnouncement
        ? html`<div class="inbox-announce-note">📢 ${t('inbox.announcementNote')}</div>`
        : html`${replyQuote ? html`<div class="inbox-replybar">
            <button class="inbox-replybar-main" onClick=${() => jumpTo(replyQuote.id)}>
              <span class="inbox-replybar-label">↩ ${t('inbox.replyingTo')} ${escHtml(quoteSender(replyQuote))}</span>
              <span class="inbox-replybar-text">${escHtml(quoteSnippet(replyQuote.body))}</span>
            </button>
            <button class="btn-ghost btn-sm" onClick=${() => setReplyQuote?.(null)} title=${t('inbox.quoteCancel')}>✕</button>
          </div>` : null}
          <${Composer} key=${'c-' + activeConv.conversationId + (draftPrefill ? '-d' + prefillNonce : '')} recipient=${activeConv.peerGhii}
            sendLabel=${t('inbox.reply')} sending=${sending} onSend=${doSend} initialText=${draftPrefill}
            focusNonce=${composerFocus} draftKey=${'aimeat.inbox.draft.' + activeConv.conversationId} />`}
    </div>`;
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
    <div class="inbox-panel">
      <div class="inbox-thread-head">
        <div class="inbox-name">🔗 ${t('inbox.trackedTitle')} ${activeTracked.length ? html`<span class="inbox-count">${activeTracked.length}</span>` : ''}</div>
      </div>
      <div class="inbox-tracked-list">
        ${activeTracked.length === 0 ? html`<div class="inbox-empty-sm">${doneCount ? t('inbox.trackedAllDone') : t('inbox.trackedEmpty')}</div>` : null}
        ${activeTracked.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '')).map(tr => {
          const trk = trackStateLabel(tr.state);
          return html`
            <div class="inbox-tracked-row" key=${tr.id}>
              <div class="inbox-tracked-main">
                <div class="inbox-tracked-line1">
                  <span class=${`inbox-track-badge inbox-track-badge--${trk.tone}`}>${trk.text}</span>
                  <span class="inbox-tracked-name">${escHtml(tr.title || t('inbox.trackResponse'))}</span>
                </div>
                <div class="inbox-tracked-sub">
                  ${t('inbox.trackedTo')} ${escHtml(peerName(tr.source?.peerGhii || ''))}
                  · ${t('inbox.trackedWatching')} <code>${escHtml(recordLabel(tr))}</code>
                  · ${tr.response?.mode === 'auto' ? t('inbox.trackModeAuto') : t('inbox.trackModeApprove')}
                  ${tr.tracking?.lastError ? html` · <span class="inbox-tracked-err">${escHtml(tr.tracking.lastError)}</span>` : null}
                </div>
              </div>
              <div class="inbox-tracked-actions">
                ${tr.references?.organismId ? html`<button class="btn-outline btn-sm" onClick=${() => openRecord(tr)}>📄 ${t('inbox.trackOpenRecord')}</button>` : null}
                ${tr.state === 'awaiting-approval'
                  ? html`<button class="btn-primary btn-sm" onClick=${() => openTracked(tr)}>${t('inbox.trackApprove')}</button>`
                  : html`<button class="btn-ghost btn-sm" onClick=${() => openTracked(tr)} title=${t('inbox.trackedOpenConvo')}>💬</button>`}
                <button class="btn-ghost btn-sm" onClick=${() => cancelTracked(tr)}>${t('inbox.trackedCancel')}</button>
              </div>
            </div>`;
        })}
        ${doneCount ? html`<div class="inbox-tracked-done">✓ ${(t('inbox.trackedDoneCount') || '{n} completed').replace('{n}', String(doneCount))}</div>` : null}
      </div>
    </div>`;
}

export function ResultsPanel({ resultsId, recentBroadcasts, results, openResults, setResultsId, setResults }) {
  if (!resultsId) {
    return html`<div class="inbox-panel">
      <div class="inbox-thread-head"><div class="inbox-name">📊 ${t('inbox.resultsTitle')}</div></div>
      <div class="inbox-tracked-list">
        ${recentBroadcasts.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.resultsEmpty')}</div>` : null}
        ${recentBroadcasts.map(b => html`
          <button class="inbox-conv" key=${b.id} onClick=${() => openResults(b.id)}>
            <div class="inbox-conv-main">
              <div class="inbox-conv-line1">
                <span class="inbox-name">${b.type === 'poll' ? '📊' : '📨'} ${escHtml(b.title)}</span>
                <span class="inbox-conv-time">${b.createdAt ? timeShort(b.createdAt) : ''}</span>
              </div>
            </div>
          </button>`)}
      </div>
    </div>`;
  }
  const r = results;
  const isPoll = r?.interactive?.role === 'questions';
  const tallies = isPoll ? tallyPoll(r.interactive, r.recipients || []) : [];
  return html`<div class="inbox-panel">
    <div class="inbox-thread-head">
      <button class="btn-ghost btn-sm" onClick=${() => { setResultsId(null); setResults(null); }}>←</button>
      <div class="inbox-name">📊 ${t('inbox.resultsTitle')}</div>
    </div>
    <div class="inbox-msgs">
      ${!r ? html`<div class="inbox-empty-sm">…</div>` : html`
        <div class="inbox-results-summary">
          ${t('inbox.resultsRecipients')}: ${r.total} · ${t('inbox.resultsDelivered')}: ${r.delivered} · ${t('inbox.resultsRead')}: ${r.read}${isPoll ? ` · ${t('inbox.resultsAnswered')}: ${r.answered}` : ''}
        </div>
        ${tallies.map(({ q, counts, others }) => html`
          <div class="inbox-results-q" key=${q.id}>
            <div class="inbox-results-prompt">${escHtml(q.prompt)}</div>
            ${(q.options || []).map(o => {
              const n = counts[o.id] || 0;
              const pct = r.answered ? Math.round((n / r.answered) * 100) : 0;
              return html`<div class="inbox-results-bar" key=${o.id}>
                <div class="inbox-results-bar-label"><span>${escHtml(o.label)}</span><span>${n}</span></div>
                <div class="inbox-results-bar-track"><div class="inbox-results-bar-fill" style=${`--w:${pct}%`}></div></div>
              </div>`;
            })}
            ${others.length ? html`<div class="inbox-results-others">${t('inbox.answer.other')}: ${others.map(o => escHtml(o)).join(', ')}</div>` : null}
          </div>`)}
        ${!isPoll ? html`<div class="inbox-results-reclist">
          ${(r.recipients || []).map(rec => html`<div class="inbox-results-rec" key=${rec.recipient}><span>${escHtml(peerName(rec.recipient))}</span><span>${rec.status}</span></div>`)}
        </div>` : null}
      `}
    </div>
  </div>`;
}
