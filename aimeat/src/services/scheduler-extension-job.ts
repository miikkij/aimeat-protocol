/**
 * @file src/services/scheduler-extension-job.ts
 * @description Scheduled `extension` job executor: resolves the extension and action, gets its
 *   sandbox context from services/extension-ctx.ts, and runs the action with memory-access tracking.
 *   Extracted from scheduler.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from scheduler.ts (max-file-lines)
 *   v1.1.0 — 2026-08-10 — Context comes from buildExtensionCtx instead of 174 hand-written lines.
 *                         Fixes what the copy had been missing: memory writes now go through the
 *                         size and key-count limits, and outbound calls through safeFetch.
 */
import type { AimeatConfig } from '../config.js';
import type { Storage, ScheduledJobRecord } from '../storage/interface.js';
import { executeExtensionAction, trackMemoryAccess } from './extension-runtime.js';
import type { ExtensionCtx } from './extension-runtime.js';
import { buildExtensionCtx, buildExtensionNotify, buildExtensionEmail } from './extension-ctx.js';
import { getEncryptionKey } from './encryption.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields } from './extension-secrets.js';
import type { EmailService } from './email.js';

/**
 * Execute a scheduled `extension` job: resolve the extension + action, build the sandbox context
 * (scheduler runs as a system caller), decrypt secret config (incl. an instance-scoped job's
 * bring-your-own-key config), run the action, and return the tracked memory reads/writes.
 */
export async function runExtensionJob(
  storage: Storage,
  config: AimeatConfig,
  emailService: EmailService | undefined,
  job: ScheduledJobRecord,
): Promise<{ reads: string[]; writes: string[] }> {
  if (!job.extensionName || !job.actionId) {
    throw new Error(`Extension job "${job.id}" missing extensionName or actionId`);
  }

  const ext = await storage.getExtension(job.extensionName);
  if (!ext) {
    throw new Error(`Extension "${job.extensionName}" not found`);
  }
  if (ext.status !== 'active') {
    throw new Error(`Extension "${job.extensionName}" is not active`);
  }

  const action = ext.actions.find(a => a.id === job.actionId);
  if (!action) {
    throw new Error(`Action "${job.actionId}" not found in extension "${job.extensionName}"`);
  }

  // Build the extension context — scheduler runs as a system caller
  const extMemoryOwner = job.instanceId
    ? `ext:${ext.name}.${job.instanceId}`
    : `ext:${ext.name}`;

  // For an instance-scoped job, load the instance and decrypt its secret config so a scheduled
  // sync gets the same bring-your-own-key config a live instance action would. `type: 'secret'`
  // fields are decrypted just before the VM (see services/extension-secrets.ts).
  const encKey = getEncryptionKey(config);
  let instanceCtx: { id: string; config: Record<string, unknown> } | undefined;
  if (job.instanceId) {
    const inst = await storage.getExtensionInstance(ext.name, job.instanceId);
    instanceCtx = {
      id: job.instanceId,
      config: inst
        ? decryptSecretFields(inst.config, getInstanceSecretKeys(ext), encKey)
        : (job.input ?? {}),
    };
  }

  // One builder, so this road cannot be the one that forgets a guard again. It was: until
  // 2026-08-10 the scheduled path wrote memory without the size and key-count limits, and fetched
  // with a bare fetch rather than safeFetch, so an extension running on a clock had neither the
  // storage ceiling nor the SSRF check that the same extension had when a person invoked it.
  const baseCtx: ExtensionCtx = buildExtensionCtx({
    config,
    storage,
    extMemoryOwner,
    // Scheduled runs have no human present. The installer is the responsible party, and the
    // 'operator' role is what the sandbox reads to decide it is a system run.
    caller: {
      gaii: `scheduler@${config.nodeId}`,
      owner: ext.installedBy,
      roles: ['operator'],
    },
    extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), encKey),
    instance: instanceCtx,
    logPrefix: `[ext:${ext.name}:scheduler]`,
    // No wallet: nobody's balance is available to spend on a schedule.
    notify: buildExtensionNotify({
      storage, config, extName: ext.name,
      recipientGaii: ext.installedBy, recipientOwner: ext.installedBy,
    }),
    email: buildExtensionEmail({
      storage, config, extName: ext.name, extConfig: ext.config,
      ownerName: ext.installedBy, emailService,
    }),
  });

  // Wrap with memory access tracking
  const { ctx, accessLog } = trackMemoryAccess(baseCtx);

  // Validate input is a plain object — reject non-serializable values
  const rawInput = job.input ?? {};
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(JSON.stringify(rawInput)) as Record<string, unknown>;
  } catch {
    throw new Error(`Scheduled job "${job.id}" has non-serializable input`);
  }
  await executeExtensionAction(action.scriptContent, ctx, input, ext.limits);

  return { reads: accessLog.reads, writes: accessLog.writes };
}
