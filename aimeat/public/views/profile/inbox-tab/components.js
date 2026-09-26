/**
 * @file public/views/profile/inbox-tab/components.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Presentational sub-components for the profile Inbox tab: MarkdownViewer, PollBuilder,
 *   CommandBar/CommandFill (agent chat.commands), SchedulePanel (own-agent scheduler),
 *   ReplyWithAiPopover (TARGET-031) and ConversationToNotebookPopover. Each is self-contained (owns
 *   its own hooks). MessageBubble (./message-turn.js) and Avatar (components/Avatar.js) are
 *   re-exported from here; the composer is the Composer component's message tone
 *   (components/Composer.js, tone="message"). Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
 *   v1.31.0 -- 2026-09-26 -- Written on components only (no class): the poll builder's questions are Boxes
 *     of TextFields and Checks; the command bar and fill and the schedule are the pane's strips
 *     (ConversationPane PaneStrip) with the field family's controls, the command a Mark that is a
 *     button, the jobs a dense List; the popovers' ways are Tabs and their panel the edge Box.
 *   v1.30.0 -- 2026-09-26 -- The composer moved into the Composer component as its message tone
 *     (components/MessageComposer.js), with main's layout back: the field over the whole width, its
 *     tools under it. Avatar is the Avatar component. The ways on are the kit
 *     (components/Action.js Action, Loud, Icon; Note for the hints and the quiet lines): this file
 *     writes no action, hint or quiet class of its own.
 *   v1.29.0 -- 2026-09-26 -- The typing box is the chat's one row (.poster-composer, its stacked cut): the thin field with the thick line under it, attach, voice and the bigger editor as three framed squares, and the dark block that sends with its own word; on a phone the field keeps the whole width and the rest goes under it (a unification: Jouni's decision "Typing box").
 *   v1.28.0 -- 2026-09-26 -- MessageBubble and AttachmentItem moved to ./message-turn.js, where a message is the chat's turn (a unification: Jouni's decision "Message"); re-exported from here.
 *   v1.27.0 -- 2026-09-25 -- Every drop-down is the Select field (.select-field, css/components/select-field.css); a place keeps only its width and margin (a unification: the look most tabs use).
 *   v1.27.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.27.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.26.0 -- 2026-09-25 -- Every many-line field is the Text area (.og-textarea); a place keeps only its size and margin (a unification: the look most tabs use).
 *   v1.26.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.25.0 -- 2026-09-25 -- Every one-line field is the Text field (.og-input); a place keeps only its layout (a unification: the look most tabs use).
 *   v1.24.0 -- 2026-09-25 -- A picture of a person or a thing is the Object box's avatar cut (.poster-box--avatar), the look most Settings tabs draw (UI consolidation phase 5, a unification).
 *   v1.23.0 -- 2026-09-25 -- Every word that says a state is the Status (.poster-status fine, attention, danger, off), a unification: Jouni's decision Status.
 *   v1.22.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   v1.21.0 -- 2026-09-25 -- Every hint is the Hint (poster-hint, components/Hint.js), the look most Settings & Controls tabs draw (UI consolidation phase 5, a unification).
 *   v1.20.0 -- 2026-09-25 -- The row labels (field and key labels, column heads, box labels) wear .poster-label (Jouni's decision "Row label", a unification).
 *   v1.19.0 -- 2026-09-25 -- A button that is a mark, not a word (a delete or close mark, a menu's
 *     dots, an arrow), is the library's small icon button, .poster-icon.poster-icon--small (Jouni's
 *     decision "Icon button").
 *   v1.18.0 -- 2026-09-25 -- Every quiet way on is the library's action link, .poster-action, with the
 *     tone its meaning names: more for "show all" and more of a list, back, text for a plain grey
 *     word, quiet (Jouni's decisions "Action link", "Panel action", "Dismiss", "Small link", "Step
 *     button").
 *   v1.17.0 -- 2026-09-25 -- The loud action is the library's dark block, .poster-slab: the control
 *     cut where it sits in a row of controls or waits to be enabled, the danger tone for a delete that
 *     cannot be undone (Jouni's decision "Loud action").
 *   2026-09-25 -- The lines that say a list is empty (or has nothing to show yet) are the quiet sentence (.poster-quiet, QuietNote), a unification: Jouni's decision "Empty line".
 *   v1.16.0 -- 2026-09-13 -- Compose inbox top rules from poster.css.
 *   v1.15.0 — 2026-09-13 — The markdown viewer and the two AI popovers open in the site's one dialog
 *     (components/Modal.js) instead of overlays of their own; their modes are poster tabs, and what
 *     the chosen one decides sits under the sun bar.
 *   v1.14.0 — 2026-09-08 — A bubble says when a model wrote it, not only which model. The node has
 *     served `ai` on every message since August, and the inbox read only `ai.model` — so an agent's
 *     message that named no model looked exactly like one a person typed, on the surface Article 50
 *     cares most about. A message with no record still shows nothing, because absence is unstated.
 *     AttachmentItem's unavailable chip says what happened and whose move is next instead of naming
 *     the machine's state ("attachment pending").
 *   v1.13.0 — 2026-08-29 — MessageBubble names its writer (`who`) above the body, so a bubble reads
 *     without the avatar and the sun of one's own bubbles carries no ambiguity.
 *   v1.12.0 — 2026-08-18 — The composer opens as the thin auto-growing line on every screen, the way a
 *     chat works, and ⤢ swaps in the full editor with the draft carried both ways. Toast UI is not even
 *     loaded until asked. Each branch of the composer body carries a key: without them Preact reused the
 *     editor div as the button row and its inline height rode along.
 *   v1.11.0 — 2026-08-01 — Voice messages. AttachmentItem hands an audio attachment to AudioAttachment
 *     (./voice-parts.js) so it plays in the bubble instead of opening in a browser tab, which is a
 *     download and not a conversation. The Composer gains a 🎤 recorder feeding the SAME attachment
 *     queue as 📎 (one upload path), and a recording's chip carries a player + its length so a bad
 *     take is caught here rather than in the other person's mailbox.
 *   v1.10.0 — 2026-07-31 — MessageBubble gets a 🔊 read-aloud action (BubbleSpeakButton from
 *     ./read-aloud.js): speaks that one message via the Web Speech API, like the Sanomat app's per-article
 *     "Puhu". Hidden when the browser can't speak or the message has no speakable body.
 *   v1.9.0 — 2026-07-25 — MessageBubble gets a ⧉ copy action next to the other bubble buttons: copies the
 *     message's raw markdown to the clipboard (✓ for ~1.6s as feedback).
 *   v1.8.0 — 2026-07-21 — MessageBubble renders link-preview cards under the body (MessageLinkPreviews),
 *     gated by the `showLinkPreviews` prop (the persisted thread-head toggle).
 *   v1.0.0 — 2026-07-13 — Extracted from inbox-tab.js (max-file-lines)
 *   v1.1.0 — 2026-07-14 — Composer: pasted/dropped images route to the file-attachment path (upload +
 *     shown as an image) instead of Toast UI base64-inlining them into the body (which blew the 50k
 *     body limit → 400 "Too big"). addImageBlobHook (rich) + onPaste (markdown fallback).
 *   v1.2.0 — 2026-07-17 — Two paste-image fixes: (1) MessageBubble looks up attachment urls via the new
 *     `${messageId}::${attachmentId}` composite key so images no longer bleed between messages; (2) pasted
 *     clipboard images (always named "image.png") get a unique name instead of every paste sharing one.
 *   v1.3.0 — 2026-07-17 — Reply-to with quote: a ↩ bubble action starts a quoted reply, and a bubble whose
 *     message carries `replyToId` renders the quoted original (sender + excerpt; click jumps to it).
 *   v1.3.1 — 2026-07-17 — Composer file chips get a ✕ — a queued (e.g. mis-pasted) attachment can be
 *     removed before sending instead of being stuck in the outgoing message.
 *   v1.4.0 — 2026-07-18 — Composer accepts a `focusNonce`: bumping it focuses the editor (rich .focus() or
 *     the fallback textarea) so clicking ↩ Reply on a bubble drops the cursor straight into the input.
 *   v1.5.0 — 2026-07-18 — Mobile composer is a plain auto-growing textarea (`mode:'simple'`, no Toast UI
 *     toolbar/Write-Preview/WYSIWYG — a phone keyboard + heavy WYSIWYG is miserable); ≤760px opens straight
 *     into it so Toast UI never even loads there. Desktop keeps the rich editor.
 *   v1.6.0 — 2026-07-19 — Composer gets an expand toggle (⤢/⤡): enlarges the editor to ~60% of the
 *     viewport so long/formatted drafts are fully visible. Rich mode resizes via Toast UI `setHeight`;
 *     the markdown fallback + simple textarea grow via the `.inbox-composer--tall` class / lifted cap.
 *   v1.8.0 — 2026-08-01 — TARGET-058 Phase 3: the generated conversation summary carries a standing
 *     "a model wrote this draft" notice with a link to its provenance record.
 *   v1.7.0 — 2026-07-19 — ConversationToNotebookPopover: capture a whole thread (with images) into the
 *     Notebook via three modes — server-side AI summary (owner's key), copy-prompt (own chat), or raw.
 *   v1.12.0 — 2026-08-08 — All three copy affordances are shared <CopyButton>s: the two AI-popover buttons (which each
 *       hand-rolled a navigator.clipboard + execCommand ladder) and the message bubble's icon-only
 *       ⧉, which uses the new ariaLabel/copiedTitle props so an icon keeps its screen-reader name.
 */
import { h } from 'preact';
import { useState, useEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import { Modal } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import { AiInteractionNotice } from '/components/ai-label.js';
import { Action, Loud, Icon } from '/components/Action.js';
import { Mark, Label } from '/components/Mark.js';
import { Note } from '/components/Note.js';
import { Box } from '/components/Box.js';
import { Tabs } from '/components/Tabs.js';
import { TextField, TextArea } from '/components/TextField.js';
import { Select } from '/components/Select.js';
import { Check } from '/components/Check.js';
import { FormActions } from '/components/Field.js';
import { Stack, Row } from '/components/Layout.js';
import { List, Row as ListRow, Name, Cell } from '/components/List.js';
import { PaneStrip } from '/components/ConversationPane.js';
import * as schedules from '/js/services/schedules.js';
import { MODES } from '/js/services/messages-ai-prompts.js';
import { swallowed } from '/js/swallowed.js';
// A message is the Message component, given its data in ./message-turn.js; the name stays reachable
// from here for the pages that take it from this file. A picture of a person is the Avatar component
// (components/Avatar.js), under the name this page has always used.
export { MessageBubble } from './message-turn.js';
export { Avatar } from '/components/Avatar.js';


/** In-app viewer for a markdown attachment — browsers don't render .md, so we fetch the (same-origin,
 *  presigned) file and render it with the shared safe Markdown component. Offers open-raw + download. */
export function MarkdownViewer({ url, name, onClose }) {
  const [text, setText] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch(url).then(r => r.ok ? r.text() : Promise.reject(new Error('http'))).then(tx => { if (alive) setText(tx); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url]);
  return html`
    <${Modal} open=${true} onClose=${onClose} title=${name} size="lg" guard=${false}
      footer=${html`
        <${Action} href=${url} newTab>${t('inbox.attachmentOpenRaw')}<//>
        <${Action} href=${url} download=${name}>${t('inbox.attachmentDownload')}<//>`}>
      ${failed ? html`<${Note} kind="quiet">${t('inbox.attachmentLoadError')}<//>`
        : text === null ? html`<${Note} kind="quiet">…<//>`
        : html`<${Markdown} text=${text} />`}
    <//>`;
}


/** Compose the questions for a poll broadcast (a fanned-out AskUserQuestion). Controlled — owns no state;
 *  edits go through setQuestions. */
export function PollBuilder({ questions, setQuestions }) {
  const uid = () => 'q' + Math.random().toString(36).slice(2, 8);
  const oid = () => 'o' + Math.random().toString(36).slice(2, 8);
  const update = (i, patch) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const addQ = () => setQuestions([...questions, {
    id: uid(), header: '', prompt: '', options: [{ id: oid(), label: '' }, { id: oid(), label: '' }],
    multiSelect: false, allowOther: true, required: false,
  }]);
  const removeQ = (i) => setQuestions(questions.filter((_, j) => j !== i));
  const updateOpt = (qi, oi, label) => update(qi, { options: questions[qi].options.map((o, j) => (j === oi ? { ...o, label } : o)) });
  const addOpt = (qi) => update(qi, { options: [...questions[qi].options, { id: oid(), label: '' }] });
  const removeOpt = (qi, oi) => update(qi, { options: questions[qi].options.filter((_, j) => j !== oi) });

  return html`
    <${Stack} gap="medium">
      ${questions.map((q, qi) => html`
        <${Box} tone="row" packed key=${q.id}>
          <${Stack}>
            <${Row}>
              <${Label}>${qi + 1}.<//>
              <${TextField} placeholder=${t('inbox.pollHeader')} value=${q.header} onInput=${(v) => update(qi, { header: v })}
                actions=${html`<${Icon} small label=${t('inbox.pollRemoveQ')} onClick=${() => removeQ(qi)}>✕<//>`} />
            <//>
            <${TextField} placeholder=${t('inbox.pollPrompt')} value=${q.prompt} onInput=${(v) => update(qi, { prompt: v })} />
            <${Stack}>
              ${q.options.map((o, oi) => html`<${TextField} key=${o.id} placeholder=${`${t('inbox.pollOption')} ${oi + 1}`}
                value=${o.label} onInput=${(v) => updateOpt(qi, oi, v)}
                actions=${q.options.length > 1 ? html`<${Icon} small label=${t('common.remove')} onClick=${() => removeOpt(qi, oi)}>✕<//>` : null} />`)}
              <span><${Action} onClick=${() => addOpt(qi)}>+ ${t('inbox.pollAddOption')}<//></span>
            <//>
            <${Row} wrap gap="large">
              <${Check} inline checked=${q.multiSelect} onChange=${(on) => update(qi, { multiSelect: on })}>${t('inbox.pollMulti')}<//>
              <${Check} inline checked=${q.allowOther} onChange=${(on) => update(qi, { allowOther: on })}>${t('inbox.pollAllowOther')}<//>
              <${Check} inline checked=${q.required} onChange=${(on) => update(qi, { required: on })}>${t('inbox.pollRequired')}<//>
            <//>
          <//>
        <//>`)}
      <span><${Action} onClick=${addQ}>+ ${t('inbox.pollAddQuestion')}<//></span>
    <//>`;
}

/* ── Agent chat commands (Phase A) — a peer agent advertises fill-in templates via its public
 *    `chat.commands` memory key ([{id,label,description,template,params:[{name,type,required,placeholder,
 *    default,options}]}]). We render a chip per command; the human fills the params; the resulting prose
 *    drops into the composer to review + send. The agent receives the filled template it advertised. ── */
export function CommandBar({ commands, onPick }) {
  return html`<${PaneStrip}>
    <${Row} wrap>
      <${Note} inline>⚡ ${t('inbox.cmdTitle')}<//>
      ${commands.map(c => html`<${Mark} key=${c.id} title=${c.description || ''} onClick=${() => onPick(c)}>${c.label || c.id}<//>`)}
    <//>
  <//>`;
}

export function CommandFill({ command, onInsert, onCancel }) {
  const [values, setValues] = useState({});
  const params = Array.isArray(command.params) ? command.params : [];
  const valOf = (p) => String(values[p.name] ?? p.default ?? '');
  const set = (name) => (v) => setValues(prev => ({ ...prev, [name]: v }));
  const missing = params.some(p => p.required && !valOf(p).trim());
  return html`<${PaneStrip} grey>
    <${Row} justify="between"><b>⚡ ${command.label || command.id}</b>
      <${Icon} small label=${t('inbox.close')} onClick=${onCancel}>✕<//><//>
    ${command.description ? html`<${Note}>${command.description}<//>` : null}
    ${params.map(p => (p.type === 'select' && Array.isArray(p.options)
      ? html`<${Select} key=${p.name} label=${`${p.name}${p.required ? ' *' : ''}`} value=${valOf(p)}
          options=${p.options.map(o => [o, String(o)])} onChange=${set(p.name)} />`
      : html`<${TextField} key=${p.name} label=${`${p.name}${p.required ? ' *' : ''}`} type=${p.type === 'number' ? 'number' : 'text'}
          placeholder=${p.placeholder || ''} value=${valOf(p)} onInput=${set(p.name)} />`))}
    <${FormActions}><${Loud} control disabled=${missing} onClick=${() => onInsert(command, values)}>${t('inbox.cmdInsert')}<//><//>
  <//>`;
}

/* ── Agent schedule (Phase B) — surfaces the node scheduler scoped to one of YOUR OWN agents
 *    (GET/POST /v1/agents/:name/schedules, which always resolve under the caller's owner). List the
 *    agent's managed jobs + create a recurring agent_task. Only shown for the human's own agents. ── */
export function SchedulePanel({ agentName, onClose, showToast }) {
  const [jobs, setJobs] = useState(null);
  const [title, setTitle] = useState('');
  const [cron, setCron] = useState('0 9 * * *');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { const r = await schedules.listAgentSchedules(agentName); setJobs(r?.data?.managed || []); }
    catch (err) { swallowed('components', err); setJobs([]); }
  }, [agentName]);
  useEffect(() => { setJobs(null); load(); }, [load]);
  const create = async () => {
    if (!title.trim() || !cron.trim() || busy) return;
    setBusy(true);
    try {
      await schedules.createAgentSchedule(agentName, {
        kind: 'agent_task', cron: cron.trim(), task_title: title.trim(),
        task_description: desc.trim(), display_name: title.trim(),
      });
      setTitle(''); setDesc(''); showToast?.(t('inbox.schedCreated'));
      await load();
    } catch (e) { showToast?.(e?.message || t('inbox.schedError'), true); }
    finally { setBusy(false); }
  };
  return html`<${PaneStrip} grey>
    <${Row} justify="between"><b>📅 ${t('inbox.schedTitle')}</b>
      <${Icon} small label=${t('inbox.close')} onClick=${onClose}>✕<//><//>
    ${jobs == null ? html`<${Note} kind="quiet">${t('inbox.loading')}<//>`
      : html`<${List} cols="name-state" keepCols dense empty=${jobs.length === 0 ? t('inbox.schedNone') : null}>
          ${jobs.map(j => html`<${ListRow} key=${j.id}>
            <${Name}>${j.displayName || j.input?.taskTemplate?.title || j.id}<//>
            <${Cell} meta>${j.cron}${j.enabled === false ? ' · ' + t('inbox.schedOff') : ''}<//>
          <//>`)}
        <//>`}
    <${Stack}>
      <${TextField} placeholder=${t('inbox.schedTaskPh')} value=${title} onInput=${setTitle} />
      <${TextField} placeholder="0 9 * * *" value=${cron} onInput=${setCron} />
      <${TextArea} rows=${2} placeholder=${t('inbox.schedDescPh')} value=${desc} onInput=${setDesc} />
      <${FormActions}><${Loud} control disabled=${busy || !title.trim() || !cron.trim()} onClick=${create}>${t('inbox.schedCreate')}<//><//>
    <//>
  <//>`;
}

/** The ways of a popover as tabs (what the chosen one decides sits under the sun bar). */
const modeTabs = (items, value, onSelect) => html`<${Tabs} kind="view" items=${items} value=${value} onSelect=${onSelect} />`;

/* ── Reply with AI (TARGET-031) — hand the conversation (or one message) to the user's OWN AI chat so
 *    it can craft a reply WITH access to their AIMEAT (organisms, memory, workspaces, librarian). Two
 *    modes: COPY (paste into any AI chat, paste the reply back) and MCP (an AI with the AIMEAT MCP reads
 *    the thread via aimeat_dm_thread, researches, drafts, and sends via aimeat_dm_send after approval).
 *    `build(mode)` returns the prompt for the picked mode; the InboxTab supplies it per source. ── */
export function ReplyWithAiPopover({ title, build, onClose, showToast }) {
  const [mode, setMode] = useState(MODES.COPY);
  const text = build(mode);
  // The two ways are tabs; what the chosen one decides sits under a sun bar (the edge box).
  return html`
    <${Modal} open=${true} onClose=${onClose} title=${title} size="lg" guard=${false}
      footer=${html`<${Loud} control copy=${text} copiedLabel=${'✓ ' + t('inbox.ai.copied')}
        onCopied=${() => showToast?.(t('inbox.ai.copied'))}>${t('common.copy')}<//>`}>
      <${Stack} gap="medium">
        ${modeTabs([{ value: MODES.COPY, label: t('common.copyPrompt') }, { value: MODES.MCP, label: t('inbox.ai.modeMcp') }], mode, setMode)}
        <${Box} tone="edge">
          <${Stack} gap="medium">
            <${Note}>${mode === MODES.COPY ? t('inbox.ai.hintCopy') : t('inbox.ai.hintMcp')}<//>
            <${TextArea} readOnly rows=${14} value=${text} />
          <//>
        <//>
      <//>
    <//>`;
}

/* ── Conversation → Notebook — capture a WHOLE thread (with its images) into the notebook for later
 *    filing/enrichment into a workspace. Three modes, all landing in parkConversationToNotebook:
 *      ✨ ai   — summarize server-side with the owner's own OpenRouter key (runServerSummary), edit, park.
 *      📋 copy — copy the summary prompt into the owner's own AI chat, paste the result back, park.
 *      📥 raw  — park the whole chain (text + images) as-is; enrich it later in the Notebook.
 *    The parent (InboxTab) owns the async work (AI call + park + toasts) via the passed callbacks. ── */
export function ConversationToNotebookPopover({ title, promptText, runServerSummary, parkConversation, onClose, showToast }) {
  const [mode, setMode] = useState('ai');       // 'ai' | 'copy' | 'raw'
  const [aiSummary, setAiSummary] = useState('');
  // TARGET-058: `meta.provenance` for the summary the model just produced, so the reader is told a
  // model wrote it before they keep it. It is NOT an Art. 50(4) content label — this text is private
  // to its owner and owes none — which is why the standing AiInteractionNotice carries it and not
  // AiLabel (whose whole job is to render only when a label is legally owed).
  const [aiProvenance, setAiProvenance] = useState(null);
  const [pasted, setPasted] = useState('');
  const [running, setRunning] = useState(false);
  const [parking, setParking] = useState(false);

  const genSummary = async () => {
    setRunning(true);
    try {
      const r = await runServerSummary();
      const text = (typeof r === 'string' ? r : r?.content) || '';
      if (text.trim()) {
        setAiSummary(text.trim());
        setAiProvenance(typeof r === 'string' ? null : (r?.provenance || null));
      } else showToast?.(t('inbox.notebook.summaryEmpty'), true);
    } catch (e) { showToast?.(e?.message || t('inbox.failed'), true); }
    finally { setRunning(false); }
  };

  const doPark = async (summary) => {
    setParking(true);
    try { await parkConversation({ summary: summary || '' }); showToast?.(t('inbox.notebook.parked')); onClose(); }
    catch (e) { showToast?.(e?.message || t('inbox.failed'), true); setParking(false); }
  };

  // A summary being written or pasted is a half-written form: Modal's guard keeps it open.
  return html`
    <${Modal} open=${true} onClose=${onClose} title=${title} size="lg">
      <${Stack} gap="medium">
        ${modeTabs([
          { value: 'ai', label: t('inbox.notebook.modeAi') },
          { value: 'copy', label: t('common.copyPrompt') },
          { value: 'raw', label: t('inbox.notebook.modeRaw') },
        ], mode, setMode)}
        <${Box} tone="edge">
          <${Stack} gap="medium">
          ${mode === 'ai' ? html`
            <${Note}>${t('inbox.notebook.hintAi')}<//>
            ${!aiSummary ? html`
              <${FormActions} end>
                <${Loud} control disabled=${running} onClick=${genSummary}>${running ? '… ' + t('inbox.notebook.summarizing') : '✨ ' + t('inbox.notebook.genSummary')}<//>
              <//>`
            : html`
              <${AiInteractionNotice} titleKey="aiLabel.draftTitle" bodyKey="aiLabel.draftBody"
                recordUrl=${aiProvenance?.recordUrl} />
              <${TextArea} rows=${12} value=${aiSummary} onInput=${setAiSummary} />
              <${FormActions} end>
                <${Action} disabled=${running} onClick=${genSummary}>${running ? '…' : '↻ ' + t('inbox.notebook.regen')}<//>
                <${Loud} control disabled=${parking} onClick=${() => doPark(aiSummary)}>${parking ? '…' : '📓 ' + t('inbox.notebook.park')}<//>
              <//>`}
          ` : mode === 'copy' ? html`
            <${Note}>${t('inbox.notebook.hintCopy')}<//>
            <${TextArea} readOnly rows=${8} value=${promptText} />
            <${FormActions} end>
              <${Loud} control copy=${promptText} copiedLabel=${'✓ ' + t('inbox.ai.copied')}
                onCopied=${() => showToast?.(t('inbox.ai.copied'))}>${'📋 ' + t('common.copy')}<//>
            <//>
            <${Note}>${t('inbox.notebook.pasteHint')}<//>
            <${TextArea} rows=${8} placeholder=${t('inbox.notebook.pastePh')} value=${pasted} onInput=${setPasted} />
            <${FormActions} end>
              <${Loud} control disabled=${parking || !pasted.trim()} onClick=${() => doPark(pasted)}>${parking ? '…' : '📓 ' + t('inbox.notebook.park')}<//>
            <//>
          ` : html`
            <${Note}>${t('inbox.notebook.hintRaw')}<//>
            <${FormActions} end>
              <${Loud} control disabled=${parking} onClick=${() => doPark('')}>${parking ? '…' : '📥 ' + t('inbox.notebook.parkRaw')}<//>
            <//>
          `}
          <//>
        <//>
      <//>
    <//>`;
}
