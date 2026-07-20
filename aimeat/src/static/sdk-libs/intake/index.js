/**
 * @file intake/index.js
 * @description The aimeat-intake library (SDK-libs migration Phase 1). The browser client for the
 *   generic Public Intake capability, two audiences in one lib: (1) the PUBLIC form renderer (no
 *   session) — getForm()/submit() hit the no-auth intake endpoint, working cross-origin because the
 *   node base URL is resolved from _core/config (APEX_URL) or the auth lib's nodeUrl; (2) the OWNER
 *   (needs aimeat-auth) — defineForm()/listForms()/deleteForm() manage a workspace's intake forms.
 *   Componentized ESM source esbuild bundles to the IIFE served, unchanged, at /v1/libs/aimeat-intake.js.
 *   Ported verbatim from lib-intake.ts; the baked ${config.baseUrl} is now APEX_URL from _core/config.
 * @structure imports APEX_URL (config) + attach (namespace); base()/enc()/submitPath(); public
 *   getForm/submit; owner authFetch/defineForm/listForms/deleteForm; attach('intake', …).
 * @usage <script src="/v1/libs/aimeat-intake.js"></script>
 *   const form = await AIMEAT.intake.getForm(org, ws, 'contact-us');
 *   await AIMEAT.intake.submit(org, ws, 'contact-us', { nimi: '…', email: '…' });
 * @version-history
 *   v1.0.0 — 2026-07-19 — Migrated from src/routes/lib-intake.ts (SDK-libs migration Phase 1).
 */
import { APEX_URL } from '../_core/config.js';
import { attach } from '../_core/namespace.js';

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
  if (!body || body.ok === false) throw new Error((body && body.error && body.error.message) || 'Form not found');
  return body.data;
}
async function submit(org, ws, formId, values) {
  var res = await fetch(base() + submitPath(org, ws, formId), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values || {}),
  });
  var body = await res.json().catch(function () { return null; });
  if (!body || body.ok === false) {
    var e = /** @type {Error & { code?: string, details?: unknown }} */ (new Error((body && body.error && body.error.message) || 'Submit failed'));
    e.code = body && body.error && body.error.code;
    e.details = body && body.error && body.error.details;
    throw e;
  }
  return body.data; // { ok, id, mode }
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

attach('intake', { getForm: getForm, submit: submit, defineForm: defineForm, listForms: listForms, deleteForm: deleteForm, submitPath: submitPath, nodeUrl: base() });
