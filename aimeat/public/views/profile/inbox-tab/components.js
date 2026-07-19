/**
 * @file public/views/profile/inbox-tab/components.js
 * @description Presentational sub-components for the profile Inbox tab: Avatar, AttachmentItem,
 *   MarkdownViewer, InteractiveForm/InteractiveAnswered (federated AskUserQuestion), PollBuilder,
 *   MessageBubble, Composer (Toast UI editor + markdown fallback), CommandBar/CommandFill (agent
 *   chat.commands), SchedulePanel (own-agent scheduler), and ReplyWithAiPopover (TARGET-031). Each is
 *   self-contained (owns its own hooks). Extracted from inbox-tab.js to satisfy max-file-lines.
 * @version-history
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
 */
import { h } from 'preact';
import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { escHtml } from '/js/utils.js';
import { Markdown } from '/components/Markdown.js';
import { minidenticon } from '/lib/minidenticons.min.js';
import * as schedules from '/js/services/schedules.js';
import { MODES } from '/js/services/messages-ai-prompts.js';
import { loadToastUI, prepareBody, quoteSnippet, statusTick, timeShort, trackStateLabel, ATTACH_ICO, attachKind, IFORM_OTHER } from './helpers.js';

export function Avatar({ seed, size = 36 }) {
  const svg = minidenticon(typeof seed === 'string' && seed ? seed : 'user');
  return html`<span class="inbox-avatar" style=${`width:${size}px;height:${size}px`}
    dangerouslySetInnerHTML=${{ __html: svg }}></span>`;
}

/** One received/sent attachment. Images render as a thumbnail (click → full-size in a new tab);
 *  PDF/audio/video/file open natively in a new tab; markdown opens the in-app rendered viewer. Every
 *  ready attachment gets a download button. Not-yet-duplicated / expired attachments show their state. */
export function AttachmentItem({ a, url, onOpenMarkdown }) {
  const kind = attachKind(a);
  const name = a.name || a.storageKey;
  const ready = !!url && !a.expired;

  if (!ready) {
    const status = a.expired ? t('inbox.attachmentExpired') : (a.mode !== 'duplicate' ? t('inbox.attachmentPending') : null);
    return html`<div class="inbox-attach-chip inbox-attach-chip--pending">
      <span class="inbox-attach-ico">${ATTACH_ICO[kind]}</span>
      <span class="inbox-attach-name">${escHtml(name)}</span>
      ${status ? html`<span class="inbox-attach-pending">${status}</span>` : null}
    </div>`;
  }

  const download = html`<a class="inbox-attach-dl" href=${url} download=${name} title=${t('inbox.attachmentDownload')}>⬇</a>`;

  if (kind === 'image') {
    return html`<div class="inbox-attach-item">
      <a class="inbox-attach-thumb-link" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
        <img class="inbox-attach-thumb" src=${url} alt=${escHtml(name)} loading="lazy" />
      </a>
      <div class="inbox-attach-cap"><span class="inbox-attach-name">${escHtml(name)}</span>${download}</div>
    </div>`;
  }
  if (kind === 'markdown') {
    return html`<div class="inbox-attach-chip">
      <button class="inbox-attach-open" onClick=${() => onOpenMarkdown?.(url, name)} title=${t('inbox.attachmentView')}>
        <span class="inbox-attach-ico">📄</span><span class="inbox-attach-name">${escHtml(name)}</span>
      </button>${download}
    </div>`;
  }
  // pdf / audio / video / file — let the browser open it in a new tab.
  return html`<div class="inbox-attach-chip">
    <a class="inbox-attach-open" href=${url} target="_blank" rel="noopener" title=${t('inbox.attachmentOpen')}>
      <span class="inbox-attach-ico">${ATTACH_ICO[kind]}</span><span class="inbox-attach-name">${escHtml(name)}</span>
    </a>${download}
  </div>`;
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
    <div class="inbox-mdviewer-overlay" onClick=${onClose}>
      <div class="inbox-mdviewer" onClick=${e => e.stopPropagation()}>
        <div class="inbox-mdviewer-head">
          <span class="inbox-mdviewer-title">📄 ${escHtml(name)}</span>
          <div class="inbox-mdviewer-actions">
            <a class="btn-ghost btn-sm" href=${url} target="_blank" rel="noopener">${t('inbox.attachmentOpenRaw')}</a>
            <a class="btn-ghost btn-sm" href=${url} download=${name}>${t('inbox.attachmentDownload')}</a>
            <button class="btn-ghost btn-sm" onClick=${onClose} title=${t('inbox.close')}>✕</button>
          </div>
        </div>
        <div class="inbox-mdviewer-body">
          ${failed ? html`<div class="inbox-empty-sm">${t('inbox.attachmentLoadError')}</div>`
            : text === null ? html`<div class="inbox-empty-sm">…</div>`
            : html`<${Markdown} text=${text} />`}
        </div>
      </div>
    </div>`;
}

/** The interactive question form rendered inline in the thread (a federated AskUserQuestion): radio
 *  groups (single-select), checkbox groups (multiSelect), an always-available "Other" freeform, and a
 *  Submit button gated until every `required` question is answered. */
export function InteractiveForm({ spec, submitting, onSubmit }) {
  const questions = spec?.questions || [];
  const [sel, setSel] = useState(() => {
    const init = {};
    for (const q of questions) init[q.id] = { picks: new Set(), other: '' };
    return init;
  });
  const setQ = (qid, updater) => setSel(prev => ({ ...prev, [qid]: updater(prev[qid] || { picks: new Set(), other: '' }) }));
  const pickSingle = (qid, optId) => setQ(qid, s => ({ picks: new Set([optId]), other: optId === IFORM_OTHER ? s.other : '' }));
  const toggleMulti = (qid, optId) => setQ(qid, s => {
    const picks = new Set(s.picks);
    if (picks.has(optId)) picks.delete(optId); else picks.add(optId);
    return { picks, other: picks.has(IFORM_OTHER) ? s.other : '' };
  });
  const setOther = (qid, text) => setQ(qid, s => ({ picks: s.picks, other: text }));

  const answeredOk = (q) => {
    const s = sel[q.id]; if (!s) return false;
    const realPicks = [...s.picks].filter(p => p !== IFORM_OTHER);
    const otherOk = s.picks.has(IFORM_OTHER) && s.other.trim().length > 0;
    return realPicks.length > 0 || otherOk;
  };
  const canSubmit = questions.every(q => !q.required || answeredOk(q));

  const submit = () => {
    if (!canSubmit || submitting) return;
    const answers = {};
    for (const q of questions) {
      const s = sel[q.id] || { picks: new Set(), other: '' };
      const selected = [...s.picks].filter(p => p !== IFORM_OTHER);
      const other = (s.picks.has(IFORM_OTHER) && s.other.trim()) ? s.other.trim() : null;
      answers[q.id] = { selected, other };
    }
    onSubmit?.(answers);
  };

  const renderOpt = (q, optId, label) => {
    const multi = !!q.multiSelect;
    const on = sel[q.id]?.picks.has(optId);
    return html`
      <label class=${`inbox-iform-opt${on ? ' inbox-iform-opt--on' : ''}`} key=${optId}>
        <input type=${multi ? 'checkbox' : 'radio'} name=${`q-${q.id}`} checked=${!!on}
          onChange=${() => multi ? toggleMulti(q.id, optId) : pickSingle(q.id, optId)} />
        <span class="inbox-iform-opt-label">${escHtml(label)}</span>
      </label>`;
  };

  return html`
    <div class="inbox-iform">
      ${questions.map(q => html`
        <div class="inbox-iform-q" key=${q.id}>
          ${q.header ? html`<span class="inbox-iform-chip">${escHtml(q.header)}</span>` : null}
          <div class="inbox-iform-prompt">${escHtml(q.prompt)}${q.required ? html`<span class="inbox-iform-req"> *</span>` : null}</div>
          <div class="inbox-iform-opts" role=${q.multiSelect ? 'group' : 'radiogroup'}>
            ${(q.options || []).map(o => renderOpt(q, o.id, o.label))}
            ${q.allowOther !== false ? html`
              ${renderOpt(q, IFORM_OTHER, t('inbox.answer.other'))}
              ${sel[q.id]?.picks.has(IFORM_OTHER) ? html`
                <input class="inbox-iform-other" type="text" value=${sel[q.id]?.other || ''}
                  placeholder=${t('inbox.answer.otherPlaceholder')} onInput=${e => setOther(q.id, e.target.value)} />` : null}` : null}
          </div>
        </div>`)}
      <button class="btn-primary btn-sm inbox-iform-submit" disabled=${!canSubmit || submitting} onClick=${submit}>
        ${submitting ? t('inbox.sending') : (spec?.submitLabel || t('inbox.answer.send'))}
      </button>
    </div>`;
}

/** Read-only summary shown on a question bubble once it has been answered. */
export function InteractiveAnswered({ spec, answers }) {
  return html`
    <div class="inbox-iform inbox-iform--done">
      ${(spec?.questions || []).map(q => {
        const a = answers[q.id] || { selected: [], other: null };
        const labels = (q.options || []).filter(o => a.selected.includes(o.id)).map(o => o.label);
        if (a.other) labels.push(`${t('inbox.answer.other')}: ${a.other}`);
        return html`
          <div class="inbox-iform-q" key=${q.id}>
            <span class="inbox-iform-chip">${escHtml(q.header || q.prompt)}</span>
            <div class="inbox-iform-answered">✓ ${labels.length ? escHtml(labels.join(', ')) : '—'}</div>
          </div>`;
      })}
    </div>`;
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
            <input class="inbox-input" placeholder=${t('inbox.pollHeader')} value=${q.header} onInput=${(e) => update(qi, { header: e.target.value })} />
            <button class="inbox-bc-chip-x" title=${t('inbox.pollRemoveQ')} onClick=${() => removeQ(qi)}>✕</button>
          </div>
          <input class="inbox-input" placeholder=${t('inbox.pollPrompt')} value=${q.prompt} onInput=${(e) => update(qi, { prompt: e.target.value })} />
          <div class="inbox-poll-opts">
            ${q.options.map((o, oi) => html`<div class="inbox-poll-opt" key=${o.id}>
              <input class="inbox-input" placeholder=${`${t('inbox.pollOption')} ${oi + 1}`} value=${o.label} onInput=${(e) => updateOpt(qi, oi, e.target.value)} />
              ${q.options.length > 1 ? html`<button class="inbox-bc-chip-x" onClick=${() => removeOpt(qi, oi)}>✕</button>` : null}
            </div>`)}
            <button class="btn-ghost btn-sm" onClick=${() => addOpt(qi)}>+ ${t('inbox.pollAddOption')}</button>
          </div>
          <div class="inbox-poll-flags">
            <label><input type="checkbox" checked=${q.multiSelect} onChange=${(e) => update(qi, { multiSelect: e.target.checked })} /> ${t('inbox.pollMulti')}</label>
            <label><input type="checkbox" checked=${q.allowOther} onChange=${(e) => update(qi, { allowOther: e.target.checked })} /> ${t('inbox.pollAllowOther')}</label>
            <label><input type="checkbox" checked=${q.required} onChange=${(e) => update(qi, { required: e.target.checked })} /> ${t('inbox.pollRequired')}</label>
          </div>
        </div>`)}
      <button class="btn-outline btn-sm" onClick=${addQ}>+ ${t('inbox.pollAddQuestion')}</button>
    </div>`;
}

export function MessageBubble({ msg, mine, urlMap, starred, onStar, onTrack, onPark, onReplyAi, onQuote, quoted, quotedName, onJumpTo, domId, tracked, onOpenMarkdown, answeredWith, onAnswer, submitting }) {
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
  return html`
    <div id=${domId} class=${`inbox-row ${mine ? 'inbox-row--mine' : 'inbox-row--theirs'}`}>
      ${!mine ? html`<${Avatar} seed=${msg.senderGhii} size=${28} />` : null}
      <div class=${`inbox-bubble ${mine ? 'inbox-bubble--mine' : 'inbox-bubble--theirs'}`}>
        <div class="inbox-bubble-actions">
          ${onQuote ? html`<button class="inbox-bubble-act" title=${t('inbox.quoteReply')}
            onClick=${() => onQuote(msg)}>↩</button>` : null}
          <button class=${`inbox-bubble-act${starred ? ' inbox-bubble-act--on' : ''}`} title=${t('inbox.markImportant')}
            onClick=${() => onStar?.(msg)}>${starred ? '⭐' : '☆'}</button>
          <button class=${`inbox-bubble-act${tracked ? ' inbox-bubble-act--on' : ''}`}
            title=${tracked ? `${t('inbox.trackResponse')} — ${trk.text}` : t('inbox.trackResponse')}
            onClick=${() => onTrack?.(msg)}>🔗</button>
          <button class="inbox-bubble-act" title=${t('inbox.parkToNotebook')}
            onClick=${() => onPark?.(msg)}>📓</button>
          <button class="inbox-bubble-act" title=${t('inbox.ai.replyToMessage')}
            onClick=${() => onReplyAi?.(msg)}>✨</button>
        </div>
        ${quoted ? html`<button class="inbox-bubble-quote" onClick=${() => onJumpTo?.(quoted.id)} title=${t('inbox.quoteJump')}>
          <span class="inbox-quote-name">${escHtml(quotedName || '')}</span>
          <span class="inbox-quote-text">${escHtml(quoteSnippet(quoted.body))}</span>
        </button>` : null}
        <div class="inbox-bubble-body"><${Markdown} text=${prepareBody(msg.body, urls, expiredIds)} /></div>
        ${msg.interactive?.role === 'questions' ? (
          answeredWith
            ? html`<${InteractiveAnswered} spec=${msg.interactive} answers=${answeredWith.answers || {}} />`
            : html`<${InteractiveForm} spec=${msg.interactive} submitting=${submitting}
                onSubmit=${(answers) => onAnswer?.(msg, answers)} />`
        ) : null}
        ${nonInline.length > 0 && html`
          <div class="inbox-attach-row">
            ${nonInline.map(a => html`<${AttachmentItem} key=${a.id} a=${a} url=${urls[a.id]} onOpenMarkdown=${onOpenMarkdown} />`)}
          </div>`}
        <div class="inbox-bubble-meta">
          ${trk ? html`<span class=${`inbox-track-badge inbox-track-badge--${trk.tone}`} title=${t('inbox.trackResponse')}>🔗 ${trk.text}</span>` : null}
          <span>${timeShort(msg.createdAt)}</span>
          ${mine && msg.status ? html`<span class=${`inbox-tick${msg.status === 'read' ? ' inbox-tick--read' : ''}${(msg.status === 'failed' || msg.status === 'undeliverable') ? ' inbox-tick--err' : ''}`}>${statusTick(msg.status)}</span>` : null}
        </div>
      </div>
    </div>`;
}

/* Composer — the Toast UI editor (Markdown⇄WYSIWYG toggle, same as workspace documents), with a
 * markdown-textarea + live-preview fallback if the editor can't load. Owns its own draft + file
 * state; calls onSend(recipient, markdown, files, reset). Remount it (via key) per conversation so
 * the draft doesn't leak between threads. */
export function Composer({ recipient, sendLabel, sending, onSend, initialText = '', draftKey = '', focusNonce = 0 }) {
  // Restore an in-progress draft for this conversation/compose (localStorage), or the passed initialText.
  const readDraft = () => { try { return draftKey ? (localStorage.getItem(draftKey) || '') : ''; } catch { return ''; } };
  const seeded = initialText || readDraft();   // an explicit suggested reply wins; else restore a draft
  // 'rich' = Toast UI (desktop); 'simple' = a plain auto-growing textarea (mobile chat input, no toolbar/
  // preview — a phone keyboard + heavy WYSIWYG toolbar is miserable); 'markdown' = the textarea+preview
  // fallback when Toast UI can't load. Mobile opens straight into 'simple' so we never load Toast UI there.
  const isNarrow = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)').matches;
  const [mode, setMode] = useState(isNarrow ? 'simple' : 'rich');
  const [md, setMd] = useState(seeded);
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
      try { if (text && text.trim()) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey); } catch { /* quota */ }
    }, 400);
  };
  const clearDraft = () => { try { if (draftKey) localStorage.removeItem(draftKey); } catch { /* noop */ } };

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
      const Editor = await loadToastUI().catch(() => null);
      if (cancelled) return;
      if (!Editor) { setMode('markdown'); return; }
      if (!containerRef.current) return;
      inst = new Editor({
        el: containerRef.current,
        height: '160px',
        initialEditType: 'markdown',     // open in markdown mode; the built-in toggle switches to WYSIWYG
        previewStyle: 'tab',
        initialValue: seeded,            // seed from a saved draft / suggested reply (remounts via key)
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
      if (inst) { try { inst.destroy(); } catch { /* noop */ } }
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
      try { editorRef.current.setMarkdown(initialText); } catch { /* noop */ }
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
      } catch { /* noop */ }
    }, 60);
    return () => clearTimeout(id);
    // Only focusNonce is the trigger; mode/refs are read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Resize the Toast UI editor when the expand toggle flips (rich mode sets its own inline height via
  // JS, so a CSS class can't reach it — the fallback/simple textareas are sized by `.inbox-composer--tall`
  // in CSS instead). `160px` matches the construction default.
  useEffect(() => {
    if (mode !== 'rich' || !editorRef.current?.setHeight) return;
    const tall = typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : 400;
    try { editorRef.current.setHeight(expanded ? tall + 'px' : '160px'); } catch { /* noop */ }
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

  const getText = () => (mode === 'rich' && editorRef.current) ? editorRef.current.getMarkdown() : md;
  const reset = () => {
    try { editorRef.current?.setMarkdown(''); } catch { /* noop */ }
    setMd(''); setFiles([]); if (fileRef.current) fileRef.current.value = '';
    if (mode === 'simple' && taRef.current) taRef.current.style.height = 'auto';
    clearDraft();   // a sent message is no longer a draft
  };
  const submit = () => onSend(recipient, getText(), files, reset);
  // Remove one queued attachment before sending (a mis-paste shouldn't force starting the message over).
  // Also clear the hidden file input when the last chip goes, so re-picking the same file fires onChange.
  const removeFile = (idx) => setFiles((prev) => {
    const next = prev.filter((_, j) => j !== idx);
    if (next.length === 0 && fileRef.current) fileRef.current.value = '';
    return next;
  });

  return html`
    <div class="inbox-composer ${expanded ? 'inbox-composer--tall' : ''}">
      ${files.length > 0 ? html`<div class="inbox-file-chips">
        ${files.map((f, i) => html`<span class="inbox-file-chip" key=${f.name + i}>📎 ${escHtml(f.name)}
          <button class="inbox-bc-chip-x" title=${t('inbox.attachmentRemove')} onClick=${() => removeFile(i)}>✕</button></span>`)}
      </div>` : null}
      ${mode === 'rich'
        ? html`<div class="inbox-editor" ref=${containerRef}></div>`
        : mode === 'simple'
        ? html`<textarea class="inbox-textarea inbox-textarea--chat" rows="1" ref=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
            value=${md} onPaste=${handleImagePaste}
            onInput=${(e) => { setMd(e.target.value); saveDraft(e.target.value); autoGrow(e.target); }}></textarea>`
        : html`<div class="inbox-md-fallback">
            <textarea class="inbox-textarea" rows="3" ref=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
              value=${md} onPaste=${handleImagePaste}
              onInput=${(e) => { setMd(e.target.value); saveDraft(e.target.value); }}></textarea>
            <div class="inbox-md-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <div class="inbox-composer-bar">
        <div class="inbox-bar-left">
          <label class="inbox-attach-btn" title=${t('inbox.attach')}>
            📎<input ref=${fileRef} type="file" multiple hidden onChange=${(e) => setFiles(Array.from(e.target.files || []))} />
          </label>
          <button type="button" class="inbox-attach-btn" title=${expanded ? t('inbox.collapse') : t('inbox.expand')}
            aria-pressed=${expanded} onClick=${() => setExpanded((v) => !v)}>${expanded ? '⤡' : '⤢'}</button>
        </div>
        <button class="btn-primary btn-sm" disabled=${sending || !recipient} onClick=${submit}>
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
      <button class="btn-ghost btn-sm" onClick=${onCancel} title=${t('inbox.close')}>✕</button></div>
    ${command.description ? html`<div class="inbox-cmdfill-desc">${escHtml(command.description)}</div>` : null}
    ${params.map(p => html`<label class="inbox-cmdfill-field" key=${p.name}>
      <span class="inbox-cmdfill-pname">${escHtml(p.name)}${p.required ? ' *' : ''}</span>
      ${p.type === 'select' && Array.isArray(p.options)
        ? html`<select class="inbox-input" value=${valOf(p)}
            onChange=${e => setValues(v => ({ ...v, [p.name]: e.target.value }))}>
            ${p.options.map(o => html`<option key=${o} value=${o}>${escHtml(String(o))}</option>`)}</select>`
        : html`<input class="inbox-input" type=${p.type === 'number' ? 'number' : 'text'}
            placeholder=${p.placeholder || ''} value=${valOf(p)}
            onInput=${e => setValues(v => ({ ...v, [p.name]: e.target.value }))} />`}
    </label>`)}
    <button class="btn-primary btn-sm inbox-cmdfill-go" disabled=${missing}
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
    catch { setJobs([]); }
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
      <button class="btn-ghost btn-sm" onClick=${onClose} title=${t('inbox.close')}>✕</button></div>
    ${jobs == null ? html`<div class="inbox-empty-sm">${t('inbox.loading')}</div>`
      : jobs.length === 0 ? html`<div class="inbox-empty-sm">${t('inbox.schedNone')}</div>`
      : html`<ul class="inbox-sched-list">${jobs.map(j => html`<li class="inbox-sched-item" key=${j.id}>
          <span class="inbox-sched-name">${escHtml(j.displayName || j.input?.taskTemplate?.title || j.id)}</span>
          <span class="inbox-sched-cron">${escHtml(j.cron)}${j.enabled === false ? ' · ' + t('inbox.schedOff') : ''}</span>
        </li>`)}</ul>`}
    <div class="inbox-sched-new">
      <input class="inbox-input" placeholder=${t('inbox.schedTaskPh')} value=${title} onInput=${e => setTitle(e.target.value)} />
      <input class="inbox-input" placeholder="0 9 * * *" value=${cron} onInput=${e => setCron(e.target.value)} />
      <textarea class="inbox-input inbox-sched-desc" placeholder=${t('inbox.schedDescPh')} value=${desc} onInput=${e => setDesc(e.target.value)}></textarea>
      <button class="btn-primary btn-sm" disabled=${busy || !title.trim() || !cron.trim()} onClick=${create}>${t('inbox.schedCreate')}</button>
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
  const [copied, setCopied] = useState(false);
  const text = build(mode);
  const copy = async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
      setCopied(true); setTimeout(() => setCopied(false), 1800);
      showToast?.(t('inbox.ai.copied'));
    } catch { showToast?.(t('inbox.failed'), true); }
  };
  return html`
    <div class="inbox-ai-overlay" onClick=${onClose}>
      <div class="inbox-ai-modal" onClick=${(e) => e.stopPropagation()}>
        <div class="inbox-ai-head">
          <span class="inbox-ai-title">✨ ${title}</span>
          <button class="btn-ghost btn-sm" onClick=${onClose} title=${t('inbox.close')}>✕</button>
        </div>
        <div class="inbox-ai-modes">
          <button class=${`inbox-ai-mode${mode === MODES.COPY ? ' inbox-ai-mode--on' : ''}`} onClick=${() => setMode(MODES.COPY)}>
            📋 ${t('inbox.ai.modeCopy')}
          </button>
          <button class=${`inbox-ai-mode${mode === MODES.MCP ? ' inbox-ai-mode--on' : ''}`} onClick=${() => setMode(MODES.MCP)}>
            🔌 ${t('inbox.ai.modeMcp')}
          </button>
        </div>
        <div class="inbox-ai-hint">${mode === MODES.COPY ? t('inbox.ai.hintCopy') : t('inbox.ai.hintMcp')}</div>
        <textarea class="inbox-ai-text" readOnly rows="14" value=${text}></textarea>
        <div class="inbox-ai-actions">
          <button class="btn-primary btn-sm" onClick=${copy}>${copied ? '✓ ' + t('inbox.ai.copied') : '📋 ' + t('inbox.ai.copy')}</button>
        </div>
      </div>
    </div>`;
}
