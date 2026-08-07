/**
 * @file src/utils/login-identifier.ts
 * @description Reads what a person typed into a sign-in field. Three shapes arrive there and they
 *   must not be confused: an email address, a full GHII (`alice@node-id`, local or federated), and a
 *   plain owner handle. The `@` alone cannot tell them apart, which is why this is one function
 *   rather than an inline test at each call site: an email routed as a GHII becomes a federated
 *   login to a node named "gmail.com".
 * @structure parseLoginIdentifier(raw, nodeId) → { kind, localName, federatedNodeId }.
 * @usage const id = parseLoginIdentifier(req.body.username, config.nodeId);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Extracted when POST /v1/ghii/login learned to accept a verified email.
 */

/** A dot-bearing domain marks an email. GHII node ids (`aimeat-fi-001-genesis`) never carry one. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LoginIdentifier =
    /** An email address — it SELECTS an account by its verified address; resolve it before lookup. */
    | { kind: 'email'; localName: string; federatedNodeId?: undefined }
    /** A GHII whose node part is another node — authentication belongs to that node. */
    | { kind: 'federated'; localName: string; federatedNodeId: string }
    /** A local handle, whether typed bare or as `alice@this-node-id`. */
    | { kind: 'local'; localName: string; federatedNodeId?: undefined };

/** Classify a typed sign-in identifier. Trims and lowercases; never touches storage. */
export function parseLoginIdentifier(raw: string, nodeId: string): LoginIdentifier {
    const value = (raw || '').trim().toLowerCase();
    if (EMAIL_RE.test(value)) return { kind: 'email', localName: value };
    const at = value.indexOf('@');
    if (at === -1) return { kind: 'local', localName: value };
    const nodePart = value.substring(at + 1);
    const name = value.substring(0, at);
    if (nodePart && nodePart !== nodeId) return { kind: 'federated', localName: name, federatedNodeId: nodePart };
    return { kind: 'local', localName: name };
}
