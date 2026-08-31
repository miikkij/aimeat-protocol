/**
 * @file src/models/agent-card.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agent v2 CARD: what an agent says it is, in a document anyone can check.
 *
 *   This replaces the fifteen-tool prompt sequence with something a machine can decide. Hello
 *   Integration succeeds today when a model behaves and fails in a way no machine can repair, because
 *   the claims arrive as tool calls in a conversation. A card is one object, validated against this
 *   schema, and the answer is either "accepted" or an exact list of what is missing — which is what
 *   `validateAgentCard` returns and what the enrolment route hands back on a refusal.
 *
 *   The card is SIGNED by the agent's own key and served as a compact JWS beside a JWKS, so a second
 *   node can verify it without asking us whether to believe it. The signing and verification live in
 *   services/agent-card.ts; this file is the shape and the rules, with no crypto and no I/O, so the
 *   same validation runs on the node, in a test, and in the connector.
 *
 *   WHAT IS NOT DECIDED HERE. A card is a CLAIM. `gaii`, `owner` and `scopes` in a card are what the
 *   submitter says, and the enrolment route resolves every one of them against the node's own
 *   records before anything is written — a card that names a different owner is refused, not
 *   believed. Validation here answers "is this a well-formed card", never "may this agent do that".
 *
 * @structure
 *   - AGENT_CARD_SPEC / AgentCard / AgentCardKey — the document
 *   - CardDefect / validateAgentCard — the machine-readable refusal
 *   - RUN_MODES / isRunMode
 * @usage
 *   import { validateAgentCard } from '../models/agent-card.js';
 *   const { ok, defects } = validateAgentCard(parsedPayload);
 * @version-history
 *   v1.0.0 — 2026-08-31 — Initial (Agent v2, V1).
 */

/** The one value `spec` may hold. A card that does not say this is not a card. */
export const AGENT_CARD_SPEC = 'aimeat.agent-card/v1';

/** The run modes an agent may declare. The node stores and shows these; it never enforces them. */
export const RUN_MODES = ['spawn', 'resident'] as const;
export type RunMode = (typeof RUN_MODES)[number];

export function isRunMode(v: unknown): v is RunMode {
  return typeof v === 'string' && (RUN_MODES as readonly string[]).includes(v);
}

/**
 * The agent's verification key, as a JWK. Ed25519 only: it is what the node signs with, what
 * federation verifies with, and what the ecosystem-app path already pins, and a second algorithm
 * here would be a second verification path to keep correct for no gain anyone has asked for.
 */
export interface AgentCardKey {
  kty: 'OKP';
  crv: 'Ed25519';
  /** The raw public key, base64url, per RFC 8037. */
  x: string;
  /** RFC 7638 thumbprint of the key. The JWS header names it, the JWKS entry carries it. */
  kid: string;
}

export interface AgentCard {
  spec: typeof AGENT_CARD_SPEC;
  /** The agent's claimed GAII. A CLAIM — the enrolment route recomputes it and compares. */
  gaii: string;
  /** Bare agent name. */
  name: string;
  /** Bare owner name. */
  owner: string;
  /** The node this card is for. */
  node: string;
  displayName?: string;
  description?: string;
  /** What runs this agent: the framework or host, and its version when it knows one. */
  runtime: { platform: string; version?: string };
  /** How the agent is meant to be run. Stored and shown by the node, honoured by the runtime. */
  runMode: RunMode;
  /** What the agent says it can do, in its own words. Free-form, for a human and for discovery. */
  skills: string[];
  /** What it can take and give back: 'text', 'image', 'audio', … Free-form for the same reason. */
  modalities: string[];
  /** What the agent is ASKING to be allowed to do. Never granted from here — see the file note. */
  requestedScopes: string[];
  publicKey: AgentCardKey;
  /** Where the key is published, so a verifier can fetch it without this card. */
  jwksUri: string;
  /** Where this card is served. */
  cardUri: string;
  /** Optional push address, in the A2A PushNotificationConfig sense. Stored, not called, in V1. */
  webhookUrl?: string;
  issuedAt: string;
}

/**
 * One thing wrong with a card, named so a machine can act on it. `field` is a dotted path into the
 * card, `reason` is why, and both are returned verbatim to the submitter — the whole point of the
 * card over a prompt sequence is that a refusal is a list a program can read and fix.
 */
export interface CardDefect {
  field: string;
  reason: string;
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.every(e => typeof e === 'string') ? (v as string[]) : null;
}

/**
 * Is this a well-formed agent card? Returns EVERY defect, not the first: a submitter fixing one
 * field at a time across a round trip each is the failure mode the prompt sequence already has, and
 * repeating it in a machine format would be the same cost with better manners.
 */
export function validateAgentCard(value: unknown): { ok: boolean; defects: CardDefect[]; card?: AgentCard } {
  const defects: CardDefect[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, defects: [{ field: '', reason: 'The card must be a JSON object.' }] };
  }
  const c = value as Record<string, unknown>;

  if (c.spec !== AGENT_CARD_SPEC) {
    defects.push({ field: 'spec', reason: `Must be the exact string "${AGENT_CARD_SPEC}".` });
  }
  for (const field of ['gaii', 'name', 'owner', 'node', 'cardUri', 'jwksUri', 'issuedAt'] as const) {
    if (!str(c[field])) defects.push({ field, reason: 'Required, and must be a non-empty string.' });
  }
  if (str(c.name) && !NAME_RE.test(c.name as string)) {
    defects.push({ field: 'name', reason: '3-64 lowercase alphanumeric characters and hyphens, not starting or ending with a hyphen.' });
  }
  if (str(c.owner) && !NAME_RE.test(c.owner as string)) {
    defects.push({ field: 'owner', reason: '3-64 lowercase alphanumeric characters and hyphens, not starting or ending with a hyphen.' });
  }
  if (str(c.issuedAt) && Number.isNaN(Date.parse(c.issuedAt as string))) {
    defects.push({ field: 'issuedAt', reason: 'Must be an ISO 8601 timestamp.' });
  }

  const runtime = c.runtime as Record<string, unknown> | undefined;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime) || !str(runtime.platform)) {
    defects.push({ field: 'runtime.platform', reason: 'Required: what runs this agent, e.g. "crewaimeat" or "claude-code".' });
  } else if (runtime.version !== undefined && !str(runtime.version)) {
    defects.push({ field: 'runtime.version', reason: 'If present, must be a non-empty string.' });
  }

  if (!isRunMode(c.runMode)) {
    defects.push({ field: 'runMode', reason: `Required, one of: ${RUN_MODES.join(', ')}.` });
  }
  for (const field of ['skills', 'modalities', 'requestedScopes'] as const) {
    if (!stringArray(c[field])) defects.push({ field, reason: 'Required: an array of strings (it may be empty).' });
  }

  const key = c.publicKey as Record<string, unknown> | undefined;
  if (!key || typeof key !== 'object' || Array.isArray(key)) {
    defects.push({ field: 'publicKey', reason: 'Required: the agent\'s Ed25519 verification key as a JWK.' });
  } else {
    if (key.kty !== 'OKP') defects.push({ field: 'publicKey.kty', reason: 'Must be "OKP".' });
    if (key.crv !== 'Ed25519') defects.push({ field: 'publicKey.crv', reason: 'Must be "Ed25519".' });
    const x = str(key.x);
    if (!x) defects.push({ field: 'publicKey.x', reason: 'Required: the raw public key, base64url (RFC 8037).' });
    else if (!BASE64URL_RE.test(x) || Buffer.from(x, 'base64url').length !== 32) {
      defects.push({ field: 'publicKey.x', reason: 'Must be 32 bytes of base64url with no padding.' });
    }
    if (!str(key.kid)) defects.push({ field: 'publicKey.kid', reason: 'Required: the RFC 7638 thumbprint of this key.' });
  }

  if (c.webhookUrl !== undefined) {
    const u = str(c.webhookUrl);
    // Checked where it is written, like consoleUrl: this value is rendered to the owner and may be
    // fetched later, and `javascript:` is a URL that parses.
    if (!u || !/^https?:\/\//i.test(u)) {
      defects.push({ field: 'webhookUrl', reason: 'If present, must be an http(s) URL.' });
    }
  }

  return defects.length === 0
    ? { ok: true, defects: [], card: value as unknown as AgentCard }
    : { ok: false, defects };
}
