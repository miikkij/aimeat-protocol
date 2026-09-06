/**
 * @file src/storage/types/secrets.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's secrets vault: named credentials an account holds so that the things
 *   acting in its name can USE them without ever HOLDING them. A row is write-only from the
 *   outside — the value goes in and never comes back out of any API — and the only reader is the
 *   node itself, resolving `{{secret:NAME}}` in an outbound header inside `ctx.fetch`.
 *
 *   WHY A TABLE AND NOT A MEMORY RECORD. Memory is the person's refined knowledge, and everything
 *   in it is readable by whoever holds the right to read that namespace: `memory:read` on an agent,
 *   an app grant, a key-space share, an export. A credential must be readable by NOBODY, including
 *   its owner, and a namespace whose whole contract is "the owner can read this back" cannot
 *   express that. The extension config already stored secrets this way (services/extension-secrets.ts)
 *   and proved the shape; what it could not express is a secret belonging to the PERSON rather than
 *   to one installed extension, which is what makes the same vault work across every extension,
 *   every instance, and whatever comes next.
 *
 *   NO PLAINTEXT COLUMN EXISTS. `ciphertext` holds `iv:authTag:ct` from services/encryption.ts,
 *   AES-256-GCM under the node key. A node with no key configured refuses the write rather than
 *   storing the value in the clear, which is the same rule encryptSecretFields already followed.
 *
 *   usedBy IS THE ANSWER TO "WHAT WOULD BREAK IF I DELETED THIS". Nothing else on the node can say
 *   it: a secret is named in a header written into a living document, in an extension's config, in
 *   a workflow — none of which the vault can see. So the vault records the fact of use as it
 *   happens: one entry per extension name, stamped with the last time that extension resolved this
 *   name. The list route projects the last 30 days of it and nothing else.
 *
 * @structure SecretRecord · SecretUseStamps · SecretRepository
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial. The owner's secrets vault.
 */

/** `{ "<extension name>": "<ISO timestamp of its last resolution>" }`. */
export type SecretUseStamps = Record<string, string>;

export interface SecretRecord {
  /**
   * The OWNER's GHII, always — never an agent GAII and never a bare name. An agent that sets a
   * secret sets its owner's, because the credential is the human's and the agent merely acts in
   * their name. Callers resolve this with `ownerGhiiOf(resolveIdentity(...))`.
   */
  ownerGaii: string;
  /** `[A-Za-z0-9_-]{1,64}`, as the owner typed it. Case-sensitive: it is an address, not a label. */
  name: string;
  /** `iv:authTag:ciphertext` (hex, colon-separated), AES-256-GCM under the node key. */
  ciphertext: string;
  /** When this name was first set on this account. Preserved across replacement. */
  setAt: string;
  /** When the value behind it last changed. Equal to setAt until the first replacement. */
  updatedAt: string;
  /** Which extensions have resolved this name, and when each last did. */
  usedBy: SecretUseStamps;
}

export interface SecretRepository {
  /** Every secret this owner holds, newest use first is NOT implied — ordering is by name. */
  listSecrets(ownerGaii: string): Promise<SecretRecord[]>;
  /** One, by owner and name. The only read that yields a ciphertext, and only the node calls it. */
  getSecret(ownerGaii: string, name: string): Promise<SecretRecord | null>;
  /**
   * Insert or replace. `setAt` on the record is used only when the name is new; an existing row
   * keeps the `setAt` it had, so "since when do I hold this" survives a rotation.
   */
  setSecret(record: SecretRecord): Promise<SecretRecord>;
  /** Remove one. False when this owner has no secret of that name. */
  deleteSecret(ownerGaii: string, name: string): Promise<boolean>;
  /**
   * Stamp `usedBy[extName]` with `at` on one secret, touching nothing else — not `updatedAt`,
   * which means "the value changed" and must stay that. A row that is gone is not an error: the
   * owner may have deleted it between the resolution and this write.
   */
  noteSecretUse(ownerGaii: string, name: string, extName: string, at: string): Promise<void>;
  /** Every secret this owner holds, gone. Called by the owner-deletion cascade. */
  deleteSecretsByOwner(ownerGaii: string): Promise<number>;
}
