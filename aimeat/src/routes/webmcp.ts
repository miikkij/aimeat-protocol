/**
 * @file src/routes/webmcp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description WebMCP bridge, server half (TARGET-034 phase C): expose an agent-faced app's
 *   declared tool manifest (apps.{appId}.tools, phase A) as a WebMCP-style tool surface over
 *   HTTP. WebMCP itself (W3C Web Machine Learning CG draft, 2026) is an IN-PAGE JS API
 *   (document.modelContext.registerTool) — the in-page half is the served library
 *   /v1/libs/aimeat-webmcp.js (lib-webmcp.ts); THIS router serves the machine-readable listing
 *   scanners and non-browser agents read, and the HTTP invoke path. A PRICED tool always answers
 *   402 + the x402-style `accepts` block with a ready-made checkout line item — payment IS the
 *   invocation (complete the checkout; a callable tool's result rides back on
 *   session.fulfillment.results). Unpriced callable tools invoke directly for authenticated
 *   principals (identity via resolveIdentity, capability run through invokeCapability/safeFetch).
 * @structure
 *   - GET  /v1/apps/:owner/:filename/webmcp             public WebMCP-shaped tool listing
 *   - POST /v1/apps/:owner/:filename/webmcp/tools/:tool invoke (402 for priced; auth for free)
 * @version-history
 *   v1.8.1 — 2026-10-09 — isRestricted reads appHiddenFromPublicSurfaces (services/app-ai-use.ts), moved unchanged.
 *   v1.8.0 — 2026-10-08 — The listing's ai_provenance is the tool manifest record's own when it
 *     carries one, the app's only otherwise (aiprov D18).
 *   v1.7.2 — 2026-10-07 — A priced tool's payment block carries every money price (`pricesMoney`,
 *     `priceMoney` its first). A tool sold only in `pricesMoney` answered 402 naming no price.
 *   v1.7.1 — 2026-10-07 — loadPublicManifest reads through publicManifestTools
 *     (commerce/app-tool-catalog.ts), the gate GET /v1/commerce/tools?include=own lists through.
 *   v1.7.0 — 2026-10-01 — A tool whose backing extension serves members only refuses a non-member
 *     (MEMBERS_ONLY, 403) before the metered call is settled.
 *   v1.6.2 — 2026-09-26 — The app owner in the listing and the invoke comes from localAccountName
 *     (utils/gaii.ts), which keeps an identity of another node whole, so it never names the local
 *     namesake (secaudit 2026-09, F-1).
 *   v1.6.1 — 2026-09-24 — …and whether the caller is the owner in person (callAuthority): an app under
 *     a grant resolves to its owner's account, and it called the owner's server as them.
 *   v1.6.0 — 2026-09-24 — Both invoke paths hand the capability service the session's scopes
 *     (heldScopes), so a tool bound to a capability over a remote MCP tool asks for mcp:use.
 *   v1.5.0 — 2026-09-19 — The invoke checks the input against the tool's published schema before
 *     metering or payment, and answers 400 INVALID_INPUT naming every missing field at once.
 *   v1.4.0 — 2026-07-28 — The listing carries `app_surface` (declared scopes, bound SKILL.md packs,
 *     bundled crew-defs, live EXCHANGE listings) and answers 200 with an empty `tools` array for a
 *     published app that sells nothing yet; 404 is now reserved for "no such public app".
 *   v1.3.0 — 2026-07-28 — Asks the metered chokepoint first instead of pre-checking whether a right
 *     exists. That pre-check is how the owner-free rule went missing on this door: an owner holding
 *     a contract against their own tool was charged the platform rake to call it.
 *   v1.2.0 — 2026-07-27 — `pricesMoney` counts as a price (a USD-only tool was invoking free), and the
 *     unpriced path tells the raw paywall so downstream that a free tool is not billed at a sibling's price.
 *   v1.1.0 — 2026-07-21 — EXCHANGE metered path (Gap 1): an authenticated caller holding a durable app-tool
 *     CONTRACT gets the call metered (+ rake) and routed to the PINNED interface binding; no contract → the
 *     existing checkout (priced) / free (unpriced) paths run unchanged.
 *   v1.0.0 — 2026-07-14 — Initial WebMCP bridge server surface (TARGET-034 phase C)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, AppRecord } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { callAuthority } from '../auth/effective-scopes.js';
import { success, error } from '../middleware/envelope.js';
import { membersOnlyRefusalForCapability, MEMBERS_ONLY_MESSAGE } from '../services/members-only.js';
import { resolveIdentity, callerPrincipal, localAccountName } from '../utils/gaii.js';
import { appToolsKey, isToolPriced, toolMoneyPrices, applyLockedInput, type AppTool } from '../models/app-tool-schemas.js';
import { paymentChallenge } from '../commerce/x402.js';
import { publicManifestTools } from '../commerce/app-tool-catalog.js';
import { checkAppToolInput } from '../services/app-tool-input.js';
import { getInterfaceVersion } from '../services/app-tool-interfaces.js';
import { authoriseMeteredCall } from '../services/metered-access.js';
import { takeDesignations } from '../commerce/beneficiary-designation.js';
import { respondMeteredRefusal } from './extensions/metered-response.js';
import { mintInternalPass } from './extensions/internal-pass.js';
import { logger } from '../utils/logger.js';
import { recordCallDuration } from '../services/call-timing.js';
import { recordAccountEvent, recordFirstUse } from '../services/account-events.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { buildAppAgentSurface } from '../services/app-agent-surface.js';
import { appHiddenFromPublicSurfaces } from '../services/app-ai-use.js';
import { loadServedProvenance, setProvenanceHeaders } from '../services/ai-provenance-marks.js';

/** The WebMCP draft this bridge mirrors (W3C Web Machine Learning CG). */
const WEBMCP_SPEC = 'https://github.com/webmachinelearning/webmcp';

/**
 * True when an app must not be described on a public surface (gated, priced, or moderated away).
 * The test lives in services/app-ai-use.ts, so the "Use with your AI" mark and this listing agree.
 */
const isRestricted = (config: AimeatConfig, app: AppRecord): boolean => appHiddenFromPublicSurfaces(config, app);

/** Load the PUBLIC tool manifest of owner/filename, or null (missing, private, malformed). */
async function loadPublicManifest(
  storage: Storage,
  config: AimeatConfig,
  ownerName: string,
  filename: string,
): Promise<AppTool[] | null> {
  return (await loadPublicManifestRecord(storage, config, ownerName, filename)).tools;
}

/** The public tools and the manifest record's own provenance id, when it carries one. */
async function loadPublicManifestRecord(
  storage: Storage, config: AimeatConfig, ownerName: string, filename: string,
): Promise<{ tools: AppTool[] | null; aiProvenanceId?: string }> {
  // The same gate the commerce catalog lists through (commerce/app-tool-catalog.ts), so a tool
  // GET /v1/commerce/tools?include=own lists is one this route serves.
  const rec = await storage.getMemory(`${ownerName}@${config.nodeId}`, appToolsKey(filename));
  const tools = publicManifestTools(rec);
  return { tools, ...(tools && rec?.aiProvenanceId ? { aiProvenanceId: rec.aiProvenanceId } : {}) };
}

/** One tool in the served listing: the WebMCP descriptor fields + the AIMEAT payment contract. */
function toolEntry(config: AimeatConfig, ownerName: string, filename: string, tool: AppTool): Record<string, unknown> {
  const b = config.baseUrl;
  const appRef = `${ownerName}/${filename}`;
  const priced = isToolPriced(tool);
  const money = toolMoneyPrices(tool).map((m) => ({ amount: m.amount, currency: m.currency, scale: 6 }));
  return {
    // WebMCP descriptor fields (document.modelContext.registerTool) — execute lives in the page.
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? { type: 'object', properties: {} },
    // AIMEAT extensions: how this tool fulfills and what it costs.
    fulfillment: tool.action_id ? 'call' : 'task',
    payment: priced
      ? {
          required: true,
          ...(tool.price && tool.price.morsels > 0 ? { price: { morsels: tool.price.morsels, unit: tool.price.unit ?? 'per-call' } } : {}),
          // Every money price, so a tool sold only in `pricesMoney` does not answer 402 with no price.
          ...(money.length ? { priceMoney: money[0], pricesMoney: money } : {}),
          note: 'Payment IS the invocation: open + complete a checkout session with the item below. A callable tool returns its result on session.fulfillment.results; a task tool queues the order for the seller. Self-purchase by the app owner is free.',
          checkout: {
            create: { method: 'POST', url: `${b}/v1/commerce/checkout-sessions` },
            items: [{ kind: 'app-tool', app: appRef, tool: tool.name, input: '<your tool input object>' }],
            complete: { method: 'POST', url: `${b}/v1/commerce/checkout-sessions/{id}/complete` },
          },
        }
      : { required: false },
    invoke: { method: 'POST', url: `${b}/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}/webmcp/tools/${encodeURIComponent(tool.name)}` },
  };
}

export function webmcpRouter(config: AimeatConfig, storage: Storage): Router {
  const router = Router();

  // ── GET /v1/apps/:owner/:filename/webmcp — public, cache-friendly tool listing ──
  // Serves the WebMCP-shaped view of the app's PUBLIC apps.{appId}.tools manifest: descriptor
  // fields agents feed to registerTool, plus the payment contract for priced tools — and the app's
  // public agent-facing surface (`app_surface`): declared scopes, bound SKILL.md packs, bundled
  // crew-defs, live EXCHANGE listings. An app with no tool manifest still answers 200 with an empty
  // `tools` array, because "this app sells nothing yet" and "there is no such app" are different
  // answers and only the second is a 404. A PRIVATE manifest reads exactly like an absent one.
  router.get('/v1/apps/:owner/:filename/webmcp', async (req, res) => {
    const ownerName = localAccountName(decodeURIComponent(req.params.owner as string));
    const filename = decodeURIComponent(req.params.filename as string);
    const manifest = await loadPublicManifestRecord(storage, config, ownerName, filename);
    const tools = manifest.tools;
    // The tool manifest is a memory-record convention keyed by filename, so a seller can declare
    // tools for an app this node does not host — that listing must keep working. The app record is
    // what the `app_surface` block needs, and only a RESTRICTED one (gated, priced, moderated away)
    // is a reason to refuse the whole listing.
    const app = await storage.getAppByOwnerName(ownerName, filename);
    if (app && isRestricted(config, app)) {
      res.status(404).json(error(config.nodeId, 'APP_NOT_FOUND', `No public app "${ownerName}/${filename}"`));
      return;
    }
    if (!tools && !app) {
      res.status(404).json(error(config.nodeId, 'APP_NOT_FOUND', `No public app or tool manifest for "${ownerName}/${filename}"`));
      return;
    }
    const b = config.baseUrl;
    const appRef = `${ownerName}/${filename}`;
    // TARGET-058: how the listing's bytes were made, on the agent plane. This listing is a WebMCP
    // document rather than an AIMEAT envelope, so the record rides at the top level under the same
    // `ai_provenance` name the MCP surface uses — snake_case parameter, camelCase document, exactly
    // as frozen. Absent means UNSTATED, which is never "a human wrote it". The tool manifest's own
    // record comes first, because the tools are what this document serves; the app's record, which
    // describes the app's bytes, only when the manifest carries none (aiprov D18).
    const prov = await loadServedProvenance(storage, config, manifest.aiProvenanceId ?? app?.aiProvenanceId);
    setProvenanceHeaders(res, prov);
    res.json({
      webmcp: { version: 'draft', spec: WEBMCP_SPEC },
      app: appRef,
      ...(prov ? { ai_provenance: prov.record, ai_provenance_url: prov.recordUrl } : {}),
      // The in-page half: the app page registers these tools on document.modelContext via the
      // served bridge library, so in-browser agents (Chrome/Edge) get them natively.
      page: `${b}/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`,
      library: `${b}/v1/libs/aimeat-webmcp.js`,
      tools: (tools ?? []).map((t) => toolEntry(config, ownerName, filename, t)),
      ...(app ? { app_surface: await buildAppAgentSurface(storage, config, app) } : {}),
      payment_challenge: paymentChallenge(config),
    });
  });

  // ── POST /v1/apps/:owner/:filename/webmcp/tools/:tool — HTTP invoke ──
  // Priced → ALWAYS 402 + x402 accepts + the ready-made checkout item (payment is the
  // invocation). Unpriced callable → authenticated direct invoke. Unpriced unbound → 422.
  router.post('/v1/apps/:owner/:filename/webmcp/tools/:tool', async (req: Request, res: Response) => {
    const ownerName = localAccountName(decodeURIComponent(req.params.owner as string));
    const filename = decodeURIComponent(req.params.filename as string);
    const toolName = decodeURIComponent(req.params.tool as string);
    const tools = await loadPublicManifest(storage, config, ownerName, filename);
    if (!tools) {
      res.status(404).json(error(config.nodeId, 'APP_TOOLS_NOT_FOUND', `App "${ownerName}/${filename}" declares no public tool manifest`));
      return;
    }
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      res.status(404).json(error(config.nodeId, 'TOOL_NOT_FOUND', `Tool not found on app "${ownerName}/${filename}": ${toolName}`));
      return;
    }
    const appRef = `${ownerName}/${filename}`;

    // Checked against the tool's published schema BEFORE anything is metered or paid for, and every
    // problem named at once (services/app-tool-input.ts). Same check as the MCP twin.
    const toolInput = applyLockedInput(tool, (req.body?.input ?? req.body ?? {}) as Record<string, unknown>);
    const inputCheck = checkAppToolInput(tool, toolInput);
    if (!inputCheck.ok) {
      res.status(400).json(error(config.nodeId, 'INVALID_INPUT', inputCheck.message, 400,
        { missing: inputCheck.missing, violations: inputCheck.violations }));
      return;
    }

    // ── The metered path: one question, asked of the one place that answers it ──
    // This route's job is to name the PRODUCT — which it alone knows, because a price belongs to a
    // product and the capability underneath may be sold under several. Everything after that (is the
    // caller the owner, do they hold a right, does it pace, does a ceiling hold, what does it cost)
    // is the chokepoint's, so that the answer cannot differ between this door and its MCP twin.
    //
    // Asked BEFORE checking whether a right exists, deliberately: an owner calling their own tool is
    // free whether or not they ever bought a contract against themselves, and pre-filtering on "do
    // they hold something" is exactly how that rule went missing here while three other doors had it.
    if (req.auth && !req.auth.anonymous) {
      const callerGaii = resolveIdentity(req.auth, config.nodeId);
      // The capability runs as the owner, as it always has. The metered call names the app, so an
      // app's spending is attributable instead of arriving as its owner's own.
      const meteredCaller = callerPrincipal(req.auth, config.nodeId);
      const coordExt = `apptool:${ownerName}/${filename}`;
      // Who the app serves, before anything is charged (services/members-only.ts). The settled call
      // used to reach the paywall on this route's pass, which skipped the question.
      if (await membersOnlyRefusalForCapability(storage, tool.action_id, callerGaii)) {
        res.status(403).json(error(config.nodeId, 'MEMBERS_ONLY', MEMBERS_ONLY_MESSAGE));
        return;
      }
      const outcome = await authoriseMeteredCall({
        config, storage, caller: meteredCaller,
        session: { roles: req.auth.roles, scopes: req.auth.scopes, appGrantId: req.auth.app_grant ?? null },
        product: { ext: coordExt, action: toolName, label: `${filename}/${toolName}`, providerOwner: ownerName },
      });

      if (outcome.kind !== 'no_right') {
        const ent = outcome.kind === 'settled' ? outcome.entitlement : null;
        if (outcome.kind !== 'settled' && outcome.kind !== 'free_owner') {
          respondMeteredRefusal(config, res, outcome, `${filename}/${toolName}`);
          return;
        }
        // A CONTRACT is pinned to the interface version it was signed at, so the provider can ship a
        // newer app without breaking a live integration. The owner's own call has nothing to pin —
        // they get their current binding, which is theirs to change.
        const pinnedVersion = ent?.surface && ent.surface.kind === 'app-tool' ? ent.surface.ifaceVersion : undefined;
        const providerGhii = ent?.providerGhii ?? `${ownerName}@${config.nodeId}`;
        const iface = pinnedVersion ? await getInterfaceVersion(storage, providerGhii, filename, toolName, pinnedVersion) : null;
        const binding = iface?.binding ?? tool.action_id ?? null;
        if (!binding) {
          res.status(422).json(error(config.nodeId, 'TOOL_NOT_INVOKABLE', 'This tool is not wired to anything that can run, so there is nothing to call yet.'));
          return;
        }
        const cap = await storage.getCapability(binding);
        if (!cap) {
          res.status(404).json(error(config.nodeId, 'CAPABILITY_NOT_FOUND', `Backing capability not found: ${binding}`));
          return;
        }
        const jwt = (req.headers.authorization || '').replace('Bearer ', '');
        try {
          const { invokeCapability } = await import('../services/capability-invoke.js');
          const startedAt = Date.now();
          // The capability runs over this node's own HTTP surface and meets the raw-invoke paywall,
          // which cannot know which product was bought. The pass says this call was already ruled on.
          const invoked = await invokeCapability(config, storage, cap, toolInput,
            callerGaii, jwt, 'normal', mintInternalPass(coordExt, toolName), callAuthority(req.auth));
          // Measured so the provider can propose a service commitment from evidence (call-timing.ts).
          recordCallDuration(storage, providerGhii, coordExt, toolName, Date.now() - startedAt);

          // The CALLER's own record. Two shapes, not one row per call: a tool can be invoked
          // hundreds of times an hour, and a row each would fill the window in minutes while the
          // per-call record already exists in UsageCall. The first time is news; a call that cost
          // something is always news; the nine-hundredth free call is not.
          const callerOwner = ownerGhiiOf(meteredCaller);
          const toolSubject = `${ownerName}/${filename}#${toolName}`;
          if (outcome.kind === 'settled' && outcome.charged > 0) {
            void recordAccountEvent(storage, {
              ownerGhii: callerOwner, kind: 'app_tool_paid', actorGaii: meteredCaller,
              subject: toolSubject, link: `/v1/profile?tab=usage`,
              data: {
                app: `${ownerName}/${filename}`, tool: toolName,
                amount: `${outcome.charged} ${outcome.entitlement.unit || 'morsels'}`,
              },
            }, config);
          } else {
            void recordFirstUse(storage, {
              ownerGhii: callerOwner, kind: 'app_tool_first_use', actorGaii: meteredCaller,
              subject: toolSubject, link: `/v1/profile?tab=usage`,
              data: { app: `${ownerName}/${filename}`, tool: toolName },
            }, config);
          }
          // Delivered → book the provider's beneficiaries out of the provider's own cut.
          const shared = takeDesignations(invoked.result);
          if (outcome.kind === 'settled') await outcome.accrue(shared.designations);
          res.json(success(config.nodeId, { app: appRef, tool: toolName, iface_version: pinnedVersion ?? null, metered: outcome.kind === 'settled', result: shared.result }));
        } catch (err) {
          if (outcome.kind === 'settled') await outcome.refund();
          const e = err as { statusCode?: number; code?: string; message?: string };
          res.status(e.statusCode || 502).json(error(config.nodeId, e.code || 'TOOL_INVOKE_FAILED', e.message || 'Tool invocation failed'));
        }
        return;
      }
      // no_right → the checkout (priced) or the free invoke below.
    }

    if (isToolPriced(tool)) {
      if (!config.commerceEnabled) {
        res.status(503).json(error(config.nodeId, 'FEATURE_DISABLED', 'This tool is priced but commerce is disabled on this node'));
        return;
      }
      const entry = toolEntry(config, ownerName, filename, tool) as { payment: Record<string, unknown> };
      res.status(402).json({
        ...error(config.nodeId, 'PAYMENT_REQUIRED', `Tool "${toolName}" is priced — pay by completing a checkout session (the result returns on it)`),
        ...paymentChallenge(config),
        payment: entry.payment,
      });
      return;
    }

    // Unpriced: a direct invoke of the backing capability — authenticated principals only.
    //
    // EXPRESS NEVER SEES THIS PROMISE. `next` is called synchronously and its return value is
    // discarded, so an async callback here is a floating promise: a throw ABOVE the inner try — the
    // capability read is a database call — was an unhandled rejection, and the request hung until
    // the client's own timeout with nothing in any log to say why. The wrapper below is what turns
    // that into an answer.
    requireAuth()(req, res, () => {
      void (async () => {
      if (!tool.action_id) {
        res.status(422).json(error(config.nodeId, 'TOOL_NOT_INVOKABLE', 'This tool declares no price and no capability binding; nothing to invoke'));
        return;
      }
      const cap = await storage.getCapability(tool.action_id);
      if (!cap) {
        res.status(404).json(error(config.nodeId, 'CAPABILITY_NOT_FOUND', `Backing capability not found: ${tool.action_id}`));
        return;
      }
      const callerGhii = resolveIdentity(req.auth!, config.nodeId);
      const jwt = (req.headers.authorization || '').replace('Bearer ', '');
      try {
        const { invokeCapability } = await import('../services/capability-invoke.js');
        // This route just read the manifest and found no price on THIS tool. The backing action may
        // still be sold under a sibling tool, and the raw paywall — which sees only the action —
        // would then bill this free call at that neighbour's price. Say what was decided instead of
        // letting it be re-decided by the one place with less information.
        const invoked = await invokeCapability(config, storage, cap, toolInput,
          callerGhii, jwt, 'normal', mintInternalPass(`apptool:${ownerName}/${filename}`, toolName, 'unpriced'),
          callAuthority(req.auth!));
        res.json(success(config.nodeId, { app: appRef, tool: toolName, result: invoked.result }));
      } catch (err) {
        const e = err as { statusCode?: number; code?: string; message?: string };
        res.status(e.statusCode || 502).json(error(config.nodeId, e.code || 'TOOL_INVOKE_FAILED', e.message || 'Tool invocation failed'));
      }
      })().catch((err: unknown) => {
        logger.error('webmcp: the unpriced invoke threw outside its own handler', {
          app: appRef, tool: toolName, error: err instanceof Error ? err.message : String(err),
        });
        if (!res.headersSent) {
          res.status(500).json(error(config.nodeId, 'TOOL_INVOKE_FAILED', 'The tool could not be invoked. This node has logged why.'));
        }
      });
    });
  });

  return router;
}
