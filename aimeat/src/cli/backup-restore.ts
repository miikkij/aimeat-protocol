/**
 * @file src/cli/backup-restore.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description `aimeat backup [FILE]` and `aimeat restore <FILE>`: call GET /v1/admin/backup and
 *   POST /v1/admin/restore with an operator's personal access token, read the HTTP status and the
 *   envelope, and return the exit code. A refusal prints the node's code and message and writes no
 *   file; a restore in which any record failed for a reason other than a duplicate exits non-zero.
 * @structure operatorTokenFrom() · runBackup() · runRestore()
 * @usage const code = await runBackup({ baseUrl, token, outFile }); process.exit(code);
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial. The two commands sent `Bearer operator:<admin password>`, which no
 *     auth path reads, never read the status, wrote the 401 answer to the backup file and logged
 *     success (QA audit P6-07, F19b-01).
 */
import { readFileSync } from 'node:fs';
import { writePrivateFile } from '../utils/private-file.js';
import { readJsonCapped } from '../utils/read-capped.js';

/** The flag and the env var an operator command reads its personal access token from. */
export const OPERATOR_TOKEN_ENV = 'AIMEAT_OP_TOKEN';

const TOKEN_HELP = `Pass a personal access token of an operator account with --token <token> or ${OPERATOR_TOKEN_ENV}=<token>. `
  + 'An operator creates one at <node>/v1/profile?tab=access with the level "Run the whole server", or with '
  + 'POST /v1/access/tokens {"label":"backup","grant_operator":true}.';

/** The token from --token, else from AIMEAT_OP_TOKEN; '' when neither is set. */
export function operatorTokenFrom(flag: string | undefined, env: NodeJS.ProcessEnv = process.env): string {
  return (flag ?? env[OPERATOR_TOKEN_ENV] ?? '').trim();
}

interface Envelope { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } }

/** The largest answer read: a backup holds every agent's memory, so the ceiling is generous. */
const ANSWER_MAX_BYTES = 1024 * 1024 * 1024;

async function call(url: string, init: RequestInit): Promise<{ status: number; ok: boolean; body: Envelope | null; text: string }> {
  // The operator's own node: the --url they typed, or the node this command started on localhost.
  const resp = await fetch(url, init);
  const read = await readJsonCapped(resp, ANSWER_MAX_BYTES);
  if (!read.ok) {
    // Not an envelope: refusal() prints the status and these first characters.
    const text = read.reason === 'too-large' ? `The answer is larger than ${ANSWER_MAX_BYTES} bytes.` : (read.text ?? '');
    return { status: resp.status, ok: false, body: null, text };
  }
  const body = (read.value ?? null) as Envelope | null;
  return { status: resp.status, ok: resp.ok && body?.ok === true, body, text: '' };
}

function refusal(what: string, r: { status: number; body: Envelope | null; text: string }): string {
  const code = r.body?.error?.code ?? 'NO_ENVELOPE';
  const message = r.body?.error?.message ?? r.text.slice(0, 200);
  const hint = r.status === 401 ? `\n  ${TOKEN_HELP}`
    : r.status === 403 ? '\n  The token is valid but does not belong to an operator account. Use a token of an operator.'
      : '';
  return `${what} failed: the node answered HTTP ${r.status} ${code}: ${message}${hint}`;
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

/** GET /v1/admin/backup and write the envelope to `outFile`. Returns the exit code. */
export async function runBackup(opts: { baseUrl: string; token: string; outFile: string }): Promise<number> {
  if (!opts.token) {
    console.error(`aimeat backup needs an operator token. ${TOKEN_HELP}`);
    return 1;
  }
  let r;
  try {
    r = await call(`${opts.baseUrl}/v1/admin/backup`, { headers: auth(opts.token) });
  } catch (err) {
    console.error(`Backup failed: the node at ${opts.baseUrl} could not be reached: ${String(err)}. No file was written.`);
    return 1;
  }
  if (!r.ok || !r.body?.data) {
    console.error(`${refusal('Backup', r)}\n  No file was written.`);
    return 1;
  }
  // The file holds account data, so only the operator's user may read it.
  writePrivateFile(opts.outFile, JSON.stringify(r.body, null, 2));
  const d = r.body.data as { owners?: unknown[]; agents?: unknown[]; actions?: unknown[]; boards?: unknown[]; omitted?: string[] };
  console.log(`Backup written to ${opts.outFile}: ${d.owners?.length ?? 0} accounts, ${d.agents?.length ?? 0} agents, `
    + `${d.actions?.length ?? 0} actions, ${d.boards?.length ?? 0} boards, and the agents' memory.`);
  console.log('This export is partial. It does not carry the records people keep under their own accounts, organisms, '
    + 'apps, files or any credential. For a full backup of the node, back up the database and the .env file.');
  for (const line of d.omitted ?? []) console.log(`  Left out: ${line}`);
  return 0;
}

/** POST the `data` part of a backup file to /v1/admin/restore. Returns the exit code. */
export async function runRestore(opts: { baseUrl: string; token: string; inFile: string }): Promise<number> {
  if (!opts.token) {
    console.error(`aimeat restore needs an operator token. ${TOKEN_HELP}`);
    return 1;
  }
  let payload: unknown;
  try {
    const parsed = JSON.parse(readFileSync(opts.inFile, 'utf-8')) as { data?: unknown };
    payload = parsed.data ?? parsed; // the envelope `aimeat backup` writes, or its data part
  } catch (err) {
    console.error(`Restore failed: ${opts.inFile} could not be read as JSON: ${String(err)}`);
    return 1;
  }
  let r;
  try {
    r = await call(`${opts.baseUrl}/v1/admin/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth(opts.token) },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error(`Restore failed: the node at ${opts.baseUrl} could not be reached: ${String(err)}`);
    return 1;
  }
  if (!r.ok || !r.body?.data) {
    console.error(`${refusal('Restore', r)}\n  Nothing was imported.`);
    return 1;
  }
  const d = r.body.data as {
    restored?: boolean; imported?: Record<string, number>; skipped_duplicates?: Record<string, number>;
    failed?: Record<string, number>; failures?: Array<{ kind: string; key: string; error: string }>;
  };
  const counts = (c: Record<string, number> | undefined) =>
    Object.entries(c ?? {}).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ') || 'none';
  console.log(`Imported: ${counts(d.imported)}.`);
  console.log(`Already on this node, skipped: ${counts(d.skipped_duplicates)}.`);
  if (d.restored !== true) {
    console.error(`Restore incomplete. Not imported because of an error: ${counts(d.failed)}.`);
    for (const f of d.failures ?? []) console.error(`  ${f.kind} ${f.key}: ${f.error}`);
    console.error('  The node log has every failure. Fix the cause and run the restore again; records already imported are skipped.');
    return 1;
  }
  console.log('Restore complete.');
  return 0;
}
