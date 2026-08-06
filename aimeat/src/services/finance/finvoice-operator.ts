/**
 * @file src/services/finance/finvoice-operator.ts
 * @description The e-invoice operator adapter seam. One interface, three implementations:
 *
 *   - 'mock'  — in-process test double (E2E + local dev without an operator account).
 *     Deterministic: submission succeeds unless the buyer's e-invoice address contains
 *     'REJECT'; status() reports delivered/rejected accordingly.
 *   - 'rest'  — a generic REST bridge: POST the Finvoice XML to the configured gateway
 *     URL with a bearer key, poll status from {url}/{messageId}. Every call goes through
 *     safeFetch (Rule 10). This is the shape most operator gateways (Maventa, Apix)
 *     front with; the operator-specific adapter replaces it once the operator contract
 *     is chosen (a phase-0 decision that is the developer's, not code's).
 *   - unset   — the safe public default: Finvoice delivery answers 503 with a hint to
 *     use the email door instead. Never a silent fallback.
 *
 *   Posture-driven config, not a code fork: AIMEAT_FINVOICE_OPERATOR selects the
 *   adapter; URL/key live in node config, never in a principal-writable namespace.
 *
 * @structure FinvoiceOperator interface · mock/rest adapters · getFinvoiceOperator() ·
 *   submitInvoice() / refreshDeliveryStatus() glue used by the finance routes
 * @usage const op = getFinvoiceOperator(config); if (op) await submitInvoice(...)
 * @version-history
 *   v1.0.0 — 2026-08-06 — Company-in-a-box phase 3.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { InvoiceRecord, InvoiceDeliveryStatus } from '../../models/finance-schemas.js';
import { safeFetch } from '../../utils/url-validator.js';
import { FinanceError } from './errors.js';
import { buildFinvoiceXml } from './finvoice.js';

export interface FinvoiceOperator {
  readonly id: string;
  /** Submits the Finvoice XML for delivery. Returns the operator-side message id. */
  submit(invoice: InvoiceRecord, xml: string): Promise<{ messageId: string }>;
  /** Reports the delivery outcome for an earlier submission. */
  status(messageId: string): Promise<InvoiceDeliveryStatus>;
}

// ── Mock adapter (tests + local dev) ─────────────────────────────────────────

/** In-process submission book — per process, which is exactly the mock's job. */
const mockSubmissions = new Map<string, InvoiceDeliveryStatus>();

function mockOperator(): FinvoiceOperator {
  return {
    id: 'mock',
    async submit(invoice: InvoiceRecord): Promise<{ messageId: string }> {
      const messageId = `mock-${randomUUID().slice(0, 12)}`;
      const rejected = (invoice.buyer.einvoiceAddress ?? '').toUpperCase().includes('REJECT');
      mockSubmissions.set(messageId, rejected ? 'rejected' : 'delivered');
      return { messageId };
    },
    async status(messageId: string): Promise<InvoiceDeliveryStatus> {
      return mockSubmissions.get(messageId) ?? 'pending';
    },
  };
}

// ── Generic REST bridge ──────────────────────────────────────────────────────

function restOperator(config: AimeatConfig): FinvoiceOperator {
  const base = (config.finvoiceOperatorUrl ?? '').replace(/\/$/, '');
  const key = config.finvoiceOperatorApiKey ?? '';
  return {
    id: 'rest',
    async submit(_invoice: InvoiceRecord, xml: string): Promise<{ messageId: string }> {
      const res = await safeFetch(`${base}/invoices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml', Authorization: `Bearer ${key}` },
        body: xml,
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (!res.ok) {
        throw new FinanceError('OPERATOR_REJECTED', res.status >= 500 ? 502 : 422, `Operator answered ${res.status}: ${text.slice(0, 300)}`);
      }
      let messageId: string | undefined;
      try {
        const ack = JSON.parse(text) as { id?: string; message_id?: string };
        messageId = ack.id ?? ack.message_id;
        // eslint-disable-next-line aimeat/no-silent-catch -- a non-JSON ack is handled by the missing-id error below; the raw body is already in that error's context
      } catch { /* non-JSON ack */ }
      if (!messageId) throw new FinanceError('OPERATOR_PROTOCOL', 502, `Operator ack did not carry a message id: ${text.slice(0, 200)}`);
      return { messageId };
    },
    async status(messageId: string): Promise<InvoiceDeliveryStatus> {
      const res = await safeFetch(`${base}/invoices/${encodeURIComponent(messageId)}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return 'pending';
      try {
        const body = await res.json() as { status?: string };
        if (body.status === 'delivered') return 'delivered';
        if (body.status === 'rejected' || body.status === 'error') return 'rejected';
        // eslint-disable-next-line aimeat/no-silent-catch -- an unparseable status body means the operator has not decided yet; 'pending' IS the honest reading, and the next poll retries
      } catch { /* unparseable → still pending */ }
      return 'pending';
    },
  };
}

// ── Selection + glue ─────────────────────────────────────────────────────────

/** Returns the configured adapter, or null when Finvoice delivery is not set up. */
export function getFinvoiceOperator(config: AimeatConfig): FinvoiceOperator | null {
  switch (config.finvoiceOperator) {
    case 'mock': return mockOperator();
    case 'rest':
      if (!config.finvoiceOperatorUrl || !config.finvoiceOperatorApiKey) return null;
      return restOperator(config);
    default: return null;
  }
}

/**
 * Submits a SENT invoice to the operator and stamps operatorMessageId + deliveryStatus.
 * Retryable: an earlier failed/pending submission is simply replaced.
 */
export async function submitInvoice(config: AimeatConfig, storage: Storage, invoice: InvoiceRecord): Promise<InvoiceRecord> {
  const operator = getFinvoiceOperator(config);
  if (!operator) {
    throw new FinanceError('FINVOICE_OPERATOR_NOT_CONFIGURED', 503,
      'No e-invoice operator is configured on this node (AIMEAT_FINVOICE_OPERATOR); deliver by email instead');
  }
  if (!invoice.invoiceNumber) throw new FinanceError('NOT_SENT', 409, 'Send the invoice first (draft → sent)');
  if (!invoice.buyer.einvoiceAddress) {
    throw new FinanceError('MISSING_EINVOICE_ADDRESS', 422, 'buyer.einvoiceAddress (verkkolaskuosoite) is required for Finvoice delivery');
  }
  let originalNumber: string | null = null;
  if (invoice.type === 'credit_note' && invoice.creditsInvoiceId) {
    originalNumber = (await storage.getInvoice(invoice.creditsInvoiceId))?.invoiceNumber ?? null;
  }
  const xml = buildFinvoiceXml(invoice, { originalInvoiceNumber: originalNumber });
  const { messageId } = await operator.submit(invoice, xml);
  await storage.setInvoiceStatus(invoice.id, invoice.status, {
    operatorMessageId: messageId,
    deliveryStatus: 'pending',
    deliveryMethod: 'finvoice',
  });
  const updated = await storage.getInvoice(invoice.id);
  if (!updated) throw new FinanceError('NOT_FOUND', 404, 'Invoice disappeared during submission');
  return updated;
}

/** Polls the operator and updates deliveryStatus when it has moved. */
export async function refreshDeliveryStatus(config: AimeatConfig, storage: Storage, invoice: InvoiceRecord): Promise<InvoiceRecord> {
  const operator = getFinvoiceOperator(config);
  if (!operator) {
    throw new FinanceError('FINVOICE_OPERATOR_NOT_CONFIGURED', 503, 'No e-invoice operator is configured on this node');
  }
  if (!invoice.operatorMessageId) {
    throw new FinanceError('NOT_SUBMITTED', 409, 'Invoice has not been submitted to the operator');
  }
  const status = await operator.status(invoice.operatorMessageId);
  if (status !== invoice.deliveryStatus) {
    await storage.setInvoiceStatus(invoice.id, invoice.status, { deliveryStatus: status });
  }
  const updated = await storage.getInvoice(invoice.id);
  if (!updated) throw new FinanceError('NOT_FOUND', 404, 'Invoice disappeared during refresh');
  return updated;
}
