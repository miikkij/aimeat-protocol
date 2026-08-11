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
 *   - setAgentTags() / setAgentMode(): same-owner gated writes on a named sibling agent
 *   - syncOnboardingFlowToMode(): re-derive the Hello Integration steps after a mode change
 *   - setAgentCapabilities(): validated capability self-report
 *   - recordSelfReportedPlatform(): the platform/model stamp written by the identify_platform step
 * @usage
 *   const outcome = await setAgentMode({ storage, config }, req.auth!.owner, name, req.body?.mode);
 *   if (!outcome.ok) return renderRefusal(outcome.code, outcome.message);
 * @version-history
 *   v1.0.0 -- 2026-08-11 -- Extracted from routes/agent-capabilities.ts,
 *     routes/agents/profile-metadata.ts, mcp/agent-capabilities.ts and mcp/agent-management.ts
 *     (August 2026 MCP audit, step 8).
 */
import type { AimeatConfig } from '../config.js';
import type { AgentRecord, AgentTechnicalCapability, Storage } from '../storage/interface.js';
import { buildGAII } from '../utils/gaii.js';
import { emitChange } from './event-bus.js';
import { createDefaultSteps } from '../models/agent-onboarding-schemas.js';
import { AgentCapabilitiesUpdateSchema } from '../models/agent-capabilities-schemas.js';
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
 * Replace the tag list on a same-owner agent. Tags are lowercased, de-duplicated and dropped when
 * empty; anything that fails TAG_PATTERN refuses the whole call rather than being silently skipped,
 * so a typo does not look like it was accepted.
 */
export async function setAgentTags(
    deps: AgentWriteDeps,
    callerOwner: string,
    identifier: string,
    rawTags: unknown,
): Promise<AgentWriteOutcome> {
    const target = await loadSameOwnerAgent(deps, callerOwner, identifier,
        'You can only update tags for agents owned by the same owner');
    if (!target.ok) return target;

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

    const updated = await deps.storage.updateAgent(target.gaii, { tags });
    if (!updated) return { ok: false, code: 'AGENT_NOT_FOUND', message: `Agent not found: ${identifier}` };
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

    if (typeof rawMode !== 'string' || !(VALID_MODES as readonly string[]).includes(rawMode)) {
        return { ok: false, code: 'INVALID_INPUT', message: `mode must be one of: ${VALID_MODES.join(', ')}` };
    }
    const mode = rawMode as AgentRecord['mode'];

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
        const target = createDefaultSteps(mode);
        const currentIds = new Set(onboarding.steps.map(s => s.id));
        const flowChanged = target.length !== onboarding.steps.length || target.some(s => !currentIds.has(s.id));
        if (!flowChanged) return;

        const prevById = new Map(onboarding.steps.map(s => [s.id, s] as const));
        const steps = target.map(fresh => {
            const prev = prevById.get(fresh.id);
            return prev
                ? { ...fresh, status: prev.status, validatedAt: prev.validatedAt, details: prev.details, failureReason: prev.failureReason }
                : fresh;
        });
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
 * Stamp the platform (and model) an agent reported about itself during the identify_platform step.
 * Attribution only: it is self-reported, and a platform delegates to subagents on other models
 * mid-session, so this is never evidence of what ran.
 */
export async function recordSelfReportedPlatform(
    storage: Storage,
    agentGaii: string,
    body: Record<string, unknown>,
): Promise<void> {
    const model = typeof body.model === 'string' && body.model.trim()
        ? body.model.trim().toLowerCase().slice(0, 64) : undefined;
    await storage.updateAgent(agentGaii, {
        platform: body.platform as string,
        platformVersion: typeof body.platform_version === 'string' ? body.platform_version : undefined,
        platformDetectedBy: 'self_report',
        ...(model ? { model, modelDetectedBy: 'self_report' as const } : {}),
    });
}
