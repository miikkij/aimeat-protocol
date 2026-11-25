/**
 * @file src/services/app/agent-face-write.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Writing an app's agent face from an AI's tool call: the action face_set of
 *   aimeat_app_manage. The face is one PUBLIC memory record, apps.<filename>.agentface
 *   (services/agent/face.ts), so this is the shared memory write (services/memory/write.ts) with the
 *   key, the level and the size fixed, and nothing of its own.
 *
 *   WHY AN ACTION. The face is one of the four things an app owes, and from an app's second version
 *   a publish without it is refused (owed-gate.ts). The appdev MCP surface, where an app is built,
 *   carried no tool that writes it: aimeat_memory_write is on the agent surface only, and the face
 *   was written by the app's own code (AIMEATAgentFace.publish) once a signed-in person opened the
 *   app. An instruction review on 2026-11-08 asked for every owed item on the surface where building
 *   starts. aimeat_app_manage is on that surface already, so this adds an action and no tool.
 *
 *   WHERE IT LANDS. In the caller's own namespace, as aimeat_memory_write without owner_scope: an
 *   agent's face is found by the owner-scope read the app's address and the publish answer use.
 * @structure AgentFaceWriteResult · writeAgentFace(deps, caller, ownerName, name, markdown, provenance)
 * @usage const out = await writeAgentFace({ storage, config }, { ...caller().principalView, targetGaii: gaii }, owner, name, markdown, { declared, declaredId });
 * @version-history
 *   v1.0.0 — 2026-11-25 — Initial (wish-agentti-saa-nykyiset-aimeat-ohjeet-ja-tekee-sovitun-ty-n-lop, item 4).
 */
import { agentFaceKey, AGENT_FACE_MAX_BYTES } from '../agent/face.js';
import { writeMemoryRecord } from '../memory/write.js';
import { resolveAppFilename } from './app-ref.js';
import type { MemoryWriteCaller, MemoryWriteFanout, MemoryWriteInput, MemoryWriteResult } from '../memory/write-types.js';

/** What the face write answers: the shared write's result with the file it was written for, or a refusal of the face itself. */
export type AgentFaceWriteResult = (MemoryWriteResult & { filename: string })
  | { ok: false; status: 400 | 404; code: 'INVALID_INPUT' | 'NOT_FOUND'; message: string };

/**
 * Write the face of one of `ownerName`'s apps, replacing the one there. `name` is the app's name or
 * its file name (services/app/app-ref.ts). Refuses an unknown app and an empty or oversized face
 * before anything is written.
 */
export async function writeAgentFace(
  deps: MemoryWriteFanout,
  caller: MemoryWriteCaller,
  ownerName: string,
  name: string,
  markdown: unknown,
  provenance: { declared?: MemoryWriteInput['declaredProvenance']; declaredId?: string },
): Promise<AgentFaceWriteResult> {
  const filename = await resolveAppFilename(deps.storage, { ownerName }, name);
  if (!(await deps.storage.getAppByOwnerName(ownerName, filename))) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: `You have no app "${name}". Publish it first; the face describes a published app.` };
  }
  if (typeof markdown !== 'string' || !markdown.trim()) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: 'markdown is required: the whole agent face as one markdown document.' };
  }
  const bytes = Buffer.byteLength(markdown, 'utf8');
  if (bytes > AGENT_FACE_MAX_BYTES) {
    return { ok: false, status: 400, code: 'INVALID_INPUT', message: `The agent face is ${bytes} bytes; at most ${AGENT_FACE_MAX_BYTES} are served. Say what the app does and leave its records out.` };
  }
  const written = await writeMemoryRecord(deps, caller, {
    // A public record asks the node's publish gate, as every public write does.
    gatePublic: true,
    key: agentFaceKey(filename),
    value: markdown,
    visibility: 'public',
    ttlHours: null,
    declaredProvenanceId: provenance.declaredId,
    declaredProvenance: provenance.declared,
    pipeline: 'mcp.app_manage.face_set',
  });
  return { ...written, filename };
}
