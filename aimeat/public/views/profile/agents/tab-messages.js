/**
 * @file tab-messages.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Messages tab with command palette, "/" autocomplete, and chat area.
 *   Wraps the existing messages subtab and adds command discovery.
 * @version-history
 *   v1.20.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.19.0 -- 2026-09-26 -- The field and Send are the chat's one row (.poster-composer): the field with the thick line under it and the dark block (a unification: Jouni's decision "Typing box").
 *   v1.18.0 -- 2026-09-26 -- A message is the chat's turn (components/Turn.js classes): your words bold on the sun, the other side's beside the pale coral spine, the name above the words, the time and the read marks under them with Copy and Listen, the other six actions behind one ⋯ (CardMenu inline); an agent's options are the chat's choices. The frame, the picture beside the other side, the action pill and the Chat tab's bubbles, pairing lines and small reader go; a suggested reply waiting for approval keeps its dashed box (a unification: Jouni's decision "Message").
 *   v1.17.0 -- 2026-09-26 -- A list of conversations is the chat's list (ThreadList's rows, .poster-thread): the name in bold, one quiet line with the time and the last message, the open one on the sun; a person's heading is its person tone (ThreadPerson) with the counts named; the row's archive square is the small icon button in the delete's place. Messages' rows, a broadcast's results list and an agent's Chat threads take it; their own row looks go (a unification: Jouni's decision "Conversation list").
 *   v1.16.0 -- 2026-09-26 -- Every line that says a part is loading is the loading line: the quiet sentence with the blinking Loading mark, LoadingLine in views/profile/shared.js (a unification: the look most tabs use).
 *   v1.15.0 -- 2026-09-26 -- The Chat tab's command palette is a folded row over the Listing (the command the inline code), no commands the quiet sentence, and Show more the action link's more tone (a unification: the look most tabs use).
 *   v1.14.0 -- 2026-09-25 -- A line that says there is nothing (none, and the more under the running tasks) is the quiet sentence (.poster-quiet); a place keeps only its margin (a unification: Jouni's decision Empty line).
 *   v1.13.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.12.0 -- 2026-09-25 -- Every time a thing happened wears .poster-time (Jouni's decision "Timestamp", a unification).
 *   v1.11.0 -- 2026-09-25 -- The headings over lists wear .poster-day-title, grey (--quiet) over a record (Jouni's decision "Group heading", a unification).
 *   v1.10.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.9.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control cut
 *     where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   2026-09-25 -- What chooses what a list or a panel shows is the tab (.poster-tab, with its fold and filter tones), a unification: Jouni's decision "Tabs and filters".
 *   v1.8.0 -- 2026-08-01 -- TARGET-058 Phase 9 step 0: the AI label renders inside the message bubble
 *     from the row's own `ai_provenance`. This is the surface where a model writes prose straight
 *     into a person's reading, and until the message carried a provenance column there was nothing
 *     to render it from. AiLabel decides for itself whether a label is owed; this call site does not.
 *   v1.7.0 -- 2026-07-16 -- Mount folds commands + threads + messages into GET /v1/agents/:name/messages/overview
 *     (getMessagesOverview); the [activeThread] effect skips its first run so the composite is the only
 *     initial load; individual reads kept as fallback.
 *   v1.6.0 -- 2026-06-10 -- Empty command palette is one quiet line ("Agent commands — none
 *     registered"), not an expandable empty box.
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
 *   v1.6.1 -- 2026-06-19 -- JSDoc type annotations for frontend type-checking
 */

import { h } from 'preact';
import { useState, useEffect, useRef, useMemo } from 'preact/hooks';
import htm from 'htm';
import { onLiveUpdate } from '/lib/live-updates.js';
import { t } from '/js/i18n.js';
import { timeAgo } from '/js/utils.js';
import { sendMessage, listMessages, listThreads, getMessagesOverview } from '/js/services/agent-messages.js';
import { getAgentCommands } from '/js/services/agent-integration.js';
import { Markdown } from '/components/Markdown.js';
import { AiLabel } from '/components/ai-label.js';
import { swallowed } from '/js/swallowed.js';
import { time as fmtTime } from '/js/format.js';

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

  // Hooks must run unconditionally before any early return (Rules of Hooks).
  const categories = useMemo(() => {
    const cats = {};
    for (const cmd of (commands || [])) {
      const cat = cmd.category || t('profile.agents.detail.messages.commands.defaultCategory');
      if (!cats[cat]) cats[cat] = [];
      cats[cat].push(cmd);
    }
    return cats;
  }, [commands]);

  if (!commands || commands.length === 0) {
    // No registered commands → one quiet line, not an expandable empty box.
    return html`
      <div class="poster-quiet pf-agd-commands--empty" title=${t('profile.agents.detail.messages.commands.noCommandsHint')}>
        <span>${t('profile.agents.detail.messages.commands.title')}</span>
        <span class="poster-quiet pf-agd-none-inline">${t('profile.agents.detail.messages.commands.noCommands')}</span>
      </div>
    `;
  }

  return html`
    <div class="pf-agd-commands">
      <button type="button" class="og-fold og-fold--event" aria-expanded=${expanded} onClick=${() => setExpanded(!expanded)}>
        <b>${t('profile.agents.detail.messages.commands.title')} (${commands.length} ${t('profile.agents.detail.messages.commands.available')})</b>
        <span class="og-fold-arrow">${expanded ? '↓' : '→'}</span>
      </button>
      ${expanded && html`
        <div class="pf-agd-commands-body">
          ${Object.entries(categories).map(([cat, cmds]) => html`
            <div key=${cat}>
              <div class="pf-agd-commands-category poster-day-title">${cat}</div>
              <div class="listing listing--cols listing--name-desc-doors">
              ${cmds.map(cmd => html`
                <div key=${cmd.name} class="listing-row">
                  <div class="listing-name"><code class="code-inline">${cmd.name}</code></div>
                  <div class="listing-desc">${cmd.description || ''}</div>
                  <div class="listing-doors"><button class="poster-action poster-action--small poster-action--row" onClick=${() => onSend(cmd.name)}>
                    ${t('profile.agents.detail.messages.commands.send')}
                  </button></div>
                </div>
              `)}
              </div>
            </div>
          `)}
        </div>
      `}
    </div>
  `;
}

export default function TabMessages({ agent, agentName, showToast }) {
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
  // The [activeThread] effect below also fires on mount; skip its first run so the mount composite is the
  // only thing that loads messages initially (it would otherwise double-load the page-1 history).
  const threadMounted = useRef(false);

  function applyCommands(value) {
    if (Array.isArray(value)) setCommands(value);
    else if (typeof value === 'string') { try { setCommands(JSON.parse(value)); } catch { setCommands([]); } }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
    else setCommands([]);
  }

  async function loadCommands() {
    try {
      const resp = await getAgentCommands(agentName, agent.gaii);
      const data = resp?.data?.value;
      if (Array.isArray(data)) setCommands(data);
      else if (typeof data === 'string') {
        try { setCommands(JSON.parse(data)); } catch { setCommands([]); }   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
      } else {
        setCommands([]);
      }
    // eslint-disable-next-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
    } catch { setCommands([]); }
  }

  async function loadMessages() {
    try {
      const opts = {};
      if (activeThread) opts.threadId = activeThread;
      const res = await listMessages(agentName, opts);
      setMessages(res?.data?.messages || []);
    } catch (err) { swallowed('tab-messages', err); setMessages([]); }
    setLoading(false);
  }

  async function loadThreads() {
    try {
      const res = await listThreads(agentName);
      setThreads(res?.data?.threads || []);
    } catch (err) { swallowed('tab-messages', err); setThreads([]); }
  }

  useEffect(() => {
    // Mount fold: ONE composite (commands + enriched threads + page-1 messages). On failure, fall back to
    // the individual reads. Reset the thread-mounted guard so the [activeThread] effect skips its first run
    // for this agent (the composite already seeded the messages).
    threadMounted.current = false;
    (async () => {
      const ov = await getMessagesOverview(agentName);
      if (ov) {
        applyCommands(ov.commands);
        setThreads(ov.threads || []);
        setMessages(ov.messages?.messages || []);
        setLoading(false);
        return;
      }
      loadCommands();
      loadThreads();
      loadMessages();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Full initial load on mount and when the agent changes; the loaders also close over activeThread, but re-keying on it would double-fetch (activeThread is handled by the effect below).
  }, [agentName]);

  useEffect(() => {
    // Reload messages when the active thread CHANGES; the first run (mount) is skipped because the mount
    // composite already loaded the page-1 history.
    if (!threadMounted.current) { threadMounted.current = true; return; }
    loadMessages();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread]);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- Re-subscribe when the agent or active thread changes; the callback reads the current loaders via closure (fresh for these deps).
  useEffect(() => onLiveUpdate(['agent-messages'], () => { loadMessages(); loadThreads(); loadCommands(); }), [agentName, activeThread]);

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
    const mine = msg.direction === 'inbound';
    // One message is the chat's turn (Jouni's decision "Message"): the owner's words on the sun, the
    // agent's beside the pale coral spine, the time under it. pf-agd-msg-bubble names the words' box
    // for the tests; it draws nothing of its own.
    return html`
      <div class="pf-agd-msg" key=${msg.id || msg.createdAt}>
        <div class=${`poster-turn poster-turn--${mine ? 'user' : 'agent'}`}>
          <div class="poster-turn-body pf-agd-msg-bubble">
            ${isCommand && html`<span class="poster-chip">${t('profile.agents.detail.messages.command')}</span>`}
            ${!mine
              // Agent replies are markdown (LLM output). Render them safely via the
              // shared vnode Markdown component. Owner-typed inbound messages stay
              // literal — the input is a plain text field, not markdown.
              ? html`<${Markdown} text=${msg.content || ''} />`
              : html`<p class="poster-turn-said">${msg.content}</p>`}
            ${/* TARGET-058: whether a label is owed was decided on the server and lives in
                  record.disclosure.required — AiLabel returns null when it is not. Inside the bubble,
                  because Art. 50(5) asks for the mark at first exposure to the content it describes,
                  not in a footer under the whole thread. */''}
            <${AiLabel} record=${msg.ai_provenance?.record}
                        recordUrl=${msg.ai_provenance?.record_url} variant="inline" />
          </div>
          ${msg.createdAt ? html`<div class="poster-time poster-turn-meta">
            <span>${fmtTime(msg.createdAt, { hour: '2-digit', minute: '2-digit' })}</span><span>${timeAgo(msg.createdAt)}</span>
          </div>` : null}
        </div>
        ${/* The agent's options are the chat's choices (the underlined words a person presses instead
              of typing); "Other" is one more, which hands the question to the field. The answer shows
              as the owner's own turn under it, as in the chat. The option classes name them for the
              tests; they draw nothing of their own. */''}
        ${prompt && html`
          <div class="agd-msg-prompt">
            <p class="agd-msg-prompt-q">${prompt.question}</p>
            <div class="poster-choices">
              ${prompt.options.map(opt => html`
                <button type="button" key=${opt}
                  class=${`btn-outline poster-suggestion agd-msg-prompt-option${answeredChoice === opt ? ' agd-msg-prompt-option--chosen' : ''}`}
                  disabled=${locked || false}
                  onClick=${() => answerOption(prompt, msg.threadId, opt)}
                >${opt}</button>
              `)}
              ${prompt.allowOther !== false && html`
                <button type="button"
                  class=${`btn-outline poster-suggestion agd-msg-prompt-option agd-msg-prompt-option--other${otherChosen ? ' agd-msg-prompt-option--chosen' : ''}`}
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
    return html`<div class="poster-quiet pf-agd-empty loading-mark">${t('profile.loading')}</div>`;
  }

  return html`
    <div>
      <${CommandPalette} commands=${commands} onSend=${(cmd) => handleSend(cmd)} />

      ${meaningfulThreads.length > 0 && html`
        <div class="pf-agd-msg-threads poster-thread-list">
          <div class=${'poster-thread' + (!activeThread ? ' poster-thread--active' : '')}>
            <button type="button" class="poster-thread-open" onClick=${() => setActiveThread(null)}>
              <span class="poster-thread-title">${t('profile.agents.messages.threads')}</span>
            </button>
          </div>
          ${(() => {
            // Collapse a long thread list behind a "show more" toggle, but always
            // keep the currently-selected thread visible even when collapsed.
            let visible = showAllThreads ? meaningfulThreads : meaningfulThreads.slice(0, THREAD_LIMIT);
            if (activeThread && !visible.some(th => th.threadId === activeThread)) {
              const active = meaningfulThreads.find(th => th.threadId === activeThread);
              if (active) visible = [active, ...visible];
            }
            return visible.map(thread => html`
              <div key=${thread.threadId} class=${'poster-thread' + (activeThread === thread.threadId ? ' poster-thread--active' : '')}>
                <button type="button" class="poster-thread-open"
                        title=${thread.title || thread.lastMessage || ''}
                        onClick=${() => setActiveThread(thread.threadId)}>
                  <span class="poster-thread-title">${threadLabel(thread)}</span>
                  <span class="poster-thread-sub">${thread.updatedAt ? fmtTime(thread.updatedAt, { hour: '2-digit', minute: '2-digit' }) + ' · ' : ''}${t('chat.turnCount', { n: String(thread.messageCount ?? 0) })}</span>
                </button>
              </div>
            `);
          })()}
          ${meaningfulThreads.length > THREAD_LIMIT && html`
            <button type="button" class="poster-action poster-action--more pf-agd-msg-thread-more"
                    onClick=${() => setShowAllThreads(v => !v)}>
              ${showAllThreads
                ? t('profile.agents.messages.threadsShowLess')
                : t('profile.agents.messages.threadsShowMore', { count: meaningfulThreads.length - THREAD_LIMIT })}
            </button>
          `}
        </div>
      `}

      ${messages.length === 0 && !loading && html`
        <div class="poster-quiet pf-agd-empty">${t('profile.agents.detail.empty.messages')}</div>
      `}

      ${messages.length > 0 && html`
        <div class="pf-agd-msg-history" ref=${historyRef}>
          ${(() => {
            const sorted = [...messages].sort((a, b) => +new Date(a.createdAt || 0) - +new Date(b.createdAt || 0));
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

      <div class="poster-composer poster-row--thing pf-agd-msg-input">
        <div class="poster-composer-row">
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
          <textarea class="poster-composer-input"
            ref=${inputRef}
            value=${draft}
            onInput=${handleInput}
            onKeyDown=${handleKeyDown}
            placeholder=${pendingPrompt ? t('profile.agents.messages.promptOtherPlaceholder') : t('profile.agents.detail.messages.placeholder')}
            rows="1"
          />
        </div>
        <button type="button" class="poster-slab poster-slab--control poster-composer-send" onClick=${() => handleSend()} disabled=${sending || !draft.trim()}>
          ${t('profile.agents.messages.send')}
        </button>
        </div>
      </div>
      <div class="pf-agd-msg-meta">${t('profile.agents.detail.messages.hint')}</div>
    </div>
  `;
}
