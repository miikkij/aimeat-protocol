/**
 * @file src/routes/webmcp.ts
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
 *   v1.0.0 — 2026-07-14 — Initial WebMCP bridge server surface (TARGET-034 phase C)
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { requireAuth } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { resolveIdentity } from '../utils/gaii.js';
import { AppToolsDocSchema, appToolsKey, type AppTool } from '../models/app-tool-schemas.js';
import { paymentChallenge } from '../commerce/x402.js';

/** The WebMCP draft this bridge mirrors (W3C Web Machine Learning CG). */
const WEBMCP_SPEC = 'https://github.com/webmachinelearning/webmcp';

const isPriced = (t: AppTool): boolean => !!((t.price && t.price.morsels > 0) || t.priceMoney);

/** Load the PUBLIC tool manifest of owner/filename, or null (missing, private, malformed). */
async function loadPublicManifest(
  storage: Storage,
  config: AimeatConfig,
  ownerName: string,
  filename: string,
): Promise<AppTool[] | null> {
  const rec = await storage.getMemory(`${ownerName}@${config.nodeId}`, appToolsKey(filename));
  if (!rec || rec.visibility !== 'public') return null;
  const parsed = AppToolsDocSchema.safeParse(rec.value);
  if (!parsed.success) return null;
  return parsed.data.tools;
}

/** One tool in the served listing: the WebMCP descriptor fields + the AIMEAT payment contract. */
function toolEntry(config: AimeatConfig, ownerName: string, filename: string, tool: AppTool): Record<string, unknown> {
  const b = config.baseUrl;
  const appRef = `${ownerName}/${filename}`;
  const priced = isPriced(tool);
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
          ...(tool.priceMoney ? { priceMoney: { amount: tool.priceMoney.amount, currency: tool.priceMoney.currency, scale: 6 } } : {}),
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
  // fields agents feed to registerTool, plus the payment contract for priced tools. 404 when the
  // app declares no public manifest (private manifests are indistinguishable from missing).
  router.get('/v1/apps/:owner/:filename/webmcp', async (req, res) => {
    const ownerName = decodeURIComponent(req.params.owner as string).split('@')[0] as string;
    const filename = decodeURIComponent(req.params.filename as string);
    const tools = await loadPublicManifest(storage, config, ownerName, filename);
    if (!tools) {
      res.status(404).json(error(config.nodeId, 'APP_TOOLS_NOT_FOUND', `App "${ownerName}/${filename}" declares no public tool manifest`));
      return;
    }
    const b = config.baseUrl;
    const appRef = `${ownerName}/${filename}`;
    res.json({
      webmcp: { version: 'draft', spec: WEBMCP_SPEC },
      app: appRef,
      // The in-page half: the app page registers these tools on document.modelContext via the
      // served bridge library, so in-browser agents (Chrome/Edge) get them natively.
      page: `${b}/v1/apps/${encodeURIComponent(ownerName)}/${encodeURIComponent(filename)}`,
      library: `${b}/v1/libs/aimeat-webmcp.js`,
      tools: tools.map((t) => toolEntry(config, ownerName, filename, t)),
      payment_challenge: paymentChallenge(config),
    });
  });

  // ── POST /v1/apps/:owner/:filename/webmcp/tools/:tool — HTTP invoke ──
  // Priced → ALWAYS 402 + x402 accepts + the ready-made checkout item (payment is the
  // invocation). Unpriced callable → authenticated direct invoke. Unpriced unbound → 422.
  router.post('/v1/apps/:owner/:filename/webmcp/tools/:tool', async (req: Request, res: Response) => {
    const ownerName = decodeURIComponent(req.params.owner as string).split('@')[0] as string;
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

    if (isPriced(tool)) {
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
    requireAuth()(req, res, async () => {
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
        const invoked = await invokeCapability(config, storage, cap, req.body?.input ?? req.body ?? {}, callerGhii, jwt, 'normal');
        res.json(success(config.nodeId, { app: appRef, tool: toolName, result: invoked.result }));
      } catch (err) {
        const e = err as { statusCode?: number; code?: string; message?: string };
        res.status(e.statusCode || 502).json(error(config.nodeId, e.code || 'TOOL_INVOKE_FAILED', e.message || 'Tool invocation failed'));
      }
    });
  });

  return router;
}
