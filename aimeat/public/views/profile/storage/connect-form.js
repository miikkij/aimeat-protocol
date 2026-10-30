/**
 * @file public/views/profile/storage/connect-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The form that connects one of a person's own stores on the page "Your own storage"
 *   (views/profile/storage-tab.js): the store's name (the first one is "main" unless the person names
 *   it; a name they already use gives that store new keys), whether it becomes the default, the address
 *   and keys of an S3 bucket or an Azure Blob container (store-fields.js), an optional folder, and the
 *   reason an operator reads when the rule here is that an operator approves. PUT /v1/file-store tests
 *   the storage (write, read, read part, list, remove) before it saves anything; the form shows each
 *   step of a passed test, or the refusal in the reader's words (store-words.js). The keys are typed
 *   hidden, never sent back by the node, and the form empties them after every send. Every part is a
 *   library component; the form passes data and writes no class.
 * @structure S · placeWords · ConnectForm({ mode, approved, names, onConnected, clearSignal }) · TestSteps
 * @usage html`<${ConnectForm} mode=${v.mode} approved=${approved} names=${v.stores.map((s) => s.name)} onConnected=${reload} />`
 * @version-history
 *   v1.2.0 — 2026-10-30 — Named stores (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-):
 *     the name field and "Make this the default"; `names` (the stores the person has) replaces
 *     `replacing`, and the form says when a name gives an existing store new keys. The address and key
 *     fields moved to store-fields.js, shared with the admin form. A refusal reads in the reader's words.
 *   v1.1.0 — 2026-10-29 — placeWords: where a storage is, built from the API's `place` in the reader's
 *     language (the English `where` only as a fallback). The secret fields empty after every send,
 *     a refused one too, and after Disconnect (`clearSignal`).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { connectMyFileStore } from '/js/services/file-store.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Check } from '/components/Check.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Tick } from '/components/List.js';
import { Stack, Space } from '/components/Layout.js';
import { swallowed } from '/js/swallowed.js';
import { EMPTY_STORE, withoutSecrets, lackingOf, storeBody, StoreFields } from './store-fields.js';
import { refusalWords, RefusalNote } from './store-words.js';

const html = htm.bind(h);
/** One word of the page "Your own storage". */
export const S = (key, params) => t('profile.storage.' + key, params);

/** A store's name: what a person types to choose it (src/services/file-store/store-target.ts STORE_NAME). */
export const STORE_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** The name of a person's first store when they name none (owner-file-store.ts LEGACY_STORE_NAME). */
const FIRST_NAME = 'main';

const EMPTY = { ...EMPTY_STORE, name: '', prefix: '', reason: '' };

/**
 * Where a storage is, in the reader's language, built from the API's `place` ({ kind, name, at }):
 * an S3 bucket at a service host (or at Amazon S3 when `at` is empty), or an Azure container in a
 * storage account. The API's English `where` is the fallback for an answer with no `place`.
 */
export function placeWords(place, where) {
  if (!place || !place.name) return where || '';
  if (place.kind === 's3') return t(place.at ? 'fileStore.place.s3' : 'fileStore.place.s3Amazon', { name: place.name, at: place.at });
  return t(place.at ? 'fileStore.place.azure' : 'fileStore.place.azureBare', { name: place.name, at: place.at });
}

/** A test step (write, read, read part, list, remove) in words; an unknown step as the node named it. */
function stepWord(step) {
  const key = 'fileStore.step.' + String(step).replace(/\s+/g, '_');
  const w = t(key);
  return w && w !== key ? w : String(step);
}

/** The steps of one connection test, each ticked done or failed, with the store's message under a failure. */
export function TestSteps({ steps }) {
  return html`
    <${List} cols="mark-name" dense>
      ${(steps || []).map((s) => html`
        <${Row} key=${s.step}>
          <${Tick} state=${s.ok ? 'done' : 'failed'} title=${s.ok ? t('fileStore.stepOk') : t('fileStore.stepFailed')} />
          <${Name} desc=${s.ok ? undefined : (s.message || t('fileStore.noAnswer'))}>${stepWord(s.step)}<//>
        <//>`)}
    <//>`;
}

/** What the form says once a store was saved: waiting for an operator, the default now, or one to choose. */
function savedWords(outcome, isDefault) {
  if (outcome === 'waiting_for_operator') return S('form.waiting');
  return isDefault ? S('form.connected') : S('form.connectedOther');
}

/**
 * The connect form. `mode` is the rule here ('operator' | 'self'); `approved` whether an operator has
 * approved this person; `names` the names of the stores the person has; `onConnected(data)` gets the
 * node's answer ({ outcome, test, view }) after a store was saved; a change of `clearSignal` (the page
 * bumps it after Disconnect) empties the secret fields.
 */
export function ConnectForm({ mode, approved, names = [], onConnected, clearSignal }) {
  const [kind, setKind] = useState('s3');
  const [f, setF] = useState(EMPTY);
  const [makeDefault, setMakeDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (name) => (v) => setF((cur) => ({ ...cur, [name]: v }));
  const asksReason = mode === 'operator' && !approved;
  useEffect(() => { if (clearSignal) setF(withoutSecrets); }, [clearSignal]);

  const first = names.length === 0;
  const name = f.name.trim() || (first ? FIRST_NAME : '');
  const nameBad = !!f.name.trim() && !STORE_NAME.test(f.name.trim());
  const replacing = !!name && names.includes(name);
  const lacking = [!name && S('form.name'), ...lackingOf(kind, f)].filter(Boolean);

  const send = async () => {
    if (lacking.length || nameBad || busy) return;
    const body = {
      name, ...(makeDefault && !first ? { make_default: true } : {}), ...storeBody(kind, f),
      ...(f.prefix.trim() ? { prefix: f.prefix.trim() } : {}), ...(asksReason && f.reason.trim() ? { reason: f.reason.trim() } : {}),
    };
    setBusy(true);
    setResult(null);
    try {
      const r = await connectMyFileStore(body);
      const view = r.data.view || {};
      setResult({ outcome: r.data.outcome, steps: r.data.test?.steps || [], isDefault: view.default_store === `own:${name}` });
      // The keys leave the page once the node has them: the form never holds a saved secret.
      setF((cur) => ({ ...withoutSecrets(cur), access_key_id: '', reason: '', name: '' }));
      setMakeDefault(false);
      onConnected?.(r.data);
    } catch (e) {
      // The node names what failed (a missing field, the test step, files still in the old place); it
      // stays under the button. The secrets go here too: a key typed once is never left in the page.
      swallowed('storage-tab: connect', e);
      setF(withoutSecrets);
      setResult({ refusal: refusalWords(e) });
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Stack} gap="medium">
      <${Note} kind="lead">${first ? S('form.lead') : S('form.leadMore')}<//>
      <${Fields} cols=${2}>
        <${TextField} label=${S('form.name')} hint=${replacing ? S('form.nameReplaces', { name }) : S('form.nameHint')} value=${f.name}
          code size="medium" maxLength=${40} placeholder=${first ? FIRST_NAME : ''} onInput=${(v) => set('name')(v.toLowerCase())}
          invalid=${nameBad} message=${nameBad ? { text: S('form.nameBad'), error: true } : undefined} />
      <//>
      ${first ? null : html`
        <${Check} checked=${makeDefault} onChange=${setMakeDefault} hint=${S('form.makeDefaultHint')}>${S('form.makeDefault')}<//>`}
      <${StoreFields} kind=${kind} onKind=${(v) => { setKind(v); setResult(null); }} f=${f} set=${set} onEnter=${send} />
      <${Fields} cols=${asksReason ? 2 : undefined}>
        <${TextField} label=${S('form.folder')} hint=${S('form.folderHint')} value=${f.prefix} code maxLength=${200} onInput=${set('prefix')} />
        ${asksReason ? html`
          <${TextField} label=${S('form.reason')} hint=${S('form.reasonHint')} value=${f.reason} maxLength=${500} onInput=${set('reason')} />` : null}
      <//>
      <${Space} above="small">
        <${FormActions} apart>
          <${Action} small control disabled=${busy || lacking.length > 0 || nameBad} onClick=${send}>
            ${busy ? S('form.testing') : replacing ? S('form.connectReplace') : S('form.connect')}
          <//>
          <${Note} kind="hint" inline>
            ${lacking.length ? S('form.fillFirst', { fields: lacking.join(', ') }) : S('form.testFirst')}
          <//>
        <//>
      <//>
      ${result && result.refusal ? html`<${RefusalNote} refusal=${result.refusal} />` : null}
      ${result && !result.refusal ? html`
        <${Note} kind="message">${savedWords(result.outcome, result.isDefault)}<//>
        <${TestSteps} steps=${result.steps} />` : null}
    <//>`;
}
