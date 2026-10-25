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
 * @usage const sender = await resolveCompanySender(config, storage, sendingCompany.company);
 * @version-history
 *   2026-10-25 — The SMTP host passes the outbound address rules at save and before each send
 *     (smtp-host-check.ts): a private-network host only when the operator lists it in
 *     email.company_smtp_private_hosts, loopback on a local node as before. The send connects to the
 *     checked address with the host name kept for TLS, and a failure is told in fixed words by its
 *     code, never with the remote end's first line (secaudit2026oct22, sendAsCompany:smtp-host-address-class).
 *   v1.1.1 — 2026-10-05 — Addresses are checked with isValidEmail (utils/email-validator.ts), which
 *     also caps the length (secaudit 2026-10, M2).
 *   v1.1.0 — 2026-08-24 — resolveCompanySender no longer authorizes. Sending as a company is no
 *     longer the same question as owning it (an organism's members may speak for a company bound
 *     to that organism), and a second copy of that rule here would drift from the one that
 *     decides. It takes the already-granted company and builds the transport. Returns null when
 *     the company has no identity of its own, which is the honest fallback to the node's shared
 *     sender rather than a failure.
 *   v1.0.0 — 2026-08-07 — Per-company sending identity for the outbound door.
 */
import { createTransport } from 'nodemailer';
import { isIP } from 'node:net';
import { checkSmtpHost } from './smtp-host-check.js';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CompanySmtpRecord, CompanySmtpPublic } from '../../models/company-smtp-schemas.js';
import { toPublicSmtp } from '../../models/company-smtp-schemas.js';
import type { EmailAttachment } from '../email.js';
import { encrypt, decrypt, getEncryptionKey } from '../encryption.js';
import { logger } from '../../utils/logger.js';
import { isValidEmail } from '../../utils/email-validator.js';
import { CompanyError, requireOwnCompany } from './company-service.js';
import type { CompanyRecord } from '../../models/company-schemas.js';

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


/** Stores (or replaces) a company's sending identity. Refuses a password it cannot encrypt. */
export async function setCompanySmtp(
  config: AimeatConfig, storage: Storage, ownerGhii: string, companyId: string, input: CompanySmtpInput,
): Promise<CompanySmtpPublic> {
  await requireOwnCompany(storage, ownerGhii, companyId);

  const host = (input.host ?? '').trim();
  if (!host || host.length > 253) throw new CompanyError('INVALID_SMTP', 400, 'host is required');
  // A private-network host only when the operator listed it (services/company/smtp-host-check.ts).
  const checked = await checkSmtpHost(host, config.companySmtpPrivateHosts);
  if (!checked.ok) throw new CompanyError(checked.code, 400, checked.message);
  const fromAddress = (input.fromAddress ?? '').trim().toLowerCase();
  if (!isValidEmail(fromAddress)) throw new CompanyError('INVALID_SMTP', 400, 'fromAddress must be an email address');
  const port = input.port ?? 587;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CompanyError('INVALID_SMTP', 400, 'port must be 1-65535');
  if (input.replyTo && !isValidEmail(input.replyTo.trim())) {
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
  /** The operator's list of private mail servers a company may use (config.companySmtpPrivateHosts). */
  privateHosts: readonly string[];
}

/**
 * Build the transport for a company whose right to speak has ALREADY been decided.
 *
 * It used to re-check ownership here, which was the whole authorization for sending as a company
 * and is now too narrow: a company bound to an organism may also be spoken for by that organism's
 * members. Two checks in two places would drift, so this one takes the company the caller was
 * granted (services/outbound/company-sender-access.ts) and does no authorizing of its own. The
 * type is the reminder: you cannot call this without having resolved access first.
 */
export async function resolveCompanySender(
  config: AimeatConfig, storage: Storage, company: CompanyRecord,
): Promise<CompanySender | null> {
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
  return { smtp, password, privateHosts: config.companySmtpPrivateHosts };
}

/**
 * The reason a send failed, in fixed words by the error's code. The client's own message carries
 * what the remote end said (nodemailer puts a refused greeting's first line in it), and that is
 * never passed back: it read the first line of whatever service a host and port pointed at.
 */
function sendFailureText(err: unknown, host: string, port: number): string {
  const e = (err ?? {}) as { code?: unknown; originalCode?: unknown; responseCode?: unknown };
  const code = typeof e.code === 'string' ? e.code : 'ERROR';
  const sys = typeof e.originalCode === 'string' ? ` ${e.originalCode}` : '';
  const smtp = typeof e.responseCode === 'number' ? `, SMTP ${e.responseCode}` : '';
  switch (code) {
    case 'EAUTH': return `The company's mail server refused the sign-in (${code}${smtp}).`;
    case 'EENVELOPE': return `The company's mail server refused the sender or the recipient (${code}${smtp}).`;
    case 'EMESSAGE': return `The company's mail server did not take the message (${code}${smtp}).`;
    default: return `The company's mail server ${host}:${port} did not accept the connection as a mail server (${code}${sys}${smtp}).`;
  }
}

/**
 * Sends one message through the company's own SMTP server. Never throws on a delivery
 * failure — the outbound door records the outcome in its log, and an exception here would
 * lose that record.
 */
export async function sendAsCompany(
  sender: CompanySender, to: string, subject: string, html: string, text: string,
  attachments: EmailAttachment[] = [],
  // Extra headers the caller wants on the wire. Today that is the optional AI disclosure, and
  // it rides here rather than in the body because its audience is machines.
  headers: Record<string, string> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { smtp, password } = sender;
  // Checked again at send: the operator's list may have changed, and a name may resolve elsewhere
  // now. The connection goes to the address checked here, with the host name kept for TLS.
  const checked = await checkSmtpHost(smtp.host, sender.privateHosts);
  if (!checked.ok) return { ok: false, error: checked.message };
  if (checked.address === null) {
    return { ok: false, error: `The company's mail server ${smtp.host} could not be found (DNS).` };
  }
  const transporter = createTransport({
    host: checked.address,
    port: smtp.port,
    secure: smtp.secure,
    ...(isIP(smtp.host.replace(/^\[|\]$/g, '')) ? {} : { servername: smtp.host }),
    auth: smtp.username ? { user: smtp.username, pass: password ?? '' } : undefined,
  });
  try {
    const from = smtp.fromName ? `"${smtp.fromName.replaceAll('"', "'")}" <${smtp.fromAddress}>` : smtp.fromAddress;
    await transporter.sendMail({
      from, to, subject, html, text,
      ...(Object.keys(headers).length ? { headers } : {}),
      replyTo: smtp.replyTo ?? undefined,
      attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
    // Never log the recipient address (the same privacy rule the shared service keeps).
    logger.info(`Company SMTP send ok: ${subject}`);
    return { ok: true };
  } catch (err) {
    logger.error(`Company SMTP send failed: ${subject}`, { error: (err as Error).message });
    return { ok: false, error: sendFailureText(err, smtp.host, smtp.port) };
  } finally {
    transporter.close();
  }
}
