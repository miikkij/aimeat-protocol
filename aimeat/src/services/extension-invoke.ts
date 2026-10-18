/**
 * @file src/services/extension-invoke.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description One extension action call, the whole sequence, for every surface that runs one on a
 *   caller's behalf: POST /v1/ext/:extName/:actionId, POST /v1/ext/:extName/:instanceId/:actionId and
 *   the node MCP tool aimeat_extension_invoke.
 *
 *   The sequence: resolve the extension and an optional version pin (name@version), refuse an
 *   inactive extension, instance or unknown action, read the caller's standing in the app the
 *   extension gates, run the paywall, build the sandbox context, run the script, refund a payment the
 *   script did not deliver, record the call duration and the capability call count, accrue the
 *   provider's beneficiary designation, and turn a failure into one answer: a workspace refusal keeps
 *   the workspace service's status and code, a timeout and the API call limit have their own codes,
 *   and the script's own error text is redacted of credential-shaped text before any caller sees it.
 *
 *   The MCP tool composed this sequence itself until 2026-10-16 and missed five parts of it: the
 *   redaction, the duration and count, the version pin, the app membership and ctx.buy.
 *
 *   What stays with the surface: how a refusal is written (the paywall writes into the surface's
 *   responder, an HTTP response or a recorder), the request's pay token, internal pass and app-tool
 *   name, the caller's bearer (ctx.buy re-presents it to the node's own routes), and whether mail is
 *   available. The paywall function itself is passed in, so this service does not import the route
 *   module that holds it (dependency-cruiser services-do-not-import-routes).
 * @structure invokeExtensionAction · ExtensionInvokeCaller · ExtensionInvokeOutcome
 * @usage
 *   const out = await invokeExtensionAction({ config, storage, enforcePaywall, extRef, actionId, input, caller, paywall: { res } });
 *   if (out.kind === 'ok') ... else if (out.kind === 'refused') ... // 'paywall': the responder already holds the answer
 * @version-history
 *   v1.1.0 — 2026-10-18 — A visitor (caller kind `anonymous`) runs an action the manifest marks public,
 *     with no paywall, a read-only memory and none of the capabilities that act for a person;
 *     ctx.caller says `anonymous` and, for everyone, `adult` and `subscriptions` (Comicland v3 A-7, A-3, A-5).
 *   v1.0.0 — 2026-10-16 — Moved out of routes/extensions/actions.ts and mcp/extensions.ts (QA audit D2-05).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { ExtensionCtx } from './extension-runtime.js';
import type { EmailService } from './email.js';
import type { CallerKind } from './caller-context.js';
import type { PaywallResponder } from '../routes/extensions/metered-response.js';
import type { enforcePaywall as EnforcePaywall } from '../routes/extensions/paywall.js';
import { executeExtensionAction } from './extension-runtime.js';
import { emitChange } from './event-bus.js';
import { makeExtensionFiles } from './extension-files.js';
import { makeExtensionDataPackage } from './datapackage/ext-capability.js';
import { logger } from '../utils/logger.js';
import { redactCredentialText } from '../utils/redact-credentials.js';
import { getMember, accountOf } from './app-members.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { resolveGatedApp } from './members-only.js';
import { buildExtensionCtx, buildExtensionWallet, buildExtensionNotify, buildExtensionEmail, unavailableEmail, sandboxLimits } from './extension-ctx.js';
import { capabilitiesOfRecord } from './extension-capability-declaration.js';
import { attachExtensionWorkspace, workspaceRefusalFor, type ExtensionWorkspaceCapability } from './extension-workspace.js';
import { maybeExtensionAi, getActiveAiJobService } from './ai-jobs/index.js';
import { takeDesignations } from '../commerce/beneficiary-designation.js';
import { recordCallDuration } from './call-timing.js';
import { countCapabilityCall } from './capability-record.js';
import { getEncryptionKey } from './encryption.js';
import { getExtSecretKeys, getInstanceSecretKeys, decryptSecretFields } from './extension-secrets.js';
import { resolveExtensionForCall } from './component-versions.js';
import { readAdult, NOT_VERIFIED } from './adult-assurance.js';
import { activeSubscriptions } from '../commerce/subscriptions.js';

/** Who runs the action. Built by the surface from its own session, once. */
export interface ExtensionInvokeCaller {
  /** The resolved principal: whose namespace the call runs in and who pays. */
  gaii: string;
  /** Who acted, for the money path: a hosted app's GEAI where `gaii` is its owner (callerPrincipal). */
  metered: string;
  /** The bare account name the principal acts for. */
  owner: string;
  /** What kind of principal it is, from the caller object (services/caller-context.ts). */
  kind: CallerKind;
  roles: string[];
  /** What this credential may do, as the token granted it: the list requireScope reads. */
  scopes: string[];
  /** The hosted app grant behind the session, which needs an explicit permission to spend. */
  appGrantId?: string | null;
}

export type ExtensionInvokeOutcome =
  /** The call delivered. `result` has the provider's designation key removed. */
  | { kind: 'ok'; result: unknown; extName: string }
  /** Refused or failed before or during the run. `keepMessage`: the text is the extension author's
   *  answer and passes the 500 text filter (middleware/internal-error-text.ts). */
  | { kind: 'refused'; status: number; code: string; message: string; keepMessage?: boolean }
  /** The paywall refused and has written its answer into the surface's responder. */
  | { kind: 'paywall' };

/**
 * Whether a sandbox run ended by running out of time. QuickJS reports its interrupt as
 * `interrupted`; the older wording is kept so neither form falls through to EXTENSION_ERROR.
 */
function isSandboxTimeout(message: string): boolean {
  return message.includes('Script execution timed out') || /\binterrupted\b/.test(message);
}

/** Which producer a data package descriptor records for this caller; 'manual' is the word for a
 *  person doing it themselves. */
function producerKindOf(kind: CallerKind): 'app' | 'agent' | 'manual' {
  if (kind === 'app' || kind === 'ecosystem') return 'app';
  if (kind === 'agent') return 'agent';
  return 'manual';
}

/**
 * Run one extension action as `caller`. Never throws for a refusal or a script failure; an error the
 * sequence did not expect (a storage failure) propagates to the surface's own error handler.
 */
export async function invokeExtensionAction(args: {
  config: AimeatConfig;
  storage: Storage;
  /** routes/extensions/paywall.ts enforcePaywall, passed in by the surface. */
  enforcePaywall: typeof EnforcePaywall;
  /** `name` or `name@version`. */
  extRef: string;
  /** Run against this instance of the extension: its own config and namespace `ext:{name}.{id}`. */
  instanceId?: string;
  actionId: string;
  /** The HTTP method the request came with; an action declaring another method is refused. Omitted
   *  on a surface without methods (MCP), where every action is callable. */
  method?: string;
  input: Record<string, unknown>;
  caller: ExtensionInvokeCaller;
  paywall: { res: PaywallResponder; payToken?: string; internalPass?: string; namedAppTool?: string };
  /** The caller's bearer, which ctx.buy re-presents to the node's own routes. */
  bearer?: string;
  correlationId?: string | null;
  /** The mail service; without one ctx.email answers false and logs why. */
  emailService?: EmailService;
}): Promise<ExtensionInvokeOutcome> {
  const { config, storage, caller, instanceId, actionId } = args;
  const resolved = await resolveExtensionForCall(storage, args.extRef);
  const extName = resolved.name;
  // The caller's organism workspace, when the manifest declares it. Declared before the run so a
  // failure can tell a workspace refusal from a script error.
  let wsCap: Partial<ExtensionWorkspaceCapability> = {};
  const label = instanceId ? `${extName}/${instanceId}/${actionId}` : `${extName}/${actionId}`;

  if (!resolved.ok) {
    return { kind: 'refused', status: 404, code: 'NOT_FOUND', message: resolved.reason === 'version'
      ? `Version "${resolved.pinned}" of extension "${extName}" is not kept on this node`
      : `Extension "${extName}" not found` };
  }
  const ext = resolved.ext;
  if (ext.status !== 'active') {
    return { kind: 'refused', status: 503, code: 'EXTENSION_INACTIVE', message: `Extension "${extName}" is not active` };
  }
  // Nobody signed in: only an action the manifest marks public, priced at nothing, runs for them.
  const visitor = caller.kind === 'anonymous';
  if (visitor) {
    const target = ext.actions.find(a => a.id === actionId);
    if (!target?.public || (target.tollMorsels ?? 0) > 0 || target.commercial?.payMoney || target.commercial?.plans?.length) {
      return { kind: 'refused', status: 401, code: 'UNAUTHORIZED', message: 'Sign in to use this action.' };
    }
  }

  // The caller's standing in the app this extension gates, resolved BEFORE the sandbox. A gate needs
  // the role, but the roster is private and must stay that way, so the node reads it here rather
  // than opening a lookup the sandbox could call. An extension declares which app it gates with
  // `config: { app: owner/file.html }`; without that it gets null and keeps its own membership model.
  const gatedApp = visitor ? null : resolveGatedApp(ext);
  const callerAccount = accountOf(caller.gaii);
  const isAppOwner = !!gatedApp && callerAccount === (gatedApp.split('/')[0] ?? '').toLowerCase();
  const appMember = gatedApp && !isAppOwner ? await getMember(storage, gatedApp, callerAccount) : null;
  // Verified adult yes or no, for an extension that serves adult content (services/adult-assurance.ts):
  // the account holder's, whichever of their principals called; never anything about a visitor.
  const adult = visitor ? NOT_VERIFIED : await readAdult(storage, ownerGhiiOf(caller.gaii));
  // The caller's running subscriptions to this extension's plans (commerce/subscriptions.ts).
  const subscriptions = visitor ? [] : await activeSubscriptions(storage, ownerGhiiOf(caller.gaii), ext.name);

  let instanceConfig: Record<string, unknown> | undefined;
  if (instanceId) {
    const instance = await storage.getExtensionInstance(extName, instanceId);
    if (!instance) {
      return { kind: 'refused', status: 404, code: 'NOT_FOUND', message: `Instance "${instanceId}" not found for extension "${extName}"` };
    }
    if (instance.status !== 'active') {
      return { kind: 'refused', status: 503, code: 'INSTANCE_INACTIVE',
        message: `This copy of "${extName}" is switched off. Turn it on in Profile → Extensions and try again.` };
    }
    instanceConfig = instance.config;
  }

  const action = ext.actions.find(a => a.id === actionId);
  if (!action) {
    return { kind: 'refused', status: 404, code: 'NOT_FOUND', message: `Action "${actionId}" not found in extension "${extName}"` };
  }
  if (args.method && action.method !== 'POST' && action.method !== args.method) {
    return { kind: 'refused', status: 405, code: 'METHOD_NOT_ALLOWED', message: `Action "${actionId}" requires ${action.method}, got ${args.method}` };
  }

  // Per-call paywall: owner-free / anti-abuse toll / priced payment (routes/extensions/paywall.ts).
  // Cross-owner invocation is intended (an extension is a sellable capability), so the paywall is
  // what makes it safe: the owner and their own principals are free, everyone else pays or holds an
  // entitlement.
  // A visitor's action has no price and no toll (checked above and at install), so nothing is charged.
  const pay = visitor ? { ok: true as const } : await args.enforcePaywall({
    config, storage, ext, action, callerGaii: caller.metered, res: args.paywall.res,
    payToken: args.paywall.payToken, internalPass: args.paywall.internalPass, namedAppTool: args.paywall.namedAppTool,
    session: { roles: caller.roles, scopes: caller.scopes, appGrantId: caller.appGrantId ?? null },
  });
  if (!pay.ok) return { kind: 'paywall' };

  try {
    // Extension memory: `ext:{name}` (or `ext:{name}.{instanceId}`), no owner suffix, because apps
    // read it with getPublic('ext:{name}', key) without knowing the owner.
    const extMemoryOwner = instanceId ? `ext:${ext.name}.${instanceId}` : `ext:${ext.name}`;
    // The caller's organism workspace, as the caller, with the caller's own scopes deciding the
    // authority question the way requireScope would (services/extension-workspace.ts). Each consumer
    // gets its own copy of the lists, so nothing the script does to ctx.caller reaches them.
    if (!visitor) {
      wsCap = attachExtensionWorkspace({ config, storage, ext, actionId: action.id,
        caller: { gaii: caller.gaii, owner: caller.owner, roles: [...caller.roles], scopes: [...caller.scopes] } });
    }
    const callerView: ExtensionCtx['caller'] = {
      gaii: caller.gaii, owner: caller.owner, roles: [...caller.roles],
      // An extension action is one route for every action there will be, so a script that must
      // hold a scope word can only do it from here.
      scopes: [...caller.scopes],
      member: appMember,
      isAppOwner,
      anonymous: visitor,
      adult: { ...adult },
      subscriptions,
    };
    // A visitor's run reads the extension's memory and may fetch. Everything that acts for a person
    // (their wallet, files, data packages, workspace, notifications, mail, purchases, AI jobs billed
    // to the installer) is left out, and the memory refuses writes (Comicland v3 A-7).
    const ctx: ExtensionCtx = visitor ? buildExtensionCtx({
      config, storage, extMemoryOwner,
      extension: { name: ext.name, owner: ext.installedBy },
      capabilities: capabilitiesOfRecord(ext),
      caller: callerView,
      extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config), { extension: ext.name }),
      instance: instanceId ? {
        id: instanceId,
        config: decryptSecretFields(instanceConfig ?? {}, getInstanceSecretKeys(ext), getEncryptionKey(config), { extension: ext.name, instance: instanceId }),
      } : undefined,
      logPrefix: instanceId ? `[ext:${ext.name}:${instanceId}:visitor]` : `[ext:${ext.name}:visitor]`,
      visitor: true,
    }) : buildExtensionCtx({
      config, storage, extMemoryOwner,
      extension: { name: ext.name, owner: ext.installedBy },
      capabilities: capabilitiesOfRecord(ext),
      workspace: wsCap.workspace,
      caller: callerView,
      // Secret config fields are decrypted for the field they are bound to, just before the VM.
      extConfig: decryptSecretFields(ext.config, getExtSecretKeys(ext), getEncryptionKey(config), { extension: ext.name }),
      instance: instanceId ? {
        id: instanceId,
        config: decryptSecretFields(instanceConfig ?? {}, getInstanceSecretKeys(ext), getEncryptionKey(config), { extension: ext.name, instance: instanceId }),
      } : undefined,
      logPrefix: instanceId ? `[ext:${ext.name}:${instanceId}]` : `[ext:${ext.name}]`,
      wallet: buildExtensionWallet({ config, storage, callerGaii: caller.gaii, extName: ext.name, ...(instanceId ? { trackingScope: instanceId } : {}) }),
      files: makeExtensionFiles({ config, storage, callerGaii: caller.gaii, callerOwner: caller.owner, callerRoles: [...caller.roles], callerScopes: [...caller.scopes], extName: ext.name }),
      // Data packages land in the OWNER's namespace whichever principal called, so one package has
      // one permanent address; `producedBy` still records the exact principal.
      datapackage: makeExtensionDataPackage({
        config, storage,
        ownerGhii: ownerGhiiOf(caller.gaii),
        producedBy: { gaii: caller.gaii, kind: producerKindOf(caller.kind), ref: `${ext.name}/${action.id}` },
      }),
      // Background model calls are billed to the INSTALLER, read from the record, never the caller.
      ai: maybeExtensionAi({
        service: getActiveAiJobService(), extName: ext.name, extOwner: ext.installedBy,
        nodeId: config.nodeId, createdBy: caller.gaii,
      }),
      buy: async (appRef: string, tool: string, buyInput?: Record<string, unknown>) => {
        const { buyForExtension } = await import('./extension-purchase.js');
        return buyForExtension({
          config, storage, extName: ext.name, extOwner: ext.installedBy,
          appRef, tool, input: buyInput ?? {},
          jwt: args.bearer ?? '',
          correlationId: args.correlationId ?? null,
        });
      },
      notify: buildExtensionNotify({
        storage, config, extName: ext.name,
        recipientGaii: caller.gaii, recipientOwner: caller.owner,
      }),
      email: args.emailService
        ? buildExtensionEmail({ storage, config, extName: ext.name, extConfig: ext.config, ownerName: caller.owner, emailService: args.emailService })
        // No mail service on this call path. Refusing with a logged false is the behaviour every
        // extension was written against; an absent capability would be a TypeError in the guest.
        : unavailableEmail(ext.name, 'no mail service on this call path'),
    });

    const limits = sandboxLimits(ext.limits, config);
    let result: unknown;
    // Time the DELIVERY, not the gate: a provider can only commit to a service level from what was
    // actually measured (call-timing.ts).
    const startedAt = Date.now();
    try {
      result = await executeExtensionAction(action.scriptContent, ctx, args.input, limits);
    } catch (execErr) {
      if (pay.refund) await pay.refund();   // never keep payment for a call that did not deliver
      throw execErr;
    }
    recordCallDuration(storage, `${ext.installedBy}@${config.nodeId}`, ext.name, action.id, Date.now() - startedAt);
    // The capability registry's call count, when the node counts direct calls (off by default).
    if (config.capabilityCallCounting) void countCapabilityCall(storage, `ext:${ext.name}:${action.id}`, true, Date.now() - startedAt);

    // The call delivered, so whoever the provider owes a share of it is booked, out of the provider's
    // own cut. The designation key is stripped before the buyer sees it, EXCEPT on an internal hop,
    // where the upstream route holds the settlement and is the only one that can accrue it.
    const shared = pay.upstream ? { designations: [], result } : takeDesignations(result);
    if (pay.accrue) await pay.accrue(shared.designations);
    emitChange('extensions');
    return { kind: 'ok', result: shared.result, extName };
  } catch (err) {
    const message = (err as Error).message;
    logger.error(`Extension action failed: ${label}`, { error: message, caller: caller.gaii });
    // A workspace refusal the script let through is the SERVICE's answer and keeps its status and code.
    const wsRefusal = workspaceRefusalFor(err, wsCap);
    if (wsRefusal) return { kind: 'refused', status: wsRefusal.status, code: wsRefusal.code, message: `Action "${actionId}" refused: ${wsRefusal.message}` };
    if (isSandboxTimeout(message)) return { kind: 'refused', status: 500, code: 'EXTENSION_TIMEOUT', message: `Action "${actionId}" timed out`, keepMessage: true };
    if (message.includes('API call limit exceeded')) return { kind: 'refused', status: 500, code: 'API_LIMIT_EXCEEDED', message: `Action "${actionId}" exceeded API call limit` };
    // The script's own error is the extension author's answer to the caller, so it passes the 500
    // text filter; credential-shaped text is redacted first.
    return { kind: 'refused', status: 500, code: 'EXTENSION_ERROR', message: `Action "${actionId}" failed: ${redactCredentialText(message)}`, keepMessage: true };
  }
}
