/**
 * @file public/components/MessageComposer.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The message tone of the Composer (components/Composer.js `tone="message"`, component
 *   plan C2): where a person writes a message to another person or their agent, laid out as Messages
 *   has it on main. The field takes the whole width; its tools sit under it (attach 📎, the voice
 *   recorder, ⤢/⤡ the bigger editor) and the loud action that sends stands at the end of that line.
 *   The field is the chat's (the thick line under it), the tools the framed squares and the send the
 *   dark block, by Jouni's decision "Typing box". The composer owns its draft and its files; the page
 *   gives the recipient, the words of the send button and what sending does. The look is
 *   css/components/composer.css (.poster-composer--message and its parts).
 *
 *   What it keeps, every one from main's views/profile/inbox-tab/components.js Composer:
 *   - the draft saved per conversation (`draftKey`, localStorage, debounced), restored on return and
 *     cleared on send; a suggested reply given as `initialText` wins over a saved draft;
 *   - the thin line that grows with its words up to a ceiling, the way every chat works;
 *   - ⤢ swaps in the Toast UI editor (Markdown and WYSIWYG, loaded only when asked), ⤡ swaps back, and
 *     the draft travels both ways; a Markdown field with a preview when the editor cannot load;
 *   - a pasted or dropped picture joins the file queue instead of going into the words as base64;
 *   - the queue's chips, each with ✕; a recording's chip carries a player and its length;
 *   - `focusNonce`: bumping it puts the cursor in the field (after ↩ Reply on a message);
 *   - `sending`: the button says it is sending and does not send twice.
 * @structure MessageComposer({ recipient, sendLabel, sending, onSend, initialText, draftKey,
 *   focusNonce, voiceMaxSeconds }) · loadToastUI() · bigEditorHeight()
 * @usage html`<${Composer} tone="message" key=${'c-' + convId} recipient=${peer} sendLabel=${t('inbox.reply')}
 *          sending=${sending} onSend=${(recipient, markdown, files, reset) => …} draftKey=${'aimeat.inbox.draft.' + convId} />`
 *   Remount it (a `key` per conversation) so a draft never leaks between threads.
 * @version-history
 *   v1.0.0 — 2026-09-26 — Moved out of views/profile/inbox-tab/components.js (Composer) with every
 *     behaviour unchanged, and loadToastUI and bigEditorHeight with it from inbox-tab/helpers.js. Put
 *     back main's layout the previous branch lost: the field on a line of its own over the whole
 *     width, its tools under it.
 */
import { h } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Markdown } from '/components/Markdown.js';
import { VoiceRecorder } from '/components/VoiceRecorder.js';
import { Loud } from '/components/Action.js';
import { fmtClock, VoicePlayer } from '/components/MessageFile.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);

/* Lazy-load the vendored Toast UI Editor (MIT, /lib/toastui/) — the same editor the workspace
 * document space uses, so composing a message feels like editing a document (Markdown⇄WYSIWYG).
 * ~520KB, so it stays out of the main bundle and loads only when someone asks for the bigger editor. */
let _tuiPromise = null;
export function loadToastUI() {
  if (window.toastui && window.toastui.Editor) return Promise.resolve(window.toastui.Editor);
  if (_tuiPromise) return _tuiPromise;
  _tuiPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-tui]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = '/lib/toastui/toastui-editor.min.css'; css.setAttribute('data-tui', '1');
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = '/lib/toastui/toastui-editor-all.min.js';
    s.onload = () => (window.toastui && window.toastui.Editor) ? resolve(window.toastui.Editor) : reject(new Error('editor missing'));
    s.onerror = () => reject(new Error('failed to load editor'));
    document.head.appendChild(s);
  });
  return _tuiPromise;
}

/**
 * How tall the big editor opens when someone asks for it with ⤢.
 *
 * The default composer is the thin auto-growing line; this is the other state. Roughly half the
 * window, floored so it is worth the switch and capped so the conversation never disappears behind it.
 */
export function bigEditorHeight() {
  if (typeof window === 'undefined') return 320;
  return Math.min(560, Math.max(240, Math.round(window.innerHeight * 0.5)));
}

/* Owns its own draft + file state; calls onSend(recipient, markdown, files, reset). */
export function MessageComposer({
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
  // storage + rendered as an image on the message) — never base64-inlined into the body, which would
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
      const Editor = await loadToastUI().catch(err => { swallowed('message-composer: loadToastUI', err); return null; });
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
      if (inst) { try { inst.destroy(); } catch (err) { swallowed('message-composer: destroy', err); } }
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
      try { editorRef.current.setMarkdown(initialText); } catch (err) { swallowed('message-composer: seed', err); }
    }
  }, [mode, initialText]);

  // Focus the composer when the parent bumps focusNonce (e.g. after pressing ↩ Reply on a message) so
  // the user can start typing straight away instead of clicking into the editor. A short delay lets the
  // reply bar / editor settle first. Skip the initial 0 so a fresh mount never steals focus / pops the keyboard.
  useEffect(() => {
    if (!focusNonce) return undefined;
    const id = setTimeout(() => {
      try {
        if (mode === 'rich' && editorRef.current?.focus) editorRef.current.focus();
        else if (taRef.current) taRef.current.focus();
      } catch (err) { swallowed('message-composer: focus', err); }
    }, 60);
    return () => clearTimeout(id);
    // Only focusNonce is the trigger; mode/refs are read at fire time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  // Resize the Toast UI editor when the expand toggle flips (rich mode sets its own inline height via
  // JS, so a CSS class can't reach it — the fallback textarea is sized by `.poster-composer--tall` in
  // CSS instead).
  useEffect(() => {
    if (mode !== 'rich' || !editorRef.current?.setHeight) return undefined;
    // The editor holds whatever height it was built with, so a window that gets shorter would keep an
    // editor sized for the taller one and squeeze the conversation instead.
    const apply = () => {
      try { editorRef.current.setHeight(bigEditorHeight() + 'px'); } catch (err) { swallowed('message-composer: resize', err); }
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [expanded, mode]);

  // Auto-grow the thin field to fit its content, capped so it never eats the thread. When expanded,
  // the cap lifts to ~60vh so a long draft is fully visible.
  const autoGrow = (ta) => {
    if (!ta) return;
    const cap = expanded && typeof window !== 'undefined' ? Math.round(window.innerHeight * 0.6) : 132;
    ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, cap) + 'px';
  };
  // Size the thin field to any seeded draft on mount (and keep it 1 row when empty); re-fit when the
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
    try { editorRef.current?.setMarkdown(''); } catch (err) { swallowed('message-composer: reset', err); }
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

  const bigWord = mode === 'rich' ? t('inbox.collapse') : t('inbox.expand');
  return html`
    <div class=${`poster-composer poster-composer--message poster-row--thing${expanded ? ' poster-composer--tall' : ''}`}>
      ${files.length > 0 ? html`<div class="poster-composer-chips">
        ${files.map((f, i) => {
          // A recording gets its own chip with a player: a bad take should be caught here, not in
          // the other person's mailbox.
          const isVoice = (f.type || '').startsWith('audio/') && f.durationSeconds;
          return html`<span class=${`poster-composer-chip${isVoice ? ' poster-composer-chip--voice' : ''}`} key=${f.name + i}>
            ${isVoice
              ? html`<span class="poster-composer-chip-voice">🎤 ${fmtClock(f.durationSeconds)}
                  <${VoicePlayer} small src=${f.previewUrl} /></span>`
              : html`<span>📎 ${f.name}</span>`}
            <button type="button" class="poster-composer-chip-x" title=${t('inbox.attachmentRemove')} aria-label=${t('inbox.attachmentRemove')}
              onClick=${() => removeFile(i)}>✕</button>
          </span>`;
        })}
      </div>` : null}
      ${mode === 'rich'
        // Keys, because the three branches are different DOM shapes sharing one slot. Without them
        // Preact reused the rich editor's <div> as the tool line below when switching back to the
        // thin input, and Toast UI's inline height=450px rode along with it — the composer stayed
        // half the pane while the textarea inside it was 40px.
        ? html`<div key="rich" class="poster-composer-editor" ref=${containerRef}></div>`
        : mode === 'simple'
        ? html`<textarea key="thin" class="poster-composer-input" rows="1" ref=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
            value=${md} onPaste=${handleImagePaste}
            onInput=${(e) => { setMd(e.target.value); saveDraft(e.target.value); autoGrow(e.target); }}></textarea>`
        : html`<div key="fallback" class="poster-composer-fallback">
            <textarea class="poster-composer-area" rows="3" ref=${taRef} placeholder=${t('inbox.bodyPlaceholder')}
              value=${md} onPaste=${handleImagePaste}
              onInput=${(e) => { setMd(e.target.value); saveDraft(e.target.value); }}></textarea>
            <div class="poster-composer-preview"><${Markdown} text=${md} /></div>
          </div>`}
      <div key="bar" class="poster-composer-bar">
        <div class="poster-composer-tools">
          <label class="poster-icon poster-composer-tool" title=${t('inbox.attach')}>
            📎<input ref=${fileRef} type="file" multiple hidden onChange=${(e) => setFiles(Array.from(e.target.files || []))} />
          </label>
          <${VoiceRecorder} maxSeconds=${voiceMaxSeconds} className="poster-icon poster-composer-tool" plain=${true}
            onRecorded=${addRecording} />
          <button type="button" class=${`poster-icon poster-composer-tool${mode === 'rich' ? ' is-on' : ''}`} title=${bigWord}
            aria-label=${bigWord} aria-pressed=${mode === 'rich'} onClick=${toggleBigEditor}>${mode === 'rich' ? '⤡' : '⤢'}</button>
        </div>
        <${Loud} control disabled=${sending || !recipient} onClick=${submit}>${sending ? t('inbox.sending') : sendLabel}<//>
      </div>
    </div>`;
}

export default MessageComposer;
