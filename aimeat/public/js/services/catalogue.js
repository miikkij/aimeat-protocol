/**
 * @file public/js/services/catalogue.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service layer for the AIMEAT action catalogue — lists an owner's services,
 *   browses the public catalogue by category, and publishes/unpublishes services via /v1/catalogue.
 *
 * @structure
 *   - listMyServices(providerGaii): GET the services one provider published (GET /v1/actions?provider=)
 *   - browse(category): GET the catalogue, optionally category-filtered
 *   - publish(...): POST a new service (display name, pacing amount, unit, optional webhook)
 *   - unpublish(serviceId): DELETE a service
 *
 * @version-history
 *   v1.2.0 — 2026-11-04 — listMyServices asks GET /v1/actions by the exact provider identity. It sent
 *     `owner` to GET /v1/catalogue, which reads no such parameter, so "My services" listed every
 *     service on the node (codebase analysis 2026-11-03, item A6).
 *   v1.1.0 — 2026-10-11 — publish() sends the pacing amount as toll_morsels, not price_morsels: a
 *     morsel is pacing, not a price (ruling 2026-10-11).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet, api } from '/js/api.js';

/**
 * The services one provider published, by its exact identity (the owner's GHII for "My services").
 * GET /v1/actions reads `provider`; GET /v1/catalogue has no owner filter and answered the whole
 * catalogue. 200 is that route's largest page. Returns array.
 */
export async function listMyServices(providerGaii) {
  const data = await apiGet('/v1/actions?provider=' + encodeURIComponent(providerGaii) + '&per_page=200');
  return data?.data?.actions || [];
}

/** Browse catalogue, optionally filtered by category. Returns array. */
export async function browse(category) {
  const q = category ? '?category=' + encodeURIComponent(category) : '';
  const data = await apiGet('/v1/catalogue' + q);
  return data?.data?.actions || data?.data || [];
}

/**
 * Publish a new service to the catalogue. `tollMorsels` is the pacing amount: the morsels one use
 * takes from the user's balance. It is not a price and goes out as `toll_morsels` (3.x `price_morsels`).
 */
export async function publish(name, description, category, tollMorsels, unit, webhookUrl) {
  const body = {
    display_name: name,
    description,
    category,
    toll_morsels: Math.max(0, Math.trunc(Number(tollMorsels) || 0)),
    unit: unit || 'call',
  };
  if (webhookUrl) body.webhook_url = webhookUrl;
  return api('/v1/catalogue', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Unpublish (delete) a service from the catalogue. */
export async function unpublish(serviceId) {
  return api('/v1/catalogue/' + encodeURIComponent(serviceId), { method: 'DELETE' });
}
