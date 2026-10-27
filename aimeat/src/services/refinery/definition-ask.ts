/**
 * @file src/services/refinery/definition-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a mail refinery reads mail and files it waits for the owner's one-press answer
 *   when an app or an agent that may not run the refinery changes it (secaudit2026oct26,
 *   refinery/pipeline:loadDefinition:definition-writer-not-bound).
 *
 *   WHY. A refinery definition is the owner's memory record `<prefix>.config` (pipeline.ts
 *   loadDefinition), and the owner's schedule runs it as the owner: it reads the mailbox the record
 *   names and files rows, with the mail's text when `keepText` says so, into the workspace the record
 *   names. Writing the record needs only memory:write (an app grant) or memory:write-as-owner (an
 *   agent), while running a batch needs the four run words (schedule-input.ts REFINERY_RUN_SCOPES).
 *   So a principal that could not read the owner's mail itself pointed the owner's next batch at
 *   another mailbox and into a workspace of its choosing.
 *
 *   WHAT IT DOES. A write into the owner's own namespace by an app grant or an agent that does not hold
 *   every run word, and that changes where the definition reads or files (DESTINATION_FIELDS), stores
 *   everything else at once and files a request of kind `refinery-definition` under the approval
 *   standard (services/approval-standard.ts): the owner gets a notice with Allow and Don't allow that
 *   names the mailbox and the workspace, the writer sees the request pending, and hears the answer
 *   either way. The applier (publish-requests/apply-refinery-definition.ts) writes the asked fields as
 *   the owner. The owner in person, the refinery app and agents holding the run words, and every
 *   change to the other fields write at once, as before. The batch itself is unchanged.
 * @structure DESTINATION_FIELDS · RefineryDefinitionAsk · refineryDefinitionGate · fileRefineryDefinitionAsk
 * @usage
 *   const gate = await refineryDefinitionGate(ctx, writer, key, value);
 *   if (gate) { store gate.value; then await fileRefineryDefinitionAsk(ctx, gate) }
 * @version-history
 *   2026-10-27 — Initial (secaudit2026oct26).
 */
import { isOwnerInPerson, localAccountName, ownerGhiiOf } from '../../utils/gaii.js';
import { scopeIsCovered } from '../../utils/scope-coverage.js';
import { callerFromAuth } from '../caller-context.js';
import { fileAsk, requesterOf, publishRequestedBody } from '../publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from '../publish-requests/store.js';
import type { MemoryPublishWriter } from '../memory-publish-gate.js';
import { REFINERY_PREFIX_RE, REFINERY_RUN_SCOPES } from './schedule-input.js';
import { logger } from '../../utils/logger.js';

/** The fields that decide which mail is read and where its rows, and its text, are filed. */
export const DESTINATION_FIELDS = ['connectionId', 'provider', 'organismId', 'workspaceId', 'spaces', 'keepText'] as const;

type Json = Record<string, unknown>;
const asJson = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : null);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export interface RefineryDefinitionAsk {
  key: string;
  prefix: string;
  ownerName: string;
  /** The record to store now: the write with the destination it had. */
  value: Json;
  /** The destination fields the writer asked for, which the approval writes. */
  asked: Json;
  requester: PublishRequester;
}

/**
 * Does this write change where the owner's refinery reads or files, by a writer that may not run it?
 * Null when the write goes ahead as it is. `value` is the whole record the write stores.
 */
export async function refineryDefinitionGate(
  ctx: PublishStoreCtx, writer: MemoryPublishWriter, key: string, value: unknown,
): Promise<RefineryDefinitionAsk | null> {
  const m = /^(.+)\.config$/.exec(key);
  if (!m || !REFINERY_PREFIX_RE.test(m[1])) return null;
  const next = asJson(value);
  if (!next) return null;
  // Only the owner's own namespace: an owner-run batch reads the definition there and nowhere else.
  if (writer.targetGaii !== ownerGhiiOf(writer.targetGaii) || writer.targetGaii.startsWith('eco:')) return null;
  if (isOwnerInPerson({ roles: writer.roles, federated: writer.federated })) return null;
  if (REFINERY_RUN_SCOPES.every((s) => scopeIsCovered([...writer.scopes], s))) return null;
  const old = asJson((await ctx.storage.getMemory(writer.targetGaii, key))?.value);
  // A record of the definition's shape, before or after: a `.config` of something else is not asked about.
  if (!('connectionId' in next) && !(old && 'connectionId' in old)) return null;
  const changed = DESTINATION_FIELDS.filter((f) => !same(old?.[f], next[f]));
  if (!changed.length) return null;

  const kept: Json = { ...next };
  const asked: Json = {};
  for (const f of DESTINATION_FIELDS) {
    if (f in next) asked[f] = next[f];
    if (old && f in old) kept[f] = old[f]; else delete kept[f];
  }
  const ownerName = localAccountName(ownerGhiiOf(writer.targetGaii));
  const caller = callerFromAuth({
    sub: writer.principal, owner: ownerName, roles: [...writer.roles], scopes: [...writer.scopes],
    ...(writer.federated !== undefined ? { federated: writer.federated } : {}),
  }, ctx.config.nodeId, ctx.storage);
  return { key, prefix: m[1], ownerName, value: kept, asked, requester: requesterOf(ctx, caller, writer.app) };
}

/** The mailbox and workspace a person reads in the question: the account's label and the organism's name. */
async function describe(ctx: PublishStoreCtx, asked: Json): Promise<{ mailbox: string; workspace: string }> {
  const conn = typeof asked.connectionId === 'string' ? await ctx.storage.getConnection(asked.connectionId) : null;
  const org = typeof asked.organismId === 'string' ? await ctx.storage.getOrganism(asked.organismId) : null;
  const ws = typeof asked.workspaceId === 'string' ? asked.workspaceId : '';
  return {
    mailbox: conn?.accountLabel || (typeof asked.connectionId === 'string' ? asked.connectionId : 'the one it had'),
    workspace: org ? `${org.name}${ws ? ` / ${ws}` : ''}` : (ws || 'the one it had'),
  };
}

/** File the owner's question, after the rest of the record was stored. Never throws. */
export async function fileRefineryDefinitionAsk(
  ctx: PublishStoreCtx, ask: RefineryDefinitionAsk,
): Promise<{ publishRequest: ReturnType<typeof publishRequestedBody> } | { warning: { code: 'PUBLISH_NOT_ASKED'; message: string } }> {
  try {
    const { mailbox, workspace } = await describe(ctx, ask.asked);
    const text = ask.asked.keepText === true;
    const filed = await fileAsk(ctx, ask.ownerName, ask.requester, {
      kind: 'refinery-definition',
      target: { key: ask.key, owner: ask.ownerName, fields: JSON.stringify(ask.asked) },
      title: `where the mail refinery ${ask.prefix} reads and files mail`,
      name: ask.prefix,
      change: { field: 'destination', from: null, to: { mailbox, workspace, keepText: text } },
      approval: {
        approver: 'owner',
        asks: `let the mail refinery ${ask.prefix} read the mailbox ${mailbox} and file it in ${workspace}${text ? ', keeping the full text of each message' : ''}`,
        why: 'The refinery reads your mail on your schedule and files it there. It was changed by an app or an agent that may not run the refinery itself, so you confirm it first; until then the refinery keeps the mailbox and the workspace it had.',
        // An agent of the owner approves only while it may run the refinery itself.
        approve_scope: 'connections:read-through',
        i18n: { key: text ? 'approval_refinery_definition_text' : 'approval_refinery_definition', vars: { refinery: ask.prefix, mailbox, workspace } },
      },
    });
    if (filed.ok) return { publishRequest: publishRequestedBody(ctx, filed) };
    return { warning: { code: 'PUBLISH_NOT_ASKED', message: `The rest was saved, and the refinery keeps where it reads and files mail: ${filed.message}` } };
  } catch (err) {
    logger.warn('refinery definition ask: the question could not be filed', { key: ask.key, error: String(err) });
    return { warning: { code: 'PUBLISH_NOT_ASKED', message: 'The rest was saved, and the refinery keeps where it reads and files mail. The owner could not be asked; try again in a moment.' } };
  }
}
