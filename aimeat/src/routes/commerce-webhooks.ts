/**
 * @file src/routes/commerce-webhooks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Stripe webhook endpoint → accounting vouchers. Per-seller path
 *   (/v1/commerce/webhooks/stripe/:owner) because every seller runs their OWN Stripe
 *   account (no Connect, no node-level key): each endpoint verifies against that
 *   seller's endpoint signing secret, stored in the merged commerce.psp record
 *   (PUT /v1/commerce/payout/stripe with webhook_secret).
 *
 *   Event mapping:
 *   - payment_intent.succeeded → income voucher (source 'stripe'); when the intent's
 *     metadata.aimeat_reference matches one of the seller's sent invoices, the invoice
 *     is marked paid instead (which books the voucher WITH its VAT breakdown).
 *   - charge.refunded → expense voucher for the refunded amount.
 *   - payout.paid → TRANSFER voucher (Stripe balance → bank account; not revenue).
 *   Everything else acks 200 without booking — Stripe retries on non-2xx, and an
 *   unhandled event type is not an error.
 *
 *   Idempotency: the voucher's externalRef is the Stripe event id; bookVoucher returns
 *   the existing voucher on a redelivery. Signature: HMAC-SHA256 over `${t}.${rawBody}`
 *   (the Stripe v1 scheme) with a 5-minute timestamp tolerance, compared in constant
 *   time. The raw body is available because server.ts mounts express.raw on this prefix
 *   before the JSON parser.
 *
 * @structure verifyStripeSignature · event mapping · commerceWebhooksRouter
 * @usage app.use(commerceWebhooksRouter(config, storage)) in routes-loader
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 1.
 */
import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AimeatConfig } from '../config-types.js';
import type { Storage } from '../storage/interface.js';
import { success, error } from '../middleware/envelope.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { emitChange } from '../services/event-bus.js';
import { logger as log } from '../utils/logger.js';
import { FinanceError } from '../services/finance/errors.js';
import { bookVoucher } from '../services/finance/vouchers.js';
import { markPaid } from '../services/finance/invoice-service.js';

const TOLERANCE_SECONDS = 300;

/** Verifies a Stripe `t=...,v1=...` signature header against the raw payload. */
export function verifyStripeSignature(rawBody: Buffer, header: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const parts = new Map<string, string[]>();
  for (const piece of header.split(',')) {
    const eq = piece.indexOf('=');
    if (eq < 1) continue;
    const k = piece.slice(0, eq).trim();
    const v = piece.slice(eq + 1).trim();
    parts.set(k, [...(parts.get(k) ?? []), v]);
  }
  const t = Number(parts.get('t')?.[0]);
  const signatures = parts.get('v1') ?? [];
  if (!Number.isFinite(t) || signatures.length === 0) return false;
  if (Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf-8');
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf-8');
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

interface StripeEvent {
  id?: string;
  type?: string;
  created?: number;
  data?: { object?: Record<string, unknown> };
}

function isoDateOf(created: number | undefined): string {
  const d = created && Number.isFinite(created) ? new Date(created * 1000) : new Date();
  return d.toISOString().slice(0, 10);
}

export function commerceWebhooksRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();
  // keyBy ip: the caller is Stripe, unauthenticated; a flood must not starve other paths.
  const webhookLimit = rateLimit({ windowMs: 60_000, max: 120, keyBy: 'ip' });

  router.post('/v1/commerce/webhooks/stripe/:owner', webhookLimit, async (req, res) => {
    const ownerName = String(req.params.owner ?? '');
    if (!/^[a-z0-9_-]{1,60}$/i.test(ownerName)) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown endpoint'));
      return;
    }
    const ownerGhii = `${ownerName}@${config.nodeId}`;
    const psp = (await storage.getMemory(ownerGhii, 'commerce.psp'))?.value as { webhookSecret?: unknown } | undefined;
    const secret = typeof psp?.webhookSecret === 'string' ? psp.webhookSecret : '';
    // Missing seller and missing webhook config answer identically: endpoint paths must not
    // reveal which owners exist or which have Stripe configured.
    if (!secret) {
      res.status(404).json(error(config.nodeId, 'NOT_FOUND', 'Unknown endpoint'));
      return;
    }
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}), 'utf-8');
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string' || !verifyStripeSignature(rawBody, signature, secret)) {
      res.status(401).json(error(config.nodeId, 'INVALID_SIGNATURE', 'Stripe signature verification failed'));
      return;
    }

    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody.toString('utf-8')) as StripeEvent;
    } catch {
      res.status(400).json(error(config.nodeId, 'INVALID_PAYLOAD', 'Body is not JSON'));
      return;
    }
    if (!event.id || !event.type) {
      res.status(400).json(error(config.nodeId, 'INVALID_PAYLOAD', 'Missing event id/type'));
      return;
    }

    const object = event.data?.object ?? {};
    const currency = typeof object.currency === 'string' ? object.currency.toUpperCase() : 'EUR';
    const date = isoDateOf(event.created);

    try {
      let booked: { action: string; voucherId?: string; invoiceId?: string } = { action: 'ignored' };

      if (event.type === 'payment_intent.succeeded') {
        const amount = Number(object.amount_received ?? object.amount ?? 0);
        const intentId = typeof object.id === 'string' ? object.id : null;
        const metadata = (object.metadata ?? {}) as Record<string, unknown>;
        const reference = typeof metadata.aimeat_reference === 'string' ? metadata.aimeat_reference : null;
        if (amount > 0) {
          const invoice = reference ? await storage.findInvoiceByReference(ownerGhii, reference) : undefined;
          if (invoice && (invoice.status === 'sent' || invoice.status === 'overdue')) {
            const paid = await markPaid(storage, ownerGhii, invoice.id, {
              trackingCode: intentId ?? undefined, externalRef: event.id,
            });
            booked = { action: 'invoice_paid', invoiceId: paid.id };
          } else {
            const voucher = await bookVoucher(storage, ownerGhii, {
              date, description: `Stripe charge${typeof object.description === 'string' ? `: ${object.description}` : ''}`,
              direction: 'income', source: 'stripe',
              amountMinor: Math.round(amount), currency,
              counterparty: typeof object.receipt_email === 'string' ? object.receipt_email : null,
              trackingCode: intentId, externalRef: event.id,
            });
            booked = { action: 'charge_booked', voucherId: voucher.id };
          }
        }
      } else if (event.type === 'charge.refunded') {
        const amount = Number(object.amount_refunded ?? 0);
        const intentId = typeof object.payment_intent === 'string' ? object.payment_intent : null;
        if (amount > 0) {
          const voucher = await bookVoucher(storage, ownerGhii, {
            date, description: 'Stripe refund',
            direction: 'expense', source: 'stripe',
            amountMinor: Math.round(amount), currency,
            trackingCode: intentId, externalRef: event.id,
          });
          booked = { action: 'refund_booked', voucherId: voucher.id };
        }
      } else if (event.type === 'payout.paid') {
        const amount = Number(object.amount ?? 0);
        if (amount > 0) {
          const voucher = await bookVoucher(storage, ownerGhii, {
            date, description: 'Stripe payout to bank account',
            direction: 'transfer', source: 'stripe',
            amountMinor: Math.round(amount), currency,
            trackingCode: typeof object.id === 'string' ? object.id : null,
            externalRef: event.id,
          });
          booked = { action: 'payout_booked', voucherId: voucher.id };
        }
      }

      if (booked.action !== 'ignored') emitChange('finance', ownerGhii);
      res.json(success(config.nodeId, { received: event.id, ...booked }));
    } catch (e) {
      if (e instanceof FinanceError && e.code === 'FISCAL_YEAR_LOCKED') {
        // A locked year rejecting a live money event is an operator problem, not Stripe's:
        // ack the event (Stripe must not retry forever) and log loudly for reconciliation.
        log.error(`Webhook event ${event.id} for ${ownerName} hit a locked fiscal year — book manually`);
        res.json(success(config.nodeId, { received: event.id, action: 'rejected_locked_fiscal_year' }));
        return;
      }
      log.error(`Webhook processing failed for ${ownerName}: ${(e as Error).message}`);
      res.status(500).json(error(config.nodeId, 'WEBHOOK_ERROR', 'Event processing failed'));
    }
  });

  return router;
}
