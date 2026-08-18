/**
 * @file public/js/services/catalogue.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Frontend service layer for the AIMEAT action catalogue — lists an owner's services,
 *   browses the public catalogue by category, and publishes/unpublishes services via /v1/catalogue.
 *
 * @structure
 *   - listMyServices(owner): GET services owned by a given owner
 *   - browse(category): GET the catalogue, optionally category-filtered
 *   - publish(...): POST a new service (display name, price, unit, optional webhook)
 *   - unpublish(serviceId): DELETE a service
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import { apiGet, api } from '/js/api.js';

/** List services owned by a specific owner. Returns array. */
export async function listMyServices(owner) {
  const data = await apiGet('/v1/catalogue?owner=' + encodeURIComponent(owner));
  return data?.data?.actions || data?.data || [];
}

/** Browse catalogue, optionally filtered by category. Returns array. */
export async function browse(category) {
  const q = category ? '?category=' + encodeURIComponent(category) : '';
  const data = await apiGet('/v1/catalogue' + q);
  return data?.data?.actions || data?.data || [];
}

/** Publish a new service to the catalogue. */
export async function publish(name, description, category, priceMorsels, unit, webhookUrl) {
  const body = {
    display_name: name,
    description,
    category,
    price_morsels: Number(priceMorsels) || 0,
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
