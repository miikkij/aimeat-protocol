/**
 * @file src/services/portfolio-memory-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate for the welcome page's switch when it is written through a memory
 *   door (POST, PUT, PATCH /v1/memory, aimeat_memory_write, the batch doors) instead of
 *   PUT /v1/portfolio/config (secaudit2026oct26, services/portfolio-config.ts:portfolio.config:
 *   unreserved-key-bypasses-publish-gate).
 *
 *   WHY. The switch is the ordinary memory record `portfolio.config`, and the page is served from the
 *   first identity of the owner whose record says `enabled` (routes/portfolio.ts
 *   resolvePublishedPortfolio). With the node's publish gate on, PUT /v1/portfolio/config files a
 *   one-press request before an agent (or an app, under 'agents-and-apps') switches the page on or
 *   opens it to anyone (services/portfolio-publish-gate.ts). The same change written as a memory record
 *   asked nothing, so an agent without publish:public made the page public by writing its own copy.
 *
 *   WHAT IT DOES. The same decision as the portfolio route, measured on the page as it is served: a
 *   write by a caller the gate asks about that would make the served page public when it was not
 *   stores everything but that one change, and the door files the same request
 *   (filePortfolioAsk), which the owner allows with one press and the applier makes as the owner.
 *   With the gate off (the default), for the owner in person, and for a write that does not make the
 *   served page public, nothing changes.
 * @structure PortfolioMemoryGate · portfolioMemoryWriteGate
 * @usage
 *   const gate = await portfolioMemoryWriteGate(ctx, writer, key, value);
 *   if (gate.kind === 'refused') refuse(gate); if (gate.kind === 'ask') { store gate.value; then filePortfolioAsk(ctx, gate.ownerName, gate) }
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { localAccountName, ownerGhiiOf } from '../utils/gaii.js';
import { memoryWriterAsk, type MemoryPublishWriter } from './memory-publish-gate.js';
import { PORTFOLIO_CONFIG_KEY, portfolioReadGaiis } from './portfolio-config.js';
import { pageAccessOf } from './page-access.js';
import type { PortfolioChange } from './portfolio-publish-gate.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';

type Config = Record<string, unknown>;

export type PortfolioMemoryGate =
  | { kind: 'go' }
  | { kind: 'refused'; status: number; code: string; message: string }
  | { kind: 'ask'; value: Config; ownerName: string; requester: PublishRequester; change: PortfolioChange };

const asConfig = (v: unknown): Config | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Config : null);

/** The config the page is served from: the first identity, in the resolver's order, whose record is enabled. */
function served(order: readonly string[], configs: ReadonlyMap<string, Config | null>): Config | null {
  for (const gaii of order) {
    const c = configs.get(gaii);
    if (c?.enabled) return c;
  }
  return null;
}

const isPublic = (c: Config | null): boolean => !!c && pageAccessOf(c.access) === 'anyone';

/**
 * Does this memory write of the welcome page's switch make the served page public, and may this
 * writer do that alone? `value` is the whole record the write stores (a merge door passes the merged
 * value). Never touches storage beyond reading the owner's portfolio records.
 */
export async function portfolioMemoryWriteGate(
  ctx: PublishStoreCtx, writer: MemoryPublishWriter, key: string, value: unknown,
): Promise<PortfolioMemoryGate> {
  if (key !== PORTFOLIO_CONFIG_KEY) return { kind: 'go' };
  const config = asConfig(value);
  if (!config) return { kind: 'go' };
  // The cheap question first: with the gate off, or for a writer the gate allows, nothing is read.
  const ask = memoryWriterAsk(ctx, writer);
  if (ask.kind === 'allowed') return { kind: 'go' };

  const ownerName = localAccountName(ownerGhiiOf(writer.targetGaii));
  const order = await portfolioReadGaiis(ctx.storage, ownerName, ctx.config.nodeId);
  const now = new Map<string, Config | null>();
  for (const gaii of order) now.set(gaii, asConfig((await ctx.storage.getMemory(gaii, PORTFOLIO_CONFIG_KEY))?.value));
  const before = served(order, now);
  const after = served(order, new Map(now).set(writer.targetGaii, config));
  if (isPublic(before) || !isPublic(after)) return { kind: 'go' };
  if (ask.kind === 'refused') return ask;

  // Everything but the one change: a record that was already switched on keeps its switch and who
  // may open it; any other record is stored without the switch.
  const old = now.get(writer.targetGaii) ?? null;
  let kept: Config = { ...config };
  if (old?.enabled) {
    kept.enabled = old.enabled;
    if ('access' in old) kept.access = old.access; else delete kept.access;
  } else {
    delete kept.enabled;
  }
  if (isPublic(served(order, new Map(now).set(writer.targetGaii, kept)))) {
    kept = { ...config };
    delete kept.enabled;
  }
  // `from` is the switch as the owner's page and the applier read it once this write is stored
  // (portfolioSwitchState: the first identity holding a config), so the approval finds it unchanged.
  const stored = new Map(now).set(writer.targetGaii, kept);
  const firstPresent = order.map((g) => stored.get(g)).find((c) => !!c) ?? null;
  const from = firstPresent?.enabled === true ? true : firstPresent?.enabled === false ? false : null;
  const change: PortfolioChange = before
    ? { field: 'access', from: typeof before.access === 'string' ? before.access : null, to: 'anyone' }
    : { field: 'enabled', from, to: true };
  return { kind: 'ask', value: kept, ownerName, requester: ask.requester, change };
}
