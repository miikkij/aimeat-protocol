/**
 * @file src/routes/apps/fork-manage.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description App-catalog fork + owner-management routes: POST /v1/apps/:owner/:filename/fork,
 *   PATCH /v1/apps/:filename (rename/access-code/parked/forkable/protection/cortex), DELETE /v1/apps/:filename.
 *   Extracted from src/routes/apps.ts to satisfy max-file-lines.
 * @version-history
 *   v1.9.1 — 2026-10-05 — The account holder in person is asked with isOwnerInPerson (utils/gaii.ts; secaudit 2026-10, C4).
 *   v1.9.0 — 2026-10-05 — Operator checks ask isOperatorCaller/operatorOverride: the operator's agent holding operator:admin passes as on MCP, and a pass in another person's account writes the operator trail (secaudit 2026-10, C2).
 *   v1.8.0 — 2026-09-28 — PATCH refuses `cortex` (the bundled crew-defs) on an app a managed package
 *     install owns, 409 MANAGED_BY_PACKAGE (services/packages/install/package-managed.ts); the settings stay open.
 *   v1.7.0 — 2026-09-27 — PATCH writes name, description, descriptions, access_code, parked,
 *     forkable and protection through services/app-settings.ts (applyOwnerSettingsUpdate), and
 *     patchRefusal validates them with its parseOwnerSettingsInput, so the MCP tool
 *     aimeat_app_manage (action "settings") runs the same code. Pure extraction: same refusals,
 *     writes, audit entries, notes and response.
 *   v1.6.3 — 2026-09-26 — The fork's source owner comes from localAccountName (utils/gaii.ts), which
 *     keeps an identity of another node whole, so it never names the local namesake
 *     (secaudit 2026-09, F-1).
 *   v1.6.2 — 2026-09-26 — The marks update is told the node's label policy, so the reviewer note
 *     says what the visible label does on this node.
 *   v1.6.1 — 2026-09-24 — PATCH asks the provenance scope a legal declaration needs before its first
 *     write too (508c32904067): an agent holding app:write and not provenance:write renamed, parked
 *     and re-coded the app, and only the legal block, read last, answered 403.
 *   v1.6.0 — 2026-09-14 — PATCH asks every refusal the body can produce BEFORE its first write.
 *     It wrote each field as the walk reached it and refused where each was read, in a different
 *     order, so a delegated developer's PATCH carrying a rename and a reviewer's name landed the
 *     rename and then answered 403. Invariant 14.
 *   v1.5.0 — 2026-08-29 — PATCH takes `legal` (the app's own pages) through services/app-legal.ts,
 *     with `ai_provenance` / `ai_provenance_id` as every publish door takes them, and every field
 *     it changes lands in the app's audit log (services/app-audit.ts).
 *   v1.4.0 — 2026-08-29 — PATCH takes `marks` (badge, install) and `author` (the named reviewer,
 *     owner principal only) through services/app-marks.ts; the response carries their state.
 *   v1.3.0 — 2026-08-11 — August 2026 audit step 8: the fork's copy and the delete's bucket sweep go
 *     through services/app-lifecycle.ts, shared with aimeat_app_fork and aimeat_app_delete. The two
 *     gates stay here, because only an HTTP session carries the operator role they consult. The
 *     per-owner fork quota now reads services/install-quotas.ts (via the shared fork) instead of
 *     spelling the same ceiling out a second time.
 *   Fork description limits 2 000 → 10 000 — 2026-07-30.
 *   v1.1.0 — 2026-07-17 — Agent-Bundled Apps: PATCH accepts `cortex` — edit/clear the bundled
 *     crew-defs in place (validated fail-loud like publish) without re-uploading the HTML.
 *   v1.2.0 — 2026-08-01 — TARGET-058 Phase 5: a fork keeps the source's AI transparency posture
 *     and its provenance record. A fork of a generative app is still a generative app, and the
 *     statement used to reset to silence exactly when somebody else took the code over.
 *   v1.0.0 — 2026-07-13 — Extracted from src/routes/apps.ts (max-file-lines)
 */
import type { Router } from 'express';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { validateCortexAgents } from '../../models/crew-def-schemas.js';
import { requireAuth, requireScope } from '../../auth/middleware.js';
import { success, error } from '../../middleware/envelope.js';
import { emitChange } from '../../services/event-bus.js';
import { forkApp, deleteOwnedApp } from '../../services/app-lifecycle.js';
import { managedChangeRefusal } from '../../services/packages/install/package-managed.js';
import { resolveIdentity, ownerGhiiOf, localAccountName, isOwnerInPerson } from '../../utils/gaii.js';
import {
    applyOwnerSettingsUpdate, appSettingsState, appDownloadUrl, parseOwnerSettingsInput,
    SETTINGS_PRESENTATION_FIELDS, SETTINGS_OFFERING_FIELDS, type AppSettingsField, type AppSettingsInput,
} from '../../services/app-settings.js';
import { applyOwnerSeoUpdate, appSeoState, parseOwnerSeoInput } from '../../services/app-seo.js';
import {
    applyOwnerMarksUpdate, appMarksState, parseMarksInput, parseAuthorInput, AUTHOR_NEEDS_OWNER_PRINCIPAL,
} from '../../services/app-marks.js';
import {
    applyOwnerLegalUpdate, appLegalState, legalReadiness, appSellsForMoney, parseLegalInput, legalUpdateRefusal,
} from '../../services/app-legal.js';
import { recordAppAudit, type AppAuditAction } from '../../services/app-audit.js';
import { parseDeclaredProvenanceInput } from '../../mcp/ai-provenance-input.js';
import { appTargetOr, type AppTargetFor, type CanonicalOwner } from './helpers.js';
import { operatorOverride } from '../../services/operator-override.js';

/** What PATCH /v1/apps/:filename answers when the body cannot be carried out, before it writes. */
interface PatchRefusal { status: number; code: string; message: string; }

const bad = (message: string): PatchRefusal => ({ status: 400, code: 'INVALID_INPUT', message });

/**
 * Every refusal PATCH /v1/apps/:filename can produce from the body and the principal alone, asked
 * once, before the first write — see the comment at the call site for why the order is the point.
 *
 * It answers `null` when nothing in the body can be refused. What it deliberately does NOT cover is
 * the refusals that need storage: the app itself is looked up before this runs, the provenance
 * scope a legal declaration needs is asked right after it (legalUpdateRefusal), and a page that
 * disappears mid-request is a 404 no ordering can prevent.
 */
function patchRefusal(body: Record<string, unknown>, auth: Parameters<typeof isOwnerInPerson>[0], delegated: unknown): PatchRefusal | null {
    // The settings fields are asked in two parts around `cortex`, so that a body with two bad
    // fields is refused on the same one it always was.
    const presentation = parseOwnerSettingsInput(settingsPart(body, SETTINGS_PRESENTATION_FIELDS));
    if ('refusal' in presentation) return presentation.refusal;
    if ('cortex' in body && !isCortexClear(body.cortex)) {
        if (typeof body.cortex !== 'object' || body.cortex === null || Array.isArray(body.cortex)) {
            return bad('cortex must be an object (e.g. { "agents": [ ... ] }) or null to clear');
        }
        const check = validateCortexAgents((body.cortex as Record<string, unknown>).agents);
        if (!check.ok) return { status: 400, code: 'INVALID_CREW_DEF', message: check.errors.join('; ') };
    }
    const offering = parseOwnerSettingsInput(settingsPart(body, SETTINGS_OFFERING_FIELDS));
    if ('refusal' in offering) return offering.refusal;
    if ('seo' in body) {
        const parsed = parseOwnerSeoInput(body.seo);
        if ('error' in parsed) return bad(parsed.error);
    }
    if ('marks' in body) {
        const parsed = parseMarksInput(body.marks);
        if ('error' in parsed) return bad(parsed.error);
    }
    if ('author' in body) {
        // Never for a delegate, whatever rung they hold. Declaring the natural person who answers
        // for an app is the account holder's own act, and somebody signed in as the owner of THEIR
        // account is not the owner of this one. The same test services/app-marks.ts applies.
        const ownerPrincipal = delegated === null && isOwnerInPerson(auth);
        if (!ownerPrincipal) return { status: 403, code: 'ACCESS_DENIED', message: AUTHOR_NEEDS_OWNER_PRINCIPAL };
        const parsed = parseAuthorInput(body.author);
        if ('error' in parsed) return bad(parsed.error);
    }
    if ('legal' in body) {
        if (!parseDeclaredProvenanceInput(body.ai_provenance).ok) {
            return bad('Invalid ai_provenance declaration.');
        }
        const parsed = parseLegalInput(body.legal, '');
        if ('error' in parsed) return bad(parsed.error);
        if (!Object.keys(parsed.legal).length) return bad('legal names no page to set or remove');
    }
    return null;
}

/** The settings fields of `body` that `fields` names; the object is empty when it carries none. */
function settingsPart(body: Record<string, unknown>, fields: readonly AppSettingsField[]): AppSettingsInput {
    const part: AppSettingsInput = {};
    for (const f of fields) if (f in body) part[f] = body[f];
    return part;
}

/** `cortex: null` and `{ agents: [] }` both mean "take the bundled crew-defs off". */
function isCortexClear(cortex: unknown): boolean {
    return cortex === null || (typeof cortex === 'object' && cortex !== null && !Array.isArray(cortex)
        && Array.isArray((cortex as { agents?: unknown }).agents)
        && ((cortex as { agents: unknown[] }).agents).length === 0);
}

export function registerForkManageRoutes(
    router: Router,
    config: AimeatConfig,
    storage: Storage,
    canonicalOwner: CanonicalOwner,
    appTarget: AppTargetFor,
): void {
    // POST /v1/apps/:owner/:filename/fork — Fork an app into YOUR OWN catalogue.
    // Authorization has two independent gates, both must pass:
    //   1. Derivative permission — the source owner and the owner's own agents (same
    //      owner component) and operators may always fork; outsiders only when the
    //      source app is flagged `forkable`.
    //   2. Byte-access — a PAID source still requires the caller to be the seller or
    //      hold a license, so a server-side copy never bypasses the read paywall
    //      (mirrors the GET /v1/apps/:owner/:filename gate).
    // On success the source bytes + manifest are copied under the caller's canonical
    // owner as a NEW app (version 1), stamped with `manifest.forkedFrom` provenance,
    // its own `forkable` defaulting to false, and a fork event is recorded for lineage.
    router.post('/v1/apps/:owner/:filename/fork', requireAuth(), requireScope('app:write'), async (req, res) => {
        const sourceOwnerParam = req.params.owner as string;
        const sourceFilename = req.params.filename as string;
        const sourceOwner = localAccountName(sourceOwnerParam);

        const body = req.body ?? {};
        const newFilename = typeof body.new_filename === 'string' ? body.new_filename.trim() : '';
        const version = body.version !== undefined ? parseInt(String(body.version), 10) : undefined;

        // Load the source app (specific version if given, else latest).
        const source = await storage.getAppByOwnerName(sourceOwner, sourceFilename, version);
        if (!source) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${sourceFilename}" not found for owner "${sourceOwner}"${version ? ` (version ${version})` : ''}`));
            return;
        }

        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner: callerOwner, ownerGhii: callerGhii } = await canonicalOwner(req);
        const sameOwner = callerOwner === source.ownerName;
        // The operator check is asked only where one of the gates below would refuse a caller who is
        // not the owner, so the operator trail is written only for a fork that needed the override.
        const paidSource = !!(config.marketplaceEnabled && source.manifest.priceMorsels && source.manifest.priceMorsels > 0);
        const isOperator = !sameOwner && (!!source.operatorHidden || !source.forkable || paidSource)
            && await operatorOverride(storage, config, req.auth, {
                ownerOf: source.ownerName, area: 'app', action: 'fork', subject: sourceFilename,
            });

        // Operator-hidden apps are unreachable to everyone but their owner/operator —
        // mirror the read gate's 404 so moderation status is not leaked via fork.
        if (source.operatorHidden && !isOperator && !sameOwner) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${sourceFilename}" not found for owner "${sourceOwner}"`));
            return;
        }

        // Gate 1 — derivative permission.
        if (!isOperator && !sameOwner && !source.forkable) {
            res.status(403).json(error(config.nodeId, 'FORBIDDEN', 'This app is not open for forking by others. Ask the owner to enable forking.'));
            return;
        }

        // Gate 2 — a paid source's bytes must not bypass the paywall. The licence keys on the buyer's
        // OWNER GHII, the same coordinate the purchase receipt stored (app-store.ts) and the wallet
        // debited — not the raw `sub`, which on an owner session is a bare name that no receipt holds
        // (audit AI-triage 2026-08-23, invariant 1).
        if (paidSource && !sameOwner && !isOperator) {
            const hasLicense = await storage.hasValidLicense(ownerGhiiOf(callerGaii), source.ownerGaii, sourceFilename);
            if (!hasLicense) {
                res.status(402).json(error(config.nodeId, 'PURCHASE_REQUIRED', `This app costs ${source.manifest.priceMorsels} morsels. Purchase it first via POST /v1/app-store/purchase before forking.`));
                return;
            }
        }

        // Past the gates it is services/app-lifecycle.ts — the same copy aimeat_app_fork performs:
        // the target-name check, the shadowing check, the per-owner quota, the manifest with the
        // source's paid terms and private notes removed, the bytes, the screenshot, the lineage
        // event, the change log and the public feed.
        const out = await forkApp(storage, config, {
            source,
            callerOwner,
            callerGhii,
            callerGaii,
            newFilename,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }

        res.status(201).json(success(config.nodeId, {
            filename: out.filename,
            version_number: out.versionNumber,
            manifest: out.manifest,
            forkable: false,
            forked_from: out.forkedFrom,
            download_url: out.downloadUrl,
            versions_url: `${out.downloadUrl}/versions`,
            note: `Forked "${sourceFilename}" into your catalogue as "${out.filename}".`,
        }, [
            { description: 'Open the fork', method: 'GET', url: `${out.downloadUrl}?mode=inline` },
        ]));
    });

    // PATCH /v1/apps/:filename — Update an app you own (requires auth). Accepts
    // `name` / `description` (rename / re-describe in place, no re-publish),
    // `access_code` (set/remove protection), `parked` (hide from / restore to the
    // public catalogue) and/or `forkable` (allow others to fork). Fields are
    // independent: each is applied only when present.
    router.patch('/v1/apps/:filename', requireAuth(), requireScope('app:write'), async (req, res) => {
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        // WHICH act this PATCH is depends on what it carries. Renaming an app and rewriting its
        // description is how it presents itself; everything else here is how it is OFFERED - who may
        // fork it, what it costs to get in, its legal pages, its search visibility - and a rung that
        // stops at `presentation` does not reach any of that. Read from the body BEFORE the target is
        // resolved, because the act is what the rung is measured against.
        const patchBody = (req.body ?? {}) as Record<string, unknown>;
        const PRESENTATION = new Set(['name', 'description', 'descriptions', 'owner', 'ai_provenance', 'ai_provenance_id']);
        const touchesOffering = Object.keys(patchBody).some(k => !PRESENTATION.has(k));
        const t = await appTargetOr(appTarget, config, req, res, touchesOffering ? 'operate' : 'presentation');
        if (!t) return;
        const { owner, ownerGhii, delegated } = t;
        const filename = req.params.filename as string;

        // Same lookup order as DELETE: canonical owner-GHII bucket first,
        // then agent-GAII shadow bucket (pre-fix rows), then bare owner,
        // then a last-resort lookup by ownerName across all buckets.
        let app = await storage.getApp(ownerGhii, filename);
        let effectiveGaii = ownerGhii;
        if (!app) {
            app = await storage.getApp(callerGaii, filename);
            if (app) effectiveGaii = callerGaii;
        }
        if (!app) {
            app = await storage.getApp(owner, filename);
            if (app) effectiveGaii = owner;
        }
        if (!app) {
            const found = await storage.getAppByOwnerName(owner, filename);
            if (found && found.ownerName === owner) { app = found; effectiveGaii = found.ownerGaii; }
        }
        if (!app) {
            res.status(404).json(error(config.nodeId, 'NOT_FOUND', `App "${filename}" not found in your uploads`));
            return;
        }

        const body = req.body ?? {};

        // REFUSE BEFORE THE FIRST WRITE. Every field below is written as the walk reaches it and
        // refused where it is read, and the two are not in the same order: a delegated developer's
        // PATCH carrying `name`, `access_code`, `parked` and `author` together wrote the first
        // three and THEN answered 403 on the fourth, so a refused request left most of itself
        // standing. The same shape is every 400 here — a malformed `parked` landed the rename.
        //
        // So every refusal the body alone can produce is asked first, in one pass, and the write
        // phase below is reached only when nothing can say no. The parsers run twice, on purpose:
        // this pass calls the same exported parser the service that owns the field calls, so there
        // is one implementation of each rule and this is a second CALL, not a second copy.
        // Invariant 14. Found by the AI triage of 2026-09-13.
        const refusal = patchRefusal(body, req.auth, delegated);
        if (refusal) {
            res.status(refusal.status).json(error(config.nodeId, refusal.code, refusal.message));
            return;
        }
        // The one refusal the body cannot answer alone: whether this principal may DECLARE how a
        // legal page was made (provenance:write), which the store knows. Asked here, still before
        // the first write, by the same service the legal block below calls: an agent without the
        // scope renamed the app, parked it and set its code, and heard 403 only at the legal block.
        if ('legal' in body) {
            const declared = parseDeclaredProvenanceInput(body.ai_provenance);
            const legalRefusal = await legalUpdateRefusal(storage, config, app, {
                legal: body.legal, actor: { ghii: callerGaii },
                declared: declared.ok ? declared.declared : undefined,
                declaredId: typeof body.ai_provenance_id === 'string' ? body.ai_provenance_id : undefined,
            });
            if (legalRefusal) {
                const code = legalRefusal.status === 403 ? 'ACCESS_DENIED' : 'INVALID_INPUT';
                res.status(legalRefusal.status).json(error(config.nodeId, code, legalRefusal.error, legalRefusal.status, legalRefusal.details));
                return;
            }
        }
        // The bundled crew-defs are code. On an app a managed package install owns they come from
        // the package, and everything else in this PATCH is a setting the owner keeps
        // (services/packages/install/package-managed.ts). Asked before the first write, like the refusals above.
        if ('cortex' in body) {
            const managed = await managedChangeRefusal(storage, owner, 'app', filename, 'code');
            if (managed) {
                res.status(managed.status).json(error(config.nodeId, managed.code, managed.message, managed.status, managed.details));
                return;
            }
        }

        // Each field is independent and only touched when present in the body, so a
        // parked-only PATCH never clears the access code (and vice-versa).
        const notes: string[] = [];
        // Every change to how this app is offered lands in its audit log (services/app-audit.ts),
        // under the principal that made it — the agent's GAII when an agent did, so the owner can
        // tell their own hand from their agents'.
        const audit = (action: AppAuditAction, detail?: Record<string, string | number | boolean | null>) =>
            recordAppAudit(storage, { ownerGhii: effectiveGaii, filename, by: callerGaii, action, detail });

        // The app's own settings (name, descriptions, access code, parked, forkable, protection)
        // are services/app-settings.ts, which the MCP tool calls too. Called once per part, before
        // and after `cortex`, so the writes and the notes keep the order they always had.
        const settingsTarget = { ownerGaii: effectiveGaii, ownerName: owner, filename, callerGaii };
        const applySettings = async (fields: readonly AppSettingsField[]): Promise<boolean> => {
            const part = settingsPart(body, fields);
            if (Object.keys(part).length === 0) return true;
            const out = await applyOwnerSettingsUpdate(storage, config, settingsTarget, part);
            if ('refusal' in out) {
                res.status(out.refusal.status).json(error(config.nodeId, out.refusal.code, out.refusal.message));
                return false;
            }
            notes.push(...out.notes);
            return true;
        };
        if (!await applySettings(SETTINGS_PRESENTATION_FIELDS)) return;

        // Agent-Bundled Apps: edit the bundled crew-defs in place, without re-publishing the
        // HTML. Same fail-loud gate as publish (a malformed agents[] never lands in a manifest);
        // `cortex: null` or `{ "agents": [] }` removes the section entirely.
        if ('cortex' in body) {
            if (body.cortex === null || (typeof body.cortex === 'object' && !Array.isArray(body.cortex)
                && Array.isArray(body.cortex.agents) && body.cortex.agents.length === 0)) {
                await storage.updateAppMeta(effectiveGaii, filename, { cortex: null });
                notes.push('Bundled agents removed from the manifest.');
            } else {
                if (typeof body.cortex !== 'object' || Array.isArray(body.cortex)) {
                    res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'cortex must be an object (e.g. { "agents": [ ... ] }) or null to clear'));
                    return;
                }
                const check = validateCortexAgents((body.cortex as Record<string, unknown>).agents);
                if (!check.ok) {
                    res.status(400).json(error(config.nodeId, 'INVALID_CREW_DEF', check.errors.join('; ')));
                    return;
                }
                await storage.updateAppMeta(effectiveGaii, filename, {
                    cortex: { agents: check.agents as unknown as Record<string, unknown>[] },
                });
                notes.push(`Bundled agents updated (${check.agents.length} crew-def${check.agents.length === 1 ? '' : 's'}).`);
            }
        }

        if (!await applySettings(SETTINGS_OFFERING_FIELDS)) return;

        // Search visibility, and the wording that goes with it. Off by default on every app:
        // publishing makes an app public and shareable by link, and being findable in a search
        // engine is a separate decision its owner makes on purpose.
        if ('seo' in body) {
            // The whole sequence — strip the operator fields, merge rather than replace, describe
            // the state AFTER the write, announce only a genuine arrival — lives in one function
            // that the MCP door calls too. The note matters: in review mode an owner switching the
            // toggle on has made a request rather than a decision, and telling them the app is now
            // findable would be false.
            const out = await applyOwnerSeoUpdate(storage, config,
                { ownerGaii: effectiveGaii, ownerName: owner, filename }, body.seo);
            if ('error' in out) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', out.error));
                return;
            }
            await audit('seo', { state: out.state, index: out.seo.index === true });
            notes.push(out.note);
        }

        // The served chrome (badge, install chip) and the named reviewer. One service call for
        // both, shared with the MCP door. The reviewer is a legal act by a natural person, so the
        // service refuses it from anything but an OWNER PRINCIPAL — the same test
        // requireOwnerPrincipal() applies: an owner token with no agent, app or ecosystem role.
        // The owner NAME is not that test; every principal here carries it.
        if ('marks' in body || 'author' in body) {
            // Never for a delegate, whatever rung they hold. Declaring the natural person who
            // answers for an app is the account holder's own act, and somebody signed in as the
            // owner of THEIR account is not the owner of this one.
            const ownerPrincipal = delegated === null && isOwnerInPerson(req.auth);
            const out = await applyOwnerMarksUpdate(storage, { ownerGaii: effectiveGaii, filename }, {
                ...('marks' in body ? { marks: body.marks } : {}),
                ...('author' in body ? { author: body.author } : {}),
                actor: { ghii: ownerGhii, ownerPrincipal },
                labelPolicy: config.aiLabelPublic,
            });
            if ('error' in out) {
                const code = out.status === 403 ? 'ACCESS_DENIED' : out.status === 404 ? 'NOT_FOUND' : 'INVALID_INPUT';
                res.status(out.status).json(error(config.nodeId, code, out.error));
                return;
            }
            notes.push(out.note);
        }

        // The app's own legal pages: `{ terms: { format, content }, privacy: null, … }`. One service
        // call shared with the MCP door; it validates, writes, audits and says what changed.
        if ('legal' in body) {
            // The same `ai_provenance` / `ai_provenance_id` block every publish door takes: a legal
            // page is text a person reads, and an AI-drafted one carries its record.
            const declared = parseDeclaredProvenanceInput(body.ai_provenance);
            if (!declared.ok) {
                res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Invalid ai_provenance declaration.', 400, { violations: declared.violations }));
                return;
            }
            const out = await applyOwnerLegalUpdate(storage, config, { ownerGaii: effectiveGaii, filename }, {
                legal: body.legal, actor: { ghii: callerGaii },
                declared: declared.declared,
                declaredId: typeof body.ai_provenance_id === 'string' ? body.ai_provenance_id : undefined,
            });
            if ('error' in out) {
                const code = out.status === 404 ? 'NOT_FOUND' : out.status === 403 ? 'ACCESS_DENIED' : 'INVALID_INPUT';
                res.status(out.status).json(error(config.nodeId, code, out.error, out.status, out.details));
                return;
            }
            notes.push(out.note);
        }

        if (notes.length === 0) {
            res.status(400).json(error(config.nodeId, 'INVALID_INPUT', 'Provide at least one field to update (name, description, access_code, parked, forkable, protection, seo, marks, author or legal).'));
            return;
        }

        // Re-read so the response reflects the app's current state after the update(s).
        const updated = await storage.getApp(effectiveGaii, filename);

        res.json(success(config.nodeId, {
            // filename, name, description, protected, parked, forkable, protection: in this order.
            ...appSettingsState(updated, filename),
            // The STATE, not the switch. An owner who turned the switch on in review mode, or on a
            // blocked app, has to be able to see that the answer is still not "findable".
            seo: updated ? { state: appSeoState(updated, config), ...(updated.manifest?.seo ?? {}) } : null,
            // The chrome switches as they now stand, the reviewer, and the audit log of the latter.
            ...(updated ? appMarksState(updated) : {}),
            // The legal pages as their state (no content), and what the app still ought to have.
            ...(updated ? {
                legal: appLegalState(updated),
                legal_readiness: legalReadiness(updated, { sellsForMoney: await appSellsForMoney(storage, updated) }),
            } : {}),
            download_url: appDownloadUrl(owner, filename),
            note: notes.join(' '),
        }));
        emitChange('apps');
    });

    // DELETE /v1/apps/:filename — Remove an app you own (supports ?version=N)
    // Apps are owner-scoped: an agent acting on behalf of its owner can delete
    // the owner's apps. To clean up "ghost" rows created by old buggy publish
    // paths (different ownerGaii buckets for the same owner+filename), the
    // no-version case sweeps ALL buckets that match the owner name. A
    // single-version delete still targets one bucket (you might want to keep
    // versions in one bucket while removing a stray version from another).
    router.delete('/v1/apps/:filename', requireAuth(), requireScope('app:manage'), async (req, res) => {
        const callerGaii = resolveIdentity(req.auth!, config.nodeId);
        const { owner, ownerGhii } = await canonicalOwner(req);
        const filename = req.params.filename as string;
        const versionParam = req.query.version as string | undefined;
        const version = versionParam ? parseInt(versionParam, 10) : undefined;

        // The bucket sweep, the screenshot removal and the change-log line are
        // services/app-lifecycle.ts — the same function aimeat_app_delete calls. That tool used to
        // delete a single bucket and nothing else, so a ghost row from an old publish path survived
        // an agent's delete and its screenshot stayed in storage.
        const out = await deleteOwnedApp(storage, {
            ownerName: owner,
            ownerGhii,
            callerGaii,
            filename,
            version,
        });
        if ('refusal' in out) {
            res.status(out.refusal.status).json(error(
                config.nodeId, out.refusal.code, out.refusal.message, out.refusal.status, out.refusal.details));
            return;
        }

        res.json(success(config.nodeId, {
            filename,
            version_deleted: out.versionDeleted,
            note: version ? `Version ${version} deleted.` : 'App deleted (all versions).',
        }));
    });
}
