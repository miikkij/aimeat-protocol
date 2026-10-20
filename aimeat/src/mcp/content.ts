/**
 * @file src/mcp/content.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description MCP tools for the content class pipeline (wish-sis-ll-n-purku-luokittelu-ja-owl): an
 *   item's facts and kept text, inspecting one item, a scan over many, the content classes and the
 *   proposals, the OWL ontology, and the owner's settings.
 *
 *   THEY HOLD NO LOGIC OF THEIR OWN. Every tool calls the function the REST route calls
 *   (services/content/service.ts, the same calls routes/content.ts makes) with the session's
 *   caller, so the permission words, the input checks and the node's switch
 *   (`contentClassMode: 'off'` answers NOT_FOUND) are decided in one place. What this file adds is
 *   the tool's input names and the shape of its answer.
 *
 *   ERRORS. A ContentError or ContentClassError is the service's refusal and is answered with its
 *   own code and sentence. Anything else is an internal failure: it is answered with a sentence and
 *   the caught error rides along for the fault log (mcp/tool-fault.ts), never its text.
 * @structure registerContentTools(mcp, storage, config, caller)
 * @usage registerContentTools(mcp, storage, config, caller);
 * @version-history
 *   v1.0.0 — 2026-10-20 — Initial: aimeat_content_facts, _inspect, _scan, _classes and _settings.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import type { CallerContext } from '../services/caller-context.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from '../tool-catalog/shape.js';
import { zodShapeFor } from '../tool-catalog/zod-shape.js';
import { toolError } from './tool-error.js';
import { withCaughtError } from './tool-fault.js';
import { checkContentInput } from '../tool-catalog/definitions/content.js';
import {
  factsFor, textFor, inspectFor, scanFor, scanStatusFor, settingsFor, updateSettingsFor, classesFor, setClassFor,
  removeClassFor, proposalsFor, decideProposalFor, ontologyFor, overviewFor, listFactsFor, ContentError, ContentClassError,
} from '../services/content/service.js';

/** A refusal the service wrote, with its code and status. */
function isRefusal(err: unknown): err is { code: string; message: string } {
  if (err instanceof ContentError || err instanceof ContentClassError) return true;
  const e = err as { code?: unknown; status?: unknown } | null;
  return !!e && typeof e.code === 'string' && typeof e.status === 'number';
}

export function registerContentTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  /** The session's caller (services/caller-context.ts): the agent, its owner's GHII and its scopes. */
  caller: () => CallerContext,
): void {
  const deps = { storage, config };
  const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] });
  const fail = (err: unknown) => {
    if (isRefusal(err)) return toolError(err.code, err.message);
    return withCaughtError(toolError('INTERNAL_ERROR', 'The content class request failed on the node.'), err);
  };

  mcp.tool('aimeat_content_facts', descriptionFor('aimeat_content_facts'), zodShapeFor('aimeat_content_facts'),
    annotationsFor('aimeat_content_facts'),
    async (args) => {
      const checked = checkContentInput('aimeat_content_facts', args);
      if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
      const { kind, key, owner, with_text, of_kind, class: classId, stale, limit, after } = args;
      try {
        const who = caller();
        if (checked.mode === 'one') {
          const source = { kind, key, owner };
          const facts = await factsFor(deps, who, source);
          if (!with_text) return ok({ facts });
          let text: { text: string; from: string } | null = null;
          try {
            text = await textFor(deps, who, source);
          } catch (err) {
            // No kept text is an answer here, not a failure: the facts were found.
            if (!(isRefusal(err) && err.code === 'NOT_FOUND')) throw err;
          }
          return ok({ facts, text: text?.text ?? null, text_from: text?.from ?? null });
        }
        // No filter at all: the overview rides along, as GET /v1/content answers it.
        const filtered = [of_kind, classId, stale, limit, after].some((v) => v !== undefined && v !== null);
        const page = await listFactsFor(deps, who, { kind: of_kind, class: classId, stale, limit, after });
        if (filtered) return ok({ page });
        return ok({ overview: await overviewFor(deps, who), page });
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_content_inspect', descriptionFor('aimeat_content_inspect'), zodShapeFor('aimeat_content_inspect'),
    annotationsFor('aimeat_content_inspect'),
    async ({ kind, key, owner, stages, force }) => {
      try {
        return ok(await inspectFor(deps, caller(), { source: { kind, key, owner }, stages, force }));
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_content_scan', descriptionFor('aimeat_content_scan'), zodShapeFor('aimeat_content_scan'),
    annotationsFor('aimeat_content_scan'),
    async (args) => {
      const checked = checkContentInput('aimeat_content_scan', args);
      if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
      const { scan_id, ...input } = args;
      try {
        if (scan_id) return ok({ scan: scanStatusFor(deps, caller(), scan_id) });
        const { scan, already } = await scanFor(deps, caller(), input);
        return ok({ scan, already_running: already, next: `Follow it with aimeat_content_scan { scan_id: "${scan.id}" }.` });
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_content_classes', descriptionFor('aimeat_content_classes'), zodShapeFor('aimeat_content_classes'),
    annotationsFor('aimeat_content_classes'),
    async (args) => {
      // The action's fields, and the one it cannot run without (class for set, id for remove,
      // approve and reject), are checked before anything runs.
      const checked = checkContentInput('aimeat_content_classes', args);
      if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
      const { action, class: cls, id, status } = args;
      try {
        const who = caller();
        switch (action) {
          case 'list': return ok({ classes: await classesFor(deps, who) });
          case 'set': return ok({ class: await setClassFor(deps, who, cls) });
          case 'remove': {
            await removeClassFor(deps, who, String(id));
            return ok({ removed: id });
          }
          case 'proposals': return ok({ proposals: await proposalsFor(deps, who, status) });
          case 'approve':
          case 'reject': return ok({ proposal: await decideProposalFor(deps, who, String(id), action) });
          case 'ontology': return ok({ ontology: await ontologyFor(deps, who) });
          default: return toolError('INVALID_INPUT', 'action is list, set, remove, proposals, approve, reject or ontology.');
        }
      } catch (err) { return fail(err); }
    });

  mcp.tool('aimeat_content_settings', descriptionFor('aimeat_content_settings'), zodShapeFor('aimeat_content_settings'),
    annotationsFor('aimeat_content_settings'),
    async ({ patch }) => {
      try {
        const who = caller();
        if (patch === undefined) return ok({ settings: await settingsFor(deps, who) });
        return ok({ settings: await updateSettingsFor(deps, who, patch) });
      } catch (err) { return fail(err); }
    });
}
