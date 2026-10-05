/**
 * @file src/services/federation-auth-payload.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The text a node signs when it asks a person's home node to check their password for a
 *   federated sign-in (POST /v1/federation/auth/verify), built in one place so the node that signs
 *   (routes/ghii/register-login.ts) and the node that verifies (routes/federation-auth.ts) cannot
 *   build it differently. The password is not in it: the signature proves which node asks, and the
 *   connection carries the password.
 * @structure federationAuthPayload(fields)
 * @usage const payload = federationAuthPayload({ username, requesting_node, timestamp });
 * @version-history
 *   v1.0.0 — 2026-10-05 — Initial: the verify request is signed (secaudit 2026-10, D1).
 */

/** The fields a requesting node signs, in a fixed order. */
export function federationAuthPayload(fields: { username: string; requesting_node: string; timestamp: string }): string {
  return JSON.stringify({ purpose: 'federation-auth-verify', username: fields.username, requesting_node: fields.requesting_node, timestamp: fields.timestamp });
}
