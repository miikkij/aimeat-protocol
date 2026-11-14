/**
 * @file public/views/profile/vault/content.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A secret's content, where a person types or picks it (the Share dialog of the Vault page
 *   and the deposit page) and where it is shown again (the pickup page). Three formats, as the server
 *   takes them (services/secret-shares/rules.ts normalizeContent): text (a key, a password, a token),
 *   pairs (NAME=value lines, such as an .env file) and file (read here into base64). The same content
 *   becomes either the body an open or sealed share sends, or, for an end-to-end share, the object
 *   public/js/vault-crypto.js seals in this browser before anything leaves it.
 * @structure emptyContent · contentReady · contentFields · plainBody · contentObject · contentBytes ·
 *   e2eBody · revealBlock · downloadFile
 * @usage import { emptyContent, contentFields, plainBody, e2eBody } from './content.js';
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { h } from 'preact';
import htm from 'htm';
import { fmtBytes } from '/js/format.js';
import { swallowed } from '/js/swallowed.js';
import { Choice } from '/components/Choice.js';
import { Fields } from '/components/Field.js';
import { TextField, TextArea } from '/components/TextField.js';
import { FileDrop } from '/components/FileDrop.js';
import { Note } from '/components/Note.js';
import { Code } from '/components/Mark.js';
import { Action, Actions } from '/components/Action.js';
import { Stack } from '/components/Layout.js';
import { sealForRecipients } from '/js/vault-crypto.js';
import { x } from './frame.js';

const html = htm.bind(h);
const enc = new TextEncoder();

/** A content form before anything is typed. */
export const emptyContent = () => ({ format: 'text', text: '', pairs: '', file: null, reading: false, readFailed: false });

/** Whether the content can be sent. */
export function contentReady(c) {
  if (c.format === 'file') return !!c.file && !c.reading;
  if (c.format === 'pairs') return !!c.pairs.trim();
  return !!c.text;
}

/** A picked file read into base64, with its name, type and size. */
function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve({ name: file.name, type: file.type || 'application/octet-stream', size: file.size, base64: String(r.result).replace(/^data:[^,]*,/, '') });
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/**
 * The format choice and the field for it. `set(patch)` merges into the content state.
 * @param {any} c the content state
 * @param {(patch: object) => void} set
 * @param {{ prefix?: string, disabled?: boolean }} [opts] `prefix` names the radio group on the page
 */
export function contentFields(c, set, opts = {}) {
  const { prefix = 'vs', disabled = false } = opts;
  const pick = async (file) => {
    if (!file) return;
    set({ reading: true, readFailed: false, file: null });
    try { set({ file: await readFile(file), reading: false }); }
    catch (err) { swallowed('vault: read file', err); set({ reading: false, readFailed: true }); }
  };
  return html`
    <${Stack}>
      <${Choice} boxed dot cols=${3} name=${prefix + '-format'} label=${x('content.formatLabel')} value=${c.format} disabled=${disabled}
        onChange=${(v) => set({ format: v })}
        options=${[
          { value: 'text', label: x('format.text'), hint: x('content.textHint') },
          { value: 'pairs', label: x('format.pairs'), hint: x('content.pairsHint') },
          { value: 'file', label: x('format.file'), hint: x('content.fileHint') },
        ]} />
      <${Fields}>
        ${c.format === 'text' ? html`
          <${TextField} secret label=${x('content.text')} value=${c.text} disabled=${disabled} autoComplete="off"
            placeholder=${x('content.textPlaceholder')} onInput=${(v) => set({ text: v })} />` : null}
        ${c.format === 'pairs' ? html`
          <${TextArea} code rows=${6} label=${x('content.pairs')} value=${c.pairs} disabled=${disabled} maxLength=${1048576} spellCheck=${false}
            placeholder=${'API_KEY=…\nAPI_URL=https://…'} onInput=${(v) => set({ pairs: v })} />` : null}
        ${c.format === 'file' ? html`
          <${FileDrop} button=${x('content.pickFile')} disabled=${disabled || c.reading} label=${x('content.file')}
            onFiles=${([f]) => pick(f)} />
          ${c.reading ? html`<${Note} kind="loading">${x('content.reading')}<//>` : null}
          ${c.readFailed ? html`<${Note} kind="message" error>${x('content.readFailed')}<//>` : null}
          ${c.file ? html`<${Note}>${x('content.chosen', { name: c.file.name, size: fmtBytes(c.file.size) })}<//>` : null}` : null}
      <//>
    <//>`;
}

/** The body an open or sealed share or deposit sends: content as text, or a file as base64. */
export function plainBody(c) {
  if (c.format === 'file') return { format: 'file', content_base64: c.file.base64, file_name: c.file.name, content_type: c.file.type };
  return { format: c.format, content: c.format === 'pairs' ? c.pairs : c.text };
}

/** The object an end-to-end share seals (vault-crypto.js): { format, text | content_base64, file_name, content_type }. */
export function contentObject(c) {
  if (c.format === 'file') return { format: 'file', content_base64: c.file.base64, file_name: c.file.name, content_type: c.file.type };
  return { format: c.format, text: c.format === 'pairs' ? c.pairs : c.text };
}

/** The content's own size in bytes: the text's UTF-8 length, or the file's. */
export function contentBytes(c) {
  if (c.format === 'file') return c.file?.size || 0;
  return enc.encode(c.format === 'pairs' ? c.pairs : c.text).length;
}

/**
 * The body an end-to-end share or deposit sends: the content sealed in this browser for every device
 * given (and for a code), with what the node may know about it.
 */
export async function e2eBody(c, devices, code) {
  let sealed;
  try {
    sealed = await sealForRecipients(contentObject(c), devices, code);
  } catch (err) {
    // A registered public key the browser cannot use (not a point on P-256) stops the whole share:
    // leaving that device out would leave its person with a secret that opens nowhere.
    swallowed('vault: seal', err);
    const e = new Error(x('err.SEAL_FAILED'));
    /** @type {any} */ (e).code = 'SEAL_FAILED';
    throw e;
  }
  return {
    format: c.format, size_bytes: contentBytes(c), ...(c.format === 'file' ? { file_name: c.file.name } : {}),
    envelope: sealed.envelope, e2e_keys: sealed.e2e_keys,
    ...(sealed.code_salt ? { code_salt: sealed.code_salt, code_verifier: sealed.code_verifier } : {}),
  };
}

/** Save a file's content (base64) under its name in the browser's downloads. */
export function downloadFile(content) {
  const bin = atob(content.content_base64 || '');
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: content.content_type || 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = content.file_name || 'secret.bin';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The content a pickup returned: text with its copy button, or a file with its download button. */
export function revealBlock(content) {
  if (!content) return null;
  if (content.format === 'file') {
    return html`
      <${Stack} gap="small">
        <${Note} kind="lead">${x('reveal.fileSaved', { name: content.file_name || 'secret.bin' })}<//>
        <${Actions}><${Action} small onClick=${() => downloadFile(content)}>${x('reveal.downloadAgain')}<//><//>
      <//>`;
  }
  const text = content.text || '';
  return html`
    <${Stack} gap="small">
      <${Code} block>${text}<//>
      <${Actions}><${Action} small copy=${text} copiedLabel=${x('copied')}>${x('copy')}<//><//>
    <//>`;
}
