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
 *   v1.0.0 -- 2026-05-22 -- Initial creation for Agent Dashboard Phase 3
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { sendMessage, listMessages, listThreads } from '/js/services/agent-messages.js';
import { createTask } from '/js/services/agent-tasks.js';

function ProposedTask({ task, agentName, showToast }) {
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    setCreating(true);
    try {
      await createTask(agentName, {
        title: task.title || task.summary || 'Agent proposed task',
        description: task.description || '',
        status: 'queued',
      });
      showToast(t('profile.agents.tasks.createTask'));
    } catch (err) {
      showToast(err.message || 'Failed to create task', true);
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

function MessageBubble({ msg, agentName, showToast }) {
  const isInbound = msg.direction === 'inbound';
  const bubbleClass = isInbound ? 'agd-msg-inbound' : 'agd-msg-outbound';
  const proposedTask = msg.metadata?.proposedTask || null;

  return html`
    <div>
      <div class="agd-msg-bubble ${bubbleClass}">
        ${msg.content}
      </div>
      <div class="agd-msg-meta ${isInbound ? 'agd-msg-meta-right' : ''}">
        ${msg.created_at ? timeAgo(msg.created_at) : ''}
        ${msg.tokens_used ? html` · ${msg.tokens_used} ${t('profile.agents.messages.tokensUsed')}` : ''}
      </div>
      ${proposedTask && html`
        <${ProposedTask} task=${proposedTask} agentName=${agentName} showToast=${showToast} />
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

export default function AgentMessagesSubtab({ agentName, session, showToast }) {
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const historyRef = useRef(null);

  async function loadMessages() {
    setLoading(true);
    try {
      const opts = {};
      if (activeThread) opts.threadId = activeThread;
      const res = await listMessages(agentName, opts);
      setMessages(res?.data?.messages || []);
    } catch {
      setMessages([]);
    }
    setLoading(false);
  }

  async function loadThreads() {
    try {
      const res = await listThreads(agentName);
      setThreads(res?.data?.threads || []);
    } catch {
      setThreads([]);
    }
  }

  useEffect(() => {
    loadThreads();
    loadMessages();
  }, [agentName]);

  useEffect(() => { loadMessages(); }, [activeThread]);

  useEffect(() => {
    const handler = () => { loadMessages(); loadThreads(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [agentName, activeThread]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      await sendMessage(agentName, draft.trim(), activeThread);
      setDraft('');
      await loadMessages();
    } catch (err) {
      showToast(err.message || 'Failed to send message', true);
    }
    setSending(false);
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

  return html`
    <div>
      <${ThreadList} threads=${threads} activeThread=${activeThread} onSelect=${setActiveThread} />

      ${messages.length === 0 && !loading && html`
        <div class="agd-empty">${t('profile.agents.messages.empty')}</div>
      `}

      ${messages.length > 0 && html`
        <div class="agd-msg-history" ref=${historyRef}>
          ${messages.map(msg => html`
            <${MessageBubble} key=${msg.id || msg.created_at} msg=${msg} agentName=${agentName} showToast=${showToast} />
          `)}
        </div>
      `}

      <div class="agd-msg-input">
        <textarea
          value=${draft}
          onInput=${(e) => setDraft(e.target.value)}
          onKeyDown=${handleKeyDown}
          placeholder=${t('profile.agents.messages.placeholder')}
          rows="1"
        />
        <button class="btn-primary btn-sm" onClick=${handleSend} disabled=${sending || !draft.trim()}>
          ${t('profile.agents.messages.send')}
        </button>
      </div>
    </div>
  `;
}
