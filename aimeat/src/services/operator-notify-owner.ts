/**
 * @file src/services/operator-notify-owner.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One notice from the operator to an owner of this node, sent once per code: the
 *   store's fleet service tells the owner of a place it sold that something happened (the first-build
 *   gift: "Sait 2 € lisää tekoälysaldoa…", Jouni, 1.11). The notice goes through notify(), so it reaches
 *   the bell, and push and mail as each owner's notification settings say.
 *
 *   ONCE PER CODE. The code is claimed in a record under the node's own identity, on its version,
 *   before anyone is told, so a retry of the same code tells nobody again. When nobody could be told
 *   the claim is released, so the retry is a real second try.
 * @structure NotifyOwnerError · notifyOwnerOnce
 * @usage const r = await notifyOwnerOnce(deps, { code, title, body, owner });
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial ("Rakennamme kanssasi", part D).
 */
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { notify } from './notify.js';
import { logger } from '../utils/logger.js';

const KEY = 'operator.notify-owner.sent';
const CODE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TITLE_MAX = 160;
const BODY_MAX = 1000;

export class NotifyOwnerError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

type Sent = Record<string, { at: string; told: string[] }>;
const parse = (v: unknown): Sent => (v && typeof v === 'object' ? v as Sent : {});

export interface NotifyOwnerInput { code?: unknown; title?: unknown; body?: unknown; owner?: unknown; link?: unknown }

/** Tell the named owner once per code. */
export async function notifyOwnerOnce(deps: { storage: Storage; config: AimeatConfig }, input: NotifyOwnerInput) {
  const code = typeof input.code === 'string' ? input.code.trim() : '';
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  const body = typeof input.body === 'string' ? input.body.trim() : '';
  const link = typeof input.link === 'string' ? input.link.trim() : '';
  if (!CODE.test(code)) throw new NotifyOwnerError(400, 'VALIDATION_ERROR', 'code is required: lower-case letters, digits, dot, dash or underscore, at most 64 (e.g. gift.first-build).');
  if (!title || title.length > TITLE_MAX) throw new NotifyOwnerError(400, 'VALIDATION_ERROR', `title is required, at most ${TITLE_MAX} characters.`);
  if (body.length > BODY_MAX) throw new NotifyOwnerError(400, 'VALIDATION_ERROR', `body is at most ${BODY_MAX} characters.`);
  // A link opens a page of this node, never an address elsewhere.
  if (link && !/^\/v1\/[^/]/.test(link)) throw new NotifyOwnerError(400, 'VALIDATION_ERROR', 'link is a path on this node that starts with /v1/.');

  // The owner is named: the fleet takes the name from the trail entry that earned the notice.
  const named = typeof input.owner === 'string' ? input.owner.trim() : '';
  if (!named) throw new NotifyOwnerError(400, 'VALIDATION_ERROR', 'owner is required: the account to tell.');
  const found = await deps.storage.getOwner(named);
  if (!found) throw new NotifyOwnerError(404, 'NOT_FOUND', `No account ${named} on this node.`);
  const recipients = [found];

  const system = `system@${deps.config.nodeId}`;
  const at = new Date().toISOString();
  let already: { at: string; told: string[] } | null = null;
  await updateRecord(deps.storage, system, KEY, parse, (cur) => {
    if (cur[code]) { already = cur[code]; return UNCHANGED; }
    return { ...cur, [code]: { at, told: recipients.map((o) => o.name) } };
  }, { tag: 'operator-notify', visibility: 'private' });
  if (already) return { already: true, ...(already as { at: string; told: string[] }) };

  const told: string[] = [];
  for (const o of recipients) {
    const r = await notify(deps.storage, `${o.name}@${deps.config.nodeId}`, {
      type: 'operator_notice', title, ...(body ? { body } : {}), ...(link ? { link } : {}),
    }).catch((e: Error) => {
      logger.warn(`[operator-notify] the notice ${code} was not stored for ${o.name}: ${e.message}`);
      return null;
    });
    if (r?.stored) told.push(o.name);
  }
  if (told.length === 0) {
    // Nobody heard it: release the code, so the retry tries again.
    await updateRecord(deps.storage, system, KEY, parse, (cur) => {
      if (!cur[code] || cur[code].at !== at) return UNCHANGED;
      return Object.fromEntries(Object.entries(cur).filter(([k]) => k !== code));
    }, { tag: 'operator-notify', visibility: 'private' });
    throw new NotifyOwnerError(502, 'NOTIFICATION_NOT_STORED', 'The notice could not be stored, so nobody was told. Send it again.');
  }
  if (told.length !== recipients.length) {
    await updateRecord(deps.storage, system, KEY, parse, (cur) => (cur[code]?.at === at ? { ...cur, [code]: { at, told } } : UNCHANGED),
      { tag: 'operator-notify', visibility: 'private' });
  }
  return { already: false, at, told };
}
