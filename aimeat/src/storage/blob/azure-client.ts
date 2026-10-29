/**
 * @file src/storage/blob/azure-client.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A BlobStore on one Azure Blob Storage container, authorised either with the account
 *   key (Shared Key signing, learn.microsoft.com/rest/api/storageservices/authorize-with-shared-key)
 *   or with a container SAS appended to every request. Written against the REST protocol for the
 *   reason s3-client.ts gives: a store a person connects must send through safeFetch. Works the same
 *   against Azurite, Microsoft's local emulator, whose endpoint carries the account in its path.
 *   Also reads the two forms people copy out of the Azure portal: a connection string and a container
 *   SAS URL (parseAzureConnection).
 * @structure azureSharedKey · parseAzureConnection · createAzureStore
 * @usage const store = createAzureStore({ kind: 'azure', accountName: 'acct', container: 'files', accountKey }, fetch);
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import { createHmac } from 'node:crypto';
import { BlobStoreError, type AzureSpec, type BlobFetch, type BlobListPage, type BlobStore } from './blob-types.js';
import { bodyBuffer, bodyText, drain, failure, uriEncode, xmlValue, xmlValues } from './blob-http.js';

const API_VERSION = '2021-08-06';

/**
 * The Shared Key signature of one request. `path` is the encoded path as sent; `query` the decoded
 * parameters; `headers` every header sent, in lower case. Exported so a unit test holds it to a
 * known value.
 */
export function azureSharedKey(input: {
  method: string; accountName: string; accountKey: string; path: string;
  query: Record<string, string>; headers: Record<string, string>;
}): string {
  const h = input.headers;
  const length = h['content-length'] && h['content-length'] !== '0' ? h['content-length'] : '';
  const msHeaders = Object.keys(h).filter(k => k.startsWith('x-ms-')).sort()
    .map(k => `${k}:${h[k].trim()}\n`).join('');
  const params = Object.entries(input.query).map(([k, v]) => [k.toLowerCase(), v] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const resource = `/${input.accountName}${input.path}` + params.map(([k, v]) => `\n${k}:${v}`).join('');
  const stringToSign = [
    input.method, h['content-encoding'] ?? '', h['content-language'] ?? '', length, h['content-md5'] ?? '',
    h['content-type'] ?? '', '', h['if-modified-since'] ?? '', h['if-match'] ?? '', h['if-none-match'] ?? '',
    h['if-unmodified-since'] ?? '', h['range'] ?? '',
  ].join('\n') + '\n' + msHeaders + resource;
  const sig = createHmac('sha256', Buffer.from(input.accountKey, 'base64')).update(stringToSign, 'utf8').digest('base64');
  return `SharedKey ${input.accountName}:${sig}`;
}

/**
 * The parts of an Azure connection string (`AccountName=…;AccountKey=…[;BlobEndpoint=…]`) or of a
 * container SAS URL (`https://<account>.blob.core.windows.net/<container>?sv=…&sig=…`). `container`
 * is set only by a SAS URL, which names one. Null when the text is neither.
 */
export function parseAzureConnection(text: string): Partial<AzureSpec> | null {
  const s = text.trim();
  if (/^https?:\/\//i.test(s)) {
    if (!URL.canParse(s)) return null;
    const u = new URL(s);
    const sas = u.search.replace(/^\?/, '');
    if (!sas.includes('sig=')) return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const dotted = u.hostname.match(/^([a-z0-9]+)\.blob\./i);
    // An address without the account in its host name (Azurite) carries it as the first path part.
    const accountName = dotted ? dotted[1] : parts.shift();
    const container = parts.shift();
    if (!accountName || !container) return null;
    const endpoint = dotted ? `${u.protocol}//${u.host}` : `${u.protocol}//${u.host}/${accountName}`;
    return { accountName, container: decodeURIComponent(container), sasToken: sas, endpoint };
  }
  const fields: Record<string, string> = {};
  for (const part of s.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
  }
  const accountName = fields.accountname;
  if (!accountName || !(fields.accountkey || fields.sharedaccesssignature)) return null;
  const protocol = fields.defaultendpointsprotocol || 'https';
  const endpoint = fields.blobendpoint
    || `${protocol}://${accountName}.blob.${fields.endpointsuffix || 'core.windows.net'}`;
  return {
    accountName, endpoint: endpoint.replace(/\/+$/, ''),
    ...(fields.accountkey ? { accountKey: fields.accountkey } : { sasToken: fields.sharedaccesssignature.replace(/^\?/, '') }),
  };
}

export function createAzureStore(spec: AzureSpec, send: BlobFetch): BlobStore {
  const endpoint = (spec.endpoint?.trim() || `https://${spec.accountName}.blob.core.windows.net`).replace(/\/+$/, '');
  const base = new URL(endpoint);
  const label = `azure container "${spec.container}" in account ${spec.accountName}`;

  async function request(method: string, key: string | null, opts: {
    query?: Record<string, string>; body?: Buffer; headers?: Record<string, string>;
  } = {}): Promise<Response> {
    const path = `${base.pathname.replace(/\/+$/, '')}/${uriEncode(spec.container, false)}${key !== null ? `/${uriEncode(key, true)}` : ''}`;
    const query = opts.query ?? {};
    const headers: Record<string, string> = {
      'x-ms-date': new Date().toUTCString(),
      'x-ms-version': API_VERSION,
      ...Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    };
    if (opts.body) headers['content-length'] = String(opts.body.length);
    const params = Object.entries(query).map(([k, v]) => `${uriEncode(k, false)}=${uriEncode(v, false)}`);
    if (spec.accountKey) {
      headers.authorization = azureSharedKey({ method, accountName: spec.accountName, accountKey: spec.accountKey, path, query, headers });
    } else if (spec.sasToken) {
      params.push(spec.sasToken.replace(/^\?/, ''));
    }
    // fetch sets Content-Length from the body itself; sending it as well is refused by undici.
    const sendHeaders = { ...headers };
    delete sendHeaders['content-length'];
    const url = `${base.protocol}//${base.host}${path}${params.length ? `?${params.join('&')}` : ''}`;
    try {
      return await send(url, { method, headers: sendHeaders, body: opts.body });
    } catch (err) {
      throw new BlobStoreError(`${method} could not reach ${label}: ${err instanceof Error ? err.message : String(err)}`, 0, 'UNREACHABLE');
    }
  }

  return {
    kind: 'azure',
    describe: () => label,

    async put(key, data, contentType) {
      const res = await request('PUT', key, {
        body: data, headers: { 'x-ms-blob-type': 'BlockBlob', 'content-type': contentType || 'application/octet-stream' },
      });
      if (!res.ok) throw await failure(res, 'Storing an object', label);
      await drain(res);
    },

    async get(key) {
      const res = await request('GET', key);
      if (res.status === 404) { await drain(res); return null; }
      if (!res.ok) throw await failure(res, 'Reading an object', label);
      return bodyBuffer(res, label);
    },

    async getRange(key, start, length) {
      if (length <= 0) return Buffer.alloc(0);
      const res = await request('GET', key, { headers: { 'x-ms-range': `bytes=${start}-${start + length - 1}` } });
      if (res.status === 404) { await drain(res); return null; }
      // 416: the range starts past the end of a blob that exists, which reads as no bytes.
      if (res.status === 416) { await drain(res); return Buffer.alloc(0); }
      if (!res.ok) throw await failure(res, 'Reading part of an object', label);
      const buf = await bodyBuffer(res, label);
      return res.status === 200 ? buf.subarray(start, start + length) : buf;
    },

    async delete(key) {
      const res = await request('DELETE', key);
      if (!res.ok && res.status !== 404) throw await failure(res, 'Removing an object', label);
      await drain(res);
    },

    async list(prefix, next): Promise<BlobListPage> {
      const query: Record<string, string> = { restype: 'container', comp: 'list', prefix, maxresults: '1000' };
      if (next) query.marker = next;
      const res = await request('GET', null, { query });
      if (!res.ok) throw await failure(res, 'Listing objects', label);
      const xml = await bodyText(res, label);
      const objects = xmlValues(xml, 'Blob', true).map(b => {
        const modified = xmlValue(b, 'Last-Modified');
        return {
          key: xmlValue(b, 'Name') ?? '',
          lastModified: modified ? new Date(modified).toISOString() : '',
          size: Number(xmlValue(b, 'Content-Length') ?? 0),
        };
      }).filter(o => o.key);
      const marker = xmlValue(xml, 'NextMarker');
      return marker ? { objects, next: marker } : { objects };
    },
  };
}
