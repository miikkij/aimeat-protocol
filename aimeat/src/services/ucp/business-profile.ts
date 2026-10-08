/**
 * @file src/services/ucp/business-profile.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The UCP business profile at /.well-known/ucp, version 2026-08-25
 *   (docs/specification/overview/index.md, "Profile Structure", read 2026-10-08): the shopping
 *   service over REST at /ucp/2026-08-25, the checkout and order capabilities, the payment handlers
 *   the place's owner can take, the keys this node signs with, and the older version this node still
 *   answers (`supported_versions`, the 2026-04-08 profile at /.well-known/ucp/2026-04-08).
 *
 *   ONE PROFILE PER NODE. A place is one owner's node, so the payment handler is the place owner's
 *   (the operator account): Stripe's `com.stripe.payments` once they gave their Stripe network
 *   profile and have a selling key. A checkout answers each seller's own handlers in its `ucp` block.
 * @structure businessProfile
 * @usage res.json(await businessProfile(storage, config));
 * @version-history
 *   v1.0.0 — 2026-10-08 — Initial (AI visibility, layer E).
 */
import type { Storage } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import { UCP_VERSION, sellerPaymentHandlers } from '../../commerce/ucp-guest-checkout.js';
import { resolvePlaceOwner } from '../visibility/visibility-counter.js';
import { ucpPublicKeys } from './ucp-keys.js';

/** The version the older profile and the signed-in checkout at /ucp/v1 are written against. */
export const UCP_PREVIOUS_VERSION = '2026-04-08';

export async function businessProfile(storage: Storage, config: AimeatConfig): Promise<Record<string, unknown>> {
  const b = config.baseUrl.replace(/\/$/, '');
  const v = UCP_VERSION;
  const place = config.commerceEnabled ? await resolvePlaceOwner(storage, config) : null;
  return {
    ucp: {
      version: v,
      services: {
        'dev.ucp.shopping': [{
          version: v,
          spec: `https://ucp.dev/${v}/specification/overview/`,
          transport: 'rest',
          endpoint: `${b}/ucp/${v}`,
          schema: `https://ucp.dev/${v}/services/shopping/rest.openapi.json`,
        }],
      },
      capabilities: config.commerceEnabled ? {
        'dev.ucp.shopping.checkout': [{
          version: v,
          spec: `https://ucp.dev/${v}/specification/shopping/checkout`,
          schema: `https://ucp.dev/${v}/schemas/shopping/checkout.json`,
        }],
        'dev.ucp.shopping.order': [{
          version: v,
          spec: `https://ucp.dev/${v}/specification/shopping/order`,
          schema: `https://ucp.dev/${v}/schemas/shopping/order.json`,
        }],
      } : {},
      payment_handlers: place ? await sellerPaymentHandlers(storage, config, place) : {},
      supported_versions: { [UCP_PREVIOUS_VERSION]: `${b}/.well-known/ucp/${UCP_PREVIOUS_VERSION}` },
    },
    keys: await ucpPublicKeys(storage),
  };
}
