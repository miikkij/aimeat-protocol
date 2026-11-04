/**
 * @file services/node-context.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's running services in one object: the scheduler, the mail service, the AI job
 *   service, the workflow engine and the connector tunnel manager. initializeServices
 *   (server-bootstrap/service-init.ts) fills it as it makes each service, at the same points where the
 *   five process-wide handles (`setActiveScheduler`, `setActiveEmailService`, `setActiveAiJobService`,
 *   `setActiveWorkflowEngine`, `setActiveConnectTunnelManager`) were set before, and the code that used
 *   their getters reads `nodeContext()` instead.
 *
 *   A field is null until its service is made, and stays null when the node does not make it: no mail
 *   service before boot, no tunnel manager when the tunnel is off, none of them in a unit test that
 *   did not provide one. A caller that skipped its step on null before skips it the same way now.
 *
 *   Each field is replaced on its own, never the whole object at once: a second initializeServices in
 *   the same process (the multi-node E2E suites) replaces what it makes and leaves the rest, as the
 *   five handles did, so a node that runs no tunnel keeps the manager the earlier node set.
 * @structure NodeContext · nodeContext() · provideNodeService(name, service)
 * @usage
 *   import { nodeContext } from './node-context.js';
 *   nodeContext().scheduler?.removeJob(id);
 * @version-history
 *   v1.0.0 — 2026-11-04 — Initial: the five service locators become fields of one context
 *     (codebase analysis 2026-11-03, item D-i).
 */
import type { Scheduler } from './scheduler.js';
import type { EmailService } from './email.js';
import type { AiJobService } from './ai-jobs/service.js';
import type { WorkflowEngine } from './workflow/engine.js';
import type { ConnectTunnelManager } from './connect-tunnel.js';

/** The node's running services. A field is null when the node has not made that service. */
export interface NodeContext {
  readonly scheduler: Scheduler | null;
  readonly email: EmailService | null;
  readonly aiJobs: AiJobService | null;
  readonly workflow: WorkflowEngine | null;
  readonly tunnel: ConnectTunnelManager | null;
}

// process-local: the services this process runs. Each process makes its own at boot; a second process
// has its own scheduler, mail transport, AI job queue, workflow engine and tunnel sockets.
let context: NodeContext = { scheduler: null, email: null, aiJobs: null, workflow: null, tunnel: null };

/** The node's running services. Read it at the moment of use; a field can be set after the caller loaded. */
export function nodeContext(): NodeContext {
  return context;
}

/** Sets one service and leaves the others as they are. null removes it. */
export function provideNodeService<K extends keyof NodeContext>(name: K, service: NodeContext[K]): void {
  context = { ...context, [name]: service };
}
