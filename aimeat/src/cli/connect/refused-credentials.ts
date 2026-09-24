/**
 * @file cli/connect/refused-credentials.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A credential the node refused is not sent again every few seconds.
 *
 *   WHY. A crew runs `aimeat connect call` every five seconds while a task runs, for its live
 *   status, and every run is a new process. When one agent's stored bearer had expired, each run
 *   sent that same dead bearer to the node once, and no run knew that the one before it had been
 *   refused: one address, one expired token, a refusal every few seconds for as long as tasks ran.
 *
 *   WHAT. When the node answers 401 to a credential, the credential (its SHA-256, never the value)
 *   is recorded in the connector home with a time before which it is not sent again: one minute,
 *   doubling with every further refusal, at most one hour. Until then a caller gets the refusal
 *   here, with no request. A different credential is never held back by this record, so a re-run
 *   `aimeat connect` or a fresh mint from a key goes out at once, and an accepted request clears
 *   the record. A file, because the callers that repeat themselves are separate processes.
 * @structure refusedCredential(token) · noteCredentialAnswer(token, status, body)
 * @usage
 *   const held = refusedCredential(token);
 *   if (held) return held;                       // no request
 *   const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
 *   noteCredentialAnswer(token, res.status, body);
 * @version-history
 *   v1.0.0 — 2026-09-24 — Created (production refusal log L-3: one expired bearer sent every few
 *     seconds by `aimeat connect call`).
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir } from './config.js';

const FIRST_HOLD_MS = 60_000;
const LONGEST_HOLD_MS = 3_600_000;
/** A record untouched for this long is dropped at the next write, so the file cannot grow for ever. */
const FORGET_AFTER_MS = 7 * 24 * 3_600_000;

interface Refusal { code: string; count: number; last_at: string; until: string }
type Book = Record<string, Refusal>;

const bookFile = (): string => join(getConfigDir(), 'refused-credentials.json');
const fingerprint = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 32);

function readBook(): Book {
  const file = bookFile();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Book : {};
  } catch (err) {
    // A torn or foreign file holds nothing back; the next refusal writes it whole again.
    console.error(`[connect] ${file} could not be read (${String(err)}); no credential is held back`);
    return {};
  }
}

function writeBook(book: Book): void {
  const now = Date.now();
  for (const [key, r] of Object.entries(book)) {
    if (!(now - Date.parse(r.last_at) < FORGET_AFTER_MS)) delete book[key];
  }
  const file = bookFile();
  // Several processes may write at once; each renames its own whole file, and the loser's record
  // costs at most one extra request.
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`;
  try {
    mkdirSync(getConfigDir(), { recursive: true });
    writeFileSync(tmp, JSON.stringify(book, null, 2), { encoding: 'utf-8', mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) {
    // Bookkeeping must not fail the call it describes; the next answer tries again.
    console.error(`[connect] could not record a refused credential in ${file}: ${String(err)}`);
    try { rmSync(tmp, { force: true }); } catch (cleanup) { console.error(`[connect] ${tmp} was left behind: ${String(cleanup)}`); }
  }
}

/** The answer for a credential the node refused and that is still held back, or null to send it. */
export function refusedCredential(token: string): { ok: false; error: { code: string; message: string } } | null {
  const r = readBook()[fingerprint(token)];
  if (!r || !(Date.parse(r.until) > Date.now())) return null;
  return {
    ok: false,
    error: {
      code: 'CREDENTIAL_REFUSED',
      message: `The node refused this credential (${r.code}), ${r.count} time(s), last at ${r.last_at}. `
        + `It is not sent again before ${r.until}. Run \`aimeat connect\` for this agent to get a new `
        + 'one; a new credential is sent at once.',
    },
  };
}

/**
 * What the node said to a credential: a 401 holds it back, for longer each time; an accepted
 * request clears it. Any other refusal (403, 404, ...) is about the request, not the credential.
 */
export function noteCredentialAnswer(token: string, status: number, body: unknown): void {
  if (status >= 400 && status !== 401) return;
  const book = readBook();
  const key = fingerprint(token);
  if (status < 400) {
    if (book[key]) { delete book[key]; writeBook(book); }
    return;
  }
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  const count = (book[key]?.count ?? 0) + 1;
  const now = Date.now();
  book[key] = {
    code: typeof code === 'string' && code ? code : 'UNAUTHORIZED',
    count,
    last_at: new Date(now).toISOString(),
    until: new Date(now + Math.min(FIRST_HOLD_MS * 2 ** (count - 1), LONGEST_HOLD_MS)).toISOString(),
  };
  writeBook(book);
}
