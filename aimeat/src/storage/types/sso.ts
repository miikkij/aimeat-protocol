/**
 * @file src/storage/types/sso.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description SSO connection records (BR-04): one organisation's identity provider, connected to
 *   this node. A connection carries the SAML side (how its people sign in) and the SCIM side (how
 *   its directory pushes them in and out). This is a table rather than a memory record because it
 *   holds server-trusted secrets (the SCIM token hash, the IdP's signing certificates) that no
 *   principal-writable namespace may carry, and it is read on unauthenticated hot paths.
 * @structure SsoConnectionSaml, SsoConnectionRecord, SSO_CONNECTION_ID_PATTERN.
 * @usage import type { SsoConnectionRecord } from '../interface.js';
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 1).
 */

/**
 * Connection ids are slugs because they are URL segments (ACS path, SCIM base path) AND lookup
 * keys inside the externalIdentities JSON map — where SQLite's `json_extract('$.' || ?)` reads a
 * dot or a bracket as a path expression and silently returns null. The pattern refuses both.
 */
export const SSO_CONNECTION_ID_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

/** The SAML half: everything needed to send an AuthnRequest and validate a Response. */
export interface SsoConnectionSaml {
  /** The IdP's entityID from its metadata. */
  idpEntityId: string;
  /** The IdP's SSO endpoint (HTTP-Redirect binding). */
  ssoUrl: string;
  /** PEM/base64 signing certificates. More than one during the IdP's certificate rollover. */
  idpCerts: string[];
  /** Requested NameID format; omitted = the IdP's default. */
  nameIdFormat?: string;
  /** Assertion-attribute names for email and display name when the IdP's differ from defaults. */
  attributeMap?: { email?: string; displayName?: string };
}

export interface SsoConnectionRecord {
  /** Slug (SSO_CONNECTION_ID_PATTERN): URL segment and externalIdentities key. Immutable. */
  id: string;
  /** Human name of the organisation — the login button label when listed. */
  name: string;
  /**
   * Organism this connection's people are added to on first sign-in or SCIM creation. The whole
   * effect of the binding: no roles, no workspaces, no group sync in v1.
   */
  organismId?: string | null;
  /**
   * Email domains this organisation vouches for, lowercased. An existing account may be ADOPTED
   * (linked, managed) only when its locally verified email is in one of these — the anti-takeover
   * rule with an organisation-sized exception the operator explicitly configured.
   */
  domains: string[];
  saml?: SsoConnectionSaml | null;
  /**
   * Accept a SAML Response with no InResponseTo (the IdP's own "My Apps" tile). Off by default:
   * unsolicited responses are the classic replay surface, and SP-initiated login needs nothing.
   */
  allowIdpInitiated: boolean;
  /**
   * Show this connection as a button in the public sign-in modal. On a shared node, listing every
   * connection would publish the customer list — those connections stay hidden and share a direct
   * login link instead.
   */
  loginVisibility: 'listed' | 'hidden';
  /** SHA-256 hex of the SCIM bearer token. Null until the operator generates one. Never the raw token. */
  scimTokenHash?: string | null;
  scimTokenCreatedAt?: string | null;
  /** Playbook evidence: when the directory last called our SCIM endpoint (throttled writes). */
  lastScimRequestAt?: string | null;
  /** Playbook evidence: when someone last signed in through this connection (throttled writes). */
  lastLoginAt?: string | null;
  /** Operator who created the connection. Audit, not authorization. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
