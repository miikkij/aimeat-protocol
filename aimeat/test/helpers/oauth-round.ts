/**
 * @file oauth-round.ts
 * @description What a test needs to finish an outside sign-in round the way a browser does: send the
 *   header a browser sends on a same-origin fetch when it starts the round, keep the cookie the start
 *   answers with, and send that cookie back to the callback.
 *
 *   WHY. Since 2026-10-09 the connection and MCP-server callbacks seal a credential only for the
 *   browser that started the round (secrets audit 2026-10-09, chapter 2). A round started by a
 *   caller that is not the owner's browser (an agent, a CLI) carries no binding until the owner
 *   confirms it at /v1/oauth-rounds/:state/approve in their own browser. A test that drives the
 *   callback with the state alone now gets the refusal, which is what a stranger's browser gets.
 * @structure BROWSER_START (header) · roundCookie(res) · readRoundRow(state)
 * @usage
 *   const res = await fetch(`${BASE}/v1/connections/start`, { method: 'POST', headers: { ...BROWSER_START, ... } });
 *   const cookie = roundCookie(res);
 *   await fetch(`${BASE}/v1/connections/callback?state=…&code=…`, { headers: { Cookie: cookie }, redirect: 'manual' });
 * @version-history
 *   v1.0.0 — 2026-10-09 — Initial (secrets audit 2026-10-09: OAuth rounds bound to the starter).
 */
import Database from 'better-sqlite3';
import { pinnedSqlitePath, serverDbUrl } from './server-db.js';

/** What a browser sends on a fetch from a page of the node's own origin. Only browsers set it. */
export const BROWSER_START: Record<string, string> = { 'Sec-Fetch-Site': 'same-origin' };

/** Every round-binding cookie a response set, as one `Cookie` header value ('' when none). */
export function roundCookie(res: Response): string {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return all
    .filter(c => c.startsWith('aimeat_oauth_'))
    .map(c => c.split(';')[0]!)
    .join('; ');
}

/** The raw Set-Cookie line of the round-binding cookie, for asserting its attributes. */
export function roundCookieLine(res: Response): string {
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  return all.find(c => c.startsWith('aimeat_oauth_')) ?? '';
}

/**
 * The stored verification-nonce row for `state`, read behind the server's back, or null when the
 * row is absent. SQLite through the file the runner pinned, Postgres through the URL it was given.
 */
export async function readRoundRow(state: string): Promise<Record<string, unknown> | null> {
  const url = serverDbUrl();
  if (url && (process.env.AIMEAT_DB ?? '').startsWith('postgres')) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url.replace(/\?schema=public$/, '') });
    await client.connect();
    try {
      const r = await client.query('SELECT * FROM "VerificationNonce" WHERE state = $1', [state]);
      return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
    } finally {
      await client.end();
    }
  }
  const path = pinnedSqlitePath();
  if (!path) return null;
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare('SELECT * FROM verification_nonces WHERE state = ?').get(state) as Record<string, unknown> | undefined) ?? null;
  } finally {
    db.close();
  }
}

/** One raw row of a table by id, behind the server's back, on whichever backend the run uses. */
export async function readRawRow(sqliteTable: string, pgTable: string, id: string): Promise<Record<string, unknown> | null> {
  const url = serverDbUrl();
  if (url && (process.env.AIMEAT_DB ?? '').startsWith('postgres')) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: url.replace(/\?schema=public$/, '') });
    await client.connect();
    try {
      const r = await client.query(`SELECT * FROM "${pgTable}" WHERE id = $1`, [id]);
      return (r.rows[0] as Record<string, unknown> | undefined) ?? null;
    } finally {
      await client.end();
    }
  }
  const path = pinnedSqlitePath();
  if (!path) return null;
  const db = new Database(path, { readonly: true });
  try {
    return (db.prepare(`SELECT * FROM ${sqliteTable} WHERE id = ?`).get(id) as Record<string, unknown> | undefined) ?? null;
  } finally {
    db.close();
  }
}
