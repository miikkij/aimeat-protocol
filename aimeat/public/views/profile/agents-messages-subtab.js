/**
 * @file agents-messages-subtab.js
 * @description Messages sub-tab for agent detail view.
 *   Shows conversation threads, message history with chat bubbles,
 *   proposed task handling, and a chat input area.
 * @structure
 *   - AgentMessagesSubtab (default export) -- main component
 *   - MessageBubble -- individual message display
 *   - ProposedTask -- task proposal from agent with create/adjust buttons
 *   - ThreadList -- horizontal thread selector
 * @version-history
 *   v1.3.0 -- 2026-05-30 -- Add OptionPrompt: render an agent's single-select option-prompt
 *     (metadata.prompt) as clickable chips + an always-present "Other". Clicking sends the
 *     choice back as a prompt_answer. A prompt locks (read-only, chosen chip highlighted) once
 *     any newer message exists in the thread.
 *   v1.2.0 -- 2026-05-22 -- Fix: use camelCase field names from API (createdAt, metadata.tokensUsed)
 *   v1.1.0 -- 2026-05-22 -- Show timestamp on messages, sort oldest-first (chat-style)
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 *   v1.3.1 -- 2026-06-19 -- JSDoc type annotations for frontend type-checking
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { sendMessage, listMessages, listThreads } from '/js/services/agent-messages.js';
import { createTask } from '/js/services/agent-tasks.js';
import { swallowed } from '/js/swallowed.js';

function ProposedTask({ task, agentName, showToast }) {
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await createTask(agentName, {
        title: task.title || task.summary || t('profile.agents.messages.proposedTaskDefault'),
        description: task.description || '',
        status: 'queued',
      });
      showToast(t('profile.agents.tasks.createTask'));
    } catch (err) {
      showToast(err.message || t('profile.agents.messages.createTaskError'), true);
    }
    setCreating(false);
  }

  return html`
    <div class="agd-msg-proposed-task">
      <h5>${t('profile.agents.messages.proposedTask')}</h5>
      <div>${task.title || task.summary || ''}</div>
      ${task.description && html`<div class="agd-service-desc">${task.description}</div>`}
      <div class="agd-form-actions">
        <button class="btn-primary btn-sm" onClick=${handleCreate} disabled=${creating}>
          ${t('profile.agents.messages.createTask')}
        </button>
        <button class="btn-ghost btn-sm" onClick=${() => {}}>
          ${t('profile.agents.messages.adjustTask')}
        </button>
      </div>
    </div>
  `;
}

// Single-select option-prompt the agent attached to an outbound message.
// Chips are clickable while the prompt is the latest message in the thread;
// once a newer message exists (`locked`), chips become read-only and the
// chosen option (if any) stays highlighted. "Other" is always offered and
// routes the owner to the free-text chat input.
function OptionPrompt({ prompt, locked, answeredChoice, onAnswer, onOther }) {
  return html`
    <div class="agd-msg-prompt">
      <div class="agd-msg-prompt-q">${prompt.question}</div>
      <div class="agd-msg-prompt-options">
        ${prompt.options.map(opt => {
          const chosen = answeredChoice != null && opt === answeredChoice;
          return html`
            <button
              key=${opt}
              class="agd-msg-prompt-option ${chosen ? 'agd-msg-prompt-option--chosen' : ''}"
              disabled=${locked}
              onClick=${() => onAnswer(opt)}
            >${opt}</button>
          `;
        })}
        ${prompt.allowOther !== false && html`
          <button
            class="agd-msg-prompt-option agd-msg-prompt-option--other ${answeredChoice != null && !prompt.options.includes(answeredChoice) ? 'agd-msg-prompt-option--chosen' : ''}"
            disabled=${locked}
            onClick=${onOther}
          >${t('profile.agents.messages.promptOther')}</button>
        `}
      </div>
    </div>
  `;
}

function MessageBubble({ msg, agentName, showToast, locked, answeredChoice, onAnswer, onOther }) {
  const isInbound = msg.direction === 'inbound';
  const bubbleClass = isInbound ? 'agd-msg-inbound' : 'agd-msg-outbound';
  const proposedTask = msg.metadata?.proposedTask || null;
  const prompt = msg.metadata?.prompt || null;

  return html`
    <div>
      <div class="agd-msg-bubble ${bubbleClass}">
        ${msg.content}
      </div>
      <div class="agd-msg-meta ${isInbound ? 'agd-msg-meta-right' : ''}">
        ${msg.createdAt ? html`<span class="agd-msg-time">${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> ${timeAgo(msg.createdAt)}` : ''}
        ${msg.metadata?.tokensUsed ? html` · ${msg.metadata.tokensUsed} ${t('profile.agents.messages.tokensUsed')}` : ''}
      </div>
      ${proposedTask && html`
        <${ProposedTask} task=${proposedTask} agentName=${agentName} showToast=${showToast} />
      `}
      ${prompt && html`
        <${OptionPrompt}
          prompt=${prompt}
          locked=${locked}
          answeredChoice=${answeredChoice}
          onAnswer=${(choice) => onAnswer(prompt, msg.threadId, choice)}
          onOther=${() => onOther(prompt, msg.threadId)}
        />
      `}
    </div>
  `;
}

function ThreadList({ threads, activeThread, onSelect }) {
  if (!threads || threads.length === 0) return null;
  return html`
    <div class="agd-msg-threads">
      <button
        class="agd-msg-thread-btn ${!activeThread ? 'agd-msg-thread-btn-active' : ''}"
        onClick=${() => onSelect(null)}
      >
        ${t('profile.agents.messages.threads')}
      </button>
      ${threads.map(thread => html`
        <button
          key=${thread.id}
          class="agd-msg-thread-btn ${activeThread === thread.id ? 'agd-msg-thread-btn-active' : ''}"
          onClick=${() => onSelect(thread.id)}
        >
          ${thread.title || thread.id?.slice(0, 8) || '...'}
        </button>
      `)}
    </div>
  `;
}

export default function AgentMessagesSubtab({ agentName, showToast }) {
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  // When the owner clicks "Other" on an option-prompt, we stage the prompt here
  // so the next free-text send attaches a prompt_answer correlated to it.
  const [pendingPrompt, setPendingPrompt] = useState(null); // { promptId, threadId } | null
  const historyRef = useRef(null);
  const inputRef = useRef(null);

  async function loadMessages() {
    setLoading(true);
    try {
      const opts = {};
      if (activeThread) opts.threadId = activeThread;
      const res = await listMessages(agentName, opts);
      setMessages(res?.data?.messages || []);
    } catch (err) {
      swallowed('agents-messages-subtab: loadMessages', err);
      setMessages([]);
    }
    setLoading(false);
  }

  async function loadThreads() {
    try {
      const res = await listThreads(agentName);
      setThreads(res?.data?.threads || []);
    } catch (err) {
      swallowed('agents-messages-subtab: loadThreads', err);
      setThreads([]);
    }
  }

  // Load threads + messages on mount and whenever the agent changes. loadThreads/loadMessages
  // close over agentName/activeThread; keying on agentName only keeps thread-switch reloads on the
  // dedicated effect below rather than double-firing here.
  useEffect(() => {
    loadThreads();
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentName]);

  // Reload messages when the active thread changes; loadMessages reads the current thread/agent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadMessages(); }, [activeThread]);

  // Re-subscribe on agent/thread change; the loaders close over those and are intentionally omitted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onLiveUpdate(['agent-messages', 'messages'], () => { loadMessages(); loadThreads(); }), [agentName, activeThread]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      // If the owner is answering an option-prompt via "Other", attach the
      // correlated prompt_answer and reply in that prompt's thread.
      if (pendingPrompt) {
        await sendMessage(agentName, draft.trim(), pendingPrompt.threadId, undefined, {
          prompt_answer: { prompt_id: pendingPrompt.promptId, choice: draft.trim(), is_other: true },
        });
        setPendingPrompt(null);
      } else {
        await sendMessage(agentName, draft.trim(), activeThread);
      }
      setDraft('');
      await loadMessages();
    } catch (err) {
      showToast(err.message || t('profile.agents.messages.sendError'), true);
    }
    setSending(false);
  }

  // Owner clicked one of the agent's listed options -> reply immediately with
  // the choice and a correlated prompt_answer (in the prompt's own thread).
  async function answerOption(prompt, threadId, choice) {
    setPendingPrompt(null);
    try {
      await sendMessage(agentName, choice, threadId, undefined, {
        prompt_answer: { prompt_id: prompt.promptId, choice, is_other: false },
      });
      await loadMessages();
    } catch (err) {
      showToast(err.message || t('profile.agents.messages.sendError'), true);
    }
  }

  // Owner clicked "Other" -> stage the prompt and focus the chat input so the
  // next free-text send becomes the answer.
  function chooseOther(prompt, threadId) {
    setPendingPrompt({ promptId: prompt.promptId, threadId });
    if (inputRef.current) inputRef.current.focus();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading && messages.length === 0) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  const pendingCount = messages.filter(m => m.status === 'pending' && m.direction === 'inbound').length;
  const deliveredCount = messages.filter(m => m.status === 'delivered').length;
  const errorCount = messages.filter(m => m.status === 'error').length;
  const lastSeen = null; // TODO Phase 2+: derive from agent.last_seen

  // Oldest-first (chat order).
  const sorted = [...messages].sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0));
  // Latest message id per thread -> an option-prompt is answerable only while it
  // is the newest message in its thread (any later message locks it).
  const lastIdByThread = {};
  for (const m of sorted) lastIdByThread[m.threadId] = m.id;
  // promptId -> the owner's chosen text (from a prompt_answer reply), for highlight.
  const answeredByPromptId = {};
  for (const m of sorted) {
    const pa = m.metadata?.promptAnswer;
    if (pa?.promptId) answeredByPromptId[pa.promptId] = pa.choice;
  }

  return html`
    <div>
      <div class="agd-msg-status-bar">
        <div>
          <span class="${lastSeen ? 'badge badge-success' : 'badge badge-muted'}">${lastSeen ? t('profile.agents.messages.online') : t('profile.agents.messages.offline')}</span>
        </div>
        <div class="agd-msg-status-counts">
          <span class="badge badge-muted">${t('profile.agents.messages.inboxLabel')}: ${pendingCount}</span>
          <span class="badge badge-muted">${t('profile.agents.messages.deliveredLabel')}: ${deliveredCount}</span>
          ${errorCount > 0 && html`<span class="badge badge-danger">${t('profile.agents.messages.errorsLabel')}: ${errorCount}</span>`}
        </div>
      </div>

      <${ThreadList} threads=${threads} activeThread=${activeThread} onSelect=${setActiveThread} />

      ${messages.length === 0 && !loading && html`
        <div class="agd-empty">${t('profile.agents.messages.empty')}</div>
      `}

      ${messages.length > 0 && html`
        <div class="agd-msg-history" ref=${historyRef}>
          ${sorted.map(msg => {
            const promptId = msg.metadata?.prompt?.promptId;
            const locked = promptId ? lastIdByThread[msg.threadId] !== msg.id : false;
            const answeredChoice = promptId ? (answeredByPromptId[promptId] ?? null) : null;
            return html`
              <${MessageBubble}
                key=${msg.id || msg.createdAt}
                msg=${msg}
                agentName=${agentName}
                showToast=${showToast}
                locked=${locked}
                answeredChoice=${answeredChoice}
                onAnswer=${answerOption}
                onOther=${chooseOther}
              />
            `;
          })}
        </div>
      `}

      ${pendingPrompt && html`
        <div class="agd-msg-pending-hint">${t('profile.agents.messages.promptOtherHint')}</div>
      `}

      <div class="agd-msg-input">
        <textarea
          ref=${inputRef}
          value=${draft}
          onInput=${(e) => setDraft(e.target.value)}
          onKeyDown=${handleKeyDown}
          placeholder=${pendingPrompt ? t('profile.agents.messages.promptOtherPlaceholder') : t('profile.agents.messages.placeholder')}
          rows="1"
        />
        <button class="btn-primary btn-sm" onClick=${handleSend} disabled=${sending || !draft.trim()}>
          ${t('profile.agents.messages.send')}
        </button>
      </div>
    </div>
  `;
}
