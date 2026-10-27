/**
 * @file public/js/services/agreements.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The browser's calls to the data processing agreements (plan doc-mvmr4i2wdk0p): the
 *   operator's section on the admin Compliance page and the counterparty's tab in Settings both use
 *   these, and the node decides everything (routes/compliance-agreements.ts). The AI reaches the same
 *   routes through aimeat_compliance_agreement.
 *
 *   A SIGNED COPY IS UPLOADED, THEN NAMED. The file goes to the person's own storage by a presigned
 *   PUT (no size ceiling but the storage limit, the way the messages service sends attachments), and
 *   POST /v1/compliance/agreements/:id/signed-copy names it.
 *
 *   THE PDF IS FETCHED WITH THE SESSION. A plain link cannot carry the Bearer header, so the download
 *   fetches the bytes and hands the browser a blob, as the skill ZIP download does.
 * @structure listAgreements · myAgreements · agreementGaps · getAgreement · createAgreement · updateAgreement ·
 *   newVersion · sendAgreement · announceChange · objectToChange · sendSignedCopy · decideCopy · endAgreement ·
 *   deletionDone · downloadAgreementPdf
 * @usage import { myAgreements, sendSignedCopy } from '/js/services/agreements.js';
 * @version-history
 *   2026-10-27 — decideCopy sends uploaded_at, the copy the operator saw (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D5).
 */
import { api, apiGet, apiPost, apiPatch } from '/js/api.js';
import { authHeaders } from '/js/services/auth.js';

const BASE = '/v1/compliance/agreements';
const at = (id) => `${BASE}/${encodeURIComponent(id)}`;

export const listAgreements = () => apiGet(BASE).then((r) => r?.data ?? { items: [] });
export const myAgreements = () => apiGet(`${BASE}/mine`).then((r) => r?.data ?? { items: [] });
export const agreementGaps = () => apiGet(`${BASE}/gaps`).then((r) => r?.data ?? { gaps: [] });
export const getAgreement = (id) => apiGet(at(id)).then((r) => r?.data ?? null);
export const createAgreement = (body, dryRun = false) => apiPost(`${BASE}${dryRun ? '?dry_run=true' : ''}`, body).then((r) => r?.data);
export const updateAgreement = (id, body) => apiPatch(at(id), body).then((r) => r?.data);
export const newVersion = (id) => apiPost(`${at(id)}/versions`, {}).then((r) => r?.data);
export const sendAgreement = (id, message) => apiPost(`${at(id)}/send`, message ? { message } : {}).then((r) => r?.data);
export const announceChange = (id) => apiPost(`${at(id)}/notice`, {}).then((r) => r?.data);
export const objectToChange = (id, reason) => apiPost(`${at(id)}/object`, { reason }).then((r) => r?.data);
// uploadedAt names the copy the operator saw, so a copy that replaced it meanwhile is not decided on.
export const decideCopy = (id, accept, reason, uploadedAt) => apiPost(`${at(id)}/confirm`, {
  accept, ...(reason ? { reason } : {}), ...(uploadedAt ? { uploaded_at: uploadedAt } : {}),
}).then((r) => r?.data);
export const endAgreement = (id, choice, reason) => apiPost(`${at(id)}/end`, reason ? { choice, reason } : { choice }).then((r) => r?.data);
export const deletionDone = (id, note) => apiPost(`${at(id)}/deletion-done`, note ? { note } : {}).then((r) => r?.data);

/** An absolute upload address on this origin becomes a path, so the PUT stays on the page's origin.
 *  An address that does not parse throws, and the caller shows that the upload failed. */
function uploadTarget(url) {
  const u = new URL(url, window.location.origin);
  return u.origin === window.location.origin ? u.pathname + u.search : u.href;
}

/**
 * Put a signed copy into the person's storage and name it on the agreement.
 * @param {string} id the agreement
 * @param {File} file the signed PDF or the scan
 * @param {'pdf'|'scan'} kind
 * @param {'controller'|'processor'} [party] the operator naming whose signature it carries
 */
export async function sendSignedCopy(id, file, kind, party) {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `agreements/returned/${id}-${Date.now()}-${safe}`;
  const mime = file.type || (kind === 'pdf' ? 'application/pdf' : 'application/octet-stream');
  const mint = await api('/v1/storage', { method: 'POST', body: JSON.stringify({ key, mime_type: mime, visibility: 'private', mode: 'presigned' }) });
  const uploadUrl = mint?.data?.upload_url;
  if (!uploadUrl) throw new Error('The node gave no upload address.');
  const resp = await fetch(uploadTarget(uploadUrl), { method: 'PUT', headers: { 'Content-Type': mime }, body: file });
  if (!resp.ok) throw new Error(`Upload failed (HTTP ${resp.status})`);
  return apiPost(`${at(id)}/signed-copy`, { storage_key: key, kind, ...(party ? { party } : {}) }).then((r) => r?.data);
}

/** Download a version's PDF (the stored one once sent; a draft is rendered on the spot). */
export async function downloadAgreementPdf(id, version) {
  const res = await fetch(`${at(id)}/document${version ? `?version=${encodeURIComponent(version)}` : ''}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${id}${version ? `-v${version}` : ''}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}
