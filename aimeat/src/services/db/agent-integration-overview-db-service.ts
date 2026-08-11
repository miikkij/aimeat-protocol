/**
 * @file src/services/db/agent-integration-overview-db-service.ts
 * @description Purpose-built Application DB Service for the agent-card **Integration** subtab — the ONE call
 *   behind GET /v1/agents/:name/integration/overview. The subtab mounted a 4-request fan-out
 *   (getWebhookConfig, getSkillBundleVersion, getDeliveryLog, getOnboarding). This folds the THREE plain
 *   reads — webhook config (from the already-loaded agent), the webhook delivery log, and the
 *   post-onboarding checklist — into one read scope. The fourth, skill-bundle/version, STAYS a separate
 *   request: it runs a bundle-generation PIPELINE (buildContext + generateBundle), a distinct subsystem,
 *   not a storage read (same discipline as keeping the ledger / EE / federation calls out of a local
 *   composite) → the mount goes 4→2, not 4→1. Each sub-object mirrors the exact `.data` of the endpoint it
 *   replaces so the subtab seeds it as a drop-in. Single-master: the Integration subtab mount only.
 *
 * @structure AgentIntegrationOverviewService.overview(agentGaii, agent, agentName, opts?) → { webhook, deliveries, onboarding }
 * @usage const ov = await createAgentIntegrationOverviewService(storage).overview(agentGaii, agent, agentName);
 * @version-history
 *   v1.0.0 — 2026-07-16 — Phase 4: fold the Integration subtab's 3 plain reads into one composite.
 */
import type { Storage } from '../../storage/interface.js';
import type { AgentRecord } from '../../storage/types/identity.js';
import { runInReadScope } from '../../storage/read-scope/read-scope.js';
import { buildPostOnboardingChecklist } from '../../routes/agent-onboarding.js';

export interface AgentIntegrationOverview {
  webhook: Record<string, unknown>;
  deliveries: { deliveries: unknown[] };
  onboarding: { post_onboarding_checklist: Record<string, unknown> | null };
}

export class AgentIntegrationOverviewService {
  constructor(private readonly storage: Storage) {}

  /**
   * The Integration subtab mount for one already-resolved agent, in a single read scope. Webhook config
   * comes from the passed-in agent record (no re-read); the delivery log and the post-onboarding checklist
   * are read here. The checklist is computed only when an onboarding record exists — mirroring GET
   * /onboarding, which returns no checklist for a not-started agent.
   */
  overview(
    agentGaii: string,
    agent: AgentRecord,
    agentName: string,
    opts: { deliveryLimit?: number } = {},
  ): Promise<AgentIntegrationOverview> {
    const deliveryLimit = Math.min(100, Math.max(1, opts.deliveryLimit ?? 10));

    return runInReadScope(async () => {
      const [deliveries, onboarding] = await Promise.all([
        this.storage.listDeliveryLog(agentGaii, deliveryLimit),
        this.storage.getOnboarding(agentGaii),
      ]);

      const post_onboarding_checklist = onboarding
        ? await buildPostOnboardingChecklist(agentGaii, agentName, this.storage)
        : null;

      // Webhook — mirrors GET /webhook .data EXACTLY, from the already-loaded agent.
      const webhook: Record<string, unknown> = agent.webhookUrl
        ? {
            configured: true, url: agent.webhookUrl, enabled: agent.webhookEnabled ?? false,
            last_success: agent.webhookLastSuccess ?? null, last_failure: agent.webhookLastFailure ?? null,
            fail_count: agent.webhookFailCount ?? 0,
          }
        : { configured: false };

      return {
        webhook,
        deliveries: { deliveries },
        onboarding: { post_onboarding_checklist },
      };
    });
  }
}

/** Assemble the Integration subtab composite over the given storage. */
export function createAgentIntegrationOverviewService(storage: Storage): AgentIntegrationOverviewService {
  return new AgentIntegrationOverviewService(storage);
}
