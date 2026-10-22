/**
 * @file src/routes/webmcp-invoke-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The permission the app-tool invoke route (routes/webmcp.ts, POST
 *   /v1/apps/:owner/:filename/webmcp/tools/:tool, and its app-origin twin in routes/subdomain-webmcp.ts)
 *   asks of an agent or an ecosystem app: exchange:write, the word its MCP twin aimeat_app_tool_invoke
 *   asks (tool-catalog/definitions/exchange.ts).
 *
 *   WHY. The call spends the person's app-tool contract budget, or a free tool's pacing, and runs the
 *   provider's capability with the caller's input. Until 2026-10-22 the route asked no word at all, so
 *   an agent its person had narrowed to memory:read did all of that over HTTP while the MCP twin, the
 *   contract acceptance and the direct capability invoke refused it (secaudit 2026-10, v72).
 *
 *   WHO PASSES UNCHANGED.
 *   - The owner in person, with no word (isOwnerInPerson).
 *   - An app grant (role `app`): the served aimeat-webmcp.js calls this route with the app page's
 *     session, and a published app's permissions change only when its author republishes it. Its
 *     metered call keeps asking contract:spend in services/metered-access.ts appSpendRefusal.
 *   - A visitor from another node and an anonymous session: neither is an agent or an ecosystem app of
 *     this node, and the route's own rules for them stay as they were.
 *   - An agent or ecosystem app holding exchange:write (or `*`, or `exchange:*`).
 *   - An agent or ecosystem app the once-only step services/app-tool-invoke-keep.ts listed, because it
 *     called app tools over HTTP before this rule, while its token still covers what it held then.
 *
 *   THE REFUSAL. 403 SCOPE_DENIED naming the word. An agent gets, through auth/deny.ts denyScope403,
 *   the address where its person allows the word with one press (services/permission-ask.ts). An
 *   ecosystem app gets the address of its person's Ecosystem apps page and the step that puts the word
 *   in front of them: ask again with POST /v1/ecosystem-apps/hello naming exchange:write, which the
 *   person approves there with one press.
 * @structure refuseAppToolInvokeWithoutWord(req, res, config, storage)
 * @usage if (await refuseAppToolInvokeWithoutWord(req, res, config, storage, toolName)) return;
 * @version-history
 *   v1.0.0 — 2026-10-22 — Initial (secaudit 2026-10, v72).
 */
import type { Request, Response } from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { error } from '../middleware/envelope.js';
import { isAnonymousPrincipal } from '../auth/anonymous-principal.js';
import { callerOf } from '../middleware/caller.js';
import { denyScope403 } from '../auth/deny.js';
import { isForeignPrincipal, isOwnerInPerson } from '../utils/gaii.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { noteScopeUse } from '../services/scope-use.js';
import { permissionAskText } from '../services/permission-ask.js';
import { APP_TOOL_INVOKE_WORD, appToolInvokeKept } from '../services/app-tool-invoke-keep.js';
import { logger } from '../utils/logger.js';

/**
 * Refuse an agent or ecosystem caller without exchange:write. True when the refusal was sent and the
 * route must stop; false when the call goes on. Asked before anything is metered, paced or run.
 */
export async function refuseAppToolInvokeWithoutWord(
  req: Request, res: Response, config: AimeatConfig, storage: Storage, toolName: string,
): Promise<boolean> {
  const auth = req.auth;
  if (!auth || isAnonymousPrincipal(auth) || isOwnerInPerson(auth) || isForeignPrincipal(auth)) return false;
  const { kind } = callerOf(req, config.nodeId, storage);
  if (kind !== 'agent' && kind !== 'ecosystem') return false;
  const ecosystem = kind === 'ecosystem';

  const held = auth.scopes ?? [];
  if (scopeIsCovered(held, APP_TOOL_INVOKE_WORD)) {
    noteScopeUse(auth.sub, [APP_TOOL_INVOKE_WORD]);
    return false;
  }
  if (await appToolInvokeKept(storage, config.nodeId, auth.sub, held)) return false;

  const route = `${req.method} /v1/apps/:owner/:filename/webmcp/tools/:tool`;
  logger.warn(`[scope-denied] ${auth.sub} needs "${APP_TOOL_INVOKE_WORD}", has [${held.join(', ')}] on ${route}`);
  if (!ecosystem) {
    const ask = permissionAskText({
      baseUrl: config.baseUrl, agentGaii: auth.sub, tool: `the app tool "${toolName}"`, words: [APP_TOOL_INVOKE_WORD],
    });
    // The word written out, so test/unit/rest-scope-keep-working.test.ts reads it in its inline scan.
    denyScope403(req, res, ['exchange:write'],
      `Scope "${APP_TOOL_INVOKE_WORD}" required to call an app tool, because the call can spend your person's contract budget or pacing. `
      + `Agent scopes: [${held.join(', ')}]. ${ask}`);
    return true;
  }
  // An ecosystem app's words change when its person approves a new hello, on their Ecosystem apps page.
  const page = `${config.baseUrl.replace(/\/+$/, '')}/v1/profile#ecosystem-apps`;
  res.setHeader('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${APP_TOOL_INVOKE_WORD}"`);
  res.status(403).json(error(config.nodeId, 'SCOPE_DENIED',
    `Scope "${APP_TOOL_INVOKE_WORD}" required to call an app tool, because the call can spend your person's contract budget or pacing. `
    + `App scopes: [${held.join(', ')}]. Ask again with POST /v1/ecosystem-apps/hello naming "${APP_TOOL_INVOKE_WORD}" beside the scopes you hold; `
    + `your person approves it with one press at ${page}, and then you repeat this call.`,
    403, { needed: [APP_TOOL_INVOKE_WORD], allow_url: page, one_press: true },
    [
      { description: `Ask your person for "${APP_TOOL_INVOKE_WORD}" beside the scopes you hold`, method: 'POST', url: '/v1/ecosystem-apps/hello' },
      { description: 'Where your person approves it with one press', method: 'GET', url: page },
    ]));
  return true;
}
