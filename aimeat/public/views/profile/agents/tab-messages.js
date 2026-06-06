/**
 * @file tab-messages.js
 * @description Messages tab with command palette, "/" autocomplete, and chat area.
 *   Wraps the existing messages subtab and adds command discovery.
 * @version-history
 *   v1.5.0 -- 2026-06-06 -- Thread buttons: fix field-name mismatch (use threadId/lastMessage from the
 *     API, not the non-existent id/title/preview) so selecting a thread actually filters and each
 *     button shows a real label. Label task-based threads by their task title, snippet others; collapse
 *     long lists behind a "show more" toggle (THREAD_LIMIT), always keeping the active thread visible.
 *   v1.4.0 -- 2026-06-02 -- Render agent (outbound) message bodies as Markdown via the
 *     shared safe vnode Markdown component, so LLM replies (bold, lists, code,
 *     tables) display formatted. Owner inbound messages stay literal text.
 *   v1.3.0 -- 2026-05-30 -- Render agent single-select option-prompts (metadata.prompt) as
 *     clickable chips + an implicit "Other"; clicking sends a correlated prompt_answer. A
 *     prompt locks (read-only, chosen chip highlighted) once a newer message exists.
 *   v1.2.0 -- 2026-05-24 -- Add command-reply visual pairing for slash commands
 *   v1.1.0 -- 2026-05-24 -- M7: visual distinction for command messages (slash prefix)
 *   v1.0.0 -- 2026-05-24 -- Initial creation for Agent Detail Tab-View
 */

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { sendMessage, listMessages, listThreads } from '/js/services/agent-messages.js';
import { getAgentCommands } from '/js/services/agent-integration.js';
import { Markdown } from '/components/Markdown.js';

const html = htm.bind(h);

// How many thread buttons to show before collapsing the rest behind "show more".
const THREAD_LIMIT = 6;

// A short, human-readable label for a thread button. Prefers the linked task's
// title (task-based threads), then a snippet of the last message, and only
// falls back to a generic label when neither exists.
function threadLabel(thread) {
  if (thread.title) return thread.title;
  const last = (thread.lastMessage || '').replace(/\s+/g, ' ').trim();
  if (last) return last.length > 28 ? last.slice(0, 28) + '…' : last;
  return t('profile.agents.messages.threadFallback');
}

function CommandPalette({ commands, onSend }) {
  const [expanded, setExpanded] = useState(false);

  if (!commands || commands.length === 0) {
    return html`
      <div class="pf-agd-commands">
        <div class="pf-agd-commands-header" onClick=${() => setExpanded(!expanded)}>
          <span>${t('profile.agents.detail.messages.commands.title')} (0)</span>
          <span>${expanded ? '▼' : '▶'}</span>
        </div>
        ${expanded && html`
          <div class="pf-agd-commands-body">
            <div class="pf-agd-empty">${t('profile.agents.detail.messages.commands.noCommands')}</div>
            <div class="pf-agd-empty-hint">${t('profile.agents.detail.messages.commands.noCommandsHint')}</div>
          </div>
        `}
      </div>
    `;
  }

  const categories = useMemo(() => {
    const cats = {};
    for (const cmd of commands) {
      const cat = cmd.category || t('profile.agents.detail.messages.commands.defaultCategory');
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(cmd);
    }
    return cats;
  }, [commands]);

  return html`
    <div class="pf-agd-commands">
      <div class="pf-agd-commands-header" onClick=${() => setExpanded(!expanded)}>
        <span>${t('profile.agents.detail.messages.commands.title')} (${commands.length} ${t('profile.agents.detail.messages.commands.available')})</span>
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
                    ${t('profile.agents.detail.messages.commands.send')}
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

export default function TabMessages({ agent, agentName, session, showToast }) {
  const [commands, setCommands] = useState([]);
  const [messages, setMessages] = useState([]);
  const [threads, setThreads] = useState([]);
  const [activeThread, setActiveThread] = useState(null);
  const [showAllThreads, setShowAllThreads] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  // When the owner clicks "Other" on an option-prompt, stage it here so the next
  // free-text send attaches a prompt_answer correlated to that prompt.
  const [pendingPrompt, setPendingPrompt] = useState(null); // { promptId, threadId } | null
  const historyRef = useRef(null);
  const inputRef = useRef(null);

  async function loadCommands() {
    try {
      const resp = await getAgentCommands(agentName, agent.gaii);
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
    const poller = setInterval(handler, 10000);
    return () => { window.removeEventListener('aimeat-live-update', handler); clearInterval(poller); };
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
      if (pendingPrompt) {
        // Owner is answering an option-prompt via free-text "Other".
        await sendMessage(agentName, msg, pendingPrompt.threadId, undefined, {
          prompt_answer: { prompt_id: pendingPrompt.promptId, choice: msg, is_other: true },
        });
        setPendingPrompt(null);
      } else {
        await sendMessage(agentName, msg, activeThread);
      }
      setDraft('');
      setShowAutocomplete(false);
      await loadMessages();
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.messages.sendError'), true);
    }
    setSending(false);
  }

  // Owner clicked one of the agent's listed options -> reply immediately with the
  // choice and a correlated prompt_answer (in the prompt's own thread).
  async function answerOption(prompt, threadId, choice) {
    setPendingPrompt(null);
    try {
      await sendMessage(agentName, choice, threadId, undefined, {
        prompt_answer: { prompt_id: prompt.promptId, choice, is_other: false },
      });
      await loadMessages();
    } catch (err) {
      showToast(err.message || t('profile.agents.detail.messages.sendError'), true);
    }
  }

  // Owner clicked "Other" -> stage the prompt and focus the chat input.
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

  // Only surface threads worth selecting: a task-linked thread (has a title) or a
  // real back-and-forth (more than one message). Single stray messages stay under
  // the "all" view rather than each becoming its own button.
  const meaningfulThreads = useMemo(
    () => threads.filter(thread => thread.title || thread.messageCount > 1),
    [threads],
  );

  function selectCommand(cmdName) {
    setDraft(cmdName);
    setShowAutocomplete(false);
  }

  function renderMessage(msg, isCommand, isReply, promptCtx) {
    const prompt = msg.metadata?.prompt || null;
    // promptCtx = { locked, answeredChoice } derived once over the full thread.
    const locked = promptCtx?.locked || false;
    const answeredChoice = promptCtx?.answeredChoice ?? null;
    const otherChosen = prompt && answeredChoice != null && !prompt.options.includes(answeredChoice);
    return html`
      <div key=${msg.id || msg.createdAt}>
        <div class="pf-agd-msg-bubble ${msg.direction === 'inbound' ? 'pf-agd-msg-inbound' : 'pf-agd-msg-outbound'} ${isCommand ? 'pf-agd-msg-command' : ''} ${isReply ? 'pf-agd-msg-reply' : ''}">
          ${isCommand && html`<span class="pf-agd-command-badge">${t('profile.agents.detail.messages.command')}</span>`}
          ${msg.direction === 'outbound'
            // Agent replies are markdown (LLM output). Render them safely via the
            // shared vnode Markdown component. Owner-typed inbound messages stay
            // literal — the input is a plain text field, not markdown.
            ? html`<${Markdown} text=${msg.content || ''} />`
            : msg.content}
        </div>
        <div class="pf-agd-msg-meta ${msg.direction === 'inbound' ? 'pf-agd-msg-meta-right' : ''}">
          ${msg.createdAt ? html`<span class="pf-agd-msg-time">${new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> ${timeAgo(msg.createdAt)}` : ''}
        </div>
        ${prompt && html`
          <div class="agd-msg-prompt">
            <div class="agd-msg-prompt-q">${prompt.question}</div>
            <div class="agd-msg-prompt-options">
              ${prompt.options.map(opt => html`
                <button
                  key=${opt}
                  class="agd-msg-prompt-option ${answeredChoice === opt ? 'agd-msg-prompt-option--chosen' : ''}"
                  disabled=${locked || false}
                  onClick=${() => answerOption(prompt, msg.threadId, opt)}
                >${opt}</button>
              `)}
              ${prompt.allowOther !== false && html`
                <button
                  class="agd-msg-prompt-option agd-msg-prompt-option--other ${otherChosen ? 'agd-msg-prompt-option--chosen' : ''}"
                  disabled=${locked || false}
                  onClick=${() => chooseOther(prompt, msg.threadId)}
                >${t('profile.agents.messages.promptOther')}</button>
              `}
            </div>
          </div>
        `}
      </div>
    `;
  }

  if (loading && messages.length === 0) {
    return html`<div class="pf-agd-empty">${t('profile.loading')}</div>`;
  }

  return html`
    <div>
      <${CommandPalette} commands=${commands} onSend=${(cmd) => handleSend(cmd)} />

      ${meaningfulThreads.length > 0 && html`
        <div class="pf-agd-msg-threads">
          <button class="pf-agd-msg-thread-btn ${!activeThread ? 'pf-agd-msg-thread-btn-active' : ''}"
                  onClick=${() => setActiveThread(null)}>
            ${t('profile.agents.messages.threads')}
          </button>
          ${(() => {
            // Collapse a long thread list behind a "show more" toggle, but always
            // keep the currently-selected thread visible even when collapsed.
            let visible = showAllThreads ? meaningfulThreads : meaningfulThreads.slice(0, THREAD_LIMIT);
            if (activeThread && !visible.some(th => th.threadId === activeThread)) {
              const active = meaningfulThreads.find(th => th.threadId === activeThread);
              if (active) visible = [active, ...visible];
            }
            return visible.map(thread => html`
              <button key=${thread.threadId}
                      class="pf-agd-msg-thread-btn ${activeThread === thread.threadId ? 'pf-agd-msg-thread-btn-active' : ''}"
                      title=${thread.title || thread.lastMessage || ''}
                      onClick=${() => setActiveThread(thread.threadId)}>
                ${threadLabel(thread)}
              </button>
            `);
          })()}
          ${meaningfulThreads.length > THREAD_LIMIT && html`
            <button class="pf-agd-msg-thread-btn pf-agd-msg-thread-more"
                    onClick=${() => setShowAllThreads(v => !v)}>
              ${showAllThreads
                ? t('profile.agents.messages.threadsShowLess')
                : t('profile.agents.messages.threadsShowMore', { count: meaningfulThreads.length - THREAD_LIMIT })}
            </button>
          `}
        </div>
      `}

      ${messages.length === 0 && !loading && html`
        <div class="pf-agd-empty">${t('profile.agents.detail.empty.messages')}</div>
      `}

      ${messages.length > 0 && html`
        <div class="pf-agd-msg-history" ref=${historyRef}>
          ${(() => {
            const sorted = [...messages].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
            // An option-prompt is answerable only while it is the newest message
            // in its thread (any later message locks it). Map each thread to its
            // last message id, and each prompt_id to the owner's chosen text.
            const lastIdByThread = {};
            for (const m of sorted) lastIdByThread[m.threadId] = m.id;
            const answeredByPromptId = {};
            for (const m of sorted) {
              const pa = m.metadata?.promptAnswer;
              if (pa?.promptId) answeredByPromptId[pa.promptId] = pa.choice;
            }
            const promptCtxFor = (msg) => {
              const pid = msg.metadata?.prompt?.promptId;
              if (!pid) return null;
              return {
                locked: lastIdByThread[msg.threadId] !== msg.id,
                answeredChoice: answeredByPromptId[pid] ?? null,
              };
            };
            const rendered = [];
            for (let i = 0; i < sorted.length; i++) {
              const msg = sorted[i];
              const isCommand = msg.content?.startsWith('/') && msg.direction === 'inbound';
              const nextMsg = sorted[i + 1];
              // Don't pair when the message carries an option-prompt -- the chips
              // belong directly under it, not in a command/reply pair.
              const hasReply = isCommand && nextMsg && nextMsg.direction === 'outbound' && !nextMsg.metadata?.prompt;

              if (hasReply) {
                rendered.push(html`
                  <div class="pf-agd-msg-pair" key=${msg.id || msg.createdAt}>
                    ${renderMessage(msg, true, false, null)}
                    <div class="pf-agd-msg-reply-indicator">↳</div>
                    ${renderMessage(nextMsg, false, true, null)}
                  </div>
                `);
                i++;
              } else {
                rendered.push(renderMessage(msg, isCommand, false, promptCtxFor(msg)));
              }
            }
            return rendered;
          })()}
        </div>
      `}

      <div class="pf-agd-msg-input">
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
            ref=${inputRef}
            value=${draft}
            onInput=${handleInput}
            onKeyDown=${handleKeyDown}
            placeholder=${pendingPrompt ? t('profile.agents.messages.promptOtherPlaceholder') : t('profile.agents.detail.messages.placeholder')}
            rows="1"
          />
        </div>
        <button class="btn-primary btn-sm" onClick=${() => handleSend()} disabled=${sending || !draft.trim()}>
          ${t('profile.agents.messages.send')}
        </button>
      </div>
      <div class="pf-agd-msg-meta">${t('profile.agents.detail.messages.hint')}</div>
    </div>
  `;
}
