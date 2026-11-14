/**
 * @file src/services/secret-shares/view.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a caller is shown of a secret share, in snake_case as the API speaks: never the
 *   ciphertext, never a code or token hash, never the wrapped e2e keys (pickup.ts hands a recipient
 *   their own). Two shapes: the view for a caller who has a role on the share, and the card the
 *   pickup and deposit pages show before anyone signs in.
 * @structure ShareView · ShareCard · shareView · publicCard · eventView
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { SecretShareEvent, SecretShareRecord } from '../../storage/types/secret-shares.js';

export interface ShareView {
  id: string; kind: string; name: string; note: string; format: string; file_name: string | null;
  content_type: string | null; size_bytes: number; protection: string;
  recipients: { people: string[]; agents: boolean; organism: boolean; code: boolean; code_login: boolean };
  organism: string | null; retention: string; max_pickups: number | null; expires_at: string | null;
  pickups: number; status: string; maker: string; created_by: string; created_at: string; updated_at: string;
  request_expires_at: string | null; deposited_at: string | null; deposited_by: string | null;
  check: SecretShareRecord['check']; revoked_at: string | null; revoked_by: string | null;
  you: { manage: boolean; pickup: boolean; deposit: boolean };
  events?: Array<{ at: string; kind: string; actor: string; on_behalf_of: string; detail: Record<string, string> }>;
}

export interface ShareCard {
  id: string; kind: string; name: string; maker: string; status: string; format: string;
  file_name: string | null; protection: string; code: boolean; code_login: boolean; code_salt: string | null;
  check: SecretShareRecord['check']; request_expires_at: string | null; expires_at: string | null;
}

export function eventView(e: SecretShareEvent) {
  return { at: e.at, kind: e.kind, actor: e.actor, on_behalf_of: e.onBehalfOf, detail: e.detail };
}

export function shareView(s: SecretShareRecord, you: { manage: boolean; pickup: boolean; deposit: boolean }, events: SecretShareEvent[] | null): ShareView {
  return {
    id: s.id, kind: s.kind, name: s.name, note: s.note, format: s.secretFormat, file_name: s.fileName,
    content_type: s.fileType, size_bytes: s.sizeBytes, protection: s.protectionLevel,
    recipients: { people: s.recipients.people, agents: s.recipients.agents, organism: s.recipients.organism, code: s.recipients.code, code_login: s.codeLogin },
    organism: s.organismId, retention: s.retention, max_pickups: s.maxPickups, expires_at: s.expiresAt,
    pickups: s.pickups, status: s.status, maker: s.ownerGhii, created_by: s.createdBy, created_at: s.createdAt,
    updated_at: s.updatedAt, request_expires_at: s.requestExpiresAt, deposited_at: s.depositedAt,
    deposited_by: s.depositedBy, check: s.check, revoked_at: s.revokedAt, revoked_by: s.revokedBy,
    you: { manage: you.manage, pickup: you.pickup, deposit: you.deposit },
    ...(events ? { events: events.map(eventView) } : {}),
  };
}

/** `withCheck`: the depositor reading their own deposit's answer. A page anyone with the id opens gets none. */
export function publicCard(s: SecretShareRecord, withCheck = false): ShareCard {
  return {
    id: s.id, kind: s.kind, name: s.name, maker: s.ownerGhii, status: s.status, format: s.secretFormat,
    file_name: s.fileName, protection: s.protectionLevel, code: s.recipients.code, code_login: s.codeLogin,
    code_salt: s.protectionLevel === 'e2e' ? s.codeSalt : null, check: withCheck ? s.check : null,
    request_expires_at: s.requestExpiresAt, expires_at: s.expiresAt,
  };
}
