/**
 * @file agents-task-builder.js
 * @description Split-panel task creation builder with Living Proposal (3 tabs)
 *   and chat panel. Implements the design spec's conversational task creation flow:
 *   user describes what they want -> agent proposes plan -> user reviews and starts.
 * @structure
 *   - TaskCreationBuilder (default export) -- main split-panel component
 *   - ProposalPanel -- left panel with Requirements/TODO/Technical tabs
 *   - BuilderChat -- right panel with task-scoped messaging
 * @version-history
 *   v1.0.0 -- 2026-05-22 -- Initial creation per design spec Part 1
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { createTask, getTask, startTask } from '/js/services/agent-tasks.js';
import { sendMessage, listMessages } from '/js/services/agent-messages.js';

const PROPOSAL_TABS = ['requirements', 'todo', 'technical'];

function ProposalPanel({ task, taskId }) {
  const [activeTab, setActiveTab] = useState('requirements');

  const tabBar = html`
    <div class="agd-proposal-tabs">
      ${PROPOSAL_TABS.map(tab => html`
        <button key=${tab}
          class="agd-proposal-tab ${activeTab === tab ? 'agd-proposal-tab-active' : ''}"
          onClick=${() => setActiveTab(tab)}>
          ${t(`profile.agents.tasks.builder.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
        </button>
      `)}
    </div>
  `;

  if (!taskId) {
    return html`<div class="agd-proposal">
      ${tabBar}
      <div class="agd-proposal-content">
        <div class="agd-builder-analyzing">${t('profile.agents.tasks.builder.initial')}</div>
      </div>
    </div>`;
  }

  if (!task) {
    return html`<div class="agd-proposal">
      ${tabBar}
      <div class="agd-proposal-content">
        <div class="agd-builder-analyzing">${t('profile.agents.tasks.builder.analyzing')}</div>
      </div>
    </div>`;
  }

  const hasTodos = task.todos && task.todos.length > 0;
  const hasScope = task.scope && task.scope.length > 0;
  const hasRules = task.rules && task.rules.length > 0;
  const hasVerification = task.verification?.userExpects || (task.verification?.technicalChecks?.length > 0);
  const hasResources = task.resources && (
    task.resources.knowledgePackages?.length > 0 ||
    task.resources.memoryKeys?.length > 0 ||
    task.resources.memoryPrefixes?.length > 0
  );
  const hasProposal = hasTodos || hasScope || hasRules || hasVerification;

  const noData = html`<div class="agd-prop-empty">${t('profile.agents.tasks.builder.noDataYet')}</div>`;

  return html`
    <div class="agd-proposal">
      <div class="agd-proposal-tabs">
        ${PROPOSAL_TABS.map(tab => html`
          <button key=${tab}
            class="agd-proposal-tab ${activeTab === tab ? 'agd-proposal-tab-active' : ''}"
            onClick=${() => setActiveTab(tab)}>
            ${t(`profile.agents.tasks.builder.tab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)}
          </button>
        `)}
      </div>

      <div class="agd-proposal-content">
        ${activeTab === 'requirements' && html`
          <div class="agd-prop-section">
            <div class="agd-prop-label">${t('profile.agents.tasks.builder.whatItDoes')}</div>
            <div class="agd-prop-value">${task.description || task.title}</div>
          </div>

          ${hasScope ? html`
            <div class="agd-prop-section">
              <div class="agd-prop-label">${t('profile.agents.tasks.builder.scope')}</div>
              ${task.scope.map(s => html`
                <div class="agd-scope-item" key=${s.name}>
                  <span class="agd-scope-name">${s.description || s.name}</span>
                  <span class="agd-prop-code">${s.value}</span>
                  <span class="agd-scope-type">${s.type}</span>
                </div>
              `)}
            </div>
          ` : ''}

          ${hasRules ? html`
            <div class="agd-prop-section">
              <div class="agd-prop-label">${t('profile.agents.tasks.builder.rules')}</div>
              <ul class="agd-prop-list">
                ${task.rules.map((r, i) => html`<li key=${i}>${r}</li>`)}
              </ul>
            </div>
          ` : ''}

          ${hasVerification ? html`
            <div class="agd-prop-section">
              <div class="agd-prop-label">${t('profile.agents.tasks.builder.verification')}</div>
              ${task.verification.userExpects && html`
                <div class="agd-prop-check">${task.verification.userExpects}</div>
              `}
              ${task.verification.technicalChecks?.map((c, i) => html`
                <div class="agd-prop-check" key=${i}><span class="agd-prop-code">${c}</span></div>
              `)}
            </div>
          ` : ''}

          ${!hasProposal ? html`
            <div class="agd-builder-analyzing">${t('profile.agents.tasks.builder.waitingTodos')}</div>
          ` : ''}
        `}

        ${activeTab === 'todo' && html`
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
        `}

        ${activeTab === 'technical' && html`
          ${hasScope && task.scope.filter(s => s.type === 'cron').length > 0 ? html`
            <div class="agd-prop-section">
              <div class="agd-prop-label">${t('profile.agents.tasks.builder.cronSchedules')}</div>
              ${task.scope.filter(s => s.type === 'cron').map(s => html`
                <div key=${s.name}><span class="agd-prop-code">${s.value}</span> -- ${s.name}</div>
              `)}
            </div>
          ` : ''}

          ${task.verification?.technicalChecks?.length > 0 ? html`
            <div class="agd-prop-section">
              <div class="agd-prop-label">${t('profile.agents.tasks.builder.technicalChecks')}</div>
              ${task.verification.technicalChecks.map((c, i) => html`
                <div key=${i} class="agd-prop-code" style="margin-bottom:0.25rem">${c}</div>
              `)}
            </div>
          ` : ''}

          ${hasResources ? html`
            <div class="agd-prop-section">
              <div class="agd-prop-label">${t('profile.agents.tasks.builder.resources')}</div>
              ${task.resources.memoryKeys?.map(k => html`
                <div key=${k}><span class="agd-prop-code">${k}</span></div>
              `)}
              ${task.resources.memoryPrefixes?.map(p => html`
                <div key=${p}><span class="agd-prop-code">${p}*</span></div>
              `)}
              ${task.resources.knowledgePackages?.map(p => html`
                <div key=${p}>${p}</div>
              `)}
            </div>
          ` : ''}

          ${!hasScope && !hasResources && !(task.verification?.technicalChecks?.length > 0) ? noData : ''}
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
      <div class="agd-builder-chat-input">
        <textarea
          value=${draft}
          onInput=${(e) => setDraft(e.target.value)}
          onKeyDown=${handleKeyDown}
          placeholder=${placeholder}
          rows="1"
        />
        <button class="btn-primary btn-sm" onClick=${handleSend} disabled=${sending || !draft.trim()}>
          ${taskId ? t('profile.agents.messages.send') : t('profile.agents.tasks.builder.send')}
        </button>
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
      const resp = await createTask(agentName, { title: text, status: 'queued' });
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
