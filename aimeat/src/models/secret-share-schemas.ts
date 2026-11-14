/**
 * @file src/models/secret-share-schemas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The bodies the secret-share routes take (routes/vault/secret-shares.ts), checked with
 *   validateBody before the handler runs: types and bounds only. What a value MEANS (a known format,
 *   a recipient who has an account, a retention that fits its fields) is decided by the service
 *   (services/secret-shares/rules.ts), which answers with its own refusal codes.
 *
 *   The secret itself (`content`, `content_base64`, `envelope`) is any text: a key, an .env file with
 *   its newlines, base64. Its size is measured by the service against security.secret_share_max_bytes,
 *   so the bound here is only the 25 MB ceiling in base64.
 * @structure SecretShareCreateBody · SecretShareDepositBody · SecretShareDepositTokenBody ·
 *   SecretSharePickupBody · SecretSharePickupCodeBody · SecretShareRevokeBody · VaultDeviceKeyBody
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { z } from 'zod';
import { INPUT_LIMITS, safeText } from './input-limits.js';

/** 25 MB as base64, with room for the JSON around it. */
const SECRET_TEXT_MAX = 36 * 1024 * 1024;
const word = () => z.string().max(INPUT_LIMITS.id).nullable().optional();
const flag = () => z.boolean().nullable().optional();
const count = () => z.number().int().nullable().optional();
const people = () => z.array(z.string().max(INPUT_LIMITS.email)).max(50).nullable().optional();

/** The content of a share or a deposit, as the browser or the tool sends it. */
const contentFields = {
  format: word(),
  content: z.string().max(SECRET_TEXT_MAX).nullable().optional(),
  content_base64: z.string().max(SECRET_TEXT_MAX).nullable().optional(),
  file_name: safeText(INPUT_LIMITS.name).nullable().optional(),
  content_type: word(),
  service: word(),
  // An end-to-end share: the envelope and keys the browser made (public/js/vault-crypto.js).
  envelope: z.string().max(SECRET_TEXT_MAX).nullable().optional(),
  e2e_keys: z.array(z.looseObject({
    ghii: z.string().max(INPUT_LIMITS.email),
    key_id: z.string().max(INPUT_LIMITS.id),
    wrapped: z.string().max(4096),
  })).max(200).nullable().optional(),
  code_salt: word(),
  size_bytes: count(),
};

/** POST /v1/secret-shares: a share with content, or a request (kind request). */
export const SecretShareCreateBody = z.looseObject({
  kind: word(),
  name: safeText(INPUT_LIMITS.name),
  note: safeText(2000).nullable().optional(),
  ...contentFields,
  recipients: z.looseObject({
    people: people(),
    agents: flag(),
    organism: flag(),
    code: flag(),
    code_login: flag(),
  }).nullable().optional(),
  organism: word(),
  protection: word(),
  retention: word(),
  max_pickups: count(),
  expires_at: z.string().max(64).nullable().optional(),
  depositors: people(),
  request_days: count(),
  code_verifier: word(),
});

/** POST /v1/secret-shares/:id/deposit (a named depositor, signed in). */
export const SecretShareDepositBody = z.looseObject({ ...contentFields });

/** POST /v1/secret-shares/:id/deposit-with-token (the link's token, no account). */
// The token is optional HERE: a missing or wrong one is the credential strategy's single 404, so the
// door does not tell a guesser which half of the request was wrong.
export const SecretShareDepositTokenBody = z.looseObject({ token: z.string().max(INPUT_LIMITS.id).nullable().optional(), ...contentFields });

/** POST /v1/secret-shares/:id/pickup (signed in). */
export const SecretSharePickupBody = z.looseObject({
  to: word(),
  name: word(),
  host: z.string().max(253).nullable().optional(),
  code: word(),
  code_verifier: word(),
}).nullish();

/** POST /v1/secret-shares/:id/pickup-with-code. */
export const SecretSharePickupCodeBody = z.looseObject({
  to: word(),
  name: word(),
  host: z.string().max(253).nullable().optional(),
  code: word(),
  code_verifier: word(),
});

/** POST /v1/secret-shares/:id/revoke: no fields; an empty or absent body. */
export const SecretShareRevokeBody = z.looseObject({}).nullish();

/** POST /v1/vault/device-keys: a browser's P-256 public key as a JWK. */
export const VaultDeviceKeyBody = z.looseObject({
  public_key: z.looseObject({
    kty: z.string().max(8),
    crv: z.string().max(16),
    x: z.string().max(64),
    y: z.string().max(64),
  }),
  label: safeText(INPUT_LIMITS.name).nullable().optional(),
});
