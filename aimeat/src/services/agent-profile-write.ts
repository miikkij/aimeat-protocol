/**
 * @file src/services/agent-profile-write.ts
 * @description Writing the owner-managed and self-reported fields of an agent record: tags, mode,
 *   capabilities, and the platform an agent reports about itself.
 *
 *   Every one of these existed twice, once in an HTTP handler and once in an MCP tool, and each
 *   pair had drifted:
 *
 *   - Capabilities. PUT /v1/agents/:name/capabilities stopped folding languages into the domain
 *     list in May 2026 and gave them their own field; aimeat_agent_capabilities_report kept
 *     pushing "Language: fi" into domainCapabilities and never wrote `languages`, so an agent that
 *     onboarded through MCP had a polluted domain list and read as speaking nothing everywhere the
 *     UI shows languages.
 *   - Mode. PATCH /v1/agents/:name/mode re-derives the Hello Integration step list when the new
 *     mode has a different flow, so a crew that self-sets task-runner sees 7/7 instead of 7/16.
 *     The comment on that code names aimeat_agent_mode_set as the caller it was written for, and
 *     aimeat_agent_mode_set was the one door that did not have it.
 *   - Tags. The tool accepted a bare agent name only; the route also accepted a full GAII.
 *
 *   The cost of leaving them apart is paid by whoever fixes the next one: three write sites for one
 *   record, and no way to tell from either which of them is current.
 * @structure
 *   - AgentWriteOutcome: a stored record or a refusal code each surface renders its own way
 *   - normaliseAgentProfile(): the field vocabulary (tags, mode, scopes, name, description)
 *   - setAgentTags() / setAgentMode() / setAgentConsoleUrl(): same-owner gated writes on a sibling
 *   - setAgentProfile(): several of those fields in one write, for the operator configure tool
 *   - syncOnboardingFlowToMode(): re-derive the Hello Integration steps after a mode change
 *   - setAgentCapabilities(): validated capability self-report
 *   - recordSelfReportedPlatform(): the platform/model stamp written by the identify_platform step
 * @usage
 *   const outcome = await setAgentMode({ storage, config }, req.auth!.owner, name, req.body?.mode);
 *   if (!outcome.ok) return renderRefusal(outcome.code, outcome.message);
 * @version-history
 *   v1.3.0 -- 2026-08-13 -- setAgentConsoleUrl(): where the agent's HOST manages it. An agent created
 *     from a chat runs in a fleet runtime the node has never heard of, so the person is told it is
 *     running and has nowhere to go and look at it. Same-owner gated like tags and mode, because the
 *     party that knows the address is usually the sibling that created the agent, not a person.
 *   v1.2.0 -- 2026-08-11 -- recordSelfReportedPlatform() also sets the mode the reported platform
 *     implies (workstation), because an agent in the user's own tool cannot pass configure_delivery
 *     and was left at a checklist that never completes. Only an unchosen mode is overwritten.
 *   v1.1.0 -- 2026-08-11 -- setAgentProfile() and normaliseAgentProfile(), for the multi-field write
 *     aimeat_operator_agent_configure was making on its own. That tool wrote tags verbatim where
 *     this file trims, lowercases, de-duplicates and caps them; it wrote a mode without re-deriving
 *     the Hello Integration step list; and it accepted an empty scope list, which PATCH
 *     /v1/agents/:name/scopes refuses. The tag and mode rules are the ones already here; the scope
 *     and length rules are read from the doors that state them (management.ts and the registration
 *     schema), so this file is now where an agent record's field vocabulary lives.
 *   v1.0.0 -- 2026-08-11 -- Extracted from routes/agent-capabilities.ts,
 *     routes/agents/profile-metadata.ts, mcp/agent-capabilities.ts and mcp/agent-management.ts
 *     (August 2026 MCP audit, step 8).
 */
import type { AimeatConfig } from '../config.js';
import type { AgentRecord, AgentTechnicalCapability, Storage } from '../storage/interface.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';
import { deriveStepsForMode } from '../models/agent-onboarding-schemas.js';
import { AgentCapabilitiesUpdateSchema } from '../models/agent-capabilities-schemas.js';
import { inferModeFromPlatform } from './platform-detector.js';
import { VALID_MODES } from '../routes/agents/constants.js';
import { logger } from '../utils/logger.js';

export interface AgentWriteDeps {
    storage: Storage;
    config: AimeatConfig;
}

/** A refusal carries a code so HTTP can pick a status and a translated message of its own. */
export interface AgentWriteRefusal {
    ok: false;
    code: 'AGENT_NOT_FOUND' | 'ACCESS_DENIED' | 'INVALID_INPUT' | 'UPDATE_FAILED';
    message: string;
}

export type AgentWriteOutcome = { ok: true; agent: AgentRecord } | AgentWriteRefusal;

// Colons are allowed so faceted tags (source:crewai, role:researcher) validate and compose
// with aimeat_discover's `tags` CSV filter; '@' stays excluded to keep tags distinct from GAII.
const TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const MAX_TAGS = 20;

// The bounds the rest of the node states for these fields. Scopes: PATCH /v1/agents/:name/scopes
// refuses a non-array or an empty list, and models/schemas.ts caps a registration request at 50
// scopes of 64 characters. Name and description: the registration schema is the only door that ever
// bounded them, because nothing but this file writes them again afterwards.
const MAX_SCOPES = 50;
const MAX_SCOPE_LENGTH = 64;
const MAX_DISPLAY_NAME = 128;
const MAX_DESCRIPTION = 10_000;
const MAX_CONSOLE_URL = 2048;

/**
 * Resolve what a caller named into a GAII under the caller's OWN owner. A bare name is built into
 * a GAII; a full GAII is taken as given and then has to survive the same-owner check below, which
 * is what stops a caller naming someone else's agent.
 */
export function resolveAgentTarget(config: AimeatConfig, callerOwner: string, identifier: string): string {
    return identifier.includes('#') ? identifier : buildGAII(identifier, callerOwner, config.nodeId);
}

/** Load the target agent and refuse unless it belongs to the caller's owner. */
async function loadSameOwnerAgent(
    deps: AgentWriteDeps,
    callerOwner: string,
    identifier: string,
    accessDeniedMessage: string,
): Promise<{ ok: true; gaii: string; agent: AgentRecord } | AgentWriteRefusal> {
    const gaii = resolveAgentTarget(deps.config, callerOwner, identifier);
    const agent = await deps.storage.getAgent(gaii);
    if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    if (agent.owner !== callerOwner) return { ok: false, code: 'ACCESS_DENIED', message: accessDeniedMessage };
    return { ok: true, gaii, agent };
}

/**
 * Trim, lowercase, de-duplicate and cap a tag list. Empty entries are dropped; anything that fails
 * TAG_PATTERN refuses the whole call rather than being silently skipped, so a typo does not look
 * like it was accepted.
 */
function normaliseTags(rawTags: unknown): { ok: true; tags: string[] } | AgentWriteRefusal {
    if (!Array.isArray(rawTags)) {
        return { ok: false, code: 'INVALID_INPUT', message: 'tags must be an array of strings' };
    }

    const tags: string[] = [];
    for (const value of rawTags) {
        if (typeof value !== 'string') {
            return { ok: false, code: 'INVALID_INPUT', message: 'tags must be an array of strings' };
        }
        const tag = value.trim().toLowerCase();
        if (!tag) continue;
        if (!TAG_PATTERN.test(tag)) {
            return { ok: false, code: 'INVALID_INPUT', message: `Invalid tag: ${value}` };
        }
        if (!tags.includes(tag)) tags.push(tag);
    }
    if (tags.length > MAX_TAGS) {
        return { ok: false, code: 'INVALID_INPUT', message: `An agent can have at most ${MAX_TAGS} tags` };
    }
    return { ok: true, tags };
}

/** The mode vocabulary, from the route constants so there is one list. */
function normaliseMode(rawMode: unknown): { ok: true; mode: NonNullable<AgentRecord['mode']> } | AgentWriteRefusal {
    if (typeof rawMode !== 'string' || !(VALID_MODES as readonly string[]).includes(rawMode)) {
        return { ok: false, code: 'INVALID_INPUT', message: `mode must be one of: ${VALID_MODES.join(', ')}` };
    }
    return { ok: true, mode: rawMode as NonNullable<AgentRecord['mode']> };
}

/**
 * Check a replacement scope list against what the node allows an agent to hold.
 *
 * An empty list is refused, because an agent holding zero scopes has its whole tool surface
 * filtered away and no door left to fix itself through. The node ceiling is `config.maxAgentScopes`,
 * inert on a default node ('*') and the operator's answer on a restricted one; PATCH
 * /v1/agents/:name/scopes calls the same refusal INVALID_SCOPES, which folds into INVALID_INPUT
 * here so callers keep one refusal vocabulary.
 */
function normaliseScopes(config: AimeatConfig, raw: unknown): { ok: true; scopes: string[] } | AgentWriteRefusal {
    if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'scopes must be a non-empty array of strings' };
    }
    if (raw.length > MAX_SCOPES) {
        return { ok: false, code: 'INVALID_INPUT', message: `An agent can hold at most ${MAX_SCOPES} scopes` };
    }
    if (!raw.every((s: unknown): s is string => typeof s === 'string' && s.length > 0 && s.length <= MAX_SCOPE_LENGTH)) {
        return {
            ok: false, code: 'INVALID_INPUT',
            message: `Each scope must be a non-empty string of at most ${MAX_SCOPE_LENGTH} characters`,
        };
    }
    if (!config.maxAgentScopes.includes('*')) {
        const invalid = raw.filter(s => {
            if (s === '*') return true;
            const [domain] = s.split(':');
            return !config.maxAgentScopes.includes(s) && !config.maxAgentScopes.includes(`${domain}:*`);
        });
        if (invalid.length > 0) {
            return { ok: false, code: 'INVALID_INPUT', message: `Scopes exceed node maximum: ${invalid.join(', ')}` };
        }
    }
    return { ok: true, scopes: [...raw] };
}

/** The fields a caller may set on an agent record through this file. Each one arrives unvalidated. */
export interface AgentProfileFields {
    displayName?: unknown;
    description?: unknown;
    mode?: unknown;
    tags?: unknown;
    defaultScopes?: unknown;
}

/**
 * Turn a caller's field bag into the exact record update, or refuse it.
 *
 * Separate from the write so a door that proposes a change before applying it can refuse bad input
 * and show the value it will actually store. Tags come back normalised, which is what makes the
 * proposal a proposal rather than a guess: `aimeat_operator_agent_configure` shows the owner a diff
 * and mints a token bound to it, and the token has to bind to the stored form.
 */
export function normaliseAgentProfile(
    config: AimeatConfig,
    fields: AgentProfileFields,
): { ok: true; updates: Partial<AgentRecord> } | AgentWriteRefusal {
    const updates: Partial<AgentRecord> = {};

    if (fields.displayName !== undefined) {
        if (typeof fields.displayName !== 'string' || fields.displayName.length > MAX_DISPLAY_NAME) {
            return {
                ok: false, code: 'INVALID_INPUT',
                message: `display name must be a string of at most ${MAX_DISPLAY_NAME} characters`,
            };
        }
        updates.displayName = fields.displayName;
    }

    if (fields.description !== undefined) {
        if (typeof fields.description !== 'string' || fields.description.length > MAX_DESCRIPTION) {
            return {
                ok: false, code: 'INVALID_INPUT',
                message: `description must be a string of at most ${MAX_DESCRIPTION} characters`,
            };
        }
        updates.description = fields.description;
    }

    if (fields.mode !== undefined) {
        const mode = normaliseMode(fields.mode);
        if (!mode.ok) return mode;
        updates.mode = mode.mode;
    }

    if (fields.tags !== undefined) {
        const tags = normaliseTags(fields.tags);
        if (!tags.ok) return tags;
        updates.tags = tags.tags;
    }

    if (fields.defaultScopes !== undefined) {
        const scopes = normaliseScopes(config, fields.defaultScopes);
        if (!scopes.ok) return scopes;
        updates.defaultScopes = scopes.scopes;
    }

    return { ok: true, updates };
}

/**
 * Where the agent's HOST manages it, checked before it is stored.
 *
 * This value is rendered as a link the owner clicks, and it arrives from a principal rather than
 * from the node, so the scheme is the gate: `javascript:` and `data:` are links too, and a stored
 * one would run in the owner's own session the moment they clicked the agent card. http and https
 * are the whole vocabulary. Length is capped because nothing legitimate needs more and a URL column
 * is not a place to park text.
 *
 * Empty or null clears it, which is how a host that moved says so.
 */
function normaliseConsoleUrl(raw: unknown): { ok: true; consoleUrl: string | null } | AgentWriteRefusal {
    if (raw === null || raw === undefined || raw === '') return { ok: true, consoleUrl: null };
    if (typeof raw !== 'string') {
        return { ok: false, code: 'INVALID_INPUT', message: 'console_url must be a string, or null to clear it' };
    }
    const value = raw.trim();
    if (value.length > MAX_CONSOLE_URL) {
        return { ok: false, code: 'INVALID_INPUT', message: `console_url must be at most ${MAX_CONSOLE_URL} characters` };
    }
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        // The exception IS the answer: an address that will not parse is not one.
        return { ok: false, code: 'INVALID_INPUT', message: 'console_url must be an absolute http(s) URL' };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { ok: false, code: 'INVALID_INPUT', message: 'console_url must be an absolute http(s) URL' };
    }
    return { ok: true, consoleUrl: value };
}

/**
 * Point a same-owner agent at the page where its HOST manages it.
 *
 * Same-owner rather than owner-only, matching tags and mode, and for the same reason those are: the
 * writer is usually not a person. An agent created by a sibling (a hatchery concierge acting on a
 * task) is the case this exists for, and that sibling is the only party that knows the address.
 */
export async function setAgentConsoleUrl(
    deps: AgentWriteDeps,
    callerOwner: string,
    identifier: string,
    rawUrl: unknown,
): Promise<AgentWriteOutcome> {
    const target = await loadSameOwnerAgent(deps, callerOwner, identifier,
        'You can only set the console address of agents owned by the same owner');
    if (!target.ok) return target;

    const normalised = normaliseConsoleUrl(rawUrl);
    if (!normalised.ok) return normalised;

    const updated = await deps.storage.updateAgent(target.gaii, { consoleUrl: normalised.consoleUrl });
    if (!updated) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    emitChange('agents');
    return { ok: true, agent: updated };
}

/** Replace the tag list on a same-owner agent, normalised by the rules in normaliseTags(). */
export async function setAgentTags(
    deps: AgentWriteDeps,
    callerOwner: string,
    identifier: string,
    rawTags: unknown,
): Promise<AgentWriteOutcome> {
    const target = await loadSameOwnerAgent(deps, callerOwner, identifier,
        'You can only update tags for agents owned by the same owner');
    if (!target.ok) return target;

    const normalised = normaliseTags(rawTags);
    if (!normalised.ok) return normalised;

    const updated = await deps.storage.updateAgent(target.gaii, { tags: normalised.tags });
    if (!updated) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
    emitChange('agents');
    return { ok: true, agent: updated };
}

/**
 * Set several owner-managed fields of a same-owner agent in one write, with the same vocabulary the
 * single-field writers use and the same Hello Integration step-list re-derive a mode change owes.
 *
 * The caller decides whether the change is ALLOWED (the operator tool's narrow-only rule on scopes
 * is a privilege question, and it stays where the propose-then-confirm flow can answer it before a
 * token is minted); this decides whether the values are WELL FORMED and performs the write.
 */
export async function setAgentProfile(
    deps: AgentWriteDeps,
    callerOwner: string,
    identifier: string,
    fields: AgentProfileFields,
): Promise<AgentWriteOutcome> {
    const target = await loadSameOwnerAgent(deps, callerOwner, identifier,
        'You can only configure agents owned by the same owner');
    if (!target.ok) return target;

    const normalised = normaliseAgentProfile(deps.config, fields);
    if (!normalised.ok) return normalised;
    if (Object.keys(normalised.updates).length === 0) {
        return { ok: false, code: 'INVALID_INPUT', message: 'No fields to change' };
    }

    const updated = await deps.storage.updateAgent(target.gaii, normalised.updates);
    if (!updated) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };

    // A mode change owes the step-list re-derive whether it arrived alone or alongside a rename.
    if (normalised.updates.mode) await syncOnboardingFlowToMode(deps.storage, target.gaii, normalised.updates.mode);

    emitChange('agents');
    return { ok: true, agent: updated };
}

/**
 * Set the operational mode of a same-owner agent, then bring its Hello Integration step list in
 * line with the mode's flow.
 *
 * The step-list sync fires whenever the stored step SET differs from what the mode asks for, so it
 * also repairs an agent already in the target mode with a stale set, and is a no-op otherwise.
 * Progress on steps that carry over (same id) is preserved. Best-effort: a sync failure must never
 * fail the mode change, which is the write the caller asked for.
 */
export async function setAgentMode(
    deps: AgentWriteDeps,
    callerOwner: string,
    identifier: string,
    rawMode: unknown,
): Promise<AgentWriteOutcome> {
    const target = await loadSameOwnerAgent(deps, callerOwner, identifier,
        'You can only update the mode of agents owned by the same owner');
    if (!target.ok) return target;

    const checked = normaliseMode(rawMode);
    if (!checked.ok) return checked;
    const mode = checked.mode;

    const updated = await deps.storage.updateAgent(target.gaii, { mode });
    if (!updated) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };

    await syncOnboardingFlowToMode(deps.storage, target.gaii, mode);

    emitChange('agents');
    return { ok: true, agent: updated };
}

/**
 * Re-derive the Hello Integration step list for `mode` and write it back when the step set changed.
 * A device-authed agent registers as 'interactive' (the connector no longer passes --mode) and
 * self-sets 'task-runner' at startup; without this it would keep showing the full flow, 7/16 where
 * 7/7 is the truth.
 */
async function syncOnboardingFlowToMode(storage: Storage, gaii: string, mode: AgentRecord['mode']): Promise<void> {
    try {
        const onboarding = await storage.getOnboarding(gaii);
        if (!onboarding) return;
        const steps = deriveStepsForMode(onboarding.steps, mode);
        if (!steps) return;

        const allRequiredPassed = steps.filter(s => s.required).every(s => s.status === 'passed');
        await storage.updateOnboarding(gaii, {
            steps,
            status: allRequiredPassed ? 'completed' : 'in_progress',
            ...(allRequiredPassed && !onboarding.completedAt ? { completedAt: new Date().toISOString() } : {}),
        });
    } catch (err) {
        logger.error('mode change: could not re-derive onboarding steps', { gaii, error: String(err) });
    }
}

/**
 * Store an agent's capability self-report.
 *
 * `liveMcpSession` marks the caller as speaking over an authenticated agent session, which is what
 * makes an mcp-type capability verified: the connection is the proof. Languages are their own
 * field, never folded into the domain list.
 */
export async function setAgentCapabilities(
    deps: AgentWriteDeps,
    agentGaii: string,
    input: unknown,
    opts: { liveMcpSession: boolean },
): Promise<AgentWriteOutcome> {
    const agent = await deps.storage.getAgent(agentGaii);
    if (!agent) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${agentGaii}` };

    const parsed = AgentCapabilitiesUpdateSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            code: 'INVALID_INPUT',
            message: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
        };
    }
    const body = parsed.data;

    const technicalCapabilities: AgentTechnicalCapability[] = body.technical.map(cap => ({
        name: cap.name,
        type: cap.type,
        verified: opts.liveMcpSession && cap.type === 'mcp',
    }));

    const updated = await deps.storage.updateAgent(agentGaii, {
        technicalCapabilities,
        domainCapabilities: [...body.domain],
        ...(body.languages !== undefined && { languages: body.languages }),
        ...(body.modules_loaded !== undefined && { modulesLoaded: body.modules_loaded }),
        ...(body.limitations !== undefined && { agentLimitations: body.limitations }),
    });
    if (!updated) return { ok: false, code: 'UPDATE_FAILED', message: 'Failed to update capabilities' };

    emitChange('agent-capabilities');
    return { ok: true, agent: updated };
}

/**
 * Stamp the platform (and model) an agent reported about itself during the identify_platform step,
 * and put the agent in the mode that platform implies.
 *
 * Attribution first: platform and model are self-reported, and a platform delegates to subagents on
 * other models mid-session, so neither is evidence of what ran.
 *
 * The mode part is what stops an agent stranding itself. A Claude Desktop / VS Code agent registers
 * in the default 'interactive' mode and therefore gets the full 13-step Hello Integration, which
 * includes `configure_delivery` — a step that wants a webhook or a watchdog seen within ten minutes.
 * A conversation-triggered agent has neither and never will, so its checklist can never complete: it
 * sits at 9/12 forever while being, in fact, fully connected. That is a real production case (an
 * external user, August 2026), and the agent's own attempt to fix it made it worse, because it
 * guessed at the mode vocabulary ("MCP") instead of the value the node accepts.
 *
 * The node already knows better than the agent does: `identify_platform` is step two, and the
 * platform string says whether the agent is node-resident. So the inference happens here, before the
 * checklist has anything to strand on.
 *
 * Only an UNCHOSEN mode is overwritten ('interactive' is the registration default, and undefined is
 * an older record). A mode someone deliberately set — task-runner, autonomous, coordinator — is left
 * exactly as it is, and so is an agent already in workstation mode.
 *
 * This writes the AGENT RECORD only and returns the mode it moved the agent to. The step list is the
 * caller's, deliberately: it is confirming a step against an onboarding record it already holds in
 * memory, and a second writer re-deriving that list underneath would be overwritten by the caller's
 * own persist a moment later. The caller re-derives with `deriveStepsForMode` and persists once.
 */
export async function recordSelfReportedPlatform(
    storage: Storage,
    agentGaii: string,
    body: Record<string, unknown>,
): Promise<{ modeSetTo?: NonNullable<AgentRecord['mode']> }> {
    const model = typeof body.model === 'string' && body.model.trim()
        ? body.model.trim().toLowerCase().slice(0, 64) : undefined;
    const platform = body.platform as string;

    const current = await storage.getAgent(agentGaii);
    const inferred = inferModeFromPlatform(platform);
    const modeIsUnchosen = !current?.mode || current.mode === 'interactive';
    const modeSetTo = inferred && inferred !== current?.mode && modeIsUnchosen ? inferred : undefined;

    await storage.updateAgent(agentGaii, {
        platform,
        platformVersion: typeof body.platform_version === 'string' ? body.platform_version : undefined,
        platformDetectedBy: 'self_report',
        ...(model ? { model, modelDetectedBy: 'self_report' as const } : {}),
        ...(modeSetTo ? { mode: modeSetTo } : {}),
    });

    return { modeSetTo };
}
