/**
 * @file public/js/services/companies.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Companies page's reads and writes: the registry CRUD, the front page, the
 *   sending identity (SMTP), the published page, the organism link, and the two counts the page
 *   reports (this company's invoices via GET /v1/finance/invoices?company= and its sends via
 *   GET /v1/outbound/log?company= — both resolved server-side to the organism the company's
 *   books live under). Also the reachability probe behind "the address answers", which the node
 *   runs (the SPA's CSP refuses foreign origins from the browser).
 * @structure registry · front page · smtp · portfolio · counts · organisms · probe · slugify
 * @usage import * as companies from '/js/services/companies.js';
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (design canvas "AIMEAT Yritysten sivu", direction A).
 */
import { apiGet, apiPost, apiPut, apiDelete } from '/js/api.js';

/* ── The registry ─────────────────────────────────────────────────────────── */

export async function listCompanies() {
  const res = await apiGet('/v1/companies?per_page=100');
  return res?.data?.companies ?? [];
}

export async function createCompany(name) {
  const res = await apiPost('/v1/companies', { name });
  return res?.data?.company ?? null;
}

/** Partial update: only the keys passed change; the server keeps the rest. '' means clear. */
export async function updateCompany(id, fields) {
  const res = await apiPut(`/v1/companies/${id}`, fields);
  return res?.data?.company ?? null;
}

export async function deleteCompany(id) {
  await apiDelete(`/v1/companies/${id}`);
}

export async function checkAvailable(slug) {
  const res = await apiGet(`/v1/companies/available?slug=${encodeURIComponent(slug)}`);
  return res?.data ?? null;
}

/* ── The front page ───────────────────────────────────────────────────────── */

export async function setFrontPage(id, kind, target) {
  const res = await apiPut(`/v1/companies/${id}/front-page`, { kind, target: target || '' });
  return res?.data?.company ?? null;
}

export async function getPortfolio(id) {
  const res = await apiGet(`/v1/companies/${id}/portfolio`);
  return res?.data?.portfolio ?? null;
}

export async function publishPortfolio(id, html) {
  const res = await apiPut(`/v1/companies/${id}/portfolio`, { html });
  return res?.data ?? null;
}

export async function removePortfolio(id) {
  await apiDelete(`/v1/companies/${id}/portfolio`);
}

/* ── The sending identity ─────────────────────────────────────────────────── */

export async function getSmtp(id) {
  const res = await apiGet(`/v1/companies/${id}/smtp`);
  return res?.data?.smtp ?? null;
}

export async function saveSmtp(id, body) {
  const res = await apiPut(`/v1/companies/${id}/smtp`, body);
  return res?.data?.smtp ?? null;
}

export async function removeSmtp(id) {
  await apiDelete(`/v1/companies/${id}/smtp`);
}

/* ── What has happened in the company's name ──────────────────────────────── */

/** How many invoices this company has, this calendar year. */
export async function invoiceCount(companyId) {
  const year = new Date().getFullYear();
  const res = await apiGet(`/v1/finance/invoices?company=${encodeURIComponent(companyId)}&from=${year}-01-01&per_page=1`);
  return res?.data?.total ?? 0;
}

/** How many messages have left in this company's name (all time). */
export async function sentCount(companyId) {
  const res = await apiGet(`/v1/outbound/log?company=${encodeURIComponent(companyId)}&per_page=1`);
  return res?.data?.total ?? 0;
}

/* ── Who may act in its name ──────────────────────────────────────────────── */

/** The organisms this owner belongs to — the candidates for the company's organism link. */
export async function myOrganisms(ownerName) {
  const res = await apiGet(`/v1/organisms?member=${encodeURIComponent(ownerName)}`);
  return (res?.data?.organisms ?? []).filter((o) => !o.archivedAt);
}

/* ── Does the address answer ──────────────────────────────────────────────── */

/**
 * A reachability probe, not a content check — and it runs on the node, because the SPA's CSP
 * (connect-src 'self') refuses every foreign origin from the browser. The node probes a redirect
 * at its target and everything else at the company's own address, through its SSRF guard.
 * Returns true/false, or null when there is nothing to probe.
 */
export async function addressAnswers(companyId) {
  const res = await apiGet(`/v1/companies/${companyId}/front-page/check`);
  return res?.data?.answers ?? null;
}

/* ── The address preview ──────────────────────────────────────────────────── */

/** Trade name → address label. Mirrors the server's slugify so the preview does not lie. */
export function slugify(name) {
  return String(name || '').toLowerCase()
    .replace(/[äå]/g, 'a').replace(/ö/g, 'o').replace(/[éè]/g, 'e')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
}
