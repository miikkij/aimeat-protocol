/**
 * @file src/storage/types/passkeys.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A passkey: one WebAuthn credential registered on one device, for one account. The
 *   device holds the private key and never gives it up; this table holds the public half, the
 *   signature counter and enough about the device for a person to recognise it in a list and take
 *   it away.
 *
 *   WHY A TABLE AND NOT A MEMORY RECORD. Memory is the person's own knowledge, read through an
 *   authenticated path under their own namespace. This is read BEFORE anyone is signed in: the
 *   login door receives a credential id and has to find which account it belongs to, across every
 *   account on the node, with no session to scope the read. The discoverable flow has nothing but
 *   that id. The signature counter is also a security value the node writes and the person must
 *   not, which a namespace they own cannot express.
 *
 *   THE COUNTER. An authenticator that keeps one increments it on every use, and a value that did
 *   not move is the signal that a credential has been cloned. Many authenticators (Apple's among
 *   them) always report 0, which is not a failure and must not be treated as one: 0 means "this
 *   device does not count", and only a counter that HAS moved before and then stops is evidence.
 *
 * @structure PasskeyRecord · PasskeyRepository
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial. Passkeys as a sign-in method of their own.
 */

export interface PasskeyRecord {
  /** The credential id the authenticator chose, base64url. Unique across the node. */
  id: string;
  /** The account this key signs in. Always a GHII. */
  ghii: string;
  /** The bare owner name, so the login door can mint a session without a second read. */
  owner: string;
  /** The credential's public key, base64url COSE. */
  publicKey: string;
  /** Signature counter as last seen. 0 forever on an authenticator that does not count. */
  counter: number;
  /**
   * How the device can be reached: 'internal', 'usb', 'nfc', 'ble', 'hybrid'. Passed back to the
   * browser as a hint so it offers the right thing rather than every option at once.
   */
  transports: string[];
  /** What the person calls this device. Theirs to set; defaults to what the browser suggested. */
  label: string;
  /** The authenticator model, as it identifies itself. Empty when it did not say. */
  aaguid: string;
  /** Whether the key is synced to the person's cloud keychain rather than living on one device. */
  backedUp: boolean;
  createdAt: string;
  /** Null until it has signed something. */
  lastUsedAt: string | null;
}

export interface PasskeyRepository {
  createPasskey(record: PasskeyRecord): Promise<void>;
  /** By credential id, with no account in hand: this is the pre-authentication lookup. */
  getPasskey(id: string): Promise<PasskeyRecord | null>;
  /** Everything this account can sign in with, newest first. */
  listPasskeysByOwner(owner: string): Promise<PasskeyRecord[]>;
  /** After a successful assertion: the new counter and the moment it was used. */
  touchPasskey(id: string, counter: number, usedAt: string): Promise<void>;
  /** Rename one. Returns false when the id is not this owner's. */
  renamePasskey(id: string, owner: string, label: string): Promise<boolean>;
  /** Take a device away. Scoped to the owner, so an id alone is not enough. */
  deletePasskey(id: string, owner: string): Promise<boolean>;
}
