/**
 * @file src/mcp/app-ui.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node-MCP door for the Atelier mosaic pair (TARGET-074):
 *   aimeat_app_ui_get / aimeat_app_ui_set. Calls the same AppUiService the REST routes do — one
 *   capability, one implementation — and scopes every call to the CALLER'S OWN OWNER via
 *   resolveAppOwnerScope, exactly as the screenshot tool does: an agent arranges its owner's
 *   apps and nobody else's, by construction rather than by comparison.
 * @structure registerAppUiTools(mcp, storage, config, getAgentGaii)
 * @usage
 *   import { registerAppUiTools } from './app-ui.js';
 *   registerAppUiTools(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-27 — Initial (TARGET-074 phase 2).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { aiProvenanceInputs, toDeclaredProvenance } from './ai-provenance-input.js';
import { descriptionFor } from './catalog/shape.js';
import { buildUiCatalogue } from '../services/app-ui/catalogue.js';
import { AppUiService } from '../services/app-ui/service.js';
import { AppUiError } from '../services/app-ui/validate.js';

/** One text block per answer; refusals carry the validator's words verbatim. */
function text(payload: unknown, isError = false) {
  return { content: [{ type: 'text' as const, text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) };
}

export function registerAppUiTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    const svc = new AppUiService(storage, config);

    mcp.tool(
        'aimeat_app_ui_get',
        descriptionFor('aimeat_app_ui_get'),
        {
            filename: z.string().describe('The published app file, e.g. "errands.html".'),
        },
        annotationsFor('aimeat_app_ui_get'),
        async ({ filename }) => {
            try {
                const app = await svc.ownApp(getAgentGaii(), filename);
                const { layout, version } = await svc.read(app.ownerGaii, filename);
                return text({
                    filename, layout, version,
                    source: layout ? 'stored' : 'none',
                    catalogue: buildUiCatalogue(),
                    note: layout
                        ? 'Send the WHOLE changed layout back with aimeat_app_ui_set — it replaces, never merges.'
                        : 'No stored layout yet: the app\'s own code decides. The catalogue above is the vocabulary a first layout is written in.',
                });
            } catch (err) {
                if (err instanceof AppUiError) return text(`${err.code}: ${err.message}`, true);
                throw err;
            }
        },
    );

    mcp.tool(
        'aimeat_app_ui_set',
        descriptionFor('aimeat_app_ui_set'),
        {
            filename: z.string().describe('The published app file the layout belongs to.'),
            layout: z.record(z.string(), z.unknown()).describe('The whole layout: { v: 1, look?, nav?, blocks: [...] }.'),
            note: z.string().optional().describe('One line on what this change was for.'),
            ...aiProvenanceInputs,
        },
        annotationsFor('aimeat_app_ui_set'),
        async ({ filename, layout, note, ai_provenance, ai_provenance_id }) => {
            try {
                const app = await svc.ownApp(getAgentGaii(), filename);
                const withNote = note ? { ...layout, meta: { ...(layout.meta as object ?? {}), note } } : layout;
                // A layout's titles and wording are text a person reads, so the write is stamped:
                // declared if the agent said something, Mint-3 if it said nothing. The service
                // mints, so every door carries the same decision.
                const out = await svc.write(app.ownerGaii, filename, withNote, {
                    principal: getAgentGaii(),
                    declaredId: ai_provenance_id,
                    declared: toDeclaredProvenance(ai_provenance),
                });
                return text({
                    filename,
                    version: out.version,
                    replaced_version: out.replaced_version,
                    note: out.replaced_version === null
                        ? 'First stored layout. The app renders it on its next open.'
                        : `Replaced version ${out.replaced_version} — it is archived, and restoring it is one call.`,
                });
            } catch (err) {
                if (err instanceof AppUiError) return text(`${err.code}: ${err.message}`, true);
                throw err;
            }
        },
    );
}
