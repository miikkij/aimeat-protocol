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
 *     When the question cannot be filed (the account's queue is full), the page waits all the same,
 *     and the next read files it.
 *   - The page routes note their writer (notePortfolioWriter), and so do the generic file write and
 *     delete (notePortfolioFileChange, from services/storage-page-keys.ts).
 *   - A page whose bytes changed by a write this module did not see waits the same way, with the
 *     request naming no writer.
 *   - A page that existed at the update (secaudit2026oct31w2 round 11) was recorded as allowed once at
 *     the node's start (services/portfolio-read-hold-keep.ts), so no existing page stops working. After
 *     that step, a page with no record was written since, and it waits. Until the step has run (a start
 *     where it failed), a page with no record is adopted as allowed on its first read, as before.
 *
 *   THE RECORD is service-owned (utils/reserved-keys.ts `portfolio-read-hold.`), in the owner's own
 *   namespace, so no memory route writes it: { allowed: digest|null, waiting: { digest, requestId|null,
 *   writer }|null }.
 * @structure PORTFOLIO_READ_HOLD_KEY · PORTFOLIO_PAGES_MARKED_KEY · PortfolioWriter · portfolioPageDigest ·
 *   notePortfolioWriter · notePortfolioFileChange · portfolioReadHold · adoptPageAtUpdate ·
 *   allowOwnersOwnPage · allowPortfolioRead
 * @usage
 *   const asked = await notePortfolioWriter(ctx, ownerName, caller, req.auth?.app);  // after a page write
 *   const held = await portfolioReadHold(ctx, ownerName);                          // before a read for the page
 * @version-history
 *   v1.1.0 — 2026-11-01 — A page with no record waits once the node marked the pages of the update
 *     (PORTFOLIO_PAGES_MARKED_KEY, adoptPageAtUpdate); notePortfolioFileChange for the generic file write
 *     and delete; a question that could not be filed leaves the page waiting, and the next read files it
 *     (secaudit2026oct31w2 round 11, portfolio-read-hold:absent-record-adopted-at-first-read).
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
import { madeBefore } from './once-only-step.js';

/** The record, in the owner's GHII namespace. Service-owned (utils/reserved-keys.ts). */
export const PORTFOLIO_READ_HOLD_KEY = 'portfolio-read-hold.page';
/**
 * The once-only step that recorded every page of the update as allowed (portfolio-read-hold-keep.ts),
 * under `system@<node>`. Its finished record is the evidence that a page with no record is a new one.
 */
export const PORTFOLIO_PAGES_MARKED_KEY = 'migrations.portfolio-read-hold-pages-marked';

type Ctx = { storage: Storage; config: AimeatConfig };
interface Hold {
  /** The digest of the page bytes that may read the owner's memory. */
  allowed: string | null;
  /** The page that waits for the owner, and the request that asks (null: not filed yet). */
  waiting: { digest: string; requestId: string | null; writer: string | null } | null;
}

/** Who wrote a page, as the rule needs it: who asks the owner, and whether it may read memory itself. */
export interface PortfolioWriter { requester: PublishRequester; readsMemory: boolean }

const parseHold = (v: unknown): Hold => {
  const o = (v && typeof v === 'object' ? v : {}) as Partial<Hold>;
  return { allowed: typeof o.allowed === 'string' ? o.allowed : null, waiting: o.waiting && typeof o.waiting === 'object' ? o.waiting : null };
};
const ghiiOf = (ctx: Ctx, ownerName: string) => `${ownerName}@${ctx.config.nodeId}`;

/** The page served now and its sha256, or null when there is no page. */
async function servedPage(ctx: Ctx, ownerName: string): Promise<{ digest: string; createdAt: string } | null> {
  for (const gaii of await portfolioReadGaiis(ctx.storage, ownerName, ctx.config.nodeId)) {
    const file = await ctx.storage.getStorageFile(gaii, PORTFOLIO_HTML_KEY);
    if (file) return { digest: createHash('sha256').update(file.data).digest('hex'), createdAt: file.createdAt };
  }
  return null;
}

/** The sha256 of the page served now, or null when there is no page. */
export async function portfolioPageDigest(ctx: Ctx, ownerName: string): Promise<string | null> {
  return (await servedPage(ctx, ownerName))?.digest ?? null;
}

async function writeHold(ctx: Ctx, ownerName: string, mutate: (cur: Hold) => Hold | typeof UNCHANGED): Promise<void> {
  await updateRecord(ctx.storage, ghiiOf(ctx, ownerName), PORTFOLIO_READ_HOLD_KEY, parseHold, mutate,
    { tag: 'portfolio', visibility: 'private' });
}

/** Seen finished once, it stays finished: the step never runs again on this node. */
const marked = new Set<string>();

/** Has the once-only step recorded the pages of the update on this node (portfolio-read-hold-keep.ts)? */
async function pagesMarked(ctx: Ctx): Promise<boolean> {
  if (marked.has(ctx.config.nodeId)) return true;
  const v = (await ctx.storage.getMemory(`system@${ctx.config.nodeId}`, PORTFOLIO_PAGES_MARKED_KEY))?.value as { state?: unknown } | undefined;
  const done = !!v && typeof v === 'object' && v.state !== 'running';
  if (done) marked.add(ctx.config.nodeId);
  return done;
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

/** The owner's own question about a page whose writer this module did not see. */
const ownerAsks = (ctx: Ctx, ownerName: string): PublishRequester => ({ principal: ghiiOf(ctx, ownerName), kind: 'person', sub: ownerName });

/**
 * The page with `digest` waits for the owner: the question is filed, and the hold names it. A question
 * that cannot be filed now leaves the page waiting with no request, and the next read files it.
 */
async function holdForOwner(ctx: Ctx, ownerName: string, digest: string, writer: PortfolioWriter | null) {
  const requester = writer?.requester ?? ownerAsks(ctx, ownerName);
  const writerId = writer ? writer.requester.principal : null;
  const filed = await askOwner(ctx, ownerName, digest, requester, writerId);
  const requestId = filed.ok ? filed.request.id : null;
  await writeHold(ctx, ownerName, cur => ({ ...cur, waiting: { digest, requestId, writer: writerId } }));
  return filed;
}

/** A writer with memory:read allows the page with `digest`; one without it files the owner's question. */
async function noteWriter(ctx: Ctx, ownerName: string, digest: string, writer: PortfolioWriter) {
  if (writer.readsMemory) {
    await writeHold(ctx, ownerName, cur => ({ allowed: digest, waiting: cur.waiting?.digest === digest ? null : cur.waiting }));
    return null;
  }
  return holdForOwner(ctx, ownerName, digest, writer);
}

/**
 * After a page write by a caller this door knows: a writer with memory:read allows the new page, a
 * writer without it files the owner's question. Answers the request for the door's reply, or undefined.
 */
export async function notePortfolioWriter(ctx: Ctx, ownerName: string, caller: CallerContext, app?: string): Promise<AppPublishAsked | undefined> {
  const digest = await portfolioPageDigest(ctx, ownerName);
  if (!digest) return undefined;
  const filed = await noteWriter(ctx, ownerName, digest, { requester: requesterOf(ctx, caller, app), readsMemory: caller.has('memory:read') });
  return filed ? askedOf(ctx, filed, 'The page is stored, and it reads your memory once you allow it') : undefined;
}

/**
 * After a generic file write or delete of the page key (services/storage-page-keys.ts). `writtenDigest`
 * is the sha256 of the bytes a write stored (null for a delete, or bytes the node did not hold); a write
 * whose bytes are not the page served now changed nothing the owner sees, and a page already allowed
 * stays allowed. `writer` null: the door named no caller, and the question names no writer. Never
 * throws: a failure is logged, and the next read decides from the record as it is.
 */
export async function notePortfolioFileChange(ctx: Ctx, ownerName: string, writer: PortfolioWriter | null, writtenDigest: string | null): Promise<void> {
  try {
    const digest = await portfolioPageDigest(ctx, ownerName);
    if (!digest || (writtenDigest !== null && writtenDigest !== digest)) return;
    const hold = parseHold((await ctx.storage.getMemory(ghiiOf(ctx, ownerName), PORTFOLIO_READ_HOLD_KEY))?.value);
    if (hold.allowed === digest || (hold.waiting?.digest === digest && hold.waiting.requestId)) return;
    if (writer) await noteWriter(ctx, ownerName, digest, writer);
    else await holdForOwner(ctx, ownerName, digest, null);
  } catch (err) {
    logger.warn('portfolio: the writer of the page could not be noted; the next read decides', { owner: ownerName, error: String(err) });
  }
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
    if (!stored && !await pagesMarked(ctx)) {
      // The pages of the update are not marked yet (the step failed at this start): adopted as it is, as before.
      await writeHold(ctx, ownerName, cur => (cur.allowed ? UNCHANGED : { allowed: digest, waiting: null }));
      return null;
    }
    const hold = parseHold(stored?.value);
    if (hold.allowed === digest) return null;
    if (hold.waiting?.digest === digest && hold.waiting.requestId) return { request_id: hold.waiting.requestId };
    // A page nobody asked about yet, or whose question could not be filed: ask now, naming the writer when known.
    const known = hold.waiting?.digest === digest ? hold.waiting.writer : null;
    const writer = known ? { requester: { principal: known, kind: known.startsWith('eco:') ? 'app' as const : 'agent' as const, sub: known }, readsMemory: false } : null;
    const filed = await holdForOwner(ctx, ownerName, digest, writer);
    return { request_id: filed.ok ? filed.request.id : null };
  } catch (err) {
    logger.warn('portfolio: whether the page may read memory could not be decided; it reads nothing', { owner: ownerName, error: String(err) });
    return { request_id: null };
  }
}

/**
 * The once-only step's work for one owner (portfolio-read-hold-keep.ts): a page served now that was
 * stored before `cutoff` and has no record is recorded as allowed, as it read before the update. True
 * when it recorded one.
 */
export async function adoptPageAtUpdate(ctx: Ctx, ownerName: string, cutoff: number): Promise<boolean> {
  const page = await servedPage(ctx, ownerName);
  if (!page || !madeBefore(page.createdAt, cutoff)) return false;
  if (await ctx.storage.getMemory(ghiiOf(ctx, ownerName), PORTFOLIO_READ_HOLD_KEY)) return false;
  let adopted = false;
  await writeHold(ctx, ownerName, cur => {
    if (cur.allowed || cur.waiting) return UNCHANGED;
    adopted = true;
    return { allowed: page.digest, waiting: null };
  });
  return adopted;
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
