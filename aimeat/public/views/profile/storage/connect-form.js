/**
 * @file public/views/profile/storage/connect-form.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The form that connects a person's own storage on the page "Your own storage"
 *   (views/profile/storage-tab.js): an S3 bucket (Amazon S3 or any S3-compatible service: the address
 *   empty for Amazon S3, the region, the bucket, the access key id and its secret, how the bucket is
 *   named in the address) or an Azure Blob container (the account, the container, and one credential:
 *   the account key, a connection string or a container SAS URL), an optional folder, and the reason
 *   an operator reads when the rule here is that an operator approves. PUT /v1/file-store tests the
 *   storage (write, read, read part, list, remove) before it saves anything; the form shows each step
 *   of a passed test, or the refusal in the node's words. The keys are typed hidden, never sent back by
 *   the node, and the form empties them after every send. Every part is a library component; the form
 *   passes data and writes no class.
 * @structure S · placeWords · ConnectForm({ mode, approved, replacing, onConnected, clearSignal }) · TestSteps
 * @usage html`<${ConnectForm} mode=${v.mode} approved=${approved} replacing=${!!v.store} onConnected=${reload} />`
 * @version-history
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
import { Choice } from '/components/Choice.js';
import { TextField } from '/components/TextField.js';
import { Fields, FormActions } from '/components/Field.js';
import { Action } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { List, Row, Name, Tick } from '/components/List.js';
import { Stack, Space } from '/components/Layout.js';
import { swallowed } from '/js/swallowed.js';

const html = htm.bind(h);
/** One word of the page "Your own storage". */
export const S = (key, params) => t('profile.storage.' + key, params);

const EMPTY = {
  endpoint: '', region: '', bucket: '', access_key_id: '', secret_access_key: '', addressing: 'auto',
  account: '', container: '', credential: '', prefix: '', reason: '',
};

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

/** The form's fields with every secret emptied: the S3 secret and the Azure credential. */
const withoutSecrets = (cur) => ({ ...cur, secret_access_key: '', credential: '' });

/**
 * The connect form. `mode` is the rule here ('operator' | 'self'); `approved` whether an operator has
 * approved this person; `replacing` whether a storage is connected already; `onConnected(data)` gets
 * the node's answer ({ outcome, test, view }) after a connection was saved; a change of `clearSignal`
 * (the page bumps it after Disconnect) empties the secret fields.
 */
export function ConnectForm({ mode, approved, replacing, onConnected, clearSignal }) {
  const [kind, setKind] = useState('s3');
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const set = (name) => (v) => setF((cur) => ({ ...cur, [name]: v }));
  const asksReason = mode === 'operator' && !approved;
  useEffect(() => { if (clearSignal) setF(withoutSecrets); }, [clearSignal]);

  const missing = kind === 's3'
    ? [!f.bucket.trim() && S('form.bucket'), !f.access_key_id.trim() && S('form.keyId'), !f.secret_access_key.trim() && S('form.secret')]
    : [!f.credential.trim() && S('form.credential')];
  const lacking = missing.filter(Boolean);

  const send = async () => {
    if (lacking.length || busy) return;
    const common = { ...(f.prefix.trim() ? { prefix: f.prefix.trim() } : {}), ...(asksReason && f.reason.trim() ? { reason: f.reason.trim() } : {}) };
    const body = kind === 's3'
      ? {
        kind: 's3', bucket: f.bucket.trim(), access_key_id: f.access_key_id.trim(), secret_access_key: f.secret_access_key.trim(),
        addressing: f.addressing, ...(f.endpoint.trim() ? { endpoint: f.endpoint.trim() } : {}), ...(f.region.trim() ? { region: f.region.trim() } : {}), ...common,
      }
      : {
        kind: 'azure', credential: f.credential.trim(),
        ...(f.account.trim() ? { account: f.account.trim() } : {}), ...(f.container.trim() ? { container: f.container.trim() } : {}), ...common,
      };
    setBusy(true);
    setResult(null);
    try {
      const r = await connectMyFileStore(body);
      setResult({ outcome: r.data.outcome, steps: r.data.test?.steps || [] });
      // The keys leave the page once the node has them: the form never holds a saved secret.
      setF((cur) => ({ ...withoutSecrets(cur), access_key_id: '', reason: '' }));
      onConnected?.(r.data);
    } catch (e) {
      // The node names what failed (a missing field, the test step, files still in the old storage); it
      // stays under the button. The secrets go here too: a key typed once is never left in the page.
      swallowed('storage-tab: connect', e);
      setF(withoutSecrets);
      setResult({ error: (e && e.message) || t('common.error'), code: e && e.code });
    } finally {
      setBusy(false);
    }
  };

  return html`
    <${Stack} gap="medium">
      <${Note} kind="lead">${replacing ? S('form.leadReplace') : S('form.lead')}<//>
      <${Choice} label=${S('form.kind')} value=${kind} onChange=${(v) => { setKind(v); setResult(null); }}
        options=${[['s3', S('form.kindS3')], ['azure', S('form.kindAzure')]]} />
      ${kind === 's3' ? html`
        <${Fields} cols=${2}>
          <${TextField} label=${S('form.endpoint')} hint=${S('form.endpointHint')} value=${f.endpoint} code maxLength=${300}
            placeholder="https://…" onInput=${set('endpoint')} />
          <${TextField} label=${S('form.region')} hint=${S('form.regionHint')} value=${f.region} code size="medium" maxLength=${64}
            placeholder="eu-north-1" onInput=${set('region')} />
          <${TextField} label=${S('form.bucket')} hint=${S('form.bucketHint')} value=${f.bucket} code maxLength=${255} onInput=${set('bucket')} />
          <${TextField} label=${S('form.keyId')} value=${f.access_key_id} code maxLength=${256} onInput=${set('access_key_id')} />
          <${TextField} unmanaged label=${S('form.secret')} hint=${S('form.secretHint')} value=${f.secret_access_key} maxLength=${512}
            onInput=${set('secret_access_key')} onEnter=${send} />
        <//>
        <${Choice} label=${S('form.addressing')} hint=${S('form.addressingHint')} value=${f.addressing} onChange=${set('addressing')}
          options=${[['auto', S('form.addrAuto')], ['path', S('form.addrPath')], ['host', S('form.addrHost')]]} />` : html`
        <${Fields} cols=${2}>
          <${TextField} label=${S('form.account')} hint=${S('form.accountHint')} value=${f.account} code maxLength=${64} onInput=${set('account')} />
          <${TextField} label=${S('form.container')} hint=${S('form.containerHint')} value=${f.container} code maxLength=${63} onInput=${set('container')} />
        <//>
        <${Fields}>
          <${TextField} unmanaged label=${S('form.credential')} hint=${S('form.credentialHint')} value=${f.credential} maxLength=${4096}
            onInput=${set('credential')} onEnter=${send} />
        <//>`}
      <${Fields} cols=${asksReason ? 2 : undefined}>
        <${TextField} label=${S('form.folder')} hint=${S('form.folderHint')} value=${f.prefix} code maxLength=${200} onInput=${set('prefix')} />
        ${asksReason ? html`
          <${TextField} label=${S('form.reason')} hint=${S('form.reasonHint')} value=${f.reason} maxLength=${500} onInput=${set('reason')} />` : null}
      <//>
      <${Space} above="small">
        <${FormActions} apart>
          <${Action} small control disabled=${busy || lacking.length > 0} onClick=${send}>
            ${busy ? S('form.testing') : S('form.connect')}
          <//>
          <${Note} kind="hint" inline>
            ${lacking.length ? S('form.fillFirst', { fields: lacking.join(', ') }) : S('form.testFirst')}
          <//>
        <//>
      <//>
      ${result && result.error ? html`<${Note} kind="message" error>${result.error}<//>` : null}
      ${result && !result.error ? html`
        <${Note} kind="message">${result.outcome === 'waiting_for_operator' ? S('form.waiting') : S('form.connected')}<//>
        <${TestSteps} steps=${result.steps} />` : null}
    <//>`;
}
