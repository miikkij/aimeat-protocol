/**
 * @file src/routes/extensions/actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension action execution routes — instance-scoped (/v1/ext/:extName/:instanceId/:actionId)
 *   and default (/v1/ext/:extName/:actionId). Each builds the sandbox ExtensionCtx (memory/fetch/wallet/
 *   consent/trust/notify/email) and runs the action script. Extracted from src/routes/extensions.ts to
 *   satisfy max-file-lines.
 * @version-history
 *   v1.7.0 — 2026-08-10 — Both handlers resolve the gated app through resolveGatedApp instead of
 *     reading config.app directly.
 *   v1.6.0 — 2026-08-10 — Both handlers take their sandbox context from buildExtensionCtx instead
 *                         of assembling ~210 lines apiece. No behaviour change on this road; the
 *                         point is that the other three roads now get the same guards.
 *     refund-on-throw wrap (priced raw calls; design notes doc-r6tyr3o)
 *   v1.5.0 — 2026-07-30 — Accrue the provider's beneficiary shares after a delivered call, and strip
 *     the capability's `_revenue` designation key from what the buyer is shown.
 *   v1.4.0 — 2026-07-27 — Forward `x-aimeat-app-tool` to the paywall, so a caller holding contracts for
 *     several products sold on one action can name which one they mean.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/extensions.ts (max-file-lines)
 *   v1.1.0 — 2026-07-16 — ctx.memory.getPublic owner-agent fallback batches into one listMemoryForOwners
 *   v1.2.0 — 2026-07-17 — Per-call paywall (enforcePaywall) before execute in both handlers +
 */
import { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { executeExtensionAction, EXT_HASH_REFERENCE_JS } from '../../services/extension-runtime.js';
import type { ExtensionCtx } from '../../services/extension-runtime.js';

/** The published hash, evaluated here so the served example is produced BY the served source. */
const aimeatHashRef: (s: string) => string =
  new Function(`${EXT_HASH_REFERENCE_JS}; return aimeatHash;`)() as (s: string) => string;
import { makeExtensionFiles } from '../../services/extension-files.js';
import { makeExtensionDataPackage } from '../../services/datapackage/ext-capability.js';
import { logger } from '../../utils/logger.js';
import { getMember, accountOf } from '../../services/app-members.js';
import { resolveIdentity, callerPrincipal, ownerGhiiOf } from '../../utils/gaii.js';

/** Which producer a descriptor records for this session. The roles say what kind of principal it is;
 *  'manual' is the honest word for a person doing it themselves. */
function producerKindOf(roles: string[]): 'app' | 'agent' | 'manual' {
  if (roles.includes('app') || roles.includes('eco')) return 'app';
  if (roles.includes('agent')) return 'agent';
  return 'manual';
}
import { INTERNAL_PASS_HEADER } from './internal-pass.js';
import { enforcePaywall, APP_TOOL_HEADER } from './paywall.js';
import { resolveGatedApp } from './permissions.js';
import { buildExtensionCtx, buildExtensionWallet, buildExtensionNotify, buildExtensionEmail, sandboxLimits } from '../../services/extension-ctx.js';
import { takeDesignations } from '../../commerce/beneficiary-designation.js';
import { recordCallDuration } from '../../services/call-timing.js';
import { getEncryptionKey } from '../../services/encryption.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields } from '../../services/extension-secrets.js';
import type { EmailService } from '../../services/email.js';

export function registerExtensionActionRoutes(router: Router, config: AimeatConfig, storage: Storage, emailService?: EmailService): void {
  // ── GET /v1/ext-hash — the node's published ctx.hash, as source ──
  // An extension and a browser app (or an agent computing a commitment before it calls one) must
  // agree on the same hash byte for byte. That agreement used to depend on copying the function
  // out of a doc; a commitment hashed by a different function is silently wrong at reveal time,
  // which is exactly where it is most expensive. So the node serves the reference itself.
  router.get('/v1/ext-hash', (_req, res) => {
    res.json(success(config.nodeId, {
      name: 'aimeatHash',
      algorithm: 'FNV-1a 64-bit (two 32-bit lanes, hex-concatenated) — 16 lowercase hex chars',
      source: EXT_HASH_REFERENCE_JS,
      note: 'This is byte-for-byte the ctx.hash an extension runs in the sandbox. Use it whenever a '
        + 'value hashed outside the sandbox has to match one hashed inside it (sealed-bid commitments, '
        + 'idempotency keys, content fingerprints).',
      examples: [{ input: 'abc', output: aimeatHashRef('abc') }],
    }));
  });

  // ── POST /v1/ext/:extName/:instanceId/:actionId — Instance-scoped action execution ──
  router.post('/v1/ext/:extName/:instanceId/:actionId', requireAuth(), async (req, res) => {
    const extName = req.params.extName as string;
    const instanceId = req.params.instanceId as string;
    const actionId = req.params.actionId as string;
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    // Who PAYS and whose namespace this runs in is `callerGaii`; who ACTED may be a hosted app, and
    // the money path is where that distinction has to survive or nobody can be told an app spent.
    const meteredCaller = callerPrincipal(req.auth!, config.nodeId);

    try {
      // Look up the extension
      const ext = await storage.getExtension(extName);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${extName}" not found`));
        return;
      }

      // Extension must be active
      if (ext.status !== 'active') {
        res.status(503).json(error(config.nodeId, 'EXTENSION_INACTIVE',
          `Extension "${extName}" is not active`));
        return;
      }

      // The caller's standing in the app this extension gates, resolved BEFORE the sandbox. A gate
      // needs the role, but the roster is private and must stay that way, so the node reads it here
      // rather than opening a lookup the sandbox could call. An extension declares which app it
      // gates with `config: { app: owner/file.html }`; without that it gets null and keeps whatever
      // membership model it already had.
      const gatedApp = resolveGatedApp(ext);
      const callerAccount = accountOf(callerGaii);
      const isAppOwner = !!gatedApp && callerAccount === (gatedApp.split('/')[0] ?? '').toLowerCase();
      const appMember = gatedApp && !isAppOwner ? await getMember(storage, gatedApp, callerAccount) : null;

      // Look up the instance
      const instance = await storage.getExtensionInstance(extName, instanceId);
      if (!instance) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Instance "${instanceId}" not found for extension "${extName}"`));
        return;
      }

      // Instance must be active
      if (instance.status !== 'active') {
        res.status(503).json(error(config.nodeId, 'INSTANCE_INACTIVE',
          `This copy of "${extName}" is switched off. Turn it on in Profile → Extensions and try again.`));
        return;
      }

      // Find the action
      const action = ext.actions.find(a => a.id === actionId);
      if (!action) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Action "${actionId}" not found in extension "${extName}"`));
        return;
      }

      // Validate HTTP method matches
      if (action.method !== 'POST' && action.method !== req.method) {
        res.status(405).json(error(config.nodeId, 'METHOD_NOT_ALLOWED',
          `Action "${actionId}" requires ${action.method}, got ${req.method}`));
        return;
      }

      // Per-call paywall: owner-free / anti-abuse toll / priced payment (design: paywall.ts).
      const pay = await enforcePaywall({ config, storage, ext, action, callerGaii: meteredCaller, res, payToken: req.header('x-aimeat-pay-token') ?? undefined,
        internalPass: req.header(INTERNAL_PASS_HEADER) ?? undefined,
        namedAppTool: req.header(APP_TOOL_HEADER) ?? undefined,
        session: { roles: req.auth!.roles, scopes: req.auth!.scopes, appGrantId: req.auth!.app_grant ?? null } });
      if (!pay.ok) return;

      // Build the ExtensionCtx with instance-scoped memory namespace
      // Extension namespace is always ext:{name}.{instanceId} — no owner scoping,
      // because ext:{name} is already unique and owner-scoping breaks client reads
      // (apps call getPublic('ext:{name}', key) without knowing the owner suffix).
      const extMemoryOwner = `ext:${ext.name}.${instanceId}`;
      const ctx: ExtensionCtx = buildExtensionCtx({
        config, storage, extMemoryOwner,
        extension: { name: ext.name, owner: ext.installedBy },
        caller: {
          gaii: callerGaii, owner: req.auth!.owner as string, roles: req.auth!.roles,
          // The caller's standing in the app this extension gates, resolved BEFORE the sandbox and
          // handed in. A gate needs the role, but the roster is private and must stay that way, so
          // the node reads it here rather than opening a lookup the sandbox could call. An
          // extension declares which app it gates with `config: { app: owner/file.html }`; without
          // that it gets null and keeps whatever membership model it already had.
          member: appMember,
          isAppOwner,
        },
        // Decrypt `type: 'secret'` config fields just before handing them to the sandbox VM.
        extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config)),
        instance: { id: instanceId, config: decryptSecretFields(instance.config, getInstanceSecretKeys(ext), getEncryptionKey(config)) },
        logPrefix: `[ext:${ext.name}:${instanceId}]`,
        wallet: buildExtensionWallet({ config, storage, callerGaii, extName: ext.name, trackingScope: instanceId }),
        files: makeExtensionFiles({ config, storage, callerGaii, callerOwner: req.auth!.owner as string, extName: ext.name }),
        // Data packages land in the OWNER's namespace whichever principal called: the same package
        // produced from the app, by an agent, on a clock or by a workflow step has to sit at ONE
        // permanent address. `producedBy` still records the exact principal, because who owns it and
        // who made it are different questions.
        datapackage: makeExtensionDataPackage({
          config, storage,
          ownerGhii: ownerGhiiOf(callerGaii),
          producedBy: { gaii: callerGaii, kind: producerKindOf(req.auth!.roles), ref: `${ext.name}/${action.id}` },
        }),
        buy: async (appRef: string, tool: string, buyInput?: Record<string, unknown>) => {
          const { buyForExtension } = await import('../../services/extension-purchase.js');
          return buyForExtension({
            config, storage, extName: ext.name, extOwner: ext.installedBy,
            appRef, tool, input: buyInput ?? {},
            jwt: (req.headers.authorization || '').replace('Bearer ', ''),
            correlationId: req.header('x-aimeat-correlation') ?? null,
          });
        },
        notify: buildExtensionNotify({
          storage, config, extName: ext.name,
          recipientGaii: callerGaii, recipientOwner: req.auth!.owner as string,
        }),
        email: buildExtensionEmail({
          storage, config, extName: ext.name, extConfig: ext.config,
          ownerName: req.auth!.owner as string, emailService,
        }),
      });

      // Execute the action in the sandbox. services/extension-ctx.ts owns the arithmetic.
      const limits = sandboxLimits(ext.limits, config);
      let result;
      // Time the DELIVERY, not the gate: what a buyer experiences is how long the answer takes, and a
      // provider can only commit to a service level from what was actually measured (call-timing.ts).
      const startedAt = Date.now();
      try {
        result = await executeExtensionAction(action.scriptContent, ctx, req.body as Record<string, unknown>, limits);
      } catch (execErr) {
        if (pay.refund) await pay.refund();   // never keep payment for a call that didn't deliver
        throw execErr;
      }
      recordCallDuration(storage, `${ext.installedBy}@${config.nodeId}`, ext.name, action.id, Date.now() - startedAt);

      // The call delivered, so whoever the provider owes a share of it is booked — out of the
      // provider's own cut, never the consumer's charge. The designation key is the capability's own
      // output and is stripped before the buyer sees it (commerce/beneficiary-designation.ts).
      // EXCEPT on an internal hop, where an upstream door already settled and is invoking through
      // this one. There the designation belongs to THAT door: the node is the only thing reading
      // this response, and stripping it here left the outer door with nothing to accrue while its
      // buyer had already paid — every app-tool sale settled and shared with nobody.
      const shared = pay.upstream ? { designations: [], result } : takeDesignations(result);
      if (pay.accrue) await pay.accrue(shared.designations);

      res.json(success(config.nodeId, shared.result, [
        { description: 'View extension', method: 'GET', url: `/v1/extensions/${extName}` },
      ]));
      emitChange('extensions');
    } catch (err) {
      const message = (err as Error).message;
      logger.error(`Extension action failed: ${extName}/${instanceId}/${actionId}`, { error: message, caller: callerGaii });

      if (message.includes('Script execution timed out')) {
        res.status(500).json(error(config.nodeId, 'EXTENSION_TIMEOUT',
          `Action "${actionId}" timed out`));
      } else if (message.includes('API call limit exceeded')) {
        res.status(500).json(error(config.nodeId, 'API_LIMIT_EXCEEDED',
          `Action "${actionId}" exceeded API call limit`));
      } else {
        res.status(500).json(error(config.nodeId, 'EXTENSION_ERROR',
          `Action "${actionId}" failed: ${message}`));
      }
    }
  });

  // ── POST /v1/ext/:extName/:actionId — Dynamic action execution ──
  router.post('/v1/ext/:extName/:actionId', requireAuth(), async (req, res) => {
    const extName = req.params.extName as string;
    const actionId = req.params.actionId as string;
    const callerGaii = resolveIdentity(req.auth!, config.nodeId);
    // Who PAYS and whose namespace this runs in is `callerGaii`; who ACTED may be a hosted app, and
    // the money path is where that distinction has to survive or nobody can be told an app spent.
    const meteredCaller = callerPrincipal(req.auth!, config.nodeId);

    try {
      // Look up the extension
      const ext = await storage.getExtension(extName);
      if (!ext) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND', `Extension "${extName}" not found`));
        return;
      }

      // Extension must be active
      if (ext.status !== 'active') {
        res.status(503).json(error(config.nodeId, 'EXTENSION_INACTIVE',
          `Extension "${extName}" is not active`));
        return;
      }

      // The caller's standing in the app this extension gates, resolved BEFORE the sandbox. A gate
      // needs the role, but the roster is private and must stay that way, so the node reads it here
      // rather than opening a lookup the sandbox could call. An extension declares which app it
      // gates with `config: { app: owner/file.html }`; without that it gets null and keeps whatever
      // membership model it already had.
      const gatedApp = resolveGatedApp(ext);
      const callerAccount = accountOf(callerGaii);
      const isAppOwner = !!gatedApp && callerAccount === (gatedApp.split('/')[0] ?? '').toLowerCase();
      const appMember = gatedApp && !isAppOwner ? await getMember(storage, gatedApp, callerAccount) : null;

      // Find the action
      const action = ext.actions.find(a => a.id === actionId);
      if (!action) {
        res.status(404).json(error(config.nodeId, 'NOT_FOUND',
          `Action "${actionId}" not found in extension "${extName}"`));
        return;
      }

      // Validate HTTP method matches
      if (action.method !== 'POST' && action.method !== req.method) {
        res.status(405).json(error(config.nodeId, 'METHOD_NOT_ALLOWED',
          `Action "${actionId}" requires ${action.method}, got ${req.method}`));
        return;
      }

      // Per-call paywall: owner-free / anti-abuse toll / priced payment (design: paywall.ts).
      const pay = await enforcePaywall({ config, storage, ext, action, callerGaii: meteredCaller, res, payToken: req.header('x-aimeat-pay-token') ?? undefined,
        internalPass: req.header(INTERNAL_PASS_HEADER) ?? undefined,
        namedAppTool: req.header(APP_TOOL_HEADER) ?? undefined,
        session: { roles: req.auth!.roles, scopes: req.auth!.scopes, appGrantId: req.auth!.app_grant ?? null } });
      if (!pay.ok) return;

      // Build the ExtensionCtx
      // Extension memory uses a flat namespace (ext:{name}) so apps can
      // read data via getPublic('ext:{name}', key) without knowing the owner.
      const extMemoryOwner = `ext:${ext.name}`;
      const ctx: ExtensionCtx = buildExtensionCtx({
        config, storage, extMemoryOwner,
        extension: { name: ext.name, owner: ext.installedBy },
        caller: {
          gaii: callerGaii, owner: req.auth!.owner as string, roles: req.auth!.roles,
          // The caller's standing in the app this extension gates, resolved BEFORE the sandbox and
          // handed in. A gate needs the role, but the roster is private and must stay that way, so
          // the node reads it here rather than opening a lookup the sandbox could call. An
          // extension declares which app it gates with `config: { app: owner/file.html }`; without
          // that it gets null and keeps whatever membership model it already had.
          member: appMember,
          isAppOwner,
        },
        // Decrypt `type: 'secret'` config fields just before handing them to the sandbox VM.
        extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config)),
        logPrefix: `[ext:${ext.name}]`,
        wallet: buildExtensionWallet({ config, storage, callerGaii, extName: ext.name }),
        files: makeExtensionFiles({ config, storage, callerGaii, callerOwner: req.auth!.owner as string, extName: ext.name }),
        // Data packages land in the OWNER's namespace whichever principal called: the same package
        // produced from the app, by an agent, on a clock or by a workflow step has to sit at ONE
        // permanent address. `producedBy` still records the exact principal, because who owns it and
        // who made it are different questions.
        datapackage: makeExtensionDataPackage({
          config, storage,
          ownerGhii: ownerGhiiOf(callerGaii),
          producedBy: { gaii: callerGaii, kind: producerKindOf(req.auth!.roles), ref: `${ext.name}/${action.id}` },
        }),
        buy: async (appRef: string, tool: string, buyInput?: Record<string, unknown>) => {
          const { buyForExtension } = await import('../../services/extension-purchase.js');
          return buyForExtension({
            config, storage, extName: ext.name, extOwner: ext.installedBy,
            appRef, tool, input: buyInput ?? {},
            jwt: (req.headers.authorization || '').replace('Bearer ', ''),
            correlationId: req.header('x-aimeat-correlation') ?? null,
          });
        },
        notify: buildExtensionNotify({
          storage, config, extName: ext.name,
          recipientGaii: callerGaii, recipientOwner: req.auth!.owner as string,
        }),
        email: buildExtensionEmail({
          storage, config, extName: ext.name, extConfig: ext.config,
          ownerName: req.auth!.owner as string, emailService,
        }),
      });

      // Execute the action in the sandbox. services/extension-ctx.ts owns the arithmetic.
      const limits = sandboxLimits(ext.limits, config);
      let result;
      // Time the DELIVERY, not the gate: what a buyer experiences is how long the answer takes, and a
      // provider can only commit to a service level from what was actually measured (call-timing.ts).
      const startedAt = Date.now();
      try {
        result = await executeExtensionAction(action.scriptContent, ctx, req.body as Record<string, unknown>, limits);
      } catch (execErr) {
        if (pay.refund) await pay.refund();   // never keep payment for a call that didn't deliver
        throw execErr;
      }
      recordCallDuration(storage, `${ext.installedBy}@${config.nodeId}`, ext.name, action.id, Date.now() - startedAt);

      // The call delivered, so whoever the provider owes a share of it is booked — out of the
      // provider's own cut, never the consumer's charge. The designation key is the capability's own
      // output and is stripped before the buyer sees it (commerce/beneficiary-designation.ts).
      // EXCEPT on an internal hop, where an upstream door already settled and is invoking through
      // this one. There the designation belongs to THAT door: the node is the only thing reading
      // this response, and stripping it here left the outer door with nothing to accrue while its
      // buyer had already paid — every app-tool sale settled and shared with nobody.
      const shared = pay.upstream ? { designations: [], result } : takeDesignations(result);
      if (pay.accrue) await pay.accrue(shared.designations);

      res.json(success(config.nodeId, shared.result, [
        { description: 'View extension', method: 'GET', url: `/v1/extensions/${extName}` },
      ]));
      emitChange('extensions');
    } catch (err) {
      const message = (err as Error).message;
      logger.error(`Extension action failed: ${extName}/${actionId}`, { error: message, caller: callerGaii });

      if (message.includes('Script execution timed out')) {
        res.status(500).json(error(config.nodeId, 'EXTENSION_TIMEOUT',
          `Action "${actionId}" timed out`));
      } else if (message.includes('API call limit exceeded')) {
        res.status(500).json(error(config.nodeId, 'API_LIMIT_EXCEEDED',
          `Action "${actionId}" exceeded API call limit`));
      } else {
        res.status(500).json(error(config.nodeId, 'EXTENSION_ERROR',
          `Action "${actionId}" failed: ${message}`));
      }
    }
  });
}
