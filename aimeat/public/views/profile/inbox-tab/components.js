/**
 * @file public/views/profile/inbox-tab/components.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Presentational sub-components for the profile Inbox tab: Avatar, AttachmentItem,
 *   MarkdownViewer, PollBuilder,
 *   MessageBubble, Composer (Toast UI editor + markdown fallback), CommandBar/CommandFill (agent
 *   chat.commands), SchedulePanel (own-agent scheduler), and ReplyWithAiPopover (TARGET-031). Each is
 *   self-contained (owns its own hooks). Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
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
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);

import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { CopyButton } from '/components/CopyButton.js';
import { Modal } from '/components/Modal.js';
import { Markdown } from '/components/Markdown.js';
import { AiInteractionNotice } from '/components/ai-label.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import * as schedules from '/js/services/schedules.js';
import { MODES } from '/js/services/messages-ai-prompts.js';
import { bigEditorHeight, loadToastUI } from './helpers.js';
import { fmtClock, stopOtherAudio } from './voice-parts.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { swallowed } from '/js/swallowed.js';
// A message and its attachments are the chat's turn now, in their own module; the names stay
// reachable from here for the pages that take them from this file.
export { MessageBubble, AttachmentItem } from './message-turn.js';

export function Avatar({ seed, size = 36 }) {
  const svg = minidenticon(typeof seed === 'string' && seed ? seed : 'user');
  return html`<span class=${`inbox-avatar inbox-avatar--${size} poster-box poster-box--avatar`}
    dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}


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
    <${Modal} open=${true} onClose=${onClose} title=${name} size="lg" guard=${false} className="inbox-mdviewer"
      footer=${html`
        <a class="poster-action" href=${url} target="_blank" rel="noopener">${t('inbox.attachmentOpenRaw')}</a>
        <a class="poster-action" href=${url} download=${name}>${t('inbox.attachmentDownload')}</a>`}>
      ${failed ? html`<div class="poster-quiet inbox-empty-sm">${t('inbox.attachmentLoadError')}</div>`
        : text === null ? html`<div class="poster-quiet inbox-empty-sm">…</div>`
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
    <div class="inbox-poll-builder">
      ${questions.map((q, qi) => html`
        <div class="inbox-poll-q" key=${q.id}>
          <div class="inbox-poll-q-head">
            <span class="inbox-poll-q-n">${qi + 1}.</span>
            <input class="og-input" placeholder=${t('inbox.pollHeader')} value=${q.header} onInput=${(e) => update(qi, { header: e.target.value })} />
            <button class="inbox-bc-chip-x" title=${t('inbox.pollRemoveQ')} onClick=${() => removeQ(qi)}>✕</button>
          </div>
          <input class="og-input" placeholder=${t('inbox.pollPrompt')} value=${q.prompt} onInput=${(e) => update(qi, { prompt: e.target.value })} />
          <div class="inbox-poll-opts">
            ${q.options.map((o, oi) => html`<div class="inbox-poll-opt" key=${o.id}>
              <input class="og-input" placeholder=${`${t('inbox.pollOption')} ${oi + 1}`} value=${o.label} onInput=${(e) => updateOpt(qi, oi, e.target.value)} />
              ${q.options.length > 1 ? html`<button class="inbox-bc-chip-x" onClick=${() => removeOpt(qi, oi)}>✕</button>` : null}
            </div>`)}
            <button class="poster-action" onClick=${() => addOpt(qi)}>+ ${t('inbox.pollAddOption')}</button>
          </div>
          <div class="inbox-poll-flags">
            <label><input type="checkbox" checked=${q.multiSelect} onChange=${(e) => update(qi, { multiSelect: e.target.checked })} /> ${t('inbox.pollMulti')}</label>
            <label><input type="checkbox" checked=${q.allowOther} onChange=${(e) => update(qi, { allowOther: e.target.checked })} /> ${t('inbox.pollAllowOther')}</label>
            <label><input type="checkbox" checked=${q.required} onChange=${(e) => update(qi, { required: e.target.checked })} /> ${t('inbox.pollRequired')}</label>
          </div>
        </div>`)}
      <button class="poster-action" onClick=${addQ}>+ ${t('inbox.pollAddQuestion')}</button>
    </div>`;
}

/* Composer — the Toast UI editor (Markdown⇄WYSIWYG toggle, same as workspace documents), with a
 * markdown-textarea + live-preview fallback if the editor can't load. Owns its own draft + file
 * state; calls onSend(recipient, markdown, files, reset). Remount it (via key) per conversation so
 * the draft doesn't leak between threads. */
export function Composer({
  recipient, sendLabel, sending, onSend, initialText = '', draftKey = '', focusNonce = 0,
  voiceMaxSeconds = 300,
}) {
  // Restore an in-progress draft for this conversation/compose (localStorage), or the passed initialText.
  const readDraft = () => { try { return draftKey ? (localStorage.getItem(draftKey) || '') : ''; } catch { return ''; } };   // eslint-disable-line aimeat/no-silent-catch -- a browser API refusing here IS the answer
  const seeded = initialText || readDraft();   // an explicit suggested reply wins; else restore a draft
  // 'simple' = a thin auto-growing textarea, the way every chat works: one line that grows as you type.
  // 'rich' = the Toast UI editor with its toolbar and preview tabs, which costs 92px of chrome before a
  // single character — worth having, not worth spending the reading area on by default. The ⤢ button
  // switches between them. 'markdown' = the textarea+preview fallback when Toast UI cannot load.
  //
  // Desktop used to open in 'rich', which handed the composer a third of the window and pushed the
  // conversation into the strip above it. The messages are what the screen is for.
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

  // A pasted / dropped image is added to the SAME file-attachment queue as the 📎 button (uploaded to
  // storage + rendered as an image on the bubble) — never base64-inlined into the body, which would
  // blow the server's 50k body limit. Wrap a bare clipboard Blob in a named File so uploadAttachment
  // (which needs .name) and the file chip both work. Functional setFiles avoids a stale closure in the
  // editor hook (created once at construction).
  const addPastedImage = (blob) => {
    if (!blob) return;
    const ext = (blob.type && blob.type.split('/')[1]) || 'png';
    const orig = (blob instanceof File && blob.name) ? blob.name : '';
    // Clipboard images always arrive as a File generically named "image.png", so every paste would share
    // that one name (and read as the same file in the thread). Give each pasted image a unique name; keep
    // a genuine dropped filename as-is.
    const generic = !orig || orig.toLowerCase() === 'image.png';
    const name = generic ? `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}` : orig;
    const file = (blob instanceof File && !generic) ? blob : new File([blob], name, { type: blob.type || 'image/png' });
    setFiles((prev) => [...prev, file]);
  };
  // A finished recording joins the same attachment queue as a picked file, so it travels the one
  // upload path (presigned PUT) everything else uses. The measured length rides ON the File: the
  // send path reads it back as `duration_seconds`, which lets the recipient's thread show "0:14"
  // before a single byte of audio has been fetched.
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
        // 160px left about 68px to type in: the toolbar and the markdown/preview tab row take 92px of
        // it between them. Writing the message is the point of this screen, so on a desktop window the
        // box gets a share of the height instead of a constant. A phone keeps the small default — its
        // composer is the auto-growing single line, and the keyboard owns the bottom half anyway.
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
    // construction (later initialText changes are applied by the effect below via setMarkdown, not a
    // remount) and `saveDraft` is a stable-behavior closure over refs — adding either would destroy +
    // recreate the editor on every render / initialText change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Seed the rich editor with an initial draft (e.g. a Tracked Response suggested reply) once it mounts.
  useEffect(() => {
    if (mode === 'rich' && initialText && editorRef.current) {
      try { editorRef.current.setMarkdown(initialText); } catch (err) { swallowed('components: handleImagePaste', err); }
    }
  }, [mode, initialText]);

  // Focus the composer when the parent bumps focusNonce (e.g. after clicking ↩ Reply on a bubble) so the
  // user can start typing straight away instead of clicking into the editor. A short delay lets the reply
  // bar / editor settle first. Skip the initial 0 so a fresh mount never steals focus / pops the keyboard.
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

  // Resize the Toast UI editor when the expand toggle flips (rich mode sets its own inline height via
  // JS, so a CSS class can't reach it — the fallback/simple textareas are sized by `.inbox-composer--tall`
  // in CSS instead). `160px` matches the construction default.
  useEffect(() => {
    if (mode !== 'rich' || !editorRef.current?.setHeight) return undefined;
    // The editor holds whatever height it was built with, so a window that gets shorter would keep an
    // editor sized for the taller one and squeeze the conversation instead.
    const apply = () => {
      try { editorRef.current.setHeight(bigEditorHeight() + 'px'); } catch (err) { swallowed('components: composer resize', err); }
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [expanded, mode]);

  // Auto-grow the simple (mobile) textarea to fit its content, capped so it never eats the thread. When
  // expanded, the cap lifts to ~60vh so a long draft is fully visible.
  const autoGrow = (ta) => {
    if (!ta) return;
    const cap = expanded && typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : 132;
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, cap) + 'px';
  };
  // Size the simple textarea to any seeded draft on mount (and keep it 1 row when empty); re-fit when the
  // expand cap changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (mode === 'simple') autoGrow(taRef.current); }, [mode, expanded]);

  /**
   * ⤢ / ⤡ — swap the thin chat input for the full editor and back.
   *
   * Not a height toggle. The thin input IS the default because the conversation above it is what the
   * screen is for; the toolbar, the preview tabs and the room to format are a thing you ask for when
   * you are writing something long. The draft travels in both directions, so switching mid-sentence
   * never costs a word.
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
  // Remove one queued attachment before sending (a mis-paste shouldn't force starting the message over).
  // Also clear the hidden file input when the last chip goes, so re-picking the same file fires onChange.
  const removeFile = (idx) => setFiles((prev) => {
    releasePreview(prev[idx]);
    const next = prev.filter((_, j) => j !== idx);
    if (next.length === 0 && fileRef.current) fileRef.current.value = '';
    return next;
  });

  return html`
    <div class="poster-composer poster-composer--stack poster-row--thing inbox-composer ${expanded ? 'inbox-composer--tall' : ''}">
      ${files.length > 0 ? html`<div class="inbox-file-chips">
        ${files.map((f, i) => {
          // A recording gets its own chip with a player: a bad take should be caught here, not in
          // the other person's mailbox.
          const isVoice = (f.type || '').startsWith('audio/') && f.durationSeconds;
          return html`<span class=${`inbox-file-chip${isVoice ? ' inbox-file-chip--voice' : ''}`} key=${f.name + i}>
            ${isVoice
              ? html`<span class="inbox-chip-voice">🎤 ${fmtClock(f.durationSeconds)}
                  <audio class="inbox-audio inbox-audio--chip" controls preload="metadata"
                         src=${f.previewUrl}
                         onPlay=${(e) => stopOtherAudio(e.currentTarget)}></audio></span>`
              : html`<span>📎 ${escHtml(f.name)}</span>`}
            <button class="inbox-bc-chip-x" title=${t('inbox.attachmentRemove')} onClick=${() => removeFile(i)}>✕</button>
          </span>`;
        })}
      </div>` : null}
      ${mode === 'rich'
        // Keys, because the three branches are different DOM shapes sharing one slot. Without them
        // Preact reused the rich editor's <div> as the toolbar row below when switching back to the
        // thin input, and Toast UI's inline height=450px rode along with it — the composer stayed
        // half the pane while the textarea inside it was 40px.
        ? html`<div key="rich" class="inbox-editor" ref=${containerRef}></div>`
        : mode === 'simple'
        ? null
        : html`<div key="fallback" class="inbox-md-fallback">
            <textarea class="inbox-textarea" rows="3" ref=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
              value=${md} onPaste=${handleImagePaste}
              onInput=${(e) => { setMd(e.target.value); saveDraft(e.target.value); }}></textarea>
            <div class="inbox-md-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <!-- The chat's one row (Jouni's decision "Typing box"): the thin field, then attach, voice and
           the bigger editor as three squares, and the dark block that sends with this page's word.
           With the bigger editor open, the editor stands above the row and the row keeps the rest. -->
      <div key="bar" class="poster-composer-row">
        ${mode === 'simple'
          ? html`<textarea key="thin" class="poster-composer-input" rows="1" ref=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
              value=${md} onPaste=${handleImagePaste}
              onInput=${(e) => { setMd(e.target.value); saveDraft(e.target.value); autoGrow(e.target); }}></textarea>`
          : null}
        <label class="poster-icon poster-composer-tool" title=${t('inbox.attach')}>
          📎<input ref=${fileRef} type="file" multiple hidden onChange=${(e) => setFiles(Array.from(e.target.files || []))} />
        </label>
        <${VoiceRecorder} maxSeconds=${voiceMaxSeconds} className="poster-icon poster-composer-tool" plain=${true}
          onRecorded=${addRecording} />
        <button type="button" class=${`poster-icon poster-composer-tool${mode === 'rich' ? ' is-on' : ''}`} title=${mode === 'rich' ? t('inbox.collapse') : t('inbox.expand')}
          aria-pressed=${mode === 'rich'} onClick=${toggleBigEditor}>${mode === 'rich' ? '⤡' : '⤢'}</button>
        <button type="button" class="poster-slab poster-slab--control poster-composer-send" disabled=${sending || !recipient} onClick=${submit}>
          ${sending ? t('inbox.sending') : sendLabel}
        </button>
      </div>
    </div>`;
}

/* ── Agent chat commands (Phase A) — a peer agent advertises fill-in templates via its public
 *    `chat.commands` memory key ([{id,label,description,template,params:[{name,type,required,placeholder,
 *    default,options}]}]). We render a chip per command; the human fills the params; the resulting prose
 *    drops into the composer to review + send. The agent receives the filled template it advertised. ── */
export function CommandBar({ commands, onPick }) {
  return html`<div class="inbox-cmdbar">
    <span class="inbox-cmdbar-label">⚡ ${t('inbox.cmdTitle')}</span>
    ${commands.map(c => html`<button class="inbox-cmd-chip" key=${c.id} title=${c.description || ''}
      onClick=${() => onPick(c)}>${escHtml(c.label || c.id)}</button>`)}
  </div>`;
}

export function CommandFill({ command, onInsert, onCancel }) {
  const [values, setValues] = useState({});
  const params = Array.isArray(command.params) ? command.params : [];
  const valOf = (p) => String(values[p.name] ?? p.default ?? '');
  const missing = params.some(p => p.required && !valOf(p).trim());
  return html`<div class="inbox-cmdfill">
    <div class="inbox-cmdfill-head">⚡ ${escHtml(command.label || command.id)}
      <button class="poster-icon poster-icon--small" onClick=${onCancel} title=${t('inbox.close')}>✕</button></div>
    ${command.description ? html`<div class="inbox-cmdfill-desc">${escHtml(command.description)}</div>` : null}
    ${params.map(p => html`<label class="inbox-cmdfill-field" key=${p.name}>
      <span class="inbox-cmdfill-pname">${escHtml(p.name)}${p.required ? ' *' : ''}</span>
      ${p.type === 'select' && Array.isArray(p.options)
        ? html`<select class="select-field" value=${valOf(p)}
            onChange=${e => setValues(v => ({ ...v, [p.name]: e.target.value }))}>
            ${p.options.map(o => html`<option key=${o} value=${o}>${escHtml(String(o))}</option>`)}</select>`
        : html`<input class="og-input" type=${p.type === 'number' ? 'number' : 'text'}
            placeholder=${p.placeholder || ''} value=${valOf(p)}
            onInput=${e => setValues(v => ({ ...v, [p.name]: e.target.value }))} />`}
    </label>`)}
    <button class="poster-slab poster-slab--control inbox-cmdfill-go" disabled=${missing}
      onClick=${() => onInsert(command, values)}>${t('inbox.cmdInsert')}</button>
  </div>`;
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
  return html`<div class="inbox-sched">
    <div class="inbox-sched-head">📅 ${t('inbox.schedTitle')}
      <button class="poster-icon poster-icon--small" onClick=${onClose} title=${t('inbox.close')}>✕</button></div>
    ${jobs == null ? html`<div class="poster-quiet inbox-empty-sm">${t('inbox.loading')}</div>`
      : jobs.length === 0 ? html`<div class="poster-quiet inbox-empty-sm">${t('inbox.schedNone')}</div>`
      : html`<ul class="inbox-sched-list">${jobs.map(j => html`<li class="inbox-sched-item" key=${j.id}>
          <span class="inbox-sched-name">${escHtml(j.displayName || j.input?.taskTemplate?.title || j.id)}</span>
          <span class="inbox-sched-cron">${escHtml(j.cron)}${j.enabled === false ? ' · ' + t('inbox.schedOff') : ''}</span>
        </li>`)}</ul>`}
    <div class="inbox-sched-new">
      <input class="og-input" placeholder=${t('inbox.schedTaskPh')} value=${title} onInput=${e => setTitle(e.target.value)} />
      <input class="og-input" placeholder="0 9 * * *" value=${cron} onInput=${e => setCron(e.target.value)} />
      <textarea class="og-textarea inbox-sched-desc" placeholder=${t('inbox.schedDescPh')} value=${desc} onInput=${e => setDesc(e.target.value)}></textarea>
      <button class="poster-slab poster-slab--control" disabled=${busy || !title.trim() || !cron.trim()} onClick=${create}>${t('inbox.schedCreate')}</button>
    </div>
  </div>`;
}

/* ── Reply with AI (TARGET-031) — hand the conversation (or one message) to the user's OWN AI chat so
 *    it can craft a reply WITH access to their AIMEAT (organisms, memory, workspaces, librarian). Two
 *    modes: COPY (paste into any AI chat, paste the reply back) and MCP (an AI with the AIMEAT MCP reads
 *    the thread via aimeat_dm_thread, researches, drafts, and sends via aimeat_dm_send after approval).
 *    `build(mode)` returns the prompt for the picked mode; the InboxTab supplies it per source. ── */
export function ReplyWithAiPopover({ title, build, onClose, showToast }) {
  const [mode, setMode] = useState(MODES.COPY);
  const text = build(mode);
  // The two ways are tabs; what the chosen one decides sits under a sun bar (poster-panel).
  return html`
    <${Modal} open=${true} onClose=${onClose} title=${title} size="lg" guard=${false} className="inbox-ai-modal"
      footer=${html`<${CopyButton} text=${text} className="poster-slab poster-slab--control"
        label=${t('common.copy')} copiedLabel=${'✓ ' + t('inbox.ai.copied')}
        onCopied=${() => showToast?.(t('inbox.ai.copied'))} />`}>
      <div class="inbox-ai-modes" role="tablist">
        <button type="button" role="tab" aria-selected=${mode === MODES.COPY} class=${`poster-tab${mode === MODES.COPY ? ' is-on' : ''}`} onClick=${() => setMode(MODES.COPY)}>
          ${t('common.copyPrompt')}
        </button>
        <button type="button" role="tab" aria-selected=${mode === MODES.MCP} class=${`poster-tab${mode === MODES.MCP ? ' is-on' : ''}`} onClick=${() => setMode(MODES.MCP)}>
          ${t('inbox.ai.modeMcp')}
        </button>
      </div>
      <div class="poster-panel">
        <div class="poster-hint">${mode === MODES.COPY ? t('inbox.ai.hintCopy') : t('inbox.ai.hintMcp')}</div>
        <textarea class="og-textarea" readOnly rows="14" value=${text}></textarea>
      </div>
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

  const tab = (id, label) => html`<button type="button" role="tab" aria-selected=${mode === id}
    class=${`poster-tab${mode === id ? ' is-on' : ''}`} onClick=${() => setMode(id)}>${label}</button>`;
  // A summary being written or pasted is a half-written form: Modal's guard keeps it open.
  return html`
    <${Modal} open=${true} onClose=${onClose} title=${title} size="lg" className="inbox-ai-modal">
        <div class="inbox-ai-modes" role="tablist">
          ${tab('ai', t('inbox.notebook.modeAi'))}
          ${tab('copy', t('common.copyPrompt'))}
          ${tab('raw', t('inbox.notebook.modeRaw'))}
        </div>
        <div class="poster-panel">
        ${mode === 'ai' ? html`
          <div class="poster-hint">${t('inbox.notebook.hintAi')}</div>
          ${!aiSummary ? html`
            <div class="inbox-ai-actions">
              <button class="poster-slab poster-slab--control" disabled=${running} onClick=${genSummary}>${running ? '… ' + t('inbox.notebook.summarizing') : '✨ ' + t('inbox.notebook.genSummary')}</button>
            </div>`
          : html`
            <${AiInteractionNotice} titleKey="aiLabel.draftTitle" bodyKey="aiLabel.draftBody"
              recordUrl=${aiProvenance?.recordUrl} />
            <textarea class="og-textarea" rows="12" value=${aiSummary} onInput=${(e) => setAiSummary(e.target.value)}></textarea>
            <div class="inbox-ai-actions">
              <button class="poster-action" disabled=${running} onClick=${genSummary}>${running ? '…' : '↻ ' + t('inbox.notebook.regen')}</button>
              <button class="poster-slab poster-slab--control" disabled=${parking} onClick=${() => doPark(aiSummary)}>${parking ? '…' : '📓 ' + t('inbox.notebook.park')}</button>
            </div>`}
        ` : mode === 'copy' ? html`
          <div class="poster-hint">${t('inbox.notebook.hintCopy')}</div>
          <textarea class="og-textarea" readOnly rows="8" value=${promptText}></textarea>
          <div class="inbox-ai-actions">
            <${CopyButton} text=${promptText} className="poster-slab poster-slab--control"
              label=${'📋 ' + t('common.copy')} copiedLabel=${'✓ ' + t('inbox.ai.copied')}
              onCopied=${() => showToast?.(t('inbox.ai.copied'))} />
          </div>
          <div class="poster-hint">${t('inbox.notebook.pasteHint')}</div>
          <textarea class="og-textarea" rows="8" placeholder=${t('inbox.notebook.pastePh')} value=${pasted} onInput=${(e) => setPasted(e.target.value)}></textarea>
          <div class="inbox-ai-actions">
            <button class="poster-slab poster-slab--control" disabled=${parking || !pasted.trim()} onClick=${() => doPark(pasted)}>${parking ? '…' : '📓 ' + t('inbox.notebook.park')}</button>
          </div>
        ` : html`
          <div class="poster-hint">${t('inbox.notebook.hintRaw')}</div>
          <div class="inbox-ai-actions">
            <button class="poster-slab poster-slab--control" disabled=${parking} onClick=${() => doPark('')}>${parking ? '…' : '📥 ' + t('inbox.notebook.parkRaw')}</button>
          </div>
        `}
        </div>
    <//>`;
}
