/**
 * @file intake/index.js
 * @description The aimeat-intake library (SDK-libs migration Phase 1). The browser client for the
 *   generic Public Intake capability, two audiences in one lib: (1) the PUBLIC form renderer (no
 *   session) — getForm()/submit() hit the no-auth intake endpoint, working cross-origin because the
 *   node base URL is resolved from _core/config (APEX_URL) or the auth lib's nodeUrl; (2) the OWNER
 *   (needs aimeat-auth) — defineForm()/listForms()/deleteForm() manage a workspace's intake forms.
 *   Componentized ESM source esbuild bundles to the IIFE served, unchanged, at /v1/libs/aimeat-intake.js.
 *   Ported verbatim from lib-intake.ts; the baked ${config.baseUrl} is now APEX_URL from _core/config.
 * @structure imports APEX_URL (config) + attach (namespace) + fields/refusalField (./fields.js);
 *   base()/enc()/submitPath()/refused(); public getForm/submit/fields; owner
 *   authFetch/defineForm/listForms/deleteForm; attach('intake', …).
 * @usage <script src="/v1/libs/aimeat-intake.js"></script>
 *   const form = await AIMEAT.intake.getForm(org, ws, 'contact-us');
 *   const list = AIMEAT.intake.fields(form);   // [{ name, label, type, required, options?, maxLength? }]
 *   await AIMEAT.intake.submit(org, ws, 'contact-us', { nimi: '…', email: '…' });
 * @version-history
 *   v1.1.0 — 2026-10-01 — fields(form): the normalised field list a renderer draws. A refusal from
 *     getForm or submit carries code, details, status and, from submit, the `field` it concerns when
 *     the node's answer names one.
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-intake.ts (SDK-libs migration Phase 1).
 */
import { APEX_URL } from '../_core/config.js';
import { attach } from '../_core/namespace.js';
import { fields, refusalField } from './fields.js';

/**
 * A refusal from the intake routes, thrown as an Error.
 * @typedef {Error & { code?: string, details?: unknown, status?: number, field?: string }} IntakeRefusal
 */

/**
 * The node's refusal as a thrown Error carrying its code, details and HTTP status.
 * @param {any} body      The parsed envelope, or null when the answer was not JSON.
 * @param {number} status The HTTP status.
 * @param {string} fallback
 * @returns {IntakeRefusal}
 */
function refused(body, status, fallback) {
  const err = body && body.error;
  const e = /** @type {IntakeRefusal} */ (new Error((err && err.message) || fallback));
  e.code = err && err.code;
  e.details = err && err.details;
  e.status = status;
  return e;
}

function base() {
  // Prefer the auth lib's node URL (same node), else the baked apex base (from _core/config prelude).
  if (window.AIMEAT && window.AIMEAT.auth && window.AIMEAT.auth.nodeUrl) return String(window.AIMEAT.auth.nodeUrl).replace(/\/+$/, '');
  return APEX_URL;
}
function enc(s) { return encodeURIComponent(String(s == null ? '' : s)); }
function submitPath(org, ws, formId) { return '/v1/intake/' + enc(org) + '/' + enc(ws) + '/' + enc(formId); }

// ── PUBLIC (no session) ──────────────────────────────────────────────────────
async function getForm(org, ws, formId) {
  var res = await fetch(base() + submitPath(org, ws, formId), { headers: { 'Accept': 'application/json' } });
  var body = await res.json().catch(function () { return null; });
  if (!body || body.ok === false) throw refused(body, res.status, 'Form not found');
  return body.data;
}
async function submit(org, ws, formId, values) {
  var res = await fetch(base() + submitPath(org, ws, formId), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values || {}),
  });
  var body = await res.json().catch(function () { return null; });
  if (!body || body.ok === false) {
    var e = refused(body, res.status, 'Submit failed');
    // The field the refusal concerns, so a renderer can mark it; absent when the node names none.
    var field = refusalField(body && body.error);
    if (field) e.field = field;
    throw e;
  }
  return body.data; // { ok, id, mode }; a filled honeypot answers { ok: true, id: null } and writes nothing
}

// ── OWNER (needs aimeat-auth) ─────────────────────────────────────────────────
async function authFetch(path, opts) {
  if (!window.AIMEAT || !window.AIMEAT.auth) throw new Error('AIMEAT.auth is required for owner methods (load aimeat-auth.js first)');
  var s = window.AIMEAT.auth.getSession();
  if (!s) throw new Error('Not logged in. Call AIMEAT.auth.login() first.');
  var res = await s.fetch(path, opts);
  if (res && typeof res.json === 'function') res = await res.json();
  return res;
}
async function defineForm(cfg) {
  var body = await authFetch('/v1/intake/forms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cfg || {}) });
  if (!body || body.ok === false) throw new Error((body && body.error && body.error.message) || 'defineForm failed');
  return body.data; // { form_id, submit_url, discoverable, enabled, mode }
}
async function listForms(org, ws) {
  var body = await authFetch('/v1/intake/forms?organism_id=' + enc(org) + '&ws=' + enc(ws));
  if (!body || body.ok === false) throw new Error((body && body.error && body.error.message) || 'listForms failed');
  return (body.data && body.data.forms) || [];
}
async function deleteForm(org, ws, formId) {
  var body = await authFetch('/v1/intake/forms?organism_id=' + enc(org) + '&ws=' + enc(ws) + '&form_id=' + enc(formId), { method: 'DELETE' });
  if (!body || body.ok === false) throw new Error((body && body.error && body.error.message) || 'deleteForm failed');
  return body.data;
}

attach('intake', { getForm: getForm, submit: submit, fields: fields, defineForm: defineForm, listForms: listForms, deleteForm: deleteForm, submitPath: submitPath, nodeUrl: base() });
