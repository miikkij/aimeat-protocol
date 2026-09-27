/**
 * @file public/components/TextField.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The typed fields of the Field family (C5 of the component plan): TextField, one line
 *   (the Text field, .og-input: an underline that turns coral on focus), and TextArea, many lines
 *   (the Text area, .og-textarea: a frame). A page passes the value, what happens, and named options;
 *   it never writes a class. Given a `label` (or a `hint` or a `message`), the field stands in a Field
 *   (components/Field.js) with its row label, hint and message.
 *
 *   The behaviour lives here, driven by what the page passes: `onInput(value, event)` on every key,
 *   `onChange(value, event)` when the field is left changed, `onEnter(value, event)` on Enter (the
 *   field's form sends; not while an input method is composing), `onEscape(event)` on Escape (a search
 *   empties itself when the page gives no onEscape), `onPaste(text, event)`, `onBlur(value, event)`,
 *   `autoFocus` (the field takes the focus when it appears), `inputRef` for a page that must reach the
 *   element.
 *
 *   TextField named options: `code` (an identifier, in the typewriter face), `secret` (typed hidden,
 *   with the eye inside the field's right end that shows it; `showLabel` and `hideLabel` name the eye;
 *   password managers are told to keep out of a key, unless the page passes `autoComplete`, such as
 *   'new-password' or 'current-password' for a real password),
 *   `unmanaged` (a key typed hidden WITHOUT the eye, main's look for a key field by the lead's ruling:
 *   type password, autocomplete off, password managers told to keep out),
 *   `search` (a search field; `note` is the small count beside it: the Search line), `size` = 'short'
 *   (a number, a time) | 'medium' (a name, a tag), `actions` (buttons in one row after the field),
 *   `box` (that row inside the thin dashed frame: Jouni's decision "Dashed field box"), `invalid`.
 *   TextArea named options: `code`, `rows`, `grow` (grows with what is typed; a number caps it in
 *   pixels, true caps it at 60% of the window), `onSend(value, event)` on Ctrl+Enter or Cmd+Enter,
 *   `indent` (a script editor: Tab puts two spaces in at the caret instead of leaving the field),
 *   `onSave(value, event)` on Ctrl+S or Cmd+S (the browser's own save of the page does not open).
 * @structure TextField(props) · TextArea(props) · Eye({ open })
 * @usage html`<${TextField} label=${t('x.name')} value=${name} onInput=${setName} onEnter=${save} />`
 *        html`<${TextField} secret label=${a('codeLabel')} value=${code} onInput=${setCode} />`
 *        html`<${TextField} ariaLabel=${x('keyLabel')} secret box value=${key} onInput=${setKey}
 *          actions=${html`<${Action} small onClick=${save}>${x('save')}<//>`} />`
 *        html`<${TextArea} label=${t('x.body')} rows=${4} value=${body} onInput=${setBody} />`
 * @version-history
 *   v1.3.0 — 2026-09-27 — TextArea's `indent` (Tab puts two spaces in) and `onSave` (Ctrl+S or Cmd+S):
 *     the admin Extensions page's action-script editors, as main's hand-written textareas did;
 *     additive, admin page group G7.
 *   v1.2.0 — 2026-09-26 — TextField's `noManager` option: a field shown as typed that password
 *     managers keep out of (autocomplete off, data-1p-ignore, data-lpignore: the Wallet's payout
 *     address, as main drew it); additive, page group G7.
 *   v1.1.0 — 2026-09-26 — TextField's `unmanaged` option: a key with no eye that keeps main's
 *     autocomplete="off" data-1p-ignore data-lpignore (the classic AI settings' API key); additive, page
 *     group G4.
 *   v1.0.0 — 2026-09-26 — Initial: the one-line and many-line fields of the Settings forms as
 *     components; the access code's eye moved in from views/profile/apps/build.js UploadForm
 *     (component plan C5).
 */
import { h } from 'preact';
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { useFieldIds, inField, messageOf } from '/components/Field.js';

const html = htm.bind(h);
const cx = (...parts) => parts.filter(Boolean).join(' ');
const SIZES = new Set(['short', 'medium']);

/** The eye: open shows what is typed; the stroke across it says it is shown now. */
function Eye({ open }) {
  return html`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
    <path d="M2 12c2.5-4.5 6-7 10-7s7.5 2.5 10 7c-2.5 4.5-6 7-10 7S4.5 16.5 2 12z" /><circle cx="12" cy="12" r="3" />
    ${open ? html`<path d="M4 4l16 16" />` : null}
  </svg>`;
}

/** One ref for the component and the page's inputRef (an object ref or a function). */
function useBothRefs(inputRef) {
  const own = useRef(null);
  const set = useCallback((el) => {
    own.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    else if (inputRef && typeof inputRef === 'object') inputRef.current = el;
  }, [inputRef]);
  return [own, set];
}

/**
 * The keys every typed field answers: the page's own handler first, then Enter and Escape.
 * @param {{ onKeyDown?: (e: any) => void, onEnter?: (value: string, e: any) => void, onEscape?: (e: any) => void,
 *   onSend?: (value: string, e: any) => void, search?: boolean, onInput?: (value: string, e: any) => void,
 *   multiline?: boolean }} opts
 */
function keyHandler({ onKeyDown, onEnter, onEscape, onSend, search, onInput, multiline }) {
  return (e) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.isComposing) return;
    const value = e.currentTarget.value;
    if (e.key === 'Enter') {
      if (multiline) {
        if (onSend && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(value, e); }
      } else if (onEnter) { e.preventDefault(); onEnter(value, e); }
    } else if (e.key === 'Escape') {
      if (onEscape) { onEscape(e); } else if (search && value && onInput) { e.preventDefault(); onInput('', e); }
    }
  };
}

export function TextField(props) {
  const {
    id, value, placeholder, type, code, secret, search, size, note, actions, box, invalid, error,
    min, max, step, maxLength, inputMode, autoComplete, spellCheck, name, required, disabled, readOnly,
    autoFocus, ariaLabel, title, list, inputRef, showLabel, hideLabel, unmanaged, noManager,
    onInput, onChange, onEnter, onEscape, onBlur, onFocus, onKeyDown, onPaste, onClick,
  } = props;
  // `unmanaged`: a key typed hidden with no eye (main's look for a key); password managers keep out.
  // `noManager` (added by page group G7, Wallet): a field shown as typed that password managers keep
  // out of too (a payout address: main's autocomplete="off" data-1p-ignore data-lpignore).
  const keepOut = (secret || unmanaged || noManager) && !autoComplete;
  const ids = useFieldIds(id);
  const [own, setRef] = useBothRefs(inputRef);
  const [shown, setShown] = useState(false);
  // A secret that the page empties (it was saved) is hidden again for the next one.
  useEffect(() => { if (secret && !value) setShown(false); }, [secret, value]);
  useEffect(() => { if (autoFocus) own.current?.focus(); }, [autoFocus, own]);

  const bad = !!invalid || !!messageOf(props.message, error)?.error;
  const kind = secret ? (shown ? 'text' : 'password') : unmanaged ? 'password' : search ? 'search' : (type || 'text');
  const input = html`<input id=${ids.id} ref=${setRef} name=${name}
    class=${cx('og-input', code && 'og-input--code', SIZES.has(size) && `text-field--${size}`, bad && 'og-input--invalid')}
    type=${kind} value=${value ?? ''} placeholder=${placeholder} title=${title}
    min=${min} max=${max} step=${step} maxLength=${maxLength} inputMode=${inputMode} list=${list}
    autoComplete=${autoComplete ?? (secret || unmanaged || noManager ? 'off' : undefined)} spellCheck=${secret || unmanaged || code ? false : spellCheck}
    data-1p-ignore=${keepOut ? '' : undefined} data-lpignore=${keepOut ? 'true' : undefined}
    required=${required} disabled=${disabled} readOnly=${readOnly}
    aria-label=${ariaLabel} aria-invalid=${bad ? 'true' : undefined}
    aria-describedby=${props.hint ? ids.hintId : undefined}
    onInput=${onInput ? (e) => onInput(e.currentTarget.value, e) : undefined}
    onChange=${onChange ? (e) => onChange(e.currentTarget.value, e) : undefined}
    onBlur=${onBlur ? (e) => onBlur(e.currentTarget.value, e) : undefined}
    onFocus=${onFocus} onClick=${onClick}
    onPaste=${onPaste ? (e) => onPaste(e.clipboardData?.getData('text') ?? '', e) : undefined}
    onKeyDown=${keyHandler({ onKeyDown, onEnter, onEscape, search, onInput })} />`;

  const what = shown ? (hideLabel || t('field.secretHide')) : (showLabel || t('field.secretShow'));
  let control = secret
    ? html`<span class="text-field-secret">${input}<button type="button" class="text-field-eye"
        aria-pressed=${shown ? 'true' : 'false'} aria-label=${what} title=${what} disabled=${disabled}
        onClick=${() => setShown((s) => !s)}><${Eye} open=${shown} /></button></span>`
    : input;
  if (search && note !== undefined && note !== null) control = html`<div class="search-line">${control}<small>${note}</small></div>`;
  if (actions || box) control = html`<div class=${box ? 'field-row' : 'field-line'}>${control}${actions}</div>`;
  return inField(props, ids, control, false);
}

export function TextArea(props) {
  const {
    id, value, placeholder, rows, code, grow, invalid, error, maxLength, spellCheck, name, required,
    disabled, readOnly, autoFocus, ariaLabel, title, inputRef, indent,
    onInput, onChange, onSend, onSave, onEscape, onBlur, onFocus, onKeyDown, onPaste,
  } = props;
  // indent and onSave (added by admin page group G7): a script editor keeps Tab for two spaces at the
  // caret and saves on Ctrl+S / Cmd+S, as main's action-script editors did by hand.
  const keys = keyHandler({ onKeyDown, onSend, onEscape, multiline: true });
  const onKey = (e) => {
    keys(e);
    if (e.defaultPrevented) return;
    if (indent && e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      ta.value = ta.value.substring(0, start) + '  ' + ta.value.substring(ta.selectionEnd);
      ta.selectionStart = ta.selectionEnd = start + 2;
      onInput?.(ta.value, e);
    } else if (onSave && e.key === 's' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      onSave(e.currentTarget.value, e);
    }
  };
  const ids = useFieldIds(id);
  const [own, setRef] = useBothRefs(inputRef);
  useEffect(() => { if (autoFocus) own.current?.focus(); }, [autoFocus, own]);
  // Growing: the box fits what is typed (a seeded draft too), up to its cap.
  const fit = useCallback((el) => {
    if (!el || !grow) return;
    const cap = typeof grow === 'number' ? grow : Math.round((typeof window !== 'undefined' ? window.innerHeight : 800) * 0.6);
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
  }, [grow]);
  useLayoutEffect(() => { fit(own.current); }, [value, fit, own]);

  const bad = !!invalid || !!messageOf(props.message, error)?.error;
  const control = html`<textarea id=${ids.id} ref=${setRef} name=${name}
    class=${cx('og-textarea', code && 'og-textarea--code', grow && 'text-area--grow', bad && 'og-textarea--invalid')}
    rows=${rows} value=${value ?? ''} placeholder=${placeholder} title=${title} maxLength=${maxLength}
    spellCheck=${code ? false : spellCheck} required=${required} disabled=${disabled} readOnly=${readOnly}
    aria-label=${ariaLabel} aria-invalid=${bad ? 'true' : undefined}
    aria-describedby=${props.hint ? ids.hintId : undefined}
    onInput=${(e) => { fit(e.currentTarget); onInput?.(e.currentTarget.value, e); }}
    onChange=${onChange ? (e) => onChange(e.currentTarget.value, e) : undefined}
    onBlur=${onBlur ? (e) => onBlur(e.currentTarget.value, e) : undefined}
    onFocus=${onFocus}
    onPaste=${onPaste ? (e) => onPaste(e.clipboardData?.getData('text') ?? '', e) : undefined}
    onKeyDown=${onKey}></textarea>`;
  return inField(props, ids, control, false);
}

export default TextField;
