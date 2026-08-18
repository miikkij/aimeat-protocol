/**
 * @file company-smtp-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A company's own sending identity: the SMTP server its outbound mail leaves
 *   through, so a customer sees mail from the company's domain rather than the node's shared
 *   sender. The password is never carried in this record — it lives encrypted in storage and
 *   is decrypted only at send time, so no read path can return it.
 * @structure CompanySmtpRecord (stored) · CompanySmtpPublic (what any read returns)
 * @version-history
 *   v1.0.0 — 2026-08-07 — Per-company sending identity for the outbound door.
 */

export interface CompanySmtpRecord {
  companyId: string;
  ownerGhii: string;
  host: string;
  port: number;
  secure: boolean;
  username: string | null;
  /** AES-256-GCM ciphertext (services/encryption.ts). Never leaves the server. */
  passwordEnc: string | null;
  fromAddress: string;
  fromName: string | null;
  replyTo: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The shape every read returns: the password is replaced by whether one is set. */
export type CompanySmtpPublic = Omit<CompanySmtpRecord, 'passwordEnc'> & { passwordSet: boolean };

export function toPublicSmtp(row: CompanySmtpRecord): CompanySmtpPublic {
  const { passwordEnc, ...rest } = row;
  return { ...rest, passwordSet: !!passwordEnc };
}
