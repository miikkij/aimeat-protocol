/**
 * @file src/mcp/app-manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_app_manage on the node's own MCP server: one tool with an `action` parameter
 *   for every setting and read of one of the owner's apps (catalog/definitions/app-manage.ts has the
 *   action table). Each action calls the same service function its REST endpoint calls, so the
 *   validation, the refusals and the side effects are written once. This file reads no storage.
 *
 *   Replaces the node's ten app tools: aimeat_app_seo_set, _marks_set, _legal_set, _audit (app-legal.ts,
 *   app-marks.ts, seo.ts), _screenshot (apps-screenshot.ts), _visitors, _visitors_measure
 *   (app-visitors.ts), _versions (apps.ts) and _ui_get, _ui_set (app-ui.ts).
 *
 *   ORDER OF CHECKS. The field list first (every missing and foreign field in one answer), then the
 *   action's permission word (catalog/action-scopes.ts), then the service, which decides whose app it
 *   is and refuses what it has always refused.
 *
 *   THE MEMBER ACTIONS GO THROUGH THE ROUTE. routes/app-members.ts holds the roster logic in its
 *   handlers (the owner test, the seat cap, the grant sync, the notifications), and no service
 *   function carries it. So those actions call the route over loopback with the session's own
 *   bearer, through the same appManageCall() the connector and the CLI use, as aimeat_invoke and
 *   aimeat_contact_resolve_email do. The route's scope gate and its refusals are then the answer,
 *   so this file does not check their permission word a second time: the route's gate lets the
 *   app's own token through without the word, and a copy here would refuse what REST allows.
 * @structure registerAppManageTool
 * @usage registerAppManageTool(mcp, storage, config, agentGaii, scopes, getToken)
 * @version-history
 *   v1.5.0 — 2026-10-02 — spec, spec_set and spec_clear go over loopback to the design-spec routes with
 *     the member actions (MEMBER_ACTIONS in tool-dispatch/app-manage-call.ts).
 *   v1.4.0 — 2026-10-02 — builders, builder_set and builder_remove go over loopback to the dev-grants
 *     routes with the member actions (MEMBER_ACTIONS in tool-dispatch/app-manage-call.ts).
 *   v1.3.1 — 2026-10-01 — agent_deploy passes the caller's principal: with no runner, the agent
 *     becomes a proposal the owner approves.
 *   v1.3.0 — 2026-10-01 — audit answers the archived years and the limit, and reads a year; the new
 *     audit_archive and audit_keep go over their routes with the member actions.
 *   v1.2.0 — 2026-10-01 — The member actions (members, member_set, member_remove, member_decline,
 *     member_dismiss, member_plan_get, member_plan_set, member_sweep, member_me, member_request), over
 *     loopback to routes/app-members.ts with the session's bearer. registerAppManageTool takes getToken.
 *   v1.1.0 — 2026-09-28 — config_get and config_set call services/app-config.ts, as the REST routes do.
 *   v1.0.0 — 2026-09-27 — Initial (wish-app-toiminnot-ilman-mcp-ty-kalua-ja-ty-kalujen-m-r-n-hallint).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { toolError } from './tool-error.js';
import { aiProvenanceInputs, toDeclaredProvenance, type AiProvenanceToolInput } from './ai-provenance-input.js';
import { appManageShape } from './app-manage-shape.js';
import { checkAppManageInput } from './catalog/definitions/app-manage.js';
import { requiredScopeForAction } from './catalog/action-scopes.js';
import { answer, refusalText, plainRefusal, type ToolAnswer } from './app-manage-answers.js';
import { scopeIsCovered } from '../utils/scope-coverage.js';
import { localAccountName } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { resolveAppTargetScope } from '../services/app-lifecycle.js';
import { resolveOperatorAgentName, OPERATOR_AGENT_REFUSAL } from '../services/operator-principal.js';
import { ownerAppSeo } from '../services/app-seo.js';
import { ownerAppMarks } from '../services/app-marks.js';
import { ownerAppLegal } from '../services/app-legal.js';
import { ownerAppAudit } from '../services/app-audit.js';
import { applyOwnerSettingsUpdate, ownerAppSettings, SETTINGS_FIELDS, SETTINGS_OFFERING_FIELDS } from '../services/app-settings.js';
import { listAppVersionsView } from '../services/app-versions.js';
import { collectAppLineage } from '../services/app-lineage.js';
import { captureAppScreenshot } from '../services/screenshot-capture.js';
import { storeAppScreenshot, clearAppScreenshot } from '../services/app-screenshot-store.js';
import { mintDraftPreview } from '../services/app-draft-preview.js';
import { AppVisitorsError, clampDays, readAppVisitors, setAppMeasurement } from '../services/app-visitors.js';
import { buildUiCatalogueView } from '../services/app-ui/catalogue-index.js';
import { AppUiService } from '../services/app-ui/service.js';
import { AppUiError } from '../services/app-ui/validate.js';
import { appCostView } from '../services/app-cost.js';
import { getAppConfig, setAppConfig } from '../services/app-config.js';
import { deployAppAgent, appAgentInstances, appAgentStatus } from '../services/app-agent-deploy.js';
import { listActiveAppGrants } from '../services/app-grant-list.js';
import { exportAppsBackupToStorage } from '../services/apps-backup-export.js';
import {
    listSubdomainSites, createSubdomainSite, updateSubdomainSite, deleteSubdomainSite,
} from '../services/subdomain-sites.js';
import { appManageCall, MEMBER_ACTIONS } from '../tool-dispatch/app-manage-call.js';
import { AimeatClient } from '../tool-dispatch/api-client.js';

type Args = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The named fields that are present. Absent means "leave it alone". */
function pick(args: Args, fields: readonly string[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of fields) if (args[f] !== undefined && args[f] !== null) out[f] = args[f];
    return out;
}

export function registerAppManageTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
    scopes: string[],
    getToken: () => string | undefined = () => undefined,
): void {
    const ui = new AppUiService(storage, config);

    mcp.tool(
        'aimeat_app_manage',
        descriptionFor('aimeat_app_manage'),
        { ...appManageShape, ...aiProvenanceInputs },
        annotationsFor('aimeat_app_manage'),
        async (raw) => {
            const args = raw as Args;
            const checked = checkAppManageInput(args);
            if (!checked.ok) return toolError('INVALID_INPUT', checked.message);
            const action = checked.action;
            // A member action's permission word is checked by its route alone (requireScopeOrOwnApp),
            // so the answer is exactly what REST answers, owner bypass and the app's own token included.
            if (MEMBER_ACTIONS.has(action)) return viaRoute(args);
            const word = requiredScopeForAction('aimeat_app_manage', action);
            if (word && !scopeIsCovered(scopes, word)) {
                return toolError('SCOPE_DENIED', `action "${action}" needs the "${word}" permission, which the owner grants this agent in its settings.`);
            }
            try {
                return await dispatch(action, args);
            } catch (err) {
                if (err instanceof AppVisitorsError || err instanceof AppUiError) return toolError(err.code, err.message);
                throw err;
            }
        },
    );

    /**
     * A member action: the route over loopback, as the caller. Not config.baseUrl, which would add a
     * public-internet hop for a call that never leaves this host. The owner defaults to the caller's
     * own account, as on the connector and the CLI.
     */
    async function viaRoute(args: Args): Promise<ToolAnswer> {
        const bearer = getToken();
        if (!bearer) return toolError('AUTH_REQUIRED', 'This session carries no credential to reach the member roster with.');
        const client = new AimeatClient(`http://127.0.0.1:${config.port}`, bearer);
        const out = await appManageCall(client, localAccountName(getAgentGaii()), args);
        if (!out.ok) return toolError(out.error?.code ?? 'REFUSED', out.error?.message ?? 'The member roster refused the call.');
        return answer(out.data ?? {});
    }

    async function dispatch(action: string, args: Args): Promise<ToolAnswer> {
        const callerGaii = getAgentGaii();
        const callerOwner = localAccountName(callerGaii);
        const ownerGhii = `${callerOwner}@${config.nodeId}`;
        const filename = String(args.filename ?? '');
        const appOwner = str(args.owner) ?? callerOwner;
        const declared = toDeclaredProvenance(args.ai_provenance as AiProvenanceToolInput | undefined);
        const declaredId = str(args.ai_provenance_id);

        /** Whose app, for an act a development grant may carry; a refusal names why not. */
        const target = async (act: 'draft' | 'presentation' | 'operate') => {
            const scope = await resolveAppTargetScope(storage, config, { principal: callerGaii, owner: str(args.owner), filename, act });
            if (!scope) return { refusal: 'Failed to parse the agent identity.' };
            return scope;
        };

        switch (action) {
            case 'settings': {
                const fields = pick(args, SETTINGS_FIELDS);
                const touchesOffering = SETTINGS_OFFERING_FIELDS.some(f => f in fields);
                const scope = await target(touchesOffering ? 'operate' : 'presentation');
                if ('refusal' in scope) return toolError('FORBIDDEN', scope.refusal);
                const appTarget = { ownerGaii: scope.ownerGhii, ownerName: scope.ownerName, filename };
                const out = await applyOwnerSettingsUpdate(storage, config, { ...appTarget, callerGaii }, fields);
                if ('refusal' in out) return refusalText(out.refusal);
                const state = await ownerAppSettings(storage, config, appTarget);
                if ('refusal' in state) return refusalText(state.refusal);
                return answer({ ...state, ...(out.notes.length ? { note: out.notes.join(' ') } : {}) });
            }
            case 'seo': {
                const out = await ownerAppSeo(storage, config, { callerGaii, filename, seo: pick(args, ['index', 'title', 'description', 'keywords', 'image', 'lang']) });
                if ('error' in out) return plainRefusal(out.error);
                return answer({ filename, state: out.state, ...(out.note ? { note: out.note } : {}), seo: out.seo });
            }
            case 'marks': {
                const out = await ownerAppMarks(storage, config, { callerGaii, filename, marks: pick(args, ['badge', 'install']) });
                if ('error' in out) return plainRefusal(out.error);
                return answer({ filename, ...(out.note ? { note: out.note } : {}), marks: out.state.marks, reviewer: out.state.authorship?.name ?? null });
            }
            case 'legal': {
                // One page per call; naming no kind is a question.
                let legal: Record<string, unknown> | undefined;
                const kind = str(args.kind);
                if (kind) {
                    if (args.remove) legal = { [kind]: null };
                    else if (args.format && args.content !== undefined) legal = { [kind]: { format: args.format, content: args.content } };
                    else return toolError('INVALID_INPUT', 'To set a page give format and content; to remove it give remove: true.');
                }
                const out = await ownerAppLegal(storage, config, { callerGaii, filename, legal, declared, declaredId });
                if ('error' in out) return plainRefusal(out.error);
                return answer({ filename, ...(out.note ? { note: out.note } : {}), pages: out.state, readiness: out.readiness });
            }
            case 'audit': {
                const out = await ownerAppAudit(storage, config, {
                    callerGaii, filename, limit: typeof args.limit === 'number' ? args.limit : undefined, playtest: args.playtest === true,
                    year: typeof args.year === 'string' && args.year ? args.year : undefined,
                });
                if ('error' in out) return plainRefusal(out.error);
                return answer({
                    filename, total: out.total, entries: out.entries, archives: out.archives, keep: out.keep,
                    ...(out.year ? { year: out.year } : {}), ...(out.live ? { live: out.live } : {}),
                });
            }
            case 'versions': {
                const out = await listAppVersionsView(storage, config, appOwner, filename);
                if (!out.ok) return refusalText(out);
                return answer({ ...out.data, ...(out.provenance ? { provenance: out.provenance } : {}) });
            }
            case 'lineage': {
                const out = await collectAppLineage(storage, localAccountName(appOwner), filename);
                if (!out) return toolError('NOT_FOUND', `App "${filename}" not found for owner "${localAccountName(appOwner)}".`);
                return answer(out);
            }
            case 'screenshot': {
                const scope = await target('presentation');
                if ('refusal' in scope) return toolError('FORBIDDEN', scope.refusal);
                const out = await captureAppScreenshot(config, storage, { ownerName: scope.ownerName, filename });
                if (!out.ok) return toolError(out.code, out.message);
                const base = config.baseUrl.replace(/\/+$/, '');
                return answer({
                    filename, captured: true, size_bytes: out.sizeBytes,
                    screenshot_url: `${base}/v1/apps/${encodeURIComponent(scope.ownerName)}/${encodeURIComponent(filename)}/screenshot`,
                    note: 'The page was rendered at 1200x750 and the image stored. The URL needs no authentication, so you can pass '
                        + 'it straight to a vision model to look at what you built. It also replaces the thumbnail the catalogue showed.',
                });
            }
            case 'screenshot_upload': {
                const scope = await target('presentation');
                if ('refusal' in scope) return toolError('FORBIDDEN', scope.refusal);
                const out = await storeAppScreenshot(storage, {
                    owner: scope.ownerName, filename, screenshot: args.screenshot, screenshot_mime_type: args.screenshot_mime_type,
                });
                return out.ok ? answer(out.data) : refusalText(out);
            }
            case 'screenshot_clear': {
                const scope = await target('presentation');
                if ('refusal' in scope) return toolError('FORBIDDEN', scope.refusal);
                const out = await clearAppScreenshot(storage, config, { owner: scope.ownerName, filename });
                return out.ok ? answer(out.data) : refusalText(out);
            }
            case 'preview_link': {
                const scope = await target('draft');
                if ('refusal' in scope) return toolError('FORBIDDEN', scope.refusal);
                const out = await mintDraftPreview(storage, config, { owner: scope.ownerName, ownerGhii: scope.ownerGhii, filename });
                return 'refusal' in out ? refusalText(out.refusal) : answer(out);
            }
            case 'visitors':
                return answer(await readAppVisitors(storage, {
                    app: { owner: callerOwner, filename }, days: clampDays(args.days as number | undefined),
                    geoAvailable: config.geoHeaders, geoAttribution: config.geoAttribution,
                }));
            case 'visitors_measure': {
                const out = await setAppMeasurement(storage, { app: { owner: callerOwner, filename }, on: args.on === true, geo: str(args.geo) });
                emitChange('signals', ownerGhii);
                return answer({ app: `${callerOwner}/${filename}`, ...out, geo_available: config.geoHeaders });
            }
            case 'ui_get': {
                const app = await ui.ownApp(callerGaii, filename);
                const { layout, version } = await ui.read(app.ownerGaii, filename);
                return answer({
                    filename, layout, version, source: layout ? 'stored' : 'none',
                    catalogue: buildUiCatalogueView('index', Array.isArray(args.detail) ? args.detail as string[] : []),
                    note: layout
                        ? 'Send the WHOLE changed layout back with action "ui_set": it replaces, never merges.'
                        : 'No stored layout yet: the app\'s own code decides. The catalogue above is the vocabulary a first layout is written in.',
                });
            }
            case 'ui_set': {
                const app = await ui.ownApp(callerGaii, filename);
                const layout = (args.layout ?? {}) as Record<string, unknown>;
                const withNote = args.note ? { ...layout, meta: { ...((layout.meta as object) ?? {}), note: args.note } } : layout;
                const out = await ui.write(app.ownerGaii, filename, withNote, { principal: callerGaii, declaredId, declared });
                return answer({
                    filename, version: out.version, replaced_version: out.replaced_version,
                    note: out.replaced_version === null
                        ? 'First stored layout. The app renders it on its next open.'
                        : `Replaced version ${out.replaced_version}. It is archived; action "ui_restore" with that version puts it back.`,
                });
            }
            case 'ui_restore': {
                const app = await ui.ownApp(callerGaii, filename);
                return answer(await ui.restore(app.ownerGaii, filename, Number(args.version), { principal: callerGaii }));
            }
            case 'config_get': {
                const out = await getAppConfig(storage, appOwner, filename);
                return out.ok ? answer(out.view) : toolError(out.code, out.message);
            }
            case 'config_set': {
                const out = await setAppConfig(storage, { callerOwnerGhii: ownerGhii, ownerName: appOwner, filename, values: args.values });
                return out.ok ? answer(out.view) : toolError(out.code, out.message);
            }
            case 'cost': {
                const out = await appCostView(storage, config, { owner: callerOwner, ownerGhii, appId: `${localAccountName(appOwner)}/${filename}` });
                return out.ok ? answer(out.view) : refusalText(out);
            }
            case 'agent_deploy':
            case 'agent_undeploy': {
                const out = await deployAppAgent(storage, config, {
                    callerOwner, appOwner, filename, agentName: String(args.bundled_agent),
                    runnerAgent: str(args.runner_agent), organismId: str(args.organism_id), undeploy: action === 'agent_undeploy',
                    // A deploy with no runner becomes a proposal for the owner (services/app-agent-propose.ts).
                    principal: { sub: callerGaii, owner: callerOwner, roles: callerGaii.includes('#') ? ['agent'] : ['owner'], scopes },
                });
                return out.ok ? answer(out.view) : refusalText(out);
            }
            case 'agent_instances': {
                const out = await appAgentInstances(storage, config, { appOwner, filename, agentName: String(args.bundled_agent), callerOwner });
                return out.ok ? answer(out.view) : refusalText(out);
            }
            case 'agent_status': {
                const out = await appAgentStatus(storage, config, {
                    callerOwner, appOwner, filename, agentName: String(args.bundled_agent), runnerAgent: str(args.runner_agent),
                });
                return out.ok ? answer(out.view) : refusalText(out);
            }
            case 'grants':
                return answer({
                    ...(await listActiveAppGrants(storage, callerOwner)),
                    next: 'Revoking an app\'s permissions is the owner\'s own act, on the Access page of their settings.',
                });
            case 'backup_export': {
                const out = await exportAppsBackupToStorage(storage, config, ownerGhii, callerOwner);
                if (!out.ok) return refusalText(out);
                return answer({
                    ...out,
                    next: 'Fetch the file with aimeat_storage_download. Restoring a backup is the owner\'s own act, on the App Catalog page.',
                });
            }
            case 'subdomain_list':
            case 'subdomain_set':
            case 'subdomain_delete': {
                // The operator's own agent, holding operator:admin: the same test the REST gate makes.
                if (!(await resolveOperatorAgentName(storage, callerGaii, scopes))) return toolError('ACCESS_DENIED', OPERATOR_AGENT_REFUSAL);
                if (action === 'subdomain_list') return answer(await listSubdomainSites(storage));
                const sub = String(args.subdomain);
                if (action === 'subdomain_delete') {
                    const out = await deleteSubdomainSite(storage, sub);
                    return out.ok ? answer(out) : refusalText(out);
                }
                const body: Record<string, unknown> = pick(args, ['target', 'enabled']);
                if (args.subdomain_kind !== undefined) body.kind = args.subdomain_kind;
                const updated = await updateSubdomainSite(storage, config, sub, body);
                if (updated.ok) return answer({ site: updated.site, created: false });
                if (updated.code !== 'NOT_FOUND') return refusalText(updated);
                const created = await createSubdomainSite(storage, config, { subdomain: sub, ...body }, callerGaii);
                return created.ok ? answer({ site: created.site, created: true }) : refusalText(created);
            }
            default:
                return toolError('INVALID_INPUT', `Unknown action "${action}".`);
        }
    }
}
