/**
 * @file tab-messages.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Messages tab with command palette, "/" autocomplete, and chat area.
 *   Wraps the existing messages subtab and adds command discovery.
 * @version-history
 *   v2.0.1 -- 2026-09-22 -- The history scrolls inside its own frame again (Surface height="scroll"),
 *     so the newest message stays in view and the input stays under it; the message field carries a
 *     hidden label; the no-commands hint sits on its caption instead of a wrapping span.
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: the command palette is a Fold
 *     of ListRows, the threads are tab actions, a message is a box (the owner's on the sun, the
 *     agent's plain) with a caption under it, an option prompt is a row of tab actions, the
 *     autocomplete is a box of rows over the input, and the input is a Field beside the Send
 *     action. The reply marker is ↩ instead of ↳. The history no longer scrolls inside its own
 *     frame (no part carries a bounded scroll area yet). No behaviour change.
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
import { Stack, Fold, ListRow, Action, Text, Chip, Surface, Field, Toolbar } from '/components/poster-parts.js';

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
      <${Stack} direction="wrap" align="center" density="compact">
        <${Text} kind="label">${t('profile.agents.detail.messages.commands.title')}<//>
        <${Text} kind="caption" tone="muted" title=${t('profile.agents.detail.messages.commands.noCommandsHint')}>${t('profile.agents.detail.messages.commands.noCommands')}<//>
      <//>
    `;
  }

  return html`
    <${Fold} title=${t('profile.agents.detail.messages.commands.title')}
      sub=${`${commands.length} ${t('profile.agents.detail.messages.commands.available')}`}
      open=${expanded} onToggle=${() => setExpanded(!expanded)}>
      <${Stack} density="compact">
        ${Object.entries(categories).map(([cat, cmds]) => html`
          <${Stack} key=${cat} density="compact">
            <${Text} kind="label">${cat}<//>
            ${cmds.map(cmd => html`
              <${ListRow} key=${cmd.name} density="compact" name=${cmd.name}
                detail=${cmd.description || ''} detailKind="text"
                actions=${html`<${Action} kind="text" onClick=${() => onSend(cmd.name)}>
                  ${t('profile.agents.detail.messages.commands.send')}
                <//>`} />
            `)}
          <//>
        `)}
      <//>
    <//>
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
    const inbound = msg.direction === 'inbound';
    return html`
      <${Stack} key=${msg.id || msg.createdAt} density="compact" align=${inbound ? 'end' : 'start'}>
        <${Surface} kind="box" density="compact" tone=${inbound ? 'sun' : 'plain'}>
          ${isCommand && html`<${Chip}>${t('profile.agents.detail.messages.command')}<//>`}
          ${msg.direction === 'outbound'
            // Agent replies are markdown (LLM output). Render them safely via the
            // shared vnode Markdown component. Owner-typed inbound messages stay
            // literal — the input is a plain text field, not markdown.
            ? html`<${Markdown} text=${msg.content || ''} />`
            : html`<${Text}>${msg.content}<//>`}
          ${/* TARGET-058: whether a label is owed was decided on the server and lives in
                record.disclosure.required — AiLabel returns null when it is not. Inside the bubble,
                because Art. 50(5) asks for the mark at first exposure to the content it describes,
                not in a footer under the whole thread. */''}
          <${AiLabel} record=${msg.ai_provenance?.record}
                      recordUrl=${msg.ai_provenance?.record_url} variant="inline" />
        <//>
        ${msg.createdAt && html`<${Text} kind="caption" tone="muted">${fmtTime(msg.createdAt, { hour: '2-digit', minute: '2-digit' })} ${timeAgo(msg.createdAt)}<//>`}
        ${prompt && html`
          <${Stack} density="compact">
            <${Text}>${prompt.question}<//>
            <${Stack} direction="wrap" density="compact">
              ${prompt.options.map(opt => html`
                <${Action} key=${opt} kind="tab" selected=${answeredChoice === opt}
                  disabled=${locked || false}
                  onClick=${() => answerOption(prompt, msg.threadId, opt)}>${opt}<//>
              `)}
              ${prompt.allowOther !== false && html`
                <${Action} kind="tab" selected=${otherChosen}
                  disabled=${locked || false}
                  onClick=${() => chooseOther(prompt, msg.threadId)}>${t('profile.agents.messages.promptOther')}<//>
              `}
            <//>
          <//>
        `}
      <//>
    `;
  }

  if (loading && messages.length === 0) {
    return html`<${Stack}><${Text} tone="muted">${t('profile.loading')}<//><//>`;
  }

  return html`
    <${Stack}>
      <${CommandPalette} commands=${commands} onSend=${(cmd) => handleSend(cmd)} />

      ${meaningfulThreads.length > 0 && html`
        <${Stack} direction="wrap" density="compact">
          <${Action} kind="tab" selected=${!activeThread} onClick=${() => setActiveThread(null)}>
            ${t('profile.agents.messages.threads')}
          <//>
          ${(() => {
            // Collapse a long thread list behind a "show more" toggle, but always
            // keep the currently-selected thread visible even when collapsed.
            let visible = showAllThreads ? meaningfulThreads : meaningfulThreads.slice(0, THREAD_LIMIT);
            if (activeThread && !visible.some(th => th.threadId === activeThread)) {
              const active = meaningfulThreads.find(th => th.threadId === activeThread);
              if (active) visible = [active, ...visible];
            }
            return visible.map(thread => html`
              <${Action} key=${thread.threadId} kind="tab" selected=${activeThread === thread.threadId}
                      title=${thread.title || thread.lastMessage || ''}
                      onClick=${() => setActiveThread(thread.threadId)}>
                ${threadLabel(thread)}
              <//>
            `);
          })()}
          ${meaningfulThreads.length > THREAD_LIMIT && html`
            <${Action} kind="text" onClick=${() => setShowAllThreads(v => !v)}>
              ${showAllThreads
                ? t('profile.agents.messages.threadsShowLess')
                : t('profile.agents.messages.threadsShowMore', { count: meaningfulThreads.length - THREAD_LIMIT })}
            <//>
          `}
        <//>
      `}

      ${messages.length === 0 && !loading && html`
        <${Text} tone="muted">${t('profile.agents.detail.empty.messages')}<//>
      `}

      ${messages.length > 0 && html`
        <${Surface} kind="plain" height="scroll" surfaceRef=${historyRef}><${Stack} density="compact">
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
                  <${Stack} key=${msg.id || msg.createdAt} density="compact">
                    ${renderMessage(msg, true, false, null)}
                    <${Text} kind="mono" tone="muted">↩<//>
                    ${renderMessage(nextMsg, false, true, null)}
                  <//>
                `);
                i++;
              } else {
                rendered.push(renderMessage(msg, isCommand, false, promptCtxFor(msg)));
              }
            }
            return rendered;
          })()}
        <//><//>
      `}

      <${Stack} density="compact">
        ${showAutocomplete && filteredCommands.length > 0 && html`
          <${Surface} kind="box" density="compact">
            ${filteredCommands.map(cmd => html`
              <${ListRow} key=${cmd.name} density="compact" name=${cmd.name} onOpen=${() => selectCommand(cmd.name)}
                detail=${cmd.description || ''} detailKind="text" />
            `)}
          <//>
        `}
        <${Toolbar} actions=${html`<${Action} kind="primary" onClick=${() => handleSend()} disabled=${sending || !draft.trim()}>
            ${t('profile.agents.messages.send')}
          <//>`}>
          <${Field} type="textarea"
            inputRef=${inputRef}
            value=${draft}
            onInput=${handleInput}
            onKeyDown=${handleKeyDown}
            placeholder=${pendingPrompt ? t('profile.agents.messages.promptOtherPlaceholder') : t('profile.agents.detail.messages.placeholder')}
            ariaLabel=${t('profile.agents.detail.messages.placeholder')}
            rows=${1} />
        <//>
        <${Text} kind="caption" tone="muted">${t('profile.agents.detail.messages.hint')}<//>
      <//>
    <//>
  `;
}
