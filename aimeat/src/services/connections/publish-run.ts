/**
 * @file publish-run.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Publishing to the caller's OWN connection, end to end, in ONE place (TARGET-057).
 *
 *   WHY THIS FILE EXISTS. There are two ways a post leaves this node — a person presses send, and a
 *   schedule comes due — and they must be the same code. A scheduler with its own copy of "open the
 *   gate, refresh the credential, call the recipe, record the outcome" is a scheduler that will
 *   eventually skip the gate, and skipping the gate is how the same video is published twice. On a
 *   provider that charges per post that is also a second bill.
 *
 *   THE GATE IS NOT OPTIONAL AND IT IS NOT HERE AS A COURTESY. openOwnPublish() writes the attempt
 *   BEFORE anything leaves, keyed deterministically on publisher + connection + file + caption. That
 *   ordering is what makes a retry safe, and it is the reason the sweeper needs no lock of its own: a
 *   sweep that dies mid-send leaves its row pending, the next tick re-enters, and the gate answers
 *   `replay` with the first attempt's outcome instead of publishing again.
 *
 *   HELD AND QUEUED ARE OUTCOMES, NOT ERRORS. `held` is moderation and `queued` is a spent provider
 *   allowance. A caller that reports either as a failure teaches the next layer to retry, which makes
 *   both worse. They come back as ok:true with a status.
 * @structure PublishRunInput · PublishRunOutcome · runOwnPublish
 * @usage import { runOwnPublish } from './publish-run.js';
 * @version-history
 *   v1.1.0 — 2026-08-08 — A replay reports no `url` for an empty externalRef. LinkedIn answers a
 *     successful share without a URN header, so `''` reached callers and every truthiness check
 *     downstream drew it as a link to nothing.
 *   v1.0.0 — 2026-08-02 — LÄHETIN phase 2: extracted from the publish route so the scheduler can
 *     take the identical path rather than a second copy of it.
 */

import type { PublishAttempt } from '../../models/connection-schemas.js';
import { findProvider } from './providers.js';
import { openOwnPublish } from './publish-gate.js';
import { ensureFreshCredential } from './refresh.js';
import { publishToProvider } from './publish.js';
import type { ConnectContext } from './oauth.js';

export interface PublishRunInput {
  /** Resolved identity. Never a client-supplied id. */
  publisher: string;
  connectionId: string;
  /** A key in the publisher's OWN storage. Empty string when the post carries no file. */
  storageKey: string;
  caption: string;
  params: Record<string, unknown>;
}

export type PublishRunOutcome =
  | {
    ok: true;
    attempt: PublishAttempt;
    /** True when the gate recognised this exact work: nothing further was published. */
    replay: boolean;
    /** Where it landed, when it landed. Absent for held/queued/replay-of-unfinished. */
    url?: string;
  }
  | {
    ok: false;
    code: string;
    reason: string;
    /** 404 when the connection is not the caller's, 400 otherwise. The route maps it. */
    notFound: boolean;
    /** Set when an attempt WAS opened and then failed — so a caller can record which one. */
    attemptId?: string;
  };

/**
 * Run one publish to a connection the publisher owns.
 *
 * Ordering is the contract: the file is resolved BEFORE the gate opens an attempt, because a missing
 * file is the caller's mistake and should not leave a row in flight for something that was never
 * going to be uploaded.
 */
export async function runOwnPublish(
  ctx: ConnectContext, input: PublishRunInput,
): Promise<PublishRunOutcome> {
  const { storage } = ctx;

  let file: { bytes: Buffer; mimeType: string; name: string } | null = null;
  if (input.storageKey) {
    const stored = await storage.getStorageFile(input.publisher, input.storageKey);
    if (!stored) {
      return {
        ok: false, notFound: true, code: 'NO_SUCH_FILE',
        reason: `you have no stored file named '${input.storageKey}'`,
      };
    }
    file = {
      bytes: stored.data,
      mimeType: stored.mimeType,
      name: input.storageKey.split('/').pop() ?? input.storageKey,
    };
  }

  const conn = await storage.getConnection(input.connectionId);
  const provider0 = conn ? findProvider(ctx.providers, conn.provider) : undefined;
  const gate = await openOwnPublish(
    storage,
    {
      publisher: input.publisher,
      connectionId: input.connectionId,
      storageKey: input.storageKey,
      caption: input.caption,
      params: input.params,
    },
    { sharedDailyLimit: provider0?.sharedDailyLimit ?? null },
  );
  if (!gate.ok) {
    return { ok: false, notFound: gate.code === 'NOT_FOUND', code: gate.code, reason: gate.reason };
  }

  // A repeat of work already opened. The first attempt's outcome IS the answer; starting a second
  // publish here is the double post this whole mechanism exists to prevent.
  //
  // The caller must read `attempt.status`, never the absence of an error: a replay says "nothing was
  // published NOW", which is a different sentence from "it is out there". An empty externalRef is
  // reported as no url at all — LinkedIn answers a successful share without a URN header, so `''`
  // reaches here and `'' ?? undefined` stays `''`, which every truthiness check downstream reads as
  // a link and renders as nothing.
  if (gate.replay) {
    return { ok: true, replay: true, attempt: gate.attempt, url: gate.attempt.externalRef || undefined };
  }
  if (gate.attempt.status === 'held' || gate.attempt.status === 'queued') {
    return { ok: true, replay: false, attempt: gate.attempt };
  }

  const fresh = await ensureFreshCredential(ctx, gate.connection.id);
  if (!fresh.ok) {
    await storage.updatePublishAttempt(gate.attempt.id, { status: 'failed', error: fresh.reason });
    return { ok: false, notFound: false, code: fresh.code, reason: fresh.reason, attemptId: gate.attempt.id };
  }

  const provider = findProvider(ctx.providers, fresh.connection.provider);
  if (!provider) {
    const reason = 'that provider is no longer configured on this node';
    await storage.updatePublishAttempt(gate.attempt.id, { status: 'failed', error: reason });
    return { ok: false, notFound: false, code: 'PROVIDER_GONE', reason, attemptId: gate.attempt.id };
  }

  const outcome = await publishToProvider({
    provider,
    connection: fresh.connection,
    credential: fresh.credential,
    caption: input.caption,
    params: gate.params,
    file,
  });

  if (outcome.ok) {
    await storage.updatePublishAttempt(gate.attempt.id, { status: 'done', externalRef: outcome.externalRef });
    await storage.touchConnectionOk(gate.connection.id);
    const attempt = await storage.getPublishAttempt(gate.attempt.id);
    return { ok: true, replay: false, attempt: attempt ?? gate.attempt, url: outcome.externalRef };
  }

  // `rejected` never retries; `failed` may. The distinction is the provider's, not ours.
  await storage.updatePublishAttempt(gate.attempt.id, {
    status: outcome.permanent ? 'rejected' : 'failed',
    error: outcome.reason,
  });
  return {
    ok: false, notFound: false,
    code: outcome.permanent ? 'REJECTED' : 'PUBLISH_FAILED',
    reason: outcome.reason,
    attemptId: gate.attempt.id,
  };
}
