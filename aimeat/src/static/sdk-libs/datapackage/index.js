/**
 * @file datapackage/index.js
 * @description The aimeat-datapackage library — AIMEAT.datapackage. Build, check, publish and read
 *   a Frictionless Data Package with AIMEAT provenance, without an app parsing CSV, inferring a
 *   type, computing a hash or assembling a provenance block itself.
 *
 *   IT IS A CLIENT, NOT A SECOND IMPLEMENTATION, and that is the whole design. A package's identity
 *   is a content hash: two pieces of code that compute it differently produce two identities for the
 *   same bytes, and every consumer pinned to a hash breaks silently. This node has already paid for
 *   that shape once, which is why `ctx.hash` is published as source (EXT_HASH_REFERENCE_JS) rather
 *   than described. So the inference, the quality gate, the canonical CSV and the hash all happen on
 *   the server, in services/datapackage/, and this library carries the rows there and brings the
 *   answer back. An app, an extension and an agent therefore cannot disagree about what a package is.
 *
 *   WHAT AN APP STILL GETS LOCALLY: the shape of the work. `create()` gives a small builder so a
 *   page can accumulate resources and provenance as the user fills a form, `validate()` shows the
 *   row and the column before anything is stored, and `publish()` is one call at the end.
 *
 *   THE ADDRESS IS NOT THIS LIBRARY. Every answer carries `descriptorUrl` — a permanent, auth-free,
 *   range-readable /v1/pub URL. That is what you give to DuckDB, pandas, frictionless-py, Excel or a
 *   person. Reading a package back through here is a convenience for a UI, not the road.
 * @structure makeSession/authFetch · DataPackageBuilder (create) · publish/validate/inferSchema ·
 *   list/open/rows/exportAs · attach('datapackage', …)
 * @usage
 *   <script src="/v1/libs/aimeat-auth.js"></script>
 *   <script src="/v1/libs/aimeat-datapackage.js"></script>
 *   const pkg = AIMEAT.datapackage.create({ name: 'laake-weekly' });
 *   pkg.addResource('rows', rows);                    // schema inferred unless you declare one
 *   const check = await pkg.validate();               // { ok, issues:[{row, field, message}], schemas }
 *   pkg.changes('Added the sentiment column');
 *   const out = await pkg.publish();                  // { packageId, contentHash, descriptorUrl }
 * @version-history
 *   v1.0.0 — 2026-08-15 — Initial (TARGET-063 vaihe 1, B1).
 */
import { makeSession } from '../_core/session.js';
const { authFetch } = makeSession('aimeat-datapackage.js');
import { attach } from '../_core/namespace.js';

/** Unwrap the node envelope and turn a refusal into a thrown Error carrying `.code` and `.issues`. */
async function call(path, opts) {
  const res = await authFetch(path, opts);
  let body = null;
  try { body = await res.json(); } catch { /* a non-JSON body is handled by the status check below */ }
  if (!res.ok || (body && body.success === false)) {
    const err = body && body.error ? body.error : { code: 'HTTP_' + res.status, message: 'Request failed' };
    /** @type {Error & { code?: string, status?: number, issues?: any[] }} */
    const e = new Error(err.message || 'Request failed');
    e.code = err.code;
    e.status = res.status;
    // The quality gate's coordinates, so a page can point at the cell rather than say "invalid".
    e.issues = (err.details && err.details.issues) || [];
    throw e;
  }
  return body && body.data !== undefined ? body.data : body;
}

/**
 * A package under construction. Holds nothing but what you put in it — no rows are sent anywhere
 * until you call validate() or publish().
 */
class DataPackageBuilder {
  constructor(meta) {
    this._meta = meta || {};
    this._resources = [];
    this._changes = '';
    this._provenance = {};
  }

  /**
   * Add one tabular resource.
   *
   * `opts.schema` omitted means INFER, and inference is a PROPOSAL: the published descriptor records
   * `schemaSource: 'inferred'`, so a consumer can see that nobody confirmed the types. Call
   * inferSchema() first, show the result to the person publishing, and pass the corrected schema
   * here to publish as `declared`.
   */
  addResource(name, rows, opts) {
    const o = opts || {};
    this._resources.push({
      name,
      rows: rows || [],
      ...(o.schema ? { schema: o.schema } : {}),
      ...(o.title ? { title: o.title } : {}),
      ...(o.description ? { description: o.description } : {}),
    });
    return this;
  }

  /** REQUIRED before publish: what moved against the previous version and why. */
  changes(text) { this._changes = String(text || ''); return this; }

  /** Origin, legal basis and licence. The owner is responsible for what they publish; this is where
   *  they say where it came from and on what terms. */
  provenance(block) { this._provenance = Object.assign({}, this._provenance, block || {}); return this; }

  /** How many old versions to keep, by count or by months. */
  retention(policy) { this._retentionPolicy = policy; return this; }

  /** What the producer was asked for — the window, the keywords. Travels in the descriptor. */
  parameters(params) { this._parameters = params; return this; }

  /** Run the quality gate WITHOUT publishing. Answers `{ ok, issues, schemas }`; `issues` name the
   *  resource, the row and the field, which is what lets a page highlight the cell. */
  validate() {
    return call('/v1/datapackages/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resources: this._resources }),
    });
  }

  /**
   * Publish one version. THROWS when the gate refuses, with `.code === 'QUALITY_GATE'` and `.issues`
   * carrying the coordinates — nothing was written, and the package stands on its previous version.
   *
   * `unchanged: true` in the answer means these exact bytes were already published: the address
   * already holds them, and no new version was created. Say "no change" rather than "updated".
   */
  publish() {
    return call('/v1/datapackages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({}, this._meta, {
        changes: this._changes,
        resources: this._resources,
        provenance: this._provenance,
        ...(this._parameters ? { parameters: this._parameters } : {}),
        ...(this._retentionPolicy ? { retentionPolicy: this._retentionPolicy } : {}),
      })),
    });
  }
}

const datapackage = {
  /** Start a package. `meta` is `{ name, title?, description? }`; the name is an address segment. */
  create(meta) { return new DataPackageBuilder(meta); },

  /** The type proposal for a set of rows, without publishing anything. Show it to the publisher. */
  inferSchema(rows) {
    return call('/v1/datapackages/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resources: [{ name: 'preview', rows: rows || [] }] }),
    }).then(d => d.schemas.preview);
  },

  /** One-shot publish for a caller that has everything already. Same refusal behaviour as the builder. */
  publish(input) {
    return call('/v1/datapackages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input || {}),
    });
  },

  /** The caller's own packages, newest version each, with `lastError` when the last run failed. */
  list() { return call('/v1/datapackages', { method: 'GET' }); },

  /** A descriptor. `ref` is `pkg:owner/name`, optionally `@sha256:…` to pin a version. */
  open(ref) {
    const p = parseRef(ref);
    if (!p) return Promise.reject(new Error('open() needs a reference like "pkg:owner/name" or "pkg:owner/name@sha256:…"'));
    const q = p.version ? ('?version=' + encodeURIComponent(p.version)) : '';
    return call('/v1/datapackages/' + encodeURIComponent(p.owner) + '/' + encodeURIComponent(p.name) + q, { method: 'GET' });
  },

  /** A window of rows, for a preview table. For the whole thing use the CSV address — it is
   *  permanent, needs no session and answers byte ranges. */
  rows(ref, resource, opts) {
    const p = parseRef(ref);
    if (!p) return Promise.reject(new Error('rows() needs a reference like "pkg:owner/name"'));
    const o = opts || {};
    const qs = [];
    if (p.version) qs.push('version=' + encodeURIComponent(p.version));
    if (o.offset != null) qs.push('offset=' + encodeURIComponent(o.offset));
    if (o.limit != null) qs.push('limit=' + encodeURIComponent(o.limit));
    if (o.select && o.select.length) qs.push('select=' + encodeURIComponent(o.select.join(',')));
    const q = qs.length ? ('?' + qs.join('&')) : '';
    return call('/v1/datapackages/' + encodeURIComponent(p.owner) + '/' + encodeURIComponent(p.name)
      + '/rows/' + encodeURIComponent(resource) + q, { method: 'GET' });
  },

  /**
   * The permanent, session-free address of one resource's CSV — what you hand to DuckDB, pandas,
   * Google Sheets IMPORTDATA or a person with a download button.
   *
   * Derived from the descriptor rather than assembled from parts, because the descriptor's
   * `resources[].path` is the authority on where a resource lives and a hand-built URL would be a
   * second opinion about it.
   */
  urlFor(descriptorResponse, resource) {
    const d = descriptorResponse && (descriptorResponse.descriptor || descriptorResponse);
    if (!d || !d.resources) return null;
    const r = d.resources.find(x => x.name === resource);
    const base = descriptorResponse && descriptorResponse.descriptor_url;
    if (!r || !base) return null;
    return base.replace(/datapackage\.json$/, '') + r.path.split('/').map(encodeURIComponent).join('/');
  },

  /**
   * Turn a resource into a file the person can keep. CSV is handed over as its permanent URL — no
   * download, no copy, the address IS the file. JSON is derived in the browser from a row read.
   *
   * There is no XLSX here yet, and it is left out rather than half-done: a spreadsheet writer is a
   * vendored dependency this node does not carry, and emitting a CSV named .xlsx would be exactly
   * the covering fallback this whole format exists to avoid.
   */
  async exportAs(ref, resource, format) {
    const fmt = String(format || 'csv').toLowerCase();
    const opened = await this.open(ref);
    if (fmt === 'csv') return { url: this.urlFor(opened, resource), format: 'csv' };
    if (fmt === 'json') {
      const all = [];
      let offset = 0;
      for (;;) {
        const page = await this.rows(ref, resource, { offset, limit: 5000 });
        all.push.apply(all, page.rows);
        offset += page.rows.length;
        if (offset >= page.total || page.rows.length === 0) break;
      }
      const blob = new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' });
      return { url: URL.createObjectURL(blob), format: 'json', rows: all.length };
    }
    throw new Error('exportAs supports "csv" (the permanent URL) and "json". '
      + 'XLSX needs a spreadsheet writer this node does not vendor yet, and a CSV named .xlsx would be a lie.');
  },
};

/** `pkg:owner/name` or `pkg:owner/name@sha256:…`. */
function parseRef(ref) {
  const m = /^pkg:([^/@]+)\/([^@]+)(?:@(sha256:[a-f0-9]{64}))?$/.exec(String(ref || '').trim());
  return m ? { owner: m[1], name: m[2], version: m[3] || null } : null;
}

attach('datapackage', datapackage);
