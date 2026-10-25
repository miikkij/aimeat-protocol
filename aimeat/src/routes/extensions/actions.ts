/**
 * @file src/routes/extensions/actions.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Extension action execution routes — instance-scoped (/v1/ext/:extName/:instanceId/:actionId)
 *   and default (/v1/ext/:extName/:actionId). Both run services/extension-invoke.ts, the sequence the
 *   node MCP tool aimeat_extension_invoke runs too, and render its answer as HTTP. Extracted from
 *   src/routes/extensions.ts to satisfy max-file-lines.
 * @version-history
 *   2026-10-25 — Names live in the owner's namespace (services/component-address.ts): `:extName` may be
 *     an encoded `<owner>/<name>`; the three-segment path is the instance form or the literal
 *     `<owner>/<name>/<action>`, read so a
 *     bare name never reaches another account's code (owner namespaces wish, secaudit2026oct22).
 *   2026-10-24 — The run no longer receives the request's bearer: ctx.buy runs the seller's action for
 *     the buying extension's GEAI (secaudit2026oct22, ext-purchase:buy-forwards-outer-caller-bearer).
 *   2026-10-21 — visitorOrSignIn asks isAnonymousPrincipal, so the minted anonymous token runs a public
 *     action as a visitor (secaudit 2026-10, anonymous-claim-not-signed).
 *   v1.18.0 — 2026-10-18 — A caller with no sign-in runs an action the manifest marks `public`, as a
 *     visitor, counted per client address on the catalogue limit; every other unsigned call still
 *     answers 401 (Comicland v3 A-7).
 *   v1.17.0 — 2026-10-16 — Both handlers call invokeExtensionAction (services/extension-invoke.ts), which
 *     holds the sequence that was written twice here and once more in mcp/extensions.ts. No change to
 *     what either route answers (QA audit D2-05).
 *   v1.16.0 — 2026-10-12 — requireRestScope (auth/rest-scope-gate.ts): ext:invoke on POST /v1/ext/:extName/:instanceId/:actionId, POST /v1/ext/:extName/:actionId. Allowed with the Deprecation headers before 4.0.0, refused from it (wish-rest-reitit-ilman-scope-tarkistusta-agentti-p-see-kaikkeen).
 *   v1.15.0 — 2026-10-09 — A failed action's own message and the timeout answer pass the 500 text
 *     filter (middleware/internal-error-text.ts) through keepErrorMessage; the script's message is
 *     redacted of credential-shaped text (secrets audit 2026-10-09, d4).
 *   v1.14.0 — 2026-10-09 — Secret config is decrypted for the field it is bound to (SecretBinding,
 *     services/extension-secrets.ts; secrets audit 2026-10-09, 1.1).
 *   v1.13.0 — 2026-10-05 — Both handlers pass the extension's capabilities to buildExtensionCtx
 *     (secaudit 2026-10, PKG-3).
 *   v1.12.0 — 2026-09-29 — Both handlers give ctx.files the caller's roles and scopes, so a file read
 *     passes the classification check as this caller (TARGET-082 V4).
 *   v1.11.1 — 2026-09-28 — A sandbox timeout answers EXTENSION_TIMEOUT again: QuickJS reports it as
 *     `interrupted`, which the old match missed, so it came back as EXTENSION_ERROR (found in V6 of
 *     the System 2 plan).
 *   v1.11.0 — 2026-09-06 — Both handlers pass the session's scopes into ctx.caller, so a script can
 *     hold a permission word the way a route holds one. Nothing reads it unless a script asks.
 *   v1.10.0 — 2026-09-05 — Both handlers attach ctx.workspace when the manifest declares it
 *     (services/extension-workspace.ts), as the caller with the caller's scopes, and answer a
 *     workspace refusal the script let through with the service's own status and code instead of
 *     a 500 EXTENSION_ERROR.
 *   v1.9.0 — 2026-09-03 — A direct call counts into the capability registry's stats when the node
 *     has switched counting on (AIMEAT_CAPABILITY_CALL_COUNTING); proxy calls always counted.
 *   v1.8.0 — 2026-09-03 — An action address may pin a version (name@version) through resolveExtensionForCall; an unknown version is a 404 that says so.
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
import type { Request, Response, NextFunction } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { requireAuth } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { isAnonymousPrincipal } from '../../auth/anonymous-principal.js';
import { EXT_HASH_REFERENCE_JS } from '../../services/extension-runtime.js';

/** The published hash, evaluated here so the served example is produced BY the served source. */
const aimeatHashRef: (s: string) => string =
  new Function(`${EXT_HASH_REFERENCE_JS}; return aimeatHash;`)() as (s: string) => string;
import { keepErrorMessage } from '../../middleware/internal-error-text.js';
import { callerPrincipal } from '../../utils/gaii.js';
import { callerOf } from '../../middleware/caller.js';
import { INTERNAL_PASS_HEADER } from './internal-pass.js';
import { enforcePaywall, APP_TOOL_HEADER } from './paywall.js';
import type { EmailService } from '../../services/email.js';
import { requireRestScope } from '../../auth/rest-scope-gate.js';
import { invokeExtensionAction } from '../../services/extension-invoke.js';
import { resolveExtensionForCall } from '../../services/component-versions.js';
import { extensionCallTarget, addressSegment } from '../../services/component-address.js';
import { rateLimit } from '../../middleware/rate-limit.js';

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

  /**
   * Run one action for this request and answer it. `:extName` may pin a version (`name@1.2.0`): the
   * call then runs that kept version's code, with the live record's status, settings and instances.
   */
  const runAction = async (req: Request, res: Response, shape: PathShape): Promise<void> => {
    const session = callerOf(req, config.nodeId, storage);
    const { extRef, instanceId } = await callTarget(req, shape, session.owner);
    const out = await invokeExtensionAction({
      config, storage, enforcePaywall, emailService,
      extRef,
      instanceId,
      actionId: req.params.actionId as string,
      method: req.method,
      input: req.body as Record<string, unknown>,
      caller: {
        // Who PAYS and whose namespace this runs in is `gaii`; who ACTED may be a hosted app, and the
        // money path is where that distinction has to survive or nobody can be told an app spent.
        gaii: session.principal,
        metered: callerPrincipal(req.auth!, config.nodeId),
        owner: session.owner,
        kind: session.kind,
        roles: [...session.roles],
        scopes: [...session.scopes],
        appGrantId: req.auth!.app_grant ?? null,
      },
      paywall: {
        res,
        payToken: req.header('x-aimeat-pay-token') ?? undefined,
        internalPass: req.header(INTERNAL_PASS_HEADER) ?? undefined,
        namedAppTool: req.header(APP_TOOL_HEADER) ?? undefined,
      },
      correlationId: req.header('x-aimeat-correlation') ?? null,
    });
    if (out.kind === 'paywall') return;   // the paywall has answered
    if (out.kind === 'refused') {
      const body = error(config.nodeId, out.code, out.message);
      res.status(out.status).json(out.keepMessage ? keepErrorMessage(body) : body);
      return;
    }
    res.json(success(config.nodeId, out.result, [
      { description: 'View extension', method: 'GET', url: `/v1/extensions/${addressSegment(out.extName)}` },
    ]));
  };

  /**
   * Which extension and instance a path names (services/component-address.ts). Two segments: the
   * extension (a namespaced name arrives as one encoded segment, `alice%2Fweather`) and the action.
   * Three: the instance form (an encoded namespaced name in the first segment) and the literal
   * `<owner>/<name>/<action>` share it, and extensionCallTarget reads it in an order where a bare
   * name never reaches another account's code.
   */
  const callTarget = async (req: Request, shape: PathShape, callerOwner: string | null): Promise<{ extRef: string; instanceId?: string }> => {
    const p = req.params as Record<string, string>;
    if (shape === 'three') return extensionCallTarget(storage, p.extName, p.instanceId, callerOwner);
    return { extRef: p.extName };
  };

  /**
   * A caller with no sign-in, on an action the manifest marks `public` (Comicland v3 A-7): run it for
   * nobody in particular, counted per client address. Anything else goes on to requireAuth, so an
   * unknown extension, an unknown action and an action that is not public all answer 401 alike and a
   * visitor learns nothing about what exists.
   */
  const visitorLimit = rateLimit(() => ({ ...config.rateLimits.catalogue, keyBy: 'ip' }));
  const visitorOrSignIn = (shape: PathShape) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (req.auth && !isAnonymousPrincipal(req.auth)) { next(); return; }
    const target = await callTarget(req, shape, null);
    const resolved = await resolveExtensionForCall(storage, target.extRef);
    const action = resolved.ok ? resolved.ext.actions.find(a => a.id === req.params.actionId) : undefined;
    if (!action?.public) { next(); return; }
    visitorLimit(req, res, () => { void runVisitor(req, res, target); });
  };
  const runVisitor = async (req: Request, res: Response, target: { extRef: string; instanceId?: string }): Promise<void> => {
    const nobody = `anonymous@${config.nodeId}`;
    const out = await invokeExtensionAction({
      config, storage, enforcePaywall,
      extRef: target.extRef, instanceId: target.instanceId, actionId: req.params.actionId as string,
      method: req.method, input: (req.body ?? {}) as Record<string, unknown>,
      caller: { gaii: nobody, metered: nobody, owner: '', kind: 'anonymous', roles: [], scopes: [], appGrantId: null },
      paywall: { res },
      correlationId: req.header('x-aimeat-correlation') ?? null,
    });
    if (out.kind === 'paywall') return;
    if (out.kind === 'refused') {
      const body = error(config.nodeId, out.code, out.message);
      res.status(out.status).json(out.keepMessage ? keepErrorMessage(body) : body);
      return;
    }
    res.json(success(config.nodeId, out.result));
  };

  // ── POST /v1/ext/:extName/:instanceId/:actionId — Instance-scoped action execution ──
  // Runs against one instance: its own config, and the namespace `ext:{name}.{instanceId}`. The same
  // path is the literal form of `<owner>/<name>/<action>` (callTarget decides).
  router.post('/v1/ext/:extName/:instanceId/:actionId', visitorOrSignIn('three'), requireAuth(), requireRestScope('ext:invoke'), async (req, res) => {
    await runAction(req, res, 'three');
  });

  // ── POST /v1/ext/:extName/:actionId — Dynamic action execution ──
  router.post('/v1/ext/:extName/:actionId', visitorOrSignIn('two'), requireAuth(), requireRestScope('ext:invoke'), async (req, res) => {
    await runAction(req, res, 'two');
  });
}

/** How many segments the action path had: the decision callTarget makes from it. */
type PathShape = 'two' | 'three';
