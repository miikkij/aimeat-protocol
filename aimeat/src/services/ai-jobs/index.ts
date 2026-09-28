/**
 * @file src/services/ai-jobs/index.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One import for the AI-jobs service: a background model call with a handle.
 * @structure re-exports of types.ts, service.ts and the extension capability builder
 * @usage import { AiJobService, AiJobError, getActiveAiJobService } from '../services/ai-jobs/index.js';
 * @version-history
 *   v1.1.0 — 2026-09-28 — System 2 plan, V5: re-exports the op rule (op.ts) and the AiJobOp type.
 *   v1.0.0 — 2026-08-31 — Initial.
 */
export {
    AiJobError,
    type AiJobOp, type AiJobState, type AiJobRecord, type AiJobLogEntry, type AiJobChainStop, type AiJobOnDone,
    type StartAiJobInput, type StartAiJobContext, type StartAiJobResult, type AiJobStarter,
} from './types.js';
export { AiJobService, setActiveAiJobService, getActiveAiJobService } from './service.js';
export { buildExtensionAi, maybeExtensionAi, type ExtensionAiDeps } from './ext-capability.js';
export { AI_JOB_KEY_PREFIX, AI_JOB_LOG_PREFIX } from './store.js';
export { AI_OPS, aiOpOf, aiOpRefusal } from './op.js';
