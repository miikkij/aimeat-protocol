/**
 * @file src/models/agent-v2-message.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The Agent v2 message and push-config SHAPES, and the rules for both. No crypto, no
 *   I/O, no storage: the same validation runs on the node, in a test and in the connector.
 *
 *   A REFUSAL LISTS EVERY DEFECT, not the first one. The caller is usually a model composing a turn
 *   it has never composed before, and "parts[1].file.uri is required" ends the round; "here are the
 *   four things wrong" ends the task. Same discipline as validateAgentCard, and for the same reason.
 *
 *   THE LIMITS ARE HERE AND NOT IN THE ROUTE. A part list with no ceiling is a memory record with no
 *   ceiling, and this table is written by agents on a loop. The numbers are deliberately small
 *   enough to argue with: a turn is a turn, and a payload that does not fit belongs in storage with
 *   a file part pointing at it.
 *
 * @structure MESSAGE_SPEC · MESSAGE_ROLES · limits · MessageDefect · validateMessageInput ·
 *   validatePushConfigInput · publicPushConfig
 * @usage const { ok, defects, parts } = validateMessageInput(req.body);
 * @version-history
 *   v1.0.0 — 2026-09-01 — Initial (Agent v2, V4).
 */
import type { MessagePart, AgentV2PushConfigRecord } from '../storage/interface.js';

/** What a stored turn says it is, for a reader that meets one on its own. */
export const MESSAGE_SPEC = 'aimeat.message/v1';

/** Who is speaking. Not a principal type — see the record's own documentation. */
export const MESSAGE_ROLES = ['user', 'agent'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

/** A turn is a turn. Anything larger belongs in storage behind a file part. */
export const MESSAGE_LIMITS = {
  /** Parts in one turn. */
  maxParts: 32,
  /** Characters in one text part. */
  maxTextChars: 64_000,
  /** Serialized bytes of one data part. */
  maxDataBytes: 64_000,
  /** Characters in a contextId or taskId a caller chooses. */
  maxIdChars: 128,
} as const;

export interface MessageDefect {
  field: string;
  reason: string;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/** http(s) only. The SSRF question is answered later by safeFetch; this is the shape question. */
function isHttpUrl(v: unknown): boolean {
  if (typeof v !== 'string') return false;
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: not a URL
  } catch { return false; }
}

function validatePart(p: unknown, i: number, defects: MessageDefect[], field = 'parts'): MessagePart | null {
  const at = `${field}[${i}]`;
  if (!p || typeof p !== 'object' || Array.isArray(p)) {
    defects.push({ field: at, reason: 'Each part must be an object.' });
    return null;
  }
  const o = p as Record<string, unknown>;
  const metadata = (o.metadata && typeof o.metadata === 'object' && !Array.isArray(o.metadata))
    ? o.metadata as Record<string, unknown> : undefined;

  if (o.kind === 'text') {
    const text = typeof o.text === 'string' ? o.text : null;
    if (text === null) { defects.push({ field: `${at}.text`, reason: 'Required, and must be a string.' }); return null; }
    if (text.length > MESSAGE_LIMITS.maxTextChars) {
      defects.push({ field: `${at}.text`, reason: `At most ${MESSAGE_LIMITS.maxTextChars} characters. Put a longer body in storage and send a file part.` });
      return null;
    }
    return metadata ? { kind: 'text', text, metadata } : { kind: 'text', text };
  }

  if (o.kind === 'file') {
    const f = (o.file && typeof o.file === 'object' && !Array.isArray(o.file)) ? o.file as Record<string, unknown> : null;
    if (!f) { defects.push({ field: `${at}.file`, reason: 'Required, and must be an object.' }); return null; }
    if (!isHttpUrl(f.uri)) {
      defects.push({ field: `${at}.file.uri`, reason: 'Required: an http or https address for the file. A part carries a pointer, never bytes.' });
      return null;
    }
    const file: { name?: string; mimeType?: string; uri: string } = { uri: f.uri as string };
    if (str(f.name)) file.name = f.name as string;
    if (str(f.mimeType)) file.mimeType = f.mimeType as string;
    return metadata ? { kind: 'file', file, metadata } : { kind: 'file', file };
  }

  if (o.kind === 'data') {
    if (!o.data || typeof o.data !== 'object' || Array.isArray(o.data)) {
      defects.push({ field: `${at}.data`, reason: 'Required, and must be a JSON object.' });
      return null;
    }
    const size = JSON.stringify(o.data).length;
    if (size > MESSAGE_LIMITS.maxDataBytes) {
      defects.push({ field: `${at}.data`, reason: `At most ${MESSAGE_LIMITS.maxDataBytes} bytes serialized; this one is ${size}.` });
      return null;
    }
    const data = o.data as Record<string, unknown>;
    return metadata ? { kind: 'data', data, metadata } : { kind: 'data', data };
  }

  defects.push({ field: `${at}.kind`, reason: 'Must be "text", "file" or "data".' });
  return null;
}

/**
 * An array of parts, under whatever name the caller's field has. Exported because a TASK carries
 * the same shape for its input and its result: one definition of what a payload looks like, so a
 * task and the conversation around it cannot disagree about it.
 *
 * Appends to `defects` and returns whatever parsed; the caller decides whether an empty result with
 * defects recorded is a refusal.
 */
export function validatePartsArray(value: unknown, field: string, defects: MessageDefect[]): MessagePart[] {
  const parts: MessagePart[] = [];
  if (!Array.isArray(value) || value.length === 0) {
    defects.push({ field, reason: 'Required: a non-empty array of parts.' });
    return parts;
  }
  if (value.length > MESSAGE_LIMITS.maxParts) {
    defects.push({ field, reason: `At most ${MESSAGE_LIMITS.maxParts} parts.` });
    return parts;
  }
  value.forEach((p, i) => {
    const part = validatePart(p, i, defects, field);
    if (part) parts.push(part);
  });
  return parts;
}

export interface ValidatedMessageInput {
  role: MessageRole;
  parts: MessagePart[];
  to: string;
  contextId: string | null;
  taskId: string | null;
  metadata: Record<string, unknown> | null;
}

/**
 * The body of a send. `to` is validated as a shape here and resolved to a real principal by the
 * route — a well-formed identity that belongs to somebody else is a 403, not a 400, and this file
 * has no way to tell the difference.
 */
export function validateMessageInput(value: unknown): { ok: boolean; defects: MessageDefect[]; message?: ValidatedMessageInput } {
  const defects: MessageDefect[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, defects: [{ field: '', reason: 'The body must be a JSON object.' }] };
  }
  const b = value as Record<string, unknown>;

  const role = b.role === undefined ? 'user' : b.role;
  if (!(MESSAGE_ROLES as readonly unknown[]).includes(role)) {
    defects.push({ field: 'role', reason: 'Must be "user" or "agent". Omitted means "user".' });
  }

  const to = str(b.to);
  if (!to) defects.push({ field: 'to', reason: 'Required: the principal this turn is addressed to.' });

  const parts = validatePartsArray(b.parts, 'parts', defects);

  for (const field of ['contextId', 'taskId'] as const) {
    const v = b[field];
    if (v === undefined || v === null) continue;
    if (!str(v)) { defects.push({ field, reason: 'Must be a non-empty string when given.' }); continue; }
    if ((v as string).length > MESSAGE_LIMITS.maxIdChars) {
      defects.push({ field, reason: `At most ${MESSAGE_LIMITS.maxIdChars} characters.` });
    }
  }

  if (b.metadata !== undefined && b.metadata !== null
    && (typeof b.metadata !== 'object' || Array.isArray(b.metadata))) {
    defects.push({ field: 'metadata', reason: 'Must be a JSON object when given.' });
  }

  if (defects.length > 0) return { ok: false, defects };
  return {
    ok: true,
    defects: [],
    message: {
      role: role as MessageRole,
      parts,
      to: to as string,
      contextId: str(b.contextId),
      taskId: str(b.taskId),
      metadata: (b.metadata ?? null) as Record<string, unknown> | null,
    },
  };
}

export interface ValidatedPushConfigInput {
  id: string | null;
  url: string;
  token: string | null;
  schemes: string[];
  credentials: string | null;
}

/**
 * A2A's PushNotificationConfig as it arrives. The URL is checked for SHAPE here; whether it is a
 * URL this node may actually call is safeFetch's question, asked at delivery time and again on
 * every redirect hop.
 */
export function validatePushConfigInput(value: unknown): { ok: boolean; defects: MessageDefect[]; config?: ValidatedPushConfigInput } {
  const defects: MessageDefect[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, defects: [{ field: '', reason: 'The body must be a JSON object.' }] };
  }
  const b = value as Record<string, unknown>;

  if (!isHttpUrl(b.url)) defects.push({ field: 'url', reason: 'Required: an http or https address.' });
  if (b.id !== undefined && b.id !== null && !str(b.id)) {
    defects.push({ field: 'id', reason: 'Must be a non-empty string when given. Omit it to be assigned one.' });
  }
  if (b.token !== undefined && b.token !== null && !str(b.token)) {
    defects.push({ field: 'token', reason: 'Must be a non-empty string when given.' });
  }

  let schemes: string[] = [];
  let credentials: string | null = null;
  const auth = b.authentication;
  if (auth !== undefined && auth !== null) {
    if (typeof auth !== 'object' || Array.isArray(auth)) {
      defects.push({ field: 'authentication', reason: 'Must be an object with `schemes` and optionally `credentials`.' });
    } else {
      const a = auth as Record<string, unknown>;
      if (!Array.isArray(a.schemes) || a.schemes.length === 0 || !a.schemes.every(s => typeof s === 'string' && s.trim() !== '')) {
        defects.push({ field: 'authentication.schemes', reason: 'Required inside `authentication`: a non-empty array of scheme names, e.g. ["Bearer"].' });
      } else {
        schemes = a.schemes as string[];
      }
      if (a.credentials !== undefined && a.credentials !== null) {
        if (!str(a.credentials)) defects.push({ field: 'authentication.credentials', reason: 'Must be a non-empty string when given.' });
        else credentials = a.credentials as string;
      }
    }
  }

  if (defects.length > 0) return { ok: false, defects };
  return {
    ok: true,
    defects: [],
    config: { id: str(b.id), url: b.url as string, token: str(b.token), schemes, credentials },
  };
}

/**
 * What a read of a push config answers with. `credentials` is absent by construction rather than by
 * a caller remembering to strip it: this is the ONLY projection any route returns.
 */
export function publicPushConfig(c: AgentV2PushConfigRecord): {
  id: string; principal: string; url: string; token: string | null;
  authentication: { schemes: string[] } | null;
  created_at: string; updated_at: string;
  last_success_at: string | null; last_failure_at: string | null;
  fail_count: number; disabled_at: string | null;
} {
  return {
    id: c.id,
    principal: c.principal,
    url: c.url,
    token: c.token,
    authentication: c.authSchemes.length > 0 ? { schemes: c.authSchemes } : null,
    created_at: c.createdAt,
    updated_at: c.updatedAt,
    last_success_at: c.lastSuccessAt,
    last_failure_at: c.lastFailureAt,
    fail_count: c.failCount,
    disabled_at: c.disabledAt,
  };
}
