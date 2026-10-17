/**
 * @file src/services/publish-requests/upload-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The publish gate's caller at a presigned upload (PUT /v1/upload/:token), which carries
 *   neither roles nor scopes: only the principal the token was minted for (plan doc-mvcn6c7e4e5q, V4).
 *   An agent's GAII is asked about with the grant its own record holds now, as the upload door's
 *   operator answer is (routes/upload.ts): it holds publish:public only while its owner has ticked it.
 *   A bare account name is the owner in person, whom the gate never asks: no PublishGateInput.
 * @structure uploadPublishGate(storage, nodeId, sub)
 * @usage const gate = await uploadPublishGate(storage, config.nodeId, verified.sub);
 * @version-history
 *   v1.0.0 — 2026-10-18 — Initial: the skill ZIP and the cortex ZIP (plan doc-mvcn6c7e4e5q, V4).
 */
import type { Storage } from '../../storage/interface.js';
import { agentSessionCaller } from '../caller-context.js';
import { localAccountName } from '../../utils/gaii.js';
import type { PublishGateInput } from './door.js';

export async function uploadPublishGate(storage: Storage, nodeId: string, sub: string): Promise<PublishGateInput | undefined> {
  if (!sub.includes('#')) return undefined;
  // A deleted agent holds nothing, so it is asked about.
  const agent = await storage.getAgent(sub);
  return { caller: agentSessionCaller(sub, localAccountName(sub), agent?.defaultScopes ?? [], nodeId, storage) };
}
