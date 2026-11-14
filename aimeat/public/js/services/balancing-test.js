/**
 * @file public/js/services/balancing-test.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The balancing test of an app (the legitimate interests assessment of GDPR art.
 *   6(1)(f)) as the app's owner reads it on the app's page: whether the app needs one and where each
 *   test stands, the owner's own approval, and the test as a PDF or an Excel file. Thin calls on the
 *   compliance routes (src/routes/compliance-docs.ts); every rule is the server's.
 * @structure readBalancingTests(app, lang) · approveBalancingTest(app, id) · setOwnerApproves(app, id, on) · downloadBalancingTest(app, id, format)
 * @usage const data = await readBalancingTests('crm.html', 'fi');
 * @version-history
 *   v1.1.0 — 2026-11-14 — setOwnerApproves: the owner keeps the approval of one test for themselves.
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import { apiGet, apiPatch } from '/js/api.js';
import { getSession } from '/js/services/auth.js';

const enc = encodeURIComponent;

/** Whether the signed-in owner's app needs a test, the stored tests and the drafts (GET /v1/compliance/lia/draft). */
export async function readBalancingTests(app, lang) {
  const resp = await apiGet(`/v1/compliance/lia/draft?app=${enc(app)}&lang=${enc(lang || 'en')}`);
  return resp?.data ?? null;
}

/** The owner approves one test in person (PATCH /v1/compliance/docs/lias/:id). */
export async function approveBalancingTest(app, id) {
  const resp = await apiPatch(`/v1/compliance/docs/lias/${enc(id)}?scope=app&app=${enc(app)}`, { set: { status: 'approved' } });
  return resp?.data ?? null;
}

/** The owner, signed in, decides whether only they approve one test (PATCH set { ownerApproves }). */
export async function setOwnerApproves(app, id, on) {
  const resp = await apiPatch(`/v1/compliance/docs/lias/${enc(id)}?scope=app&app=${enc(app)}`, { set: { ownerApproves: !!on } });
  return resp?.data ?? null;
}

/** Save one test as a file: format 'pdf' or 'xlsx' (GET /v1/compliance/lia/:id/document). */
export async function downloadBalancingTest(app, id, format) {
  const session = getSession();
  const resp = await fetch(`/v1/compliance/lia/${enc(id)}/document?app=${enc(app)}&format=${enc(format)}`, {
    headers: session?.jwt ? { Authorization: 'Bearer ' + session.jwt } : {},
  });
  if (!resp.ok) {
    // A refusal is the server's JSON envelope; its message is what the page shows.
    const refused = (resp.headers.get('content-type') || '').includes('json') ? await resp.json() : null;
    throw new Error(refused?.error?.message || String(resp.status));
  }
  const url = URL.createObjectURL(await resp.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.${format}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
