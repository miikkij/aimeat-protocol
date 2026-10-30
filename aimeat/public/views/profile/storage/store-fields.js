/**
 * @file public/views/profile/storage/store-fields.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The address and key fields of one store, shared by the person's connect form
 *   (connect-form.js) and the operator's add-a-store form (views/admin/file-stores-tab.named.js): the
 *   kind (S3 bucket or Azure Blob container), then for S3 the address (empty for Amazon S3), the region,
 *   the bucket, the access key id and its secret and how the address names the bucket, and for Azure the
 *   account, the container and one credential (the account key, a connection string or a container SAS
 *   URL). The operator's form also gets the Azure address (`azureEndpoint`), which a person's store may
 *   not set: an emulator such as Azurite, or a sovereign cloud. Moved out of connect-form.js unchanged,
 *   with the field state, what is missing and the request body as helpers both forms call. Every part
 *   is a library component; the fields pass data and write no class.
 * @structure EMPTY_STORE · withoutSecrets · lackingOf · storeBody · StoreFields
 * @usage const [f, setF] = useState(EMPTY_STORE);
 *        html`<${StoreFields} kind=${kind} onKind=${setKind} f=${f} set=${set} onEnter=${send} />`
 * @version-history
 *   v1.0.0 — 2026-10-30 — Initial: the field block of connect-form.js, shared with the admin form, plus
 *     the Azure address for the operator (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 */
import { h } from 'preact';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { Choice } from '/components/Choice.js';
import { TextField } from '/components/TextField.js';
import { Fields } from '/components/Field.js';

const html = htm.bind(h);
/** One word of the store form (the words of the page "Your own storage", shared with the admin form). */
const W = (key, params) => t('profile.storage.form.' + key, params);

/** The fields of an empty form. */
export const EMPTY_STORE = {
  endpoint: '', region: '', bucket: '', access_key_id: '', secret_access_key: '', addressing: 'auto',
  account: '', container: '', credential: '', azure_endpoint: '',
};

/** The form's fields with every secret emptied: the S3 secret and the Azure credential. */
export const withoutSecrets = (cur) => ({ ...cur, secret_access_key: '', credential: '' });

/** The labels of the fields a kind needs and the form lacks, for "Fill in first: …". */
export function lackingOf(kind, f) {
  const missing = kind === 's3'
    ? [!f.bucket.trim() && W('bucket'), !f.access_key_id.trim() && W('keyId'), !f.secret_access_key.trim() && W('secret')]
    : [!f.credential.trim() && W('credential')];
  return missing.filter(Boolean);
}

/** The address and key part of a PUT body; `azureEndpoint` sends the Azure address (the operator's form). */
export function storeBody(kind, f, { azureEndpoint = false } = {}) {
  return kind === 's3'
    ? {
      kind: 's3', bucket: f.bucket.trim(), access_key_id: f.access_key_id.trim(), secret_access_key: f.secret_access_key.trim(),
      addressing: f.addressing, ...(f.endpoint.trim() ? { endpoint: f.endpoint.trim() } : {}), ...(f.region.trim() ? { region: f.region.trim() } : {}),
    }
    : {
      kind: 'azure', credential: f.credential.trim(),
      ...(f.account.trim() ? { account: f.account.trim() } : {}), ...(f.container.trim() ? { container: f.container.trim() } : {}),
      ...(azureEndpoint && f.azure_endpoint.trim() ? { endpoint: f.azure_endpoint.trim() } : {}),
    };
}

/**
 * The kind and its fields. `kind` and `onKind(kind)` the choice; `f` the field values and `set(name)`
 * the setter of one; `onEnter` sends from a key field; `kindLabel` the choice's row label;
 * `azureEndpoint` adds the Azure address field.
 */
export function StoreFields({ kind, onKind, f, set, onEnter, kindLabel, azureEndpoint }) {
  return html`
    <${Choice} label=${kindLabel || W('kind')} value=${kind} onChange=${onKind}
      options=${[['s3', W('kindS3')], ['azure', W('kindAzure')]]} />
    ${kind === 's3' ? html`
      <${Fields} cols=${2}>
        <${TextField} label=${W('endpoint')} hint=${W('endpointHint')} value=${f.endpoint} code maxLength=${300}
          placeholder="https://…" onInput=${set('endpoint')} />
        <${TextField} label=${W('region')} hint=${W('regionHint')} value=${f.region} code size="medium" maxLength=${64}
          placeholder="eu-north-1" onInput=${set('region')} />
        <${TextField} label=${W('bucket')} hint=${W('bucketHint')} value=${f.bucket} code maxLength=${255} onInput=${set('bucket')} />
        <${TextField} label=${W('keyId')} value=${f.access_key_id} code maxLength=${256} onInput=${set('access_key_id')} />
        <${TextField} unmanaged label=${W('secret')} hint=${W('secretHint')} value=${f.secret_access_key} maxLength=${512}
          onInput=${set('secret_access_key')} onEnter=${onEnter} />
      <//>
      <${Choice} label=${W('addressing')} hint=${W('addressingHint')} value=${f.addressing} onChange=${set('addressing')}
        options=${[['auto', W('addrAuto')], ['path', W('addrPath')], ['host', W('addrHost')]]} />` : html`
      <${Fields} cols=${2}>
        <${TextField} label=${W('account')} hint=${W('accountHint')} value=${f.account} code maxLength=${64} onInput=${set('account')} />
        <${TextField} label=${W('container')} hint=${W('containerHint')} value=${f.container} code maxLength=${63} onInput=${set('container')} />
      <//>
      <${Fields}>
        <${TextField} unmanaged label=${W('credential')} hint=${W('credentialHint')} value=${f.credential} maxLength=${4096}
          onInput=${set('credential')} onEnter=${onEnter} />
        ${azureEndpoint ? html`
          <${TextField} label=${W('azureEndpoint')} hint=${W('azureEndpointHint')} value=${f.azure_endpoint} code maxLength=${300}
            placeholder="http://127.0.0.1:10000/devstoreaccount1" onInput=${set('azure_endpoint')} />` : null}
      <//>`}`;
}
