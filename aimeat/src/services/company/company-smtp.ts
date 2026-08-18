/**
 * @file src/services/company/company-smtp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A company's own sending identity: store it, read it back without the
 *   password, and build a nodemailer transport from it at send time.
 *
 *   Two rules that are the whole point of this file:
 *   1. The password is stored as AES-256-GCM ciphertext and NEVER returned by any read.
 *      Without an encryption key the node REFUSES to store one rather than writing it in
 *      the clear — a credential that cannot be protected is not accepted.
 *   2. The transport is built per send and closed after: a company's SMTP server is its
 *      own, and holding a long-lived pooled connection per company would leak both file
 *      descriptors and the fact of who sent when.
 *
 * @structure setCompanySmtp · getCompanySmtpPublic · resolveCompanySender · sendAsCompany
 * @usage const sender = await resolveCompanySender(config, storage, ownerGhii, companyId);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Per-company sending identity for the outbound door.
 */
import { createTransport } from 'nodemailer';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CompanySmtpRecord, CompanySmtpPublic } from '../../models/company-smtp-schemas.js';
import { toPublicSmtp } from '../../models/company-smtp-schemas.js';
import type { EmailAttachment } from '../email.js';
import { encrypt, decrypt, getEncryptionKey } from '../encryption.js';
import { logger } from '../../utils/logger.js';
import { CompanyError, requireOwnCompany } from './company-service.js';

export interface CompanySmtpInput {
  host: string;
  port?: number;
  secure?: boolean;
  username?: string | null;
  /** Plaintext on the way in only; stored encrypted. Omit on an update to keep the stored one. */
  password?: string | null;
  fromAddress: string;
  fromName?: string | null;
  replyTo?: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Stores (or replaces) a company's sending identity. Refuses a password it cannot encrypt. */
export async function setCompanySmtp(
  config: AimeatConfig, storage: Storage, ownerGhii: string, companyId: string, input: CompanySmtpInput,
): Promise<CompanySmtpPublic> {
  await requireOwnCompany(storage, ownerGhii, companyId);

  const host = (input.host ?? '').trim();
  if (!host || host.length > 253) throw new CompanyError('INVALID_SMTP', 400, 'host is required');
  const fromAddress = (input.fromAddress ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(fromAddress)) throw new CompanyError('INVALID_SMTP', 400, 'fromAddress must be an email address');
  const port = input.port ?? 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CompanyError('INVALID_SMTP', 400, 'port must be 1-65535');
  if (input.replyTo && !EMAIL_RE.test(input.replyTo.trim())) {
    throw new CompanyError('INVALID_SMTP', 400, 'replyTo must be an email address');
  }

  const existing = await storage.getCompanySmtp(companyId);
  let passwordEnc = existing?.passwordEnc ?? null;
  if (input.password !== undefined && input.password !== null && input.password !== '') {
    const key = getEncryptionKey(config);
    if (!key) {
      // Refusing beats storing a credential in the clear, and saying so beats a silent downgrade.
      throw new CompanyError('NO_ENCRYPTION_KEY', 503,
        'This node cannot store an SMTP password: AIMEAT_ENCRYPTION_KEY is unset');
    }
    passwordEnc = encrypt(input.password, key);
  }

  const now = new Date().toISOString();
  const row: CompanySmtpRecord = {
    companyId, ownerGhii, host, port,
    secure: input.secure ?? (port === 465),
    username: input.username?.trim() || null,
    passwordEnc,
    fromAddress,
    fromName: input.fromName?.trim() || null,
    replyTo: input.replyTo?.trim().toLowerCase() || null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await storage.setCompanySmtp(row);
  return toPublicSmtp(row);
}

/** The sending identity as any read returns it: no password, only whether one is set. */
export async function getCompanySmtpPublic(storage: Storage, ownerGhii: string, companyId: string): Promise<CompanySmtpPublic | null> {
  await requireOwnCompany(storage, ownerGhii, companyId);
  const row = await storage.getCompanySmtp(companyId);
  return row ? toPublicSmtp(row) : null;
}

export async function deleteCompanySmtp(storage: Storage, ownerGhii: string, companyId: string): Promise<void> {
  await requireOwnCompany(storage, ownerGhii, companyId);
  await storage.deleteCompanySmtp(companyId);
}

export interface CompanySender {
  smtp: CompanySmtpRecord;
  password: string | null;
}

/**
 * Resolves the company's sending identity for a send. Returns null when the company has
 * none — the caller then falls back to the node's shared sender, which is the honest
 * default rather than a failure.
 */
export async function resolveCompanySender(
  config: AimeatConfig, storage: Storage, ownerGhii: string, companyId: string,
): Promise<CompanySender | null> {
  const company = await requireOwnCompany(storage, ownerGhii, companyId);
  const smtp = await storage.getCompanySmtp(company.id);
  if (!smtp) return null;
  let password: string | null = null;
  if (smtp.passwordEnc) {
    const key = getEncryptionKey(config);
    if (!key) {
      throw new CompanyError('NO_ENCRYPTION_KEY', 503,
        'The stored SMTP password cannot be read: AIMEAT_ENCRYPTION_KEY is unset');
    }
    password = decrypt(smtp.passwordEnc, key);
  }
  return { smtp, password };
}

/**
 * Sends one message through the company's own SMTP server. Never throws on a delivery
 * failure — the outbound door records the outcome in its log, and an exception here would
 * lose that record.
 */
export async function sendAsCompany(
  sender: CompanySender, to: string, subject: string, html: string, text: string,
  attachments: EmailAttachment[] = [],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { smtp, password } = sender;
  const transporter = createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.username ? { user: smtp.username, pass: password ?? '' } : undefined,
  });
  try {
    const from = smtp.fromName ? `"${smtp.fromName.replaceAll('"', "'")}" <${smtp.fromAddress}>` : smtp.fromAddress;
    await transporter.sendMail({
      from, to, subject, html, text,
      replyTo: smtp.replyTo ?? undefined,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    // Never log the recipient address (the same privacy rule the shared service keeps).
    logger.info(`Company SMTP send ok: ${subject}`);
    return { ok: true };
  } catch (err) {
    logger.error(`Company SMTP send failed: ${subject}`, { error: (err as Error).message });
    return { ok: false, error: (err as Error).message.slice(0, 200) };
  } finally {
    transporter.close();
  }
}
