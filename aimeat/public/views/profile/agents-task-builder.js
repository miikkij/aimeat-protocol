/**
 * @file agents-task-builder.js
 * @description Split-panel task creation builder with Living Proposal and chat panel.
 *   Implements the design spec's conversational task creation flow:
 *   user describes what they want -> agent proposes plan -> user reviews and starts.
 * @structure
 *   - TaskCreationBuilder (default export) -- main split-panel component
 *   - ProposalPanel -- left panel showing the proposed TODO plan
 *   - BuilderChat -- right panel with task-scoped messaging
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation per design spec Part 1
 *   v1.1.0 -- 2026-05-29 -- Drop the Requirements and Technical tabs. Field tests
 *     showed they were not used in practice (verification.userExpects and
 *     technicalChecks stayed empty for every real task), and surfacing empty
 *     tabs made the proposal panel look like it had three things to inspect
 *     when only one mattered. The verification fields stay in the schema for
 *     callers that want to set them via aimeat_task_create.
 *   v1.2.0 -- 2026-05-30 -- The first chat message now becomes the task
 *     DESCRIPTION (the field the agent crew reads as its prompt), with a short
 *     title auto-derived from its first line. Previously the whole message was
 *     forced into title, which is capped at 256 chars. Add a live character
 *     counter (limit 10000) to the chat input.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { createTask, getTask, startTask } from '/js/services/agent-tasks.js';
import { sendMessage, listMessages } from '/js/services/agent-messages.js';

// Max length for a chat message. Matches both AgentMessageCreateSchema.content
// and AgentTaskCreateSchema.description (10000) in src/models/. The first
// message in a thread becomes the task description, later ones are messages --
// both share this ceiling.
const MSG_MAX = 10000;

// Build a short task title from the (longer) first message. The title is only
// for display in lists/cards; the full text lives in the description, which is
// what the agent actually reads. Title schema cap is 256 -- we stay well under.
function deriveTitle(text) {
  const firstLine = text.split('\n').map(l => l.trim()).find(Boolean) || text.trim();
  return firstLine.length > 120 ? firstLine.slice(0, 117) + '...' : firstLine;
}

function ProposalPanel({ task, taskId }) {
  if (!taskId) {
    return html`<div class="agd-proposal">
      <div class="agd-proposal-content">
        <div class="agd-builder-analyzing">${t('profile.agents.tasks.builder.initial')}</div>
      </div>
    </div>`;
  }

  if (!task) {
    return html`<div class="agd-proposal">
      <div class="agd-proposal-content">
        <div class="agd-builder-analyzing">${t('profile.agents.tasks.builder.analyzing')}</div>
      </div>
    </div>`;
  }

  const hasTodos = task.todos && task.todos.length > 0;

  return html`
    <div class="agd-proposal">
      <div class="agd-proposal-content">
        <div class="agd-prop-section">
          <div class="agd-prop-label">${t('profile.agents.tasks.builder.whatItDoes')}</div>
          <div class="agd-prop-value">${task.description || task.title}</div>
        </div>

        ${hasTodos ? html`
          <div>
            <div class="agd-todo-header">
              <strong>${t('profile.agents.tasks.todoLabel')}</strong>
              <span class="agd-todo-summary">
                ${(() => {
                  const aimeatSteps = task.todos.filter(td => td.environment === 'aimeat').length;
                  const agentSteps = task.todos.filter(td => td.environment === 'agent').length;
                  const totalMinutes = task.todos.reduce((sum, td) => sum + (td.estimateMinutes || 0), 0);
                  return html`
                    ${aimeatSteps > 0 && html`<span class="agd-env-badge agd-env-aimeat">${t('profile.agents.tasks.envAimeat')}: ${aimeatSteps}</span>`}
                    ${agentSteps > 0 && html`<span class="agd-env-badge agd-env-agent">${t('profile.agents.tasks.envAgent')}: ${agentSteps}</span>`}
                    ${totalMinutes > 0 && html`<span class="agd-todo-time">~${totalMinutes} ${t('profile.agents.tasks.minuteShort')}</span>`}
                  `;
                })()}
              </span>
            </div>
            <div class="agd-todo-list">
              ${task.todos.map((td, i) => html`
                <div class="agd-todo-item agd-todo-${td.status || 'pending'}" key=${td.id || i}>
                  <span class="agd-todo-icon">${td.status === 'done' ? '✅' : '⬜'}</span>
                  <div class="agd-todo-content">
                    <div class="agd-todo-title">
                      <span>${i + 1}. ${td.title}</span>
                      <span class="agd-env-badge agd-env-${td.environment || 'agent'}">${td.environment === 'aimeat' ? t('profile.agents.tasks.envAimeat') : t('profile.agents.tasks.envAgent')}</span>
                      ${td.estimateMinutes && html`<span class="agd-todo-est">${td.estimateMinutes} ${t('profile.agents.tasks.minuteShort')}</span>`}
                    </div>
                    ${td.description && html`<div class="agd-todo-desc">${td.description}</div>`}
                    ${td.environmentReason && html`<div class="agd-todo-reason">${td.environmentReason}</div>`}
                    ${td.verification && html`<div class="agd-todo-verify">${td.verification}</div>`}
                  </div>
                </div>
              `)}
            </div>
          </div>
        ` : html`
          <div class="agd-builder-analyzing">${t('profile.agents.tasks.builder.waitingTodos')}</div>
        `}
      </div>
    </div>
  `;
}

function BuilderChat({ agentName, taskId, threadId, onTaskCreated, showToast }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const historyRef = useRef(null);

  async function loadMessages() {
    if (!threadId) return;
    try {
      const res = await listMessages(agentName, { threadId });
      setMessages(res?.data?.messages || []);
    } catch {
      setMessages([]);
    }
  }

  useEffect(() => { loadMessages(); }, [threadId]);

  useEffect(() => {
    if (!threadId) return;
    const handler = () => loadMessages();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [threadId]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend() {
    const text = draft.trim();
    if (!text) return;
    setSending(true);
    try {
      if (!taskId) {
        await onTaskCreated(text);
      } else {
        await sendMessage(agentName, text, threadId, taskId);
      }
      setDraft('');
      await loadMessages();
    } catch (err) {
      showToast(err.message || t('profile.agents.messages.sendError'), true);
    }
    setSending(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const sorted = [...messages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
  const placeholder = taskId
    ? t('profile.agents.tasks.builder.chatPlaceholder')
    : t('profile.agents.tasks.builder.placeholder');

  return html`
    <div class="agd-builder-chat">
      <div class="agd-builder-chat-history" ref=${historyRef}>
        ${sorted.map(msg => {
          const isInbound = msg.direction === 'inbound';
          return html`
            <div key=${msg.id}>
              <div class="agd-msg-bubble ${isInbound ? 'agd-msg-inbound' : 'agd-msg-outbound'}">
                ${msg.content}
              </div>
              <div class="agd-msg-meta ${isInbound ? 'agd-msg-meta-right' : ''}">
                ${msg.createdAt ? html`
                  <span class="agd-msg-time">${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  ${' '}${timeAgo(msg.createdAt)}
                ` : ''}
              </div>
            </div>
          `;
        })}
        ${taskId && messages.length === 0 && html`
          <div class="agd-builder-analyzing">${t('profile.agents.tasks.builder.analyzing')}</div>
        `}
      </div>
      <div class="agd-builder-chat-input-wrap">
        <div class="agd-builder-chat-input">
          <textarea
            value=${draft}
            onInput=${(e) => setDraft(e.target.value)}
            onKeyDown=${handleKeyDown}
            placeholder=${placeholder}
            maxlength=${MSG_MAX}
            rows="1"
          />
          <button class="btn-primary btn-sm" onClick=${handleSend} disabled=${sending || !draft.trim()}>
            ${taskId ? t('profile.agents.messages.send') : t('profile.agents.tasks.builder.send')}
          </button>
        </div>
        <div class=${`agd-chat-charcount ${draft.length >= MSG_MAX ? 'agd-chat-charcount-max' : ''}`}>
          ${draft.length} / ${MSG_MAX}
        </div>
      </div>
    </div>
  `;
}

export default function TaskCreationBuilder({ agentName, session, showToast, onClose }) {
  const [taskId, setTaskId] = useState(null);
  const [threadId, setThreadId] = useState(null);
  const [task, setTask] = useState(null);
  const [starting, setStarting] = useState(false);
  const [version, setVersion] = useState(0);

  async function loadTask() {
    if (!taskId) return;
    try {
      const resp = await getTask(agentName, taskId);
      const newTask = resp?.data?.task;
      if (newTask) {
        if (task && JSON.stringify(newTask.todos) !== JSON.stringify(task.todos)) {
          setVersion(v => v + 1);
        }
        setTask(newTask);
      }
    } catch { /* task may not exist yet */ }
  }

  useEffect(() => { loadTask(); }, [taskId]);

  const loadRef = useRef(loadTask);
  loadRef.current = loadTask;
  useEffect(() => {
    if (!taskId) return;
    const handler = () => loadRef.current();
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [taskId]);

  async function handleFirstMessage(text) {
    const newThreadId = crypto.randomUUID();
    try {
      // The full message is the description (what the agent reads); title is a
      // short label derived from it for display in task lists.
      const resp = await createTask(agentName, {
        title: deriveTitle(text),
        description: text,
        status: 'queued',
      });
      const newTaskId = resp?.data?.task?.id;
      if (!newTaskId) throw new Error('No task ID returned');
      setTaskId(newTaskId);
      setThreadId(newThreadId);
      await sendMessage(agentName, text, newThreadId, newTaskId);
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.createError'), true);
    }
  }

  async function handleStart() {
    setStarting(true);
    try {
      await startTask(agentName, taskId);
      showToast(t('profile.agents.tasks.builder.startTask'));
      onClose();
    } catch (err) {
      showToast(err.message || t('profile.agents.tasks.startError'), true);
    }
    setStarting(false);
  }

  const hasTodos = task?.todos?.length > 0;
  const canStart = hasTodos && (task?.status === 'queued' || task?.status === 'draft');

  return html`
    <div class="agd-builder">
      <div class="agd-builder-header">
        <h4>${t('profile.agents.tasks.builder.title')}</h4>
        ${version > 0 && html`<span class="agd-version-badge">${t('profile.agents.tasks.builder.version').replace('{n}', String(version))}</span>`}
      </div>

      <div class="agd-builder-panels">
        <${ProposalPanel} task=${task} taskId=${taskId} />
        <${BuilderChat}
          agentName=${agentName}
          taskId=${taskId}
          threadId=${threadId}
          onTaskCreated=${handleFirstMessage}
          showToast=${showToast}
        />
      </div>

      <div class="agd-builder-actions">
        <div>
          ${canStart && html`
            <button class="btn-primary btn-sm" onClick=${handleStart} disabled=${starting}>
              ${starting ? '...' : t('profile.agents.tasks.builder.startTask')}
            </button>
          `}
        </div>
        <div class="agd-builder-actions-right">
          <button class="btn-outline btn-sm" onClick=${onClose}>${t('profile.agents.tasks.builder.cancel')}</button>
        </div>
      </div>
    </div>
  `;
}
