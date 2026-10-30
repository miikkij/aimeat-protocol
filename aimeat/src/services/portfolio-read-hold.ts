/**
 * @file src/services/portfolio-read-hold.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Whether the owner's welcome page (the portfolio) may read the owner's memory when the
 *   owner opens it, decided by who wrote the page that is served now (audit H-9, f-2026aug-h-9).
 *
 *   WHY. Writing the page is designed use: an agent or an app of the owner may publish it. When the
 *   owner opens their own page at `<owner>.portfolio.<apex>` while signed in, the silent bridge gives
 *   the page a memory:read token with no question, and the SPA viewer reads records for the page with
 *   the owner's session. So a page written by an app or agent that may write files but may not read
 *   memory could read the owner's memory through the owner, and send it on. This decides the reads
 *   by the page's bytes:
 *
 *   - A page written by a writer that holds memory:read (the owner, or an agent or app granted it)
 *     reads as before: its digest is recorded as allowed.
 *   - A page written by a writer without memory:read waits for one press: a request of kind
 *     `portfolio-memory-read` asks the owner (an agent of theirs that holds memory:read may answer).
 *     Until then the page is served as before, signed out: it reads no memory through the owner.
 *   - A page whose bytes changed by a write this module did not see (a generic file write under the
 *     page's key) waits the same way, with the request naming no writer.
 *   - A page from before this module, with no record yet, is adopted as allowed on its first read,
 *     so no existing page stops working.
 *
 *   THE RECORD is service-owned (utils/reserved-keys.ts `portfolio-read-hold.`), in the owner's own
 *   namespace, so no memory route writes it: { allowed: digest|null, waiting: { digest, requestId,
 *   writer }|null }.
 * @structure PORTFOLIO_READ_HOLD_KEY · portfolioPageDigest · notePortfolioWriter · portfolioReadHold ·
 *   allowOwnersOwnPage · allowPortfolioRead
 * @usage
 *   const asked = await notePortfolioWriter(ctx, ownerName, caller, req.auth?.app);  // after a page write
 *   const held = await portfolioReadHold(ctx, ownerName);                          // before a read for the page
 * @version-history
 *   v1.0.0 — 2026-10-31 — Initial (audit H-9, f-2026aug-h-9; Jouni, 2026-10-31: the page may be written by
 *     any agent of the owner, and a page whose writer may not read memory asks once before it reads).
 */
import { createHash } from 'node:crypto';
import type { Storage } from '../storage/interface.js';
import type { AimeatConfig } from '../config.js';
import type { CallerContext } from './caller-context.js';
import { updateRecord, UNCHANGED } from './record-cas.js';
import { PORTFOLIO_HTML_KEY, portfolioReadGaiis } from './portfolio-config.js';
import { fileAsk, requesterOf } from './publish-requests/ask.js';
import type { PublishRequester } from './publish-requests/store.js';
import { askedOf, type AppPublishAsked } from './app-publish-gate.js';
import { logger } from '../utils/logger.js';
import { parseGAII } from '../utils/gaii.js';

/** The record, in the owner's GHII namespace. Service-owned (utils/reserved-keys.ts). */
export const PORTFOLIO_READ_HOLD_KEY = 'portfolio-read-hold.page';

type Ctx = { storage: Storage; config: AimeatConfig };
interface Hold {
  /** The digest of the page bytes that may read the owner's memory. */
  allowed: string | null;
  /** The page that waits for the owner, and the request that asks. */
  waiting: { digest: string; requestId: string; writer: string | null } | null;
}

const parseHold = (v: unknown): Hold => {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Hold>;
  return { allowed: typeof o.allowed === 'string' ? o.allowed : null, waiting: o.waiting && typeof o.waiting === 'object' ? o.waiting : null };
};
const ghiiOf = (ctx: Ctx, ownerName: string) => `${ownerName}@${ctx.config.nodeId}`;

/** The sha256 of the page served now, or null when there is no page. */
export async function portfolioPageDigest(ctx: Ctx, ownerName: string): Promise<string | null> {
  for (const gaii of await portfolioReadGaiis(ctx.storage, ownerName, ctx.config.nodeId)) {
    const file = await ctx.storage.getStorageFile(gaii, PORTFOLIO_HTML_KEY);
    if (file) return createHash('sha256').update(file.data).digest('hex');
  }
  return null;
}

async function writeHold(ctx: Ctx, ownerName: string, mutate: (cur: Hold) => Hold | typeof UNCHANGED): Promise<void> {
  await updateRecord(ctx.storage, ghiiOf(ctx, ownerName), PORTFOLIO_READ_HOLD_KEY, parseHold, mutate,
    { tag: 'portfolio', visibility: 'private' });
}

/** File the owner's question about the page with `digest`. `writer` null: a write this module did not see. */
async function askOwner(ctx: Ctx, ownerName: string, digest: string, requester: PublishRequester, writerId: string | null) {
  // The name a person reads: an agent's own name, an app's name, never the whole identity.
  const writer = writerId === null ? null : (parseGAII(writerId)?.agent ?? writerId).replace(/^eco:/, '');
  const writerName = writer ?? '';
  return fileAsk(ctx, ownerName, requester, {
    kind: 'portfolio-memory-read',
    target: { owner: ownerName, digest },
    title: 'your welcome page',
    name: ownerName,
    change: { field: 'portfolio.memory.read', from: null, to: 'allowed' },
    approval: {
      approver: 'owner',
      asks: 'let your welcome page read your memory when you open it while signed in',
      why: (writer
        ? `${writer} wrote the page, and ${writer} may not read your memory itself. `
        : 'The page was changed outside the page editor, so the node does not know who wrote it. ')
        + 'A page that reads your memory while you look at it can send what it reads elsewhere. If you do not allow it, the page is shown as before, without your private entries.',
      approve_scope: 'memory:read',
      change: { link: '/v1/portfolio', key: 'approval_change.portfolio_page' },
      i18n: writer
        ? { key: 'approval_portfolio_memory_read', vars: { writer: writerName } }
        : { key: 'approval_portfolio_memory_read_changed', vars: {} },
    },
  });
}

/**
 * After a page write by a caller this door knows: a writer with memory:read allows the new page, a
 * writer without it files the owner's question. Answers the request for the door's reply, or undefined.
 */
export async function notePortfolioWriter(ctx: Ctx, ownerName: string, caller: CallerContext, app?: string): Promise<AppPublishAsked | undefined> {
  const digest = await portfolioPageDigest(ctx, ownerName);
  if (!digest) return undefined;
  if (caller.has('memory:read')) {
    await writeHold(ctx, ownerName, cur => ({ allowed: digest, waiting: cur.waiting?.digest === digest ? null : cur.waiting }));
    return undefined;
  }
  const requester = requesterOf(ctx, caller, app);
  const filed = await askOwner(ctx, ownerName, digest, requester, requester.principal);
  if (filed.ok) {
    const requestId = filed.request.id;
    await writeHold(ctx, ownerName, cur => ({ ...cur, waiting: { digest, requestId, writer: requester.principal } }));
  }
  return askedOf(ctx, filed, 'The page is stored, and it reads your memory once you allow it');
}

/**
 * Whether the page served now must not read the owner's memory yet. null: it may (allowed, adopted,
 * or there is no page). Otherwise the request that asks the owner, filed now when none waits for these
 * bytes. Never throws: a failure reads as held, which serves the page signed out.
 */
export async function portfolioReadHold(ctx: Ctx, ownerName: string): Promise<{ request_id: string | null } | null> {
  try {
    const digest = await portfolioPageDigest(ctx, ownerName);
    if (!digest) return null;
    const stored = await ctx.storage.getMemory(ghiiOf(ctx, ownerName), PORTFOLIO_READ_HOLD_KEY);
    if (!stored) {
      // A page from before this check: adopted as it is, so an existing page keeps working.
      await writeHold(ctx, ownerName, cur => (cur.allowed ? UNCHANGED : { allowed: digest, waiting: null }));
      return null;
    }
    const hold = parseHold(stored.value);
    if (hold.allowed === digest) return null;
    if (hold.waiting?.digest === digest) return { request_id: hold.waiting.requestId };
    const owner: PublishRequester = { principal: ghiiOf(ctx, ownerName), kind: 'person', sub: ownerName };
    const filed = await askOwner(ctx, ownerName, digest, owner, null);
    if (!filed.ok) return { request_id: null };
    await writeHold(ctx, ownerName, cur => ({ ...cur, waiting: { digest, requestId: filed.request.id, writer: null } }));
    return { request_id: filed.request.id };
  } catch (err) {
    logger.warn('portfolio: whether the page may read memory could not be decided; it reads nothing', { owner: ownerName, error: String(err) });
    return { request_id: null };
  }
}

/** The owner wrote the page served now in person (the welcome mat): it reads their memory as before. */
export async function allowOwnersOwnPage(ctx: Ctx, ownerName: string): Promise<void> {
  const digest = await portfolioPageDigest(ctx, ownerName);
  if (digest) await allowPortfolioRead(ctx, ownerName, digest);
}

/** The owner allowed the page with `digest`. False when the page served now is another one. */
export async function allowPortfolioRead(ctx: Ctx, ownerName: string, digest: string): Promise<boolean> {
  if (await portfolioPageDigest(ctx, ownerName) !== digest) return false;
  await writeHold(ctx, ownerName, cur => ({ allowed: digest, waiting: cur.waiting?.digest === digest ? null : cur.waiting }));
  return true;
}
