/**
 * @file src/services/memory-write-asks.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The owner's one-press questions a generic memory write can raise beside the publish
 *   gate's own, asked in one place for every memory door (memory-write.ts for POST, PUT and
 *   aimeat_memory_write; routes/memory/patch.ts; the batch doors through routes/memory/batch-guards.ts),
 *   so a door cannot ask one and forget the other (secaudit2026oct26).
 *     - The welcome page's switch (services/portfolio-memory-gate.ts): a write that would make the
 *       served page public, by a caller the publish gate asks about.
 *     - A mail refinery's definition (services/refinery/definition-ask.ts): a change of where it reads
 *       and files mail, by an app or an agent that may not run it.
 *   Each stores everything but the change it asks about; the door files the questions after the write.
 * @structure MemoryWriteAsk · memoryWriteAsks · fileMemoryWriteAsks
 * @usage
 *   const asks = await memoryWriteAsks(ctx, writer, key, value);
 *   if ('refused' in asks) refuse(asks.refused); else { store asks.value; const filed = await fileMemoryWriteAsks(ctx, asks.asks); }
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import type { MemoryPublishWriter } from './memory-publish-gate.js';
import type { PublishStoreCtx } from './publish-requests/store.js';
import type { publishRequestedBody } from './publish-requests/ask.js';
import { portfolioMemoryWriteGate, type PortfolioMemoryGate } from './portfolio-memory-gate.js';
import { filePortfolioAsk } from './portfolio-publish-gate.js';
import { refineryDefinitionGate, fileRefineryDefinitionAsk, type RefineryDefinitionAsk } from './refinery/definition-ask.js';

export type MemoryWriteAsk =
  | { kind: 'portfolio'; ask: Extract<PortfolioMemoryGate, { kind: 'ask' }> }
  | { kind: 'refinery'; ask: RefineryDefinitionAsk };

/** The value to store and the questions to file after it, or the refusal a door answers with. */
export async function memoryWriteAsks(
  ctx: PublishStoreCtx, writer: MemoryPublishWriter, key: string, value: unknown,
): Promise<{ refused: { status: number; code: string; message: string } } | { value: unknown; asks: MemoryWriteAsk[] }> {
  const asks: MemoryWriteAsk[] = [];
  const portfolio = await portfolioMemoryWriteGate(ctx, writer, key, value);
  if (portfolio.kind === 'refused') return { refused: portfolio };
  if (portfolio.kind === 'ask') { asks.push({ kind: 'portfolio', ask: portfolio }); value = portfolio.value; }
  const refinery = await refineryDefinitionGate(ctx, writer, key, value);
  if (refinery) { asks.push({ kind: 'refinery', ask: refinery }); value = refinery.value; }
  return { value, asks };
}

/** File the questions a stored write raised. The first request is the door's answer; a failed one is a warning. */
export async function fileMemoryWriteAsks(ctx: PublishStoreCtx, asks: readonly MemoryWriteAsk[]): Promise<{
  publishRequest?: ReturnType<typeof publishRequestedBody>; warnings: Array<{ code: 'PUBLISH_NOT_ASKED'; message: string }>;
}> {
  let publishRequest: ReturnType<typeof publishRequestedBody> | undefined;
  const warnings: Array<{ code: 'PUBLISH_NOT_ASKED'; message: string }> = [];
  for (const a of asks) {
    const asked = a.kind === 'portfolio' ? await filePortfolioAsk(ctx, a.ask.ownerName, a.ask) : await fileRefineryDefinitionAsk(ctx, a.ask);
    if ('publishRequest' in asked) publishRequest ??= asked.publishRequest; else warnings.push(asked.warning);
  }
  return { ...(publishRequest ? { publishRequest } : {}), warnings };
}
