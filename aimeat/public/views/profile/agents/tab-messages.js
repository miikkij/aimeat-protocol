/**
 * @file tab-messages.js
 * @description Messages tab with command palette, "/" autocomplete, and chat area.
 *   Wraps the existing messages subtab and adds command discovery.
 * @version-history
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { sendMessage, listMessages, listThreads } from '/js/services/agent-messages.js';
import { getAgentCommands } from '/js/services/agent-integration.js';

const html = htm.bind(h);

function CommandPalette({ commands, onSend }) {
  const [expanded, setExpanded] = useState(true);

  if (!commands || commands.length === 0) {
    return html`
      <div class="pf-agd-commands">
        <div class="pf-agd-commands-header" onClick=${() => setExpanded(!expanded)}>
          <span>${t('profile.agents.detail.commands.title')} (0)</span>
          <span>${expanded ? '▼' : '▶'}</span>
        </div>
        ${expanded && html`
          <div class="pf-agd-commands-body">
            <div class="agd-empty">${t('profile.agents.detail.commands.noCommands')}</div>
          </div>
        `}
      </div>
    `;
  }

  const categories = useMemo(() => {
    const cats = {};
    for (const cmd of commands) {
      const cat = cmd.category || t('profile.agents.detail.commands.defaultCategory');
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(cmd);
    }
    return cats;
  }, [commands]);

  return html`
    <div class="pf-agd-commands">
      <div class="pf-agd-commands-header" onClick=${() => setExpanded(!expanded)}>
        <span>${t('profile.agents.detail.commands.title')} (${commands.length} ${t('profile.agents.detail.commands.available')})</span>
        <span>${expanded ? '▼' : '▶'}</span>
      </div>
      ${expanded && html`
        <div class="pf-agd-commands-body">
          ${Object.entries(categories).map(([cat, cmds]) => html`
            <div key=${cat}>
              <div class="pf-agd-commands-category">${cat}</div>
              ${cmds.map(cmd => html`
                <div key=${cmd.name} class="pf-agd-command-row">
                  <span class="pf-agd-command-name">${cmd.name}</span>
                  <span class="pf-agd-command-desc">${cmd.description || ''}</span>
                  <button class="btn-outline btn-sm" onClick=${() => onSend(cmd.name)}>
                    ${t('profile.agents.detail.commands.send')}
                  </button>
                </div>
              `)}
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}

export default function TabMessages({ agentName, session, showToast }) {
  const [commands, setCommands] = useState([]);
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const historyRef = useRef(null);

  async function loadCommands() {
    try {
      const resp = await getAgentCommands(agentName);
      const data = resp?.data?.value;
      if (Array.isArray(data)) setCommands(data);
      else if (typeof data === 'string') {
        try { setCommands(JSON.parse(data)); } catch { setCommands([]); }
      } else {
        setCommands([]);
      }
    } catch { setCommands([]); }
  }

  async function loadMessages() {
    try {
      const opts = {};
      if (activeThread) opts.threadId = activeThread;
      const res = await listMessages(agentName, opts);
      setMessages(res?.data?.messages || []);
    } catch { setMessages([]); }
    setLoading(false);
  }

  async function loadThreads() {
    try {
      const res = await listThreads(agentName);
      setThreads(res?.data?.threads || []);
    } catch { setThreads([]); }
  }

  useEffect(() => {
    loadCommands();
    loadThreads();
    loadMessages();
  }, [agentName]);

  useEffect(() => { loadMessages(); }, [activeThread]);

  useEffect(() => {
    const handler = () => { loadMessages(); loadThreads(); loadCommands(); };
    window.addEventListener('aimeat-live-update', handler);
    return () => window.removeEventListener('aimeat-live-update', handler);
  }, [agentName, activeThread]);

  useEffect(() => {
    if (historyRef.current) {
      historyRef.current.scrollTop = historyRef.current.scrollHeight;
    }
  }, [messages]);

  async function handleSend(text) {
    const msg = text || draft.trim();
    if (!msg) return;
    setSending(true);
    try {
      await sendMessage(agentName, msg, activeThread);
      setDraft('');
      setShowAutocomplete(false);
      await loadMessages();
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.messages.sendError'), true);
    }
    setSending(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e) {
    const val = e.target.value;
    setDraft(val);
    setShowAutocomplete(val.startsWith('/') && commands.length > 0);
  }

  const filteredCommands = useMemo(() => {
    if (!draft.startsWith('/')) return [];
    const search = draft.toLowerCase();
    return commands.filter(c => c.name.toLowerCase().startsWith(search));
  }, [draft, commands]);

  function selectCommand(cmdName) {
    setDraft(cmdName);
    setShowAutocomplete(false);
  }

  if (loading && messages.length === 0) {
    return html`<div class="agd-empty">${t('profile.loading')}</div>`;
  }

  return html`
    <div>
      <${CommandPalette} commands=${commands} onSend=${(cmd) => handleSend(cmd)} />

      ${threads.length > 0 && html`
        <div class="agd-msg-threads">
          <button class="agd-msg-thread-btn ${!activeThread ? 'agd-msg-thread-btn-active' : ''}"
                  onClick=${() => setActiveThread(null)}>
            ${t('profile.agents.messages.threads')}
          </button>
          ${threads.map(thread => html`
            <button key=${thread.id}
                    class="agd-msg-thread-btn ${activeThread === thread.id ? 'agd-msg-thread-btn-active' : ''}"
                    onClick=${() => setActiveThread(thread.id)}>
              ${thread.title || thread.id?.slice(0, 8) || '...'}
            </button>
          `)}
        </div>
      `}

      ${messages.length === 0 && !loading && html`
        <div class="agd-empty">${t('profile.agents.detail.empty.messages')}</div>
      `}

      ${messages.length > 0 && html`
        <div class="agd-msg-history" ref=${historyRef}>
          ${[...messages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)).map(msg => html`
            <div key=${msg.id || msg.createdAt}>
              <div class="agd-msg-bubble ${msg.direction === 'inbound' ? 'agd-msg-inbound' : 'agd-msg-outbound'}">
                ${msg.content}
              </div>
              <div class="agd-msg-meta ${msg.direction === 'inbound' ? 'agd-msg-meta-right' : ''}">
                ${msg.createdAt ? html`<span class="agd-msg-time">${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> ${timeAgo(msg.createdAt)}` : ''}
              </div>
            </div>
          `)}
        </div>
      `}

      <div class="agd-msg-input">
        <div class="pf-agd-input-wrap">
          ${showAutocomplete && filteredCommands.length > 0 && html`
            <div class="pf-agd-autocomplete">
              ${filteredCommands.map(cmd => html`
                <div key=${cmd.name} class="pf-agd-autocomplete-item" onClick=${() => selectCommand(cmd.name)}>
                  <span class="pf-agd-command-name">${cmd.name}</span>
                  <span class="pf-agd-command-desc">${cmd.description || ''}</span>
                </div>
              `)}
            </div>
          `}
          <textarea
            value=${draft}
            onInput=${handleInput}
            onKeyDown=${handleKeyDown}
            placeholder=${t('profile.agents.detail.messages.placeholder')}
            rows="1"
          />
        </div>
        <button class="btn-primary btn-sm" onClick=${() => handleSend()} disabled=${sending || !draft.trim()}>
          ${t('profile.agents.messages.send')}
        </button>
      </div>
      <div class="agd-msg-meta">${t('profile.agents.detail.messages.hint')}</div>
    </div>
  `;
}
