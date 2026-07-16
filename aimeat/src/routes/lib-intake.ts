/**
 * @file lib-intake.ts
 * @description aimeat-intake.js — the browser client for the generic Public Intake capability. Two
 *   audiences in one lib: (1) the PUBLIC form-renderer (no session needed) — getForm() fetches a form's
 *   public descriptor and submit() posts a submission to the no-auth intake endpoint; works cross-origin
 *   because the node base URL is baked in. (2) the OWNER (needs aimeat-auth) — defineForm()/listForms()/
 *   deleteForm() manage a workspace's intake forms. Any app renders the form however it likes (a generic
 *   Public Forms app or a service's own branded page) — this lib is the one call surface.
 * @structure aimeatIntakeLib(config) -> string (IIFE attaching global.AIMEAT.intake)
 *   PUBLIC:  getForm(org, ws, formId) -> {form_id,title,fields,honeypot_field,success_message,redirect_url}
 *            submit(org, ws, formId, values) -> { ok, id, mode }
 *   OWNER:   defineForm(cfg) / listForms(org, ws) / deleteForm(org, ws, formId)   (need aimeat-auth session)
 * @usage <script src="/v1/libs/aimeat-intake.js"></script>
 *   const form = await AIMEAT.intake.getForm(org, ws, 'contact-us');
 *   await AIMEAT.intake.submit(org, ws, 'contact-us', { nimi:'…', email:'…' });   // no login needed
 * @version-history
 *   v1.0.0 — 2026-07-16 — Initial: public getForm/submit + owner defineForm/listForms/deleteForm.
 */
import type { AimeatConfig } from '../config.js';

export function aimeatIntakeLib(config: AimeatConfig): string {
  const baked = (config.baseUrl ?? '').replace(/\/+$/, '');
  return `// aimeat-intake.js — AIMEAT Public Intake Library
// Node: ${config.nodeId} | Generated: ${new Date().toISOString()}
// PUBLIC form submit needs NO login; owner form management needs aimeat-auth.js loaded first.
(function (global) {
'use strict';
var BAKED_NODE = ${JSON.stringify(baked)};
function base() {
  // Prefer the auth lib's node URL (same node), else the baked base, else same-origin.
  if (global.AIMEAT && global.AIMEAT.auth && global.AIMEAT.auth.nodeUrl) return String(global.AIMEAT.auth.nodeUrl).replace(/\\/+$/, '');
  return BAKED_NODE;
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
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values || {})
  });
  var body = await res.json().catch(function () { return null; });
  if (!body || body.ok === false) { var e = new Error((body && body.error && body.error.message) || 'Submit failed'); e.code = body && body.error && body.error.code; e.details = body && body.error && body.error.details; throw e; }
  return body.data; // { ok, id, mode }
}

// ── OWNER (needs aimeat-auth) ─────────────────────────────────────────────────
async function authFetch(path, opts) {
  if (!global.AIMEAT || !global.AIMEAT.auth) throw new Error('AIMEAT.auth is required for owner methods (load aimeat-auth.js first)');
  var s = global.AIMEAT.auth.getSession();
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

global.AIMEAT = global.AIMEAT || {};
global.AIMEAT.intake = { getForm: getForm, submit: submit, defineForm: defineForm, listForms: listForms, deleteForm: deleteForm, submitPath: submitPath, nodeUrl: base() };
})(window);
`;
}
