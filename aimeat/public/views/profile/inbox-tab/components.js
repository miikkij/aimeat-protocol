/**
 * @file public/views/profile/inbox-tab/components.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Presentational sub-components for the profile Inbox tab: Avatar, AttachmentItem,
 *   PollBuilder, MessageBubble (one message as the set's Message) and Composer (a thin auto-growing
 *   field, the Toast UI editor on request, a markdown fallback, and the row of attach, record,
 *   enlarge and send). The dialogs live in ./dialogs.js and the agent tools in ./agent-tools.js;
 *   both are re-exported here so the callers' imports stay as they were. Each component owns its
 *   own hooks. Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
 *   v2.0.0 -- 2026-09-22 -- Composed from the shared component set: a message is the set's Message
 *     (mine on the sun at the right, theirs in the ink frame at the left, the writer named, the
 *     quote, the time and ticks under it), its actions are words, a star toggle and a Menu; the
 *     composer is a Field with a row of actions; attachments are actions and chips. The dialogs and
 *     agent tools moved to ./dialogs.js and ./agent-tools.js. The emoji left the buttons and ticks.
 *     Every handler is unchanged.
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
 *     chat works, and the enlarge action swaps in the full editor with the draft carried both ways.
 *     Toast UI is not even loaded until asked. Each branch of the composer body carries a key: without
 *     them Preact reused the editor div as the button row and its inline height rode along.
 *   v1.11.0 — 2026-08-01 — Voice messages. AttachmentItem hands an audio attachment to AudioAttachment
 *     (./voice-parts.js) so it plays in the bubble instead of opening in a browser tab, which is a
 *     download and not a conversation. The Composer gains a recorder feeding the SAME attachment
 *     queue as a picked file (one upload path), and a recording's chip carries a player + its length
 *     so a bad take is caught here rather than in the other person's mailbox.
 *   v1.10.0 — 2026-07-31 — MessageBubble gets a read-aloud action (BubbleSpeakButton, ./read-aloud.js).
 *   v1.9.0 — 2026-07-25 — MessageBubble gets a copy action: copies the message's raw markdown.
 *   v1.8.0 — 2026-07-21 — MessageBubble renders link-preview cards under the body (MessageLinkPreviews),
 *     gated by the `showLinkPreviews` prop (the persisted thread-head toggle).
 *   v1.0.0 — 2026-07-13 — Extracted from inbox-tab.js (max-file-lines)
 *   v1.1.0 — 2026-07-14 — Composer: pasted/dropped images route to the file-attachment path (upload +
 *     shown as an image) instead of Toast UI base64-inlining them into the body (which blew the 50k
 *     body limit → 400 "Too big"). addImageBlobHook (rich) + onPaste (markdown fallback).
 *   v1.2.0 — 2026-07-17 — Two paste-image fixes: (1) MessageBubble looks up attachment urls via the
 *     `${messageId}::${attachmentId}` composite key so images no longer bleed between messages; (2)
 *     pasted clipboard images (always named "image.png") get a unique name.
 *   v1.3.0 — 2026-07-17 — Reply-to with quote: a bubble action starts a quoted reply, and a bubble whose
 *     message carries `replyToId` renders the quoted original (sender + excerpt; click jumps to it).
 *   v1.3.1 — 2026-07-17 — A queued (e.g. mis-pasted) attachment can be removed before sending.
 *   v1.4.0 — 2026-07-18 — Composer accepts a `focusNonce`: bumping it focuses the editor.
 *   v1.5.0 — 2026-07-18 — Mobile composer is a plain auto-growing textarea (`mode:'simple'`).
 *   v1.6.0 — 2026-07-19 — Composer gets an expand toggle: enlarges the editor to ~60% of the viewport.
 *   v1.8.0 — 2026-08-01 — TARGET-058 Phase 3: the generated conversation summary carries a standing
 *     "a model wrote this draft" notice with a link to its provenance record.
 *   v1.7.0 — 2026-07-19 — ConversationToNotebookPopover: capture a whole thread into the Notebook.
 *   v1.12.0 — 2026-08-08 — All three copy affordances are shared <CopyButton>s.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { MessageLinkPreviews } from '/components/LinkPreview.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import { Message, Action, CopyAction, Menu, Chip, Field, Stack, Surface, Columns, Text } from '/components/poster-parts.js';
import { InteractiveForm, InteractiveAnswered } from './interactive-form.js';
import { bigEditorHeight, loadToastUI, prepareBody, quoteSnippet, statusTick, timeShort, trackStateLabel, attachKind } from './helpers.js';
import { BubbleSpeakButton } from './read-aloud.js';
import { AudioAttachment, fmtClock, stopOtherAudio } from './voice-parts.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { swallowed } from '/js/swallowed.js';

export { MarkdownViewer, ReplyWithAiPopover, ConversationToNotebookPopover } from './dialogs.js';
export { CommandBar, CommandFill, SchedulePanel } from './agent-tools.js';

/** The identicon for a person or an agent, drawn at the size asked for. */
export function Avatar({ seed, size = 36 }) {
  const svg = minidenticon(typeof seed === 'string' && seed ? seed : 'user')
    .replace('<svg', `<svg width="${size}" height="${size}" aria-hidden="true"`);
  return html`<span dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}

/** A tracked response's state as a chip tone. */
export const TRACK_TONE = { watch: 'plain', ready: 'sun', done: 'success', err: 'danger' };

/** One received/sent attachment. Images render as a thumbnail (click → full-size in a new tab);
 *  audio plays in place; PDF/video/file open natively in a new tab; markdown opens the in-app
 *  rendered viewer. Every ready attachment gets a download action. Not-yet-duplicated / expired
 *  attachments show their state. */
export function AttachmentItem({ a, url, onOpenMarkdown, msgId, onTranscribe, canTranscribe }) {
  const kind = attachKind(a);
  const name = a.name || a.storageKey;
  const ready = !!url && !a.expired;

  if (!ready) {
    // What the reader needs is not the machine's word for the state ("pending") but what happened to
    // them and whose move it is next. The chip carries the short form and the title the whole
    // sentence, because a chip is four words wide and the answer is longer than that.
    const status = a.expired ? t('inbox.attachmentExpired') : (a.mode !== 'duplicate' ? t('inbox.attachmentPending') : null);
    const help = a.expired ? t('inbox.attachmentExpiredHelp') : (a.mode !== 'duplicate' ? t('inbox.attachmentPendingHelp') : null);
    return html`<${Chip} tone="muted" title=${help || undefined}>${name}${status ? ` · ${status}` : ''}<//>`;
  }

  const download = html`<${Action} kind="text" href=${url} download=${name} title=${t('inbox.attachmentDownload')}>${t('inbox.attachmentDownload')}<//>`;

  if (kind === 'image') {
    return html`<${Stack} density="compact">
      <a href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
        <img src=${url} alt=${name} loading="lazy" />
      </a>
      <${Stack} direction="wrap" align="center" density="compact"><${Text} kind="caption">${name}<//>${download}<//>
    <//>`;
  }
  if (kind === 'markdown') {
    return html`<${Stack} direction="wrap" align="center" density="compact">
      <${Action} kind="text" onClick=${() => onOpenMarkdown?.(url, name)} title=${t('inbox.attachmentView')}>${name}<//>${download}
    <//>`;
  }
  if (kind === 'audio') {
    return html`<${AudioAttachment} a=${a} url=${url} name=${name} download=${download}
      msgId=${msgId} onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />`;
  }
  // pdf / video / file — let the browser open it in a new tab.
  return html`<${Stack} direction="wrap" align="center" density="compact">
    <${Action} kind="text" href=${url} target="_blank" title=${t('inbox.attachmentOpen')}>${name}<//>${download}
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
    <${Stack}>
      ${questions.map((q, qi) => html`
        <${Surface} kind="box" density="compact" key=${q.id}>
          <${Stack} density="compact">
            <${Stack} direction="horizontal" align="center">
              <${Text} kind="mono" tone="coral">${qi + 1}.<//>
              <${Field} ariaLabel=${t('inbox.pollHeader')} placeholder=${t('inbox.pollHeader')} value=${q.header} onInput=${(e) => update(qi, { header: e.target.value })} />
              <${Action} kind="text" label=${t('inbox.pollRemoveQ')} title=${t('inbox.pollRemoveQ')} onClick=${() => removeQ(qi)}>✗<//>
            <//>
            <${Field} ariaLabel=${t('inbox.pollPrompt')} placeholder=${t('inbox.pollPrompt')} value=${q.prompt} onInput=${(e) => update(qi, { prompt: e.target.value })} />
            ${q.options.map((o, oi) => html`<${Stack} direction="horizontal" align="center" key=${o.id}>
              <${Field} ariaLabel=${`${t('inbox.pollOption')} ${oi + 1}`} placeholder=${`${t('inbox.pollOption')} ${oi + 1}`} value=${o.label} onInput=${(e) => updateOpt(qi, oi, e.target.value)} />
              ${q.options.length > 1 ? html`<${Action} kind="text" label=${t('inbox.bcRemove')} onClick=${() => removeOpt(qi, oi)}>✗<//>` : null}
            <//>`)}
            <${Stack} direction="horizontal"><${Action} kind="text" onClick=${() => addOpt(qi)}>+ ${t('inbox.pollAddOption')}<//><//>
            <${Field} type="checkbox" label=${t('inbox.pollMulti')} value=${q.multiSelect} onChange=${(e) => update(qi, { multiSelect: e.target.checked })} />
            <${Field} type="checkbox" label=${t('inbox.pollAllowOther')} value=${q.allowOther} onChange=${(e) => update(qi, { allowOther: e.target.checked })} />
            <${Field} type="checkbox" label=${t('inbox.pollRequired')} value=${q.required} onChange=${(e) => update(qi, { required: e.target.checked })} />
          <//>
        <//>`)}
      <${Stack} direction="horizontal"><${Action} onClick=${addQ}>+ ${t('inbox.pollAddQuestion')}<//><//>
    <//>`;
}

/** The star, as an inline SVG: the interface carries no emoji. Filled when the message is marked. */
const StarIcon = ({ on }) => html`<svg viewBox="0 0 20 20" aria-hidden="true" fill=${on ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">
  <path d="M10 2.6l2.3 4.8 5.2.7-3.8 3.6.9 5.2L10 14.4l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" /></svg>`;

export function MessageBubble({ msg, mine, who, urlMap, starred, onStar, onTrack, onPark, onReplyAi, onQuote, onDelete, quoted, quotedName, onJumpTo, domId, flash, tracked, onOpenMarkdown, answeredWith, onAnswer, submitting, showLinkPreviews, onTranscribe, canTranscribe }) {
  const nonInline = (msg.attachments || []).filter(a => !a.inline);
  const expiredIds = new Set((msg.attachments || []).filter(a => a.expired).map(a => a.id));
  // urlMap is keyed by `${messageId}::${attachmentId}` because per-message attachment ids (at0, at1…)
  // aren't unique across messages. Build THIS message's flat { attId → url } view so prepareBody's cid
  // resolution and the thumbnails only ever see their own message's attachments.
  const urls = {};
  for (const a of (msg.attachments || [])) {
    const u = urlMap[`${msg.id}::${a.id}`];
    if (u) urls[a.id] = u;
  }
  const trk = tracked ? trackStateLabel(tracked.state) : null;
  const failed = msg.status === 'failed' || msg.status === 'undeliverable';
  const meta = html`
    ${trk ? html`<${Chip} tone=${TRACK_TONE[trk.tone] || 'plain'} title=${t('inbox.trackResponse')}>${trk.text}<//>` : null}
    ${/* That a model wrote this at all, which is a different fact from WHICH model and arrives far more
         often: an agent's message is stamped whether or not it names one. Absence stays silent on
         purpose — no record means nothing was claimed. */''}
    ${msg.ai ? html`<${Chip} tone="muted" title=${t('inbox.aiRecorded')}>${
      msg.ai.level === 'ai-generated' ? t('inbox.aiWrote') : t('inbox.aiAssisted')
    }<//>` : null}
    ${/* Which model wrote this, when an AI wrote it and named one. The name is the agent's own claim
         (the node cannot verify it), so the tooltip says so. */''}
    ${msg.ai?.model ? html`<${Chip} tone="muted" title=${t('inbox.modelClaimed', { model: msg.ai.model })}>${msg.ai.model}<//>` : null}
    <span>${timeShort(msg.createdAt)}</span>
    ${mine && msg.status ? (msg.status === 'read' ? html`<strong>${statusTick(msg.status)}</strong>`
      : failed ? html`<${Text} kind="mono" tone="danger">${statusTick(msg.status)}<//>` : html`<span>${statusTick(msg.status)}</span>`) : null}`;
  const actions = html`
    ${onQuote ? html`<${Action} kind="text" title=${t('inbox.quoteReply')} label=${t('inbox.quoteReply')}
      onClick=${() => onQuote(msg)}>↩<//>` : null}
    <${BubbleSpeakButton} msgId=${msg.id} body=${msg.body} />
    ${/* Copies the raw markdown the sender wrote — that is what pastes usefully into an AI chat or a
         document; the rendered body's presigned image URLs are transient. */''}
    <${CopyAction} kind="text" text=${String(msg.body || '')} label=${t('common.copy')} copiedLabel=${t('common.copied')}
      title=${t('inbox.copyMessage')} />
    <${Action} kind="icon" selected=${!!starred} title=${t('inbox.markImportant')} label=${t('inbox.markImportant')}
      onClick=${() => onStar?.(msg)}><${StarIcon} on=${!!starred} /><//>
    <${Menu} label=${t('inbox.cover.more')} items=${[
      { label: tracked ? `${t('inbox.trackResponse')} — ${trk.text}` : t('inbox.trackResponse'), onClick: () => onTrack?.(msg) },
      { label: t('inbox.parkToNotebook'), onClick: () => onPark?.(msg) },
      { label: t('inbox.ai.replyToMessage'), onClick: () => onReplyAi?.(msg) },
      // LAST on purpose: the only action here that cannot be undone, and it asks before it acts.
      onDelete ? { divider: true } : null,
      onDelete ? { label: t('inbox.deleteMessage'), danger: true, onClick: () => onDelete(msg) } : null,
    ]} />`;
  const quote = quoted ? html`<${Action} kind="text" onClick=${() => onJumpTo?.(quoted.id)} title=${t('inbox.quoteJump')}>
    ${quotedName || ''}: ${quoteSnippet(quoted.body)}<//>` : null;
  return html`
    <${Message} id=${domId} side=${mine ? 'mine' : 'theirs'} who=${who} quote=${quote} meta=${meta} actions=${actions} flash=${!!flash}>
      <${Markdown} text=${prepareBody(msg.body, urls, expiredIds)} />
      ${showLinkPreviews ? html`<${MessageLinkPreviews} msg=${msg} />` : null}
      ${msg.interactive?.role === 'questions' ? (
        answeredWith
          ? html`<${InteractiveAnswered} spec=${msg.interactive} answers=${answeredWith.answers || {}} />`
          : html`<${InteractiveForm} spec=${msg.interactive} submitting=${submitting}
              onSubmit=${(answers) => onAnswer?.(msg, answers)} />`
      ) : null}
      ${nonInline.length > 0 && html`
        <${Stack} density="compact">
          ${nonInline.map(a => html`<${AttachmentItem} key=${a.id} a=${a} url=${urls[a.id]}
            onOpenMarkdown=${onOpenMarkdown} msgId=${msg.id}
            onTranscribe=${onTranscribe} canTranscribe=${canTranscribe} />`)}
        <//>`}
    <//>`;
}

/* Composer — a thin auto-growing field by default, the Toast UI editor (Markdown⇄WYSIWYG toggle, same
 * as workspace documents) on request, with a markdown-textarea + live-preview fallback if the editor
 * can't load. Owns its own draft + file state; calls onSend(recipient, markdown, files, reset).
 * Remount it (via key) per conversation so the draft doesn't leak between threads. */
export function Composer({
  recipient, sendLabel, sending, onSend, initialText = '', draftKey = '', focusNonce = 0,
  voiceMaxSeconds = 300,
}) {
  // Restore an in-progress draft for this conversation/compose (localStorage), or the passed initialText.
  const readDraft = () => { try { return draftKey ? (localStorage.getItem(draftKey) || '') : ''; } catch { return ''; } };   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  const seeded = initialText || readDraft();   // an explicit suggested reply wins; else restore a draft
  // 'simple' = a thin auto-growing textarea, the way every chat works: one line that grows as you type.
  // 'rich' = the Toast UI editor with its toolbar and preview tabs, which costs 92px of chrome before a
  // single character — worth having, not worth spending the reading area on by default. The enlarge
  // action switches between them. 'markdown' = the textarea+preview fallback when Toast UI cannot load.
  const [mode, setMode] = useState('simple');
  const [md, setMd] = useState(seeded);
  const mdRef = useRef(seeded);
  useEffect(() => { mdRef.current = md; }, [md]);
  // Temporarily enlarge the editor (~60% of the viewport) so long/formatted drafts are fully visible.
  const [expanded, setExpanded] = useState(false);
  const [files, setFiles] = useState([]);
  const containerRef = useRef(null);
  const editorRef = useRef(null);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const saveTimer = useRef(null);
  // Debounced auto-save of the draft (skipped when there's no key). Empty text clears the draft.
  const saveDraft = (text) => {
    if (!draftKey) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try { if (text && text.trim()) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey); } catch { /* quota */ }   // eslint-disable-line aimeat/no-silent-catch -- quota
    }, 400);
  };
  const clearDraft = () => { try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* noop */ } };   // eslint-disable-line aimeat/no-silent-catch -- noop

  // A pasted / dropped image is added to the SAME file-attachment queue as a picked file (uploaded to
  // storage + rendered as an image on the bubble) — never base64-inlined into the body, which would
  // blow the server's 50k body limit. Wrap a bare clipboard Blob in a named File so uploadAttachment
  // (which needs .name) and the file chip both work. Functional setFiles avoids a stale closure in the
  // editor hook (created once at construction).
  const addPastedImage = (blob) => {
    if (!blob) return;
    const ext = (blob.type && blob.type.split('/')[1]) || 'png';
    const orig = (blob instanceof File && blob.name) ? blob.name : '';
    // Clipboard images always arrive as a File generically named "image.png", so every paste would share
    // that one name. Give each pasted image a unique name; keep a genuine dropped filename as-is.
    const generic = !orig || orig.toLowerCase() === 'image.png';
    const name = generic ? `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}` : orig;
    const file = (blob instanceof File && !generic) ? blob : new File([blob], name, { type: blob.type || 'image/png' });
    setFiles((prev) => [...prev, file]);
  };
  // A finished recording joins the same attachment queue as a picked file, so it travels the one
  // upload path (presigned PUT) everything else uses. The measured length rides ON the File: the
  // send path reads it back as `duration_seconds`.
  const addRecording = (file, durationSeconds) => {
    file.durationSeconds = durationSeconds;
    // Minted ONCE here, not in render: createObjectURL in a render body allocates a new blob URL on
    // every re-render and never releases the old ones.
    file.previewUrl = URL.createObjectURL(file);
    setFiles((prev) => [...prev, file]);
  };
  const releasePreview = (file) => {
    if (file?.previewUrl) { URL.revokeObjectURL(file.previewUrl); file.previewUrl = null; }
  };

  // Pull image files out of a clipboard/drop event; returns true if any were handled (caller preventDefaults).
  const handleImagePaste = (e) => {
    const items = Array.from(e.clipboardData?.items || e.dataTransfer?.items || []);
    const imgs = items.filter((it) => it.kind === 'file' && (it.type || '').startsWith('image/'))
      .map((it) => it.getAsFile()).filter(Boolean);
    if (imgs.length === 0) return false;
    e.preventDefault();
    imgs.forEach(addPastedImage);
    return true;
  };

  useEffect(() => {
    if (mode !== 'rich') return undefined;
    let inst = null, cancelled = false;
    (async () => {
      const Editor = await loadToastUI().catch(err => { swallowed('components: handleImagePaste', err); return null; });
      if (cancelled) return;
      if (!Editor) { setMode('markdown'); return; }
      if (!containerRef.current) return;
      inst = new Editor({
        el: containerRef.current,
        // On a desktop window the box gets a share of the height instead of a constant.
        height: bigEditorHeight() + 'px',
        initialEditType: 'markdown',     // open in markdown mode; the built-in toggle switches to WYSIWYG
        previewStyle: 'tab',
        initialValue: mdRef.current || seeded,   // whatever is in the thin input right now, else the draft
        usageStatistics: false,
        // editorRef is set only AFTER construction, so the constructor's own change (initialValue) is
        // skipped — only real user edits auto-save the draft.
        events: { change: () => { if (editorRef.current) saveDraft(editorRef.current.getMarkdown()); } },
        // Intercept pasted / dropped images: queue them as file attachments and DON'T call the callback,
        // so Toast UI skips its default base64 <img> insertion into the markdown body.
        hooks: { addImageBlobHook: (blob /* , callback, source */) => { addPastedImage(blob); } },
        toolbarItems: [
          ['bold', 'italic', 'strike'],
          ['ul', 'ol', 'task'],
          ['quote', 'code', 'codeblock'],
          ['link'],
        ],
      });
      editorRef.current = inst;
    })();
    return () => {
      cancelled = true;
      if (inst) { try { inst.destroy(); } catch (err) { swallowed('components: handleImagePaste', err); } }
      editorRef.current = null;
    };
    // Create the editor once when mode becomes 'rich': `seeded` is intentionally read only at
    // construction and `saveDraft` is a stable-behavior closure over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Seed the rich editor with an initial draft (e.g. a Tracked Response suggested reply) once it mounts.
  useEffect(() => {
    if (mode === 'rich' && initialText && editorRef.current) {
      try { editorRef.current.setMarkdown(initialText); } catch (err) { swallowed('components: handleImagePaste', err); }
    }
  }, [mode, initialText]);

  // Focus the composer when the parent bumps focusNonce (e.g. after the reply action on a bubble). Skip
  // the initial 0 so a fresh mount never steals focus / pops the keyboard.
  useEffect(() => {
    if (!focusNonce) return undefined;
    const id = setTimeout(() => {
      try {
        if (mode === 'rich' && editorRef.current?.focus) editorRef.current.focus();
        else if (taRef.current) taRef.current.focus();
      } catch (err) { swallowed('components: handleImagePaste', err); }
    }, 60);
    return () => clearTimeout(id);
    // Only focusNonce is the trigger; mode/refs are read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Resize the Toast UI editor when the expand toggle flips or the window changes height.
  useEffect(() => {
    if (mode !== 'rich' || !editorRef.current?.setHeight) return undefined;
    const apply = () => {
      try { editorRef.current.setHeight(bigEditorHeight() + 'px'); } catch (err) { swallowed('components: composer resize', err); }
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [expanded, mode]);

  // Auto-grow the simple textarea to fit its content, capped so it never eats the thread.
  const autoGrow = (ta) => {
    if (!ta) return;
    const cap = expanded && typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : 132;
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, cap) + 'px';
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'simple') autoGrow(taRef.current); }, [mode, expanded]);

  /**
   * Swap the thin chat input for the full editor and back. The draft travels in both directions, so
   * switching mid-sentence never costs a word.
   */
  const toggleBigEditor = () => {
    if (mode === 'rich') {
      const text = editorRef.current?.getMarkdown ? editorRef.current.getMarkdown() : md;
      setMd(text); mdRef.current = text; saveDraft(text);
      setExpanded(false); setMode('simple');
      return;
    }
    setExpanded(true); setMode('rich');
  };

  const getText = () => (mode === 'rich' && editorRef.current) ? editorRef.current.getMarkdown() : md;
  const reset = () => {
    try { editorRef.current?.setMarkdown(''); } catch (err) { swallowed('components: reset', err); }
    setMd('');
    setFiles((prev) => { prev.forEach(releasePreview); return []; });
    if (fileRef.current) fileRef.current.value = '';
    if (mode === 'simple' && taRef.current) taRef.current.style.height = 'auto';
    clearDraft();   // a sent message is no longer a draft
  };
  const submit = () => onSend(recipient, getText(), files, reset);
  // Remove one queued attachment before sending. Also clear the hidden file input when the last chip
  // goes, so re-picking the same file fires onChange.
  const removeFile = (idx) => setFiles((prev) => {
    releasePreview(prev[idx]);
    const next = prev.filter((_, j) => j !== idx);
    if (next.length === 0 && fileRef.current) fileRef.current.value = '';
    return next;
  });
  const onType = (e) => { setMd(e.target.value); saveDraft(e.target.value); };

  return html`
    <${Stack} density="compact">
      ${files.length > 0 ? html`<${Stack} direction="wrap" align="center" density="compact">
        ${files.map((f, i) => {
          // A recording gets its own chip with a player: a bad take should be caught here.
          const isVoice = (f.type || '').startsWith('audio/') && f.durationSeconds;
          return html`<${Stack} direction="horizontal" align="center" density="compact" key=${f.name + i}>
            ${isVoice
              ? html`<${Chip}>${fmtClock(f.durationSeconds)}<//><audio controls preload="metadata" src=${f.previewUrl}
                  onPlay=${(e) => stopOtherAudio(e.currentTarget)}></audio>`
              : html`<${Chip}>${f.name}<//>`}
            <${Action} kind="text" label=${t('inbox.attachmentRemove')} title=${t('inbox.attachmentRemove')} onClick=${() => removeFile(i)}>✗<//>
          <//>`;
        })}
      <//>` : null}
      ${mode === 'rich'
        // Keys, because the three branches are different DOM shapes sharing one slot. Without them
        // Preact reused the rich editor's element for the next branch and Toast UI's inline height
        // rode along with it.
        ? html`<${Surface} key="rich" kind="editor" density="flush" surfaceRef=${containerRef} />`
        : mode === 'simple'
        ? html`<${Field} key="thin" type="textarea" rows=${1} inputRef=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
            ariaLabel=${t('inbox.bodyPlaceholder')} value=${md} onPaste=${handleImagePaste}
            onInput=${(e) => { onType(e); autoGrow(e.target); }} />`
        : html`<${Columns} key="fallback" collapse=${600}>
            <${Field} type="textarea" rows=${3} inputRef=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
              ariaLabel=${t('inbox.bodyPlaceholder')} value=${md} onPaste=${handleImagePaste} onInput=${onType} />
            <${Surface} kind="box" density="compact"><${Markdown} text=${md} /><//>
          <//>`}
      <${Stack} key="bar" direction="wrap" align="between">
        <${Stack} direction="wrap" align="center">
          <${Field} type="file" multiple=${true} chooseLabel=${t('inbox.attach')} inputRef=${fileRef}
            onChange=${(e) => setFiles(Array.from(e.target.files || []))} />
          <${VoiceRecorder} maxSeconds=${voiceMaxSeconds} className="poster-icon-action" onRecorded=${addRecording} />
          <${Action} kind="text" onClick=${toggleBigEditor}>${mode === 'rich' ? t('inbox.collapse') : t('inbox.expand')}<//>
        <//>
        <${Action} kind="primary" disabled=${sending || !recipient} onClick=${submit}>
          ${sending ? t('inbox.sending') : sendLabel}
        <//>
      <//>
    <//>`;
}
