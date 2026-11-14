/**
 * @file src/services/secret-shares/rules.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The rules of a secret share as values and pure functions: what a name, a format, a
 *   recipient list, a retention and a protection may be, how a body is normalized into them, and the
 *   pickup code and deposit token (made, and compared as an HMAC under the node key). No storage, no
 *   request: services/secret-shares/service.ts calls these before it writes anything, so every route
 *   and tool refuses with the same words.
 *
 *   THE MAKER DECIDES (Jouni, 2026-11-14). Whoever makes the share, or the request, sets recipients,
 *   retention and protection. A depositor filling a request sets none of them: normalizeTerms runs
 *   for the maker only.
 * @structure SHARE_ID_RE · NAME_RE · FORMATS · PROTECTIONS · RETENTIONS · DEFAULT_SHARE_MAX_BYTES ·
 *   SHARE_MAX_BYTES_CEILING · REQUEST_DAYS_DEFAULT · REQUEST_DAYS_MAX · newShareId · newEventId ·
 *   newPickupCode · newDepositToken · secretHmac · hmacEquals · hmacMatches · normalizeTerms · normalizeContent ·
 *   ShareRefusal · refuse
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { otherRingKeys } from '../owner-secrets.js';
import type {
  SecretShareFormat, SecretShareProtection, SecretShareRecipients, SecretShareRetention,
} from '../../storage/types/secret-shares.js';

export const SHARE_ID_RE = /^shr_[a-z2-7]{20}$/;
/** A name a person recognises and may type: letters, digits, space, underscore, hyphen, dot. */
export const NAME_RE = /^[\p{L}\p{N} _.-]{1,128}$/u;
export const NOTE_MAX = 2000;
export const FORMATS: readonly SecretShareFormat[] = ['text', 'pairs', 'file'];
export const PROTECTIONS: readonly SecretShareProtection[] = ['open', 'sealed', 'e2e'];
export const RETENTIONS: readonly SecretShareRetention[] = ['once', 'count', 'until', 'keep'];
/** 1 MB: a key, a password, a configuration, a certificate or a service-account file. */
export const DEFAULT_SHARE_MAX_BYTES = 1024 * 1024;
/** The highest an operator may set: a share row holds its content, and it is read in one piece. */
export const SHARE_MAX_BYTES_CEILING = 25 * 1024 * 1024;
export const MAX_PEOPLE = 50;
export const MAX_PICKUPS = 1000;
/** A request with no time of its own may be filled for 14 days, and for at most 90. */
export const REQUEST_DAYS_DEFAULT = 14;
export const REQUEST_DAYS_MAX = 90;
/** A share with an end date ends within 365 days. */
export const UNTIL_DAYS_MAX = 365;
/** At most this many end-to-end wrapped keys on one share (recipient devices). */
export const MAX_E2E_KEYS = 200;

/** What every secret-share function takes. */
export interface ShareDeps { storage: Storage; config: AimeatConfig }
/** A refusal with its HTTP status, code and the words a person reads. Never contains content. */
export interface ShareRefusal { ok: false; status: number; code: string; message: string }
export type ShareResult<T> = { ok: true; data: T } | ShareRefusal;
export const refuse = (status: number, code: string, message: string): ShareRefusal => ({ ok: false, status, code, message });

const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
function base32(bytes: Buffer, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) out += BASE32[bytes[i] % 32];
  return out;
}

export function newShareId(): string { return `shr_${base32(randomBytes(20), 20)}`; }
export function newEventId(): string { return `sev_${base32(randomBytes(20), 20)}`; }

/**
 * Three words and four digits, e.g. KARHU-7215-SUMU-VALO: said over the phone without spelling.
 * About 46 bits with this word list. The pickup route counts failures per share and per address
 * (service.ts), which is what keeps guessing from paying off.
 */
const CODE_WORDS = [
  'KARHU', 'SUMU', 'VALO', 'KIVI', 'TUULI', 'LUMI', 'META', 'PILVI', 'RANTA', 'SAARI', 'TAIVAS', 'KUU',
  'TAHTI', 'METSA', 'JOKI', 'SILTA', 'LAIVA', 'OMENA', 'KETTU', 'HAUKI', 'KORPI', 'NIITTY', 'PURO', 'VUORI',
  'AALTO', 'KALLIO', 'SATAMA', 'TORNI', 'PORTTI', 'KIRJA', 'SAVU', 'TULI', 'JAA', 'HELMI', 'KULTA', 'HOPEA',
  'RAUTA', 'NUOLI', 'KAARNA', 'KANTO', 'LAAKSO', 'SADE', 'ROUTA', 'KESA', 'SYKSY', 'TALVI', 'KEVAT', 'AAMU',
  'ILTA', 'YO', 'PAIVA', 'HAVU', 'KOIVU', 'MANTY', 'KUUSI', 'TAMMI', 'VAHTERA', 'PAJU', 'LEPPA', 'HAAPA',
  'LOHI', 'SIIKA', 'AHVEN', 'KUHA',
];
export function newPickupCode(): string {
  const w = () => CODE_WORDS[randomInt(CODE_WORDS.length)];
  return `${w()}-${String(randomInt(10000)).padStart(4, '0')}-${w()}-${w()}`;
}
/** A request's deposit token: 32 random bytes, base64url. It is in the deposit link and nowhere else. */
export function newDepositToken(): string { return randomBytes(32).toString('base64url'); }

/** A code is compared without case or surrounding space, and with any run of spaces read as a hyphen. */
export function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s_]+/g, '-');
}

/** HMAC-SHA256 of a code or token under the node key, bound to its purpose and share. */
export function secretHmac(key: Buffer, purpose: 'code' | 'deposit', shareId: string, value: string): string {
  return createHmac('sha256', key).update(`secret-share:${purpose}:${shareId}:${value}`).digest('hex');
}
export function hmacEquals(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex'); const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Does `value` match a stored HMAC made under the current data key or another key of its ring? A
 * code or token made before a key rotation keeps working until the old key is removed
 * (docs/operations/key-rotation.md); a new one is always made under the current key.
 */
export function hmacMatches(key: Buffer, purpose: 'code' | 'deposit', shareId: string, value: string, stored: string): boolean {
  return [key, ...otherRingKeys(key)].some(k => hmacEquals(secretHmac(k, purpose, shareId, value), stored));
}

const asBool = (v: unknown): boolean => v === true || v === 'true';
const DAY = 24 * 60 * 60 * 1000;

/** The terms the maker sets, normalized. People are returned as given; the service resolves them. */
export interface ShareTerms {
  name: string;
  note: string;
  protection: SecretShareProtection;
  recipients: Omit<SecretShareRecipients, 'people'> & { people: string[] };
  codeLogin: boolean;
  retention: SecretShareRetention;
  maxPickups: number | null;
  expiresAt: string | null;
  organismId: string | null;
}

/**
 * The maker's terms from a body (REST and MCP send the same field names). Refuses before anything is
 * written. `now` is injected so a test can fix it.
 */
export function normalizeTerms(body: Record<string, unknown>, now = Date.now()): { ok: true; terms: ShareTerms } | ShareRefusal {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!NAME_RE.test(name)) {
    return refuse(400, 'INVALID_NAME', 'name is what the secret is called, 1 to 128 letters, digits, spaces, dots, underscores or hyphens, for example ELEVENLABS_API_KEY.');
  }
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (note.length > NOTE_MAX) return refuse(400, 'INVALID_NOTE', `note is at most ${NOTE_MAX} characters.`);

  const protection = (body.protection ?? 'sealed') as SecretShareProtection;
  if (!PROTECTIONS.includes(protection)) {
    return refuse(400, 'INVALID_PROTECTION', 'protection is open (an agent may receive the content), sealed (an agent never receives it; a person does) or e2e (only the recipient\'s own device opens it).');
  }

  const r = (body.recipients && typeof body.recipients === 'object' ? body.recipients : {}) as Record<string, unknown>;
  const people = Array.isArray(r.people) ? r.people.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(p => p.trim()) : [];
  if (people.length > MAX_PEOPLE) return refuse(400, 'TOO_MANY_PEOPLE', `A share names at most ${MAX_PEOPLE} people. Use the organism's members instead.`);
  const recipients = { people: [...new Set(people)], agents: asBool(r.agents), organism: asBool(r.organism), code: asBool(r.code) };
  const organismId = typeof body.organism === 'string' && body.organism.trim() ? body.organism.trim() : null;
  if (recipients.organism && !organismId) {
    return refuse(400, 'ORGANISM_REQUIRED', 'recipients.organism lets the members of an organism pick it up, so the share names that organism in `organism`.');
  }
  if (protection === 'e2e' && (recipients.organism || recipients.agents)) {
    return refuse(400, 'E2E_NAMED_ONLY', 'An end-to-end share opens only on a recipient\'s own registered device, so it names people or a code. An organism\'s members and agents cannot be recipients of one.');
  }
  const codeLogin = asBool(r.code_login);

  const retention = (body.retention ?? 'once') as SecretShareRetention;
  if (!RETENTIONS.includes(retention)) {
    return refuse(400, 'INVALID_RETENTION', 'retention is once (ends at the first pickup), count (ends at max_pickups), until (ends at expires_at) or keep (until it is revoked).');
  }
  let maxPickups: number | null = null;
  let expiresAt: string | null = null;
  if (retention === 'once') maxPickups = 1;
  if (retention === 'count') {
    const m = Number(body.max_pickups);
    if (!Number.isInteger(m) || m < 1 || m > MAX_PICKUPS) return refuse(400, 'INVALID_MAX_PICKUPS', `max_pickups is a whole number from 1 to ${MAX_PICKUPS}.`);
    maxPickups = m;
  }
  if (retention === 'until') {
    const t = typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : NaN;
    if (!Number.isFinite(t) || t <= now || t > now + UNTIL_DAYS_MAX * DAY) {
      return refuse(400, 'INVALID_EXPIRES_AT', `expires_at is a date and time in the future, at most ${UNTIL_DAYS_MAX} days away (ISO 8601).`);
    }
    expiresAt = new Date(t).toISOString();
  }
  if (!recipients.people.length && !recipients.organism && !recipients.code) {
    return refuse(400, 'NO_RECIPIENTS', 'Name who may pick it up: recipients.people, recipients.organism or recipients.code. Several may be chosen.');
  }
  return { ok: true, terms: { name, note, protection, recipients, codeLogin, retention, maxPickups, expiresAt, organismId } };
}

/** The content of a deposit or a share, measured and checked. File content arrives as base64. */
export interface ShareContent {
  format: SecretShareFormat;
  /** The content as text: for a file, its base64. */
  text: string;
  sizeBytes: number;
  fileName: string | null;
  contentType: string | null;
}

export function normalizeContent(body: Record<string, unknown>, maxBytes: number): { ok: true; content: ShareContent } | ShareRefusal {
  const format = (body.format ?? 'text') as SecretShareFormat;
  if (!FORMATS.includes(format)) return refuse(400, 'INVALID_FORMAT', 'format is text (a key, a password, a token), pairs (NAME=value lines, such as an .env file) or file (content_base64 with file_name).');
  if (format === 'file') {
    const b64 = typeof body.content_base64 === 'string' ? body.content_base64.replace(/\s+/g, '') : '';
    if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return refuse(400, 'INVALID_CONTENT', 'A file is sent as content_base64 (standard base64).');
    const size = Buffer.from(b64, 'base64').length;
    if (size > maxBytes) return refuse(413, 'SECRET_TOO_LARGE', `That file is ${size} bytes and this node takes at most ${maxBytes}. The operator sets the limit (secrets.share_max_bytes).`);
    const fileName = typeof body.file_name === 'string' && body.file_name.trim() ? body.file_name.trim().slice(0, 200) : 'secret.bin';
    const contentType = typeof body.content_type === 'string' && /^[\w.+-]+\/[\w.+-]+$/.test(body.content_type) ? body.content_type : 'application/octet-stream';
    return { ok: true, content: { format, text: b64, sizeBytes: size, fileName, contentType } };
  }
  const text = typeof body.content === 'string' ? body.content : '';
  if (text === '') return refuse(400, 'INVALID_CONTENT', 'content is required: the secret itself, as text.');
  const size = Buffer.byteLength(text, 'utf8');
  if (size > maxBytes) return refuse(413, 'SECRET_TOO_LARGE', `That content is ${size} bytes and this node takes at most ${maxBytes}. The operator sets the limit (secrets.share_max_bytes).`);
  return { ok: true, content: { format, text, sizeBytes: size, fileName: null, contentType: null } };
}

/** The time a request may be filled until: `request_days` from now, 1 to 90, default 14. */
export function requestDeadline(body: Record<string, unknown>, now = Date.now()): { ok: true; at: string } | ShareRefusal {
  const raw = body.request_days ?? REQUEST_DAYS_DEFAULT;
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > REQUEST_DAYS_MAX) {
    return refuse(400, 'INVALID_REQUEST_DAYS', `request_days is how long the request can be filled, 1 to ${REQUEST_DAYS_MAX} days. It ends sooner when it is filled.`);
  }
  return { ok: true, at: new Date(now + days * DAY).toISOString() };
}
