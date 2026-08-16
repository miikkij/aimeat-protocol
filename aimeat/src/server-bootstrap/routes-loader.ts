/**
 * @file src/server-bootstrap/routes-loader.ts
 * @description Central route mounting for the AIMEAT server: imports every domain router and wires
 *   them (with shared middleware and injected services — federation, directory, tunnels, realtime,
 *   scheduler, workflow engine) onto the Express app during bootstrap.
 *
 * @structure
 *   - router imports: pulls in all src/routes/* routers
 *   - mountRoutes(): async entrypoint that registers routers + middleware in the correct order
 *
 * @version-history
 *   v1.7.0 — 2026-07-28 — Drop the enterprise-edition seam (single edition): the Stripe and invoice
 *     money handlers register here as core rails instead of arriving from a loaded ee/ module
 *   v1.6.0 — 2026-07-21 — Mount unfurlRouter (GET /v1/unfurl(/image) — link-preview cards)
 *   v1.5.0 — 2026-07-19 — Mount appdevPitfallsRouter (/v1/appdev/pitfalls, AppDev KB Phase 1)
 *   v1.4.0 — 2026-07-14 — Mount agentSkillsDiscoveryRouter (/.well-known/agent-skills, RFC v0.2.0)
 *   v1.3.0 — 2026-07-14 — Register the app-tool sellable resolver (TARGET-034 phase A)
 *   v1.2.0 — 2026-07-13 — Commerce core (TARGET-033): payment-handler registry + commerceRouter mount
 *   v1.1.0 — 2026-07-13 — Mount discoveryLinkHeaders() before bootstrapRouter (RFC 8288 agent discovery)
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import express from 'express';
import type { AimeatConfig } from '../config.js';
import type { Storage, MaintenanceState } from '../storage/interface.js';
import type { ConfigProvenance } from '../services/config-provenance.js';
import type { ConsulConfigService } from '../services/consul-config.js';
import type { PeerInfo } from '../services/federation.js';
import type { ServiceSummary } from '../utils/service-summary.js';
import type { DirectoryService } from '../services/directory.js';
import type { TunnelManager } from '../services/personal-tunnel.js';
import { RealtimeManager } from '../services/realtime-manager.js';
import type { MailboxNotificationService } from '../services/mailbox-notification.js';
import type { Scheduler } from '../services/scheduler.js';
import type { WorkflowEngine } from '../services/workflow/engine.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { success, error } from '../middleware/envelope.js';
import { workspaceAccessMiddleware } from '../middleware/workspace-access.js';
import { logger } from '../utils/logger.js';
import { registerPaymentHandler, resetPaymentHandlers, morselPaymentHandler } from '../commerce/payment-handlers.js';
import { stripePaymentHandler } from '../commerce/stripe-handler.js';
import { invoicePaymentHandler } from '../commerce/invoice-handler.js';
import { getWebBotAuthState, signOutboundRequest, resetWebBotAuth } from '../services/web-bot-auth.js';
import { setOutboundRequestSigner } from '../utils/url-validator.js';
import { registerSellableResolver, resetSellableResolvers, offerSellableResolver, appToolSellableResolver, extCallSellableResolver } from '../commerce/sellable-resolvers.js';
import { commerceRouter } from '../routes/commerce.js';
import { commerceUcpRouter } from '../routes/commerce-ucp.js';
import { commerceAcpRouter } from '../routes/commerce-acp.js';
import { commerceBeneficiariesRouter } from '../routes/commerce-beneficiaries.js';
import { commerceWebhooksRouter } from '../routes/commerce-webhooks.js';
import { financeRouter } from '../routes/finance.js';
import { financeLedgerRouter } from '../routes/finance-ledger.js';
import { outboundRouter } from '../routes/outbound.js';
import { companiesRouter } from '../routes/companies.js';

// Routes
import { bootstrapRouter } from '../routes/bootstrap.js';
import { agentDocsRouter } from '../routes/agent-docs.js';
import { glossaryRouter } from '../routes/glossary.js';
import { markdownMirrorsRouter } from '../routes/markdown-mirrors.js';
import { agentConventionsRouter } from '../routes/agent-conventions.js';
import { nodeRobotsTxt } from './static-files.js';
import { wellknownRouter, discoveryLinkHeaders } from '../routes/wellknown.js';
import { agentSkillsDiscoveryRouter } from '../routes/agent-skills-discovery.js';
import { authRouter } from '../routes/auth.js';
import { accessTokensRouter } from '../routes/access-tokens.js';
import { appGrantsRouter } from '../routes/app-grants.js';
import { ownersRouter } from '../routes/owners.js';
import { agentsRouter } from '../routes/agents.js';
import { ecosystemAppsRouter } from '../routes/ecosystem-apps.js';
import { ecosystemEventsRouter } from '../routes/ecosystem-events.js';
import { schemaRouter } from '../routes/schemas.js';
import { consentRouter } from '../routes/consent.js';
import { permissionsRouter } from '../routes/permissions.js';
import { memoryRouter } from '../routes/memory.js';
import { librarianRouter } from '../routes/librarian.js';
import { discoverRouter } from '../routes/discover.js';
import { livingRouter } from '../routes/living.js';
import { actionsRouter } from '../routes/actions.js';
import { catalogueRouter } from '../routes/catalogue.js';
import { workRouter } from '../routes/work.js';
import { walletRouter } from '../routes/wallet.js';
import { usageRouter } from '../routes/usage.js';
import { usageReportsRouter } from '../routes/usage-reports.js';
import { boardsRouter } from '../routes/boards.js';
import { promptsRouter } from '../routes/prompts.js';
import { adminRouter } from '../routes/admin.js';
import { federationRouter } from '../routes/federation.js';
import { organismsRouter } from '../routes/organisms.js';
import { notificationsRouter } from '../routes/notifications.js';
import { adminSecurityRouter } from '../routes/admin-security.js';
import { sharingGroupsRouter } from '../routes/sharing-groups.js';
import { connectionsRouter } from '../routes/connections.js';
import { specRouter } from '../routes/spec.js';
import { disputesRouter } from '../routes/disputes.js';
import { microMemoryRouter } from '../routes/micro-memory.js';
import { storageFilesRouter } from '../routes/storage-files.js';
import { dataPackagesRouter } from '../routes/datapackages.js';
import { odataRouter } from '../routes/odata.js';
import { validateRouter } from '../routes/validate.js';
import { unfurlRouter } from '../routes/unfurl.js';
import { mcpRouter } from '../mcp/index.js';
import { portalRouter } from '../routes/portal.js';
import { publicStatsRouter } from '../routes/public-stats.js';
import { publicEventsRouter } from '../routes/public-events.js';
import { portfolioRouter } from '../routes/portfolio.js';
import { homeRouter } from '../routes/home.js';
import { registrationInvitesRouter } from '../routes/registration-invites.js';
import { portalApiRouter } from '../routes/portal-api.js';
import { csmRouter } from '../routes/csm.js';
import { msmRouter } from '../routes/msm.js';
import { ghiiRouter } from '../routes/ghii.js';
import { chatInstancesRouter } from '../routes/chat-instances.js';
import { totpRouter } from '../routes/totp.js';
import { libsRouter } from '../routes/libs.js';
import { appTemplatesRouter } from '../routes/app-templates.js';
import { appdevPitfallsRouter } from '../routes/appdev-pitfalls.js';
import { appdevOverviewRouter } from '../routes/appdev-overview.js';
import { libraryPacksRouter } from '../routes/library-packs.js';
import { appsRouter } from '../routes/apps.js';
import { appMembersRouter } from '../routes/app-members.js';
import { appStoreRouter } from '../routes/app-store.js';
import { flagsRouter } from '../routes/flags.js';
import { appealsRouter } from '../routes/appeals.js';
import { matchesRouter } from '../routes/matches.js';
import { personalRouter } from '../routes/personal.js';
import { pushRouter } from '../routes/push.js';
import { verificationRouter } from '../routes/verification.js';
import { oauthLoginRouter } from '../routes/oauth-login.js';
import { buildOidcProviders } from '../services/oidc-providers.js';
import { knowledgeRouter } from '../routes/knowledge.js';
import { siteRouter } from '../routes/site.js';
import { realtimeRouter } from '../routes/realtime.js';
import { sseRouter } from '../routes/sse.js';
import { presenceRouter } from '../routes/presence.js';
import { adminFeaturesRouter } from '../routes/admin-features.js';
import { setupRouter } from '../routes/setup.js';
import { extensionsRouter } from '../routes/extensions.js';
import { cortexRouter } from '../routes/cortex.js';
import { packagesRouter } from '../routes/packages.js';
import { instancesRouter } from '../routes/instances.js';
import { templatesRouter } from '../routes/templates.js';
import { adminSchedulerRouter } from '../routes/admin-scheduler.js';
import { capabilitiesRouter } from '../routes/capabilities.js';
import { adminCapabilitiesRouter } from '../routes/admin-capabilities.js';
import { adminExtensionsRouter } from '../routes/admin-extensions.js';
import { adminPromptsRouter } from '../routes/admin-prompts.js';
import { statsRouter } from '../routes/stats.js';
import { calibratorRouter } from '../routes/calibrator.js';
import { openrouterRouter } from '../routes/openrouter.js';
import { aiRouter } from '../routes/ai.js';
import { chatRouter } from '../routes/chat.js';
import { aiProvenanceRouter } from '../routes/ai-provenance.js';
import { aiTransparencyRouter } from '../routes/ai-transparency.js';
import { uploadRouter } from '../routes/upload.js';
import { agentTasksRouter } from '../routes/agent-tasks.js';
import { schedulesRouter } from '../routes/schedules.js';
import { workflowsRouter } from '../routes/workflows.js';
import { agentIntegrationRouter } from '../routes/agent-integration.js';
import { agentDirectivesRouter } from '../routes/agent-directives.js';
import { adminAgentTasksRouter } from '../routes/admin-agent-tasks.js';
import { adminStorageStatsRouter } from '../routes/admin-storage-stats.js';
import { adminUsageRouter } from '../routes/admin-usage.js';
import { adminAgentIntegrationRouter } from '../routes/admin-agent-integration.js';
import { adminSharingGroupsRouter } from '../routes/admin-sharing-groups.js';
import { adminOrganismsRouter } from '../routes/admin-organisms.js';
import { agentCapabilitiesRouter } from '../routes/agent-capabilities.js';
import { agentActivityRouter } from '../routes/agent-activity.js';
import { agentMessagesRouter } from '../routes/agent-messages.js';
import { messagesRouter } from '../routes/messages.js';
import { contactsRouter } from '../routes/contacts.js';
import { openItemsRouter } from '../routes/open-items.js';
import { attestationsRouter } from '../routes/attestations.js';
import { trackedResponsesRouter } from '../routes/tracked-responses.js';
import { agentWebhookRouter } from '../routes/agent-webhook.js';
import { agentTelemetryRouter } from '../routes/agent-telemetry.js';
import { ledgerRouter } from '../routes/ledger.js';
import { appsCostRouter } from '../routes/apps-cost.js';
import { exchangeRouter } from '../routes/exchange.js';
import { exchangeMarketRouter } from '../routes/exchange-market.js';
import { agentSkillBundleRouter } from '../routes/agent-skill-bundle.js';
import { skillsRouter } from '../routes/skills.js';
import { webmcpRouter } from '../routes/webmcp.js';
import { agentOnboardingRouter } from '../routes/agent-onboarding.js';
import { connectTunnelRouter } from '../routes/connect-tunnel.js';
import { subdomainServeRouter } from '../routes/subdomains.js';
import { subdomainAdminRouter } from '../routes/subdomain-admin.js';
import { appsBackupRouter } from '../routes/apps-backup.js';

// Services needed during route mounting
import { createWebhookDispatcher } from '../services/webhook-dispatcher.js';
import { createPushService } from '../services/push.js';
import { setNotifyPushService } from '../services/notify.js';
import { createEudiwService } from '../services/eudiw.js';
import { createSdJwtVerifier } from '../services/sd-jwt.js';
import { createOidcClient, type OidcClient } from '../services/oidc-client.js';
import { createDidDocumentService } from '../services/did-document.js';
import { createVcIssuerService } from '../services/vc-issuer.js';
import { createMyDataReceiptService } from '../services/mydata-receipt.js';
import { createEmailService } from '../services/email.js';
import { SiteService } from '../services/site.js';
import { startSiteSyncJob, triggerSiteSync } from '../services/site-sync.js';
import { startMatchNotificationJob } from '../services/match-notification.js';
import { createMatchingEngine, startMatchingScheduler } from '../services/matching.js';
import { createGenesisPeeringService } from '../services/genesis-peering.js';
import { createGenesisSyncService } from '../services/genesis-sync.js';
import { startCacheCleanupJob } from '../services/cache-cleanup.js';
import { startSyncScheduler } from '../services/sync-scheduler.js';
import { startMessageRetryJob } from '../services/message-delivery.js';
import { startTrackedResponseReconciler, evaluateTrackedKey } from '../services/tracked-response.js';
import { rebuildTrackRegistry, isTracked } from '../services/track-registry.js';
import { onMemoryWrittenEvent, onChangeEvent } from '../services/event-bus.js';
import { invalidateTag } from '../services/cache.js';
import { parseGaiiLoose } from '../utils/gaii.js';
import { initStats } from '../services/stats.js';
import { initTelemetryBuffer } from '../services/telemetry-buffer.js';
import { initUsageBuffer } from '../services/usage/usage-buffer.js';
import { initConsentAuditBuffer } from '../services/consent-audit-buffer.js';
import { createMetricsRegistry } from '../services/prometheus.js';
import { seedCoreScheduledJobs } from '../services/job-seeding.js';

export interface MountRoutesOptions {
  rejectForRelay: express.RequestHandler;
  mirrorReadOnly: express.RequestHandler;
  maintenanceState: {
    get: () => MaintenanceState;
    set: (state: MaintenanceState) => void;
  };
  provenance: ConfigProvenance;
  consulService: ConsulConfigService | null;
  directoryService: DirectoryService;
  peers: Map<string, PeerInfo>;
  networkDirectory?: Map<string, ServiceSummary>;
  tunnelManager: TunnelManager | null;
  mailboxNotificationService: MailboxNotificationService | null;
  scheduler: Scheduler;
  workflowEngine: WorkflowEngine;
  invalidateHasOwnersCache: () => void;
}

export interface MountRoutesResult {
  realtimeManager: RealtimeManager | null;
}

/**
 * Mount all 40+ route handlers on the Express app.
 */
export async function mountRoutes(
  app: express.Express,
  config: AimeatConfig,
  storage: Storage,
  opts: MountRoutesOptions,
): Promise<MountRoutesResult> {
  const {
    rejectForRelay, mirrorReadOnly, maintenanceState,
    provenance, consulService, directoryService,
    peers, networkDirectory, tunnelManager, mailboxNotificationService,
    scheduler, workflowEngine, invalidateHasOwnersCache,
  } = opts;

  // Webhook dispatcher for agent push notifications
  const webhookDispatcher = createWebhookDispatcher({ config, storage });

  // Statistics collector (with persistence via storage)
  const stats = await initStats(storage);

  // In-memory accumulator for high-frequency agent signals (telemetry + heartbeat),
  // flushed to storage on an interval instead of per request.
  initTelemetryBuffer(storage);

  // The one write door for the usage call stream: every measured call, whichever surface it came
  // through, buffers here and flushes on an interval so a request never waits on a metrics write.
  initUsageBuffer(storage);

  // Off-request-path buffer for consent-audit writes (denials + grant/revoke mutations).
  initConsentAuditBuffer(storage);

  // Generic read-cache invalidation: translate every mutation (`emitChange(domain, ownerGaii?)`)
  // into cache tag drops. The broad `domain:<d>` tag is the safety net for write paths that don't
  // carry an owner; the owner-scoped tag is the precise drop when they do. Read paths opt in by
  // tagging their cached() entries with these same tags (see services/cache.ts).
  onChangeEvent((evt) => {
    invalidateTag(`domain:${evt.domain}`);
    if (evt.ownerGaii) {
      const owner = parseGaiiLoose(evt.ownerGaii).owner;
      if (owner) invalidateTag(`owner:${owner}:${evt.domain}`);
    }
  });

  // Prometheus metrics registry (opt-in)
  const metricsRegistry = config.metricsEnabled
    ? createMetricsRegistry(config)
    : undefined;

  // Presigned upload endpoint (raw body — no JSON parsing needed)
  app.use(uploadRouter(config, storage));

  // Mount routes
  // SiteService is created early so the bootstrap GET / handler can serve a
  // custom portal template (set via the admin Template Editor) instead of
  // always redirecting human visitors to the SPA. Reused by siteRouter below.
  const siteService = new SiteService(config, storage);
  // RFC 8288 discovery Link headers (api-catalog + service-desc) on every GET/HEAD —
  // must precede bootstrapRouter so the root response carries them too.
  app.use(discoveryLinkHeaders());
  app.use(setupRouter(config, storage, invalidateHasOwnersCache));
  // Subdomain root serving MUST come before bootstrapRouter — its GET / handles
  // mapped `<sub>.<apex>` requests; apex requests fall through untouched.
  app.use(subdomainServeRouter(config, storage));
  // The node's robots.txt, registered AFTER the subdomain router so an app origin has already
  // answered with its own. Registered inside setupStaticFiles it ran before the subdomain
  // middleware, could not tell which host it was on, and served the node's file everywhere.
  if (nodeRobotsTxt !== null) {
    const robots = nodeRobotsTxt;
    app.get('/robots.txt', (req, res, next) => {
      // Apex only, and this is the point where that can be decided: subdomainMiddleware has run.
      // A mapped app origin answered above with its own; an UNMAPPED one gets a 404 rather than
      // the node's file, because a robots.txt whose Sitemap: line names another host is a document
      // about somebody else no matter which subdomain asked for it.
      if (req.appOrigin || req.portfolioOrigin) { next(); return; }
      res.set('Cache-Control', 'no-cache');
      res.type('text/plain; charset=utf-8').send(robots);
    });
  }
  app.use(bootstrapRouter(config, storage, tunnelManager ?? undefined, siteService));
  app.use(agentDocsRouter(config));  // /sitemap.md + /AGENTS.md (apex only)
  app.use(glossaryRouter(config));   // /v1/glossary.{json,md} + JSON-LD
  app.use(markdownMirrorsRouter(config));  // <page>.md mirrors (apex only)
  app.use(agentConventionsRouter(config));  // /openapi.json, /skill.md, /agents.txt, webmcp + x402 discovery
  app.use(statsRouter(config, storage, stats, metricsRegistry));
  app.use(wellknownRouter(config, storage));
  app.use(agentSkillsDiscoveryRouter(config, storage));  // /.well-known/agent-skills (RFC v0.2.0)

  // IndexNow key verification file (serves /{key}.txt for Bing/Yandex)
  if (config.indexNowKey) {
    app.get(`/${config.indexNowKey}.txt`, (_req, res) => {
      res.type('text/plain').send(config.indexNowKey);
    });
  }

  app.use(authRouter(config, storage));
  app.use(accessTokensRouter(config, storage));
  app.use(appGrantsRouter(config, storage));   // H-2: explicit scoped app grants (OAuth-like)
  app.use(sseRouter(config, storage));
  app.use(presenceRouter(config, storage));

  // Relay nodes skip agent-hosting routes entirely
  app.use('/v1/owners', rejectForRelay);
  app.use('/v1/agents', rejectForRelay);
  app.use('/v1/memory', rejectForRelay);
  app.use('/v1/work', rejectForRelay);
  app.use('/v1/wallet', rejectForRelay);
  app.use('/v1/boards', rejectForRelay);
  app.use('/v1/disputes', rejectForRelay);
  app.use('/v1/micro-memory', rejectForRelay);
  app.use('/v1/storage', rejectForRelay);

  // Mirror nodes block writes (except federation replication)
  app.use(mirrorReadOnly);

  app.use(ownersRouter(config, storage));
  // Resolve /v1/agents/me/... to /v1/agents/{actual-name}/... by decoding agent name from JWT
  app.use((req, _res, next) => {
    if (!req.url.startsWith('/v1/agents/me') && !req.originalUrl.startsWith('/v1/agents/me')) { next(); return; }
    const tail = req.originalUrl.slice('/v1/agents/me'.length);
    if (tail && !tail.startsWith('/')) { next(); return; } // /v1/agents/memory etc.
    if (tail.startsWith('/handbook')) { next(); return; } // /v1/agents/me/handbook is a fixed route, not an alias
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) { next(); return; }
    try {
      const payload = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
      const sub = payload.sub as string;
      const hashIdx = sub?.indexOf('#');
      const atIdx = sub?.lastIndexOf('@');
      if (hashIdx >= 0 && atIdx > hashIdx) {
        const agentName = sub.slice(0, hashIdx);
        const rewritten = `/v1/agents/${encodeURIComponent(agentName)}${tail}`;
        req.url = rewritten;
        req.originalUrl = rewritten;
      }
    // eslint-disable-next-line aimeat/no-silent-catch -- auth verification happens later in requireAuth()
    } catch { /* auth verification happens later in requireAuth() */ }
    next();
  });

  // Commerce core (TARGET-033): one registry of payment handlers and one of sellable resolvers,
  // advertised at /.well-known/ucp. Every rail is core — morsels on this node's ledger, cards on
  // the SELLER's own Stripe account, invoices settled offline, stablecoin via x402. The resets keep
  // embedded test servers from double-registering.
  // Web Bot Auth (RFC 9421): reset the per-boot key state (embedded test servers), then arm the
  // outbound signer on safeFetch when the operator opted in. The key DIRECTORY at
  // /.well-known/http-message-signatures-directory is served regardless (wellknown.ts).
  resetWebBotAuth();
  setOutboundRequestSigner(config.webBotAuthSign
    ? async (url) => {
        const state = await getWebBotAuthState(storage, config);
        return state ? signOutboundRequest(state, url) : null;
      }
    : null);

  resetPaymentHandlers();
  registerPaymentHandler(morselPaymentHandler());
  // Money rails. Neither carries a node-level credential: the Stripe handler charges on the
  // seller's own key (commerce.psp) and the invoice handler books an obligation instead of
  // capturing anything, so both are safe to register on every node.
  registerPaymentHandler(stripePaymentHandler());
  registerPaymentHandler(invoicePaymentHandler());
  resetSellableResolvers();
  registerSellableResolver(offerSellableResolver());
  registerSellableResolver(appToolSellableResolver());
  registerSellableResolver(extCallSellableResolver());   // priced raw-call money channel (rm-commercial-raw-calls)
  // TEST ONLY: a fake EUR/USD rail so the money chain is E2E-provable without a real PSP. Off in prod.
  if (config.testMoneyHandler) {
    const { testMoneyPaymentHandler } = await import('../commerce/test-money-handler.js');
    registerPaymentHandler(testMoneyPaymentHandler());
  }
  // x402 stablecoin settlement (TARGET-042): the NON-CUSTODIAL USDC handler for money (USD) sessions.
  // The facilitator is a parameter — an off-chain double in E2E (AIMEAT_X402_TEST_FACILITATOR), the
  // real safeFetch client against config.x402FacilitatorUrl in prod. OFF unless AIMEAT_X402_ENABLED.
  if (config.x402Enabled) {
    const { x402PaymentHandler } = await import('../commerce/x402-handler.js');
    const { httpFacilitator, testFacilitator } = await import('../commerce/x402-facilitator.js');
    registerPaymentHandler(x402PaymentHandler(
      config, config.x402TestFacilitator ? testFacilitator() : httpFacilitator(config.x402FacilitatorUrl),
    ));
  }
  app.use(commerceRouter(config, storage));
  app.use(commerceUcpRouter(config, storage));
  app.use(commerceAcpRouter(config, storage));
  app.use(commerceBeneficiariesRouter(config, storage));  // the second rake: revenue shared with third parties
  app.use(commerceWebhooksRouter(config, storage));       // Stripe webhooks → accounting vouchers (per-seller secret)
  app.use(financeRouter(config, storage));                // Finance: invoices (Finvoice 3.0) — company-in-a-box phase 1
  app.use(financeLedgerRouter(config, storage));          // Finance: vouchers, VAT registry/report, fiscal years, exports
  app.use(outboundRouter(config, storage));               // Outbound door: contact registry, policied send, public unsubscribe
  app.use(companiesRouter(config, storage));              // Company registry — {slug}.co.<apex> addresses

  // Agent tasks, directives, capabilities, and integration BEFORE agentsRouter to avoid /v1/agents/:name param conflicts
  app.use(agentTasksRouter(config, storage, webhookDispatcher));
  app.use(schedulesRouter(config, storage, scheduler));
  app.use(workflowsRouter(config, storage, scheduler, workflowEngine));
  app.use(agentDirectivesRouter(config, storage, webhookDispatcher));
  app.use(agentCapabilitiesRouter(config, storage));
  app.use(agentActivityRouter(config, storage));
  app.use(agentMessagesRouter(config, storage, webhookDispatcher));
  app.use(messagesRouter(config, storage, peers));
  app.use(contactsRouter(config, storage));       // Contacts (address book) — generic identity picker source
  app.use(openItemsRouter(config, storage));      // Open items — what the owner is going to do here
  app.use(attestationsRouter(config, storage));   // Dual-signed attestations (TINKI) — co-signed deeds
  app.use(trackedResponsesRouter(config, storage, peers));   // Memory Contracts — Tracked Responses
  app.use(agentWebhookRouter(config, storage));
  app.use(agentTelemetryRouter(config, storage));
  app.use(ledgerRouter(config, storage));         // LEDGER (TARGET-016) — agent LLM usage/cost read API
  app.use(appsCostRouter(config, storage));       // EXCHANGE G3 (TARGET-045) — per-app cost & contracts
  app.use(exchangeRouter(config, storage));       // EXCHANGE (TARGET-045) — contract acceptance / entitlement mint
  app.use(exchangeMarketRouter(config, storage));  // EXCHANGE (TARGET-045 Phase C) — marketplace: offerings/needs/bids
  app.use(agentSkillBundleRouter(config, storage));
  app.use(skillsRouter(config, storage));  // Skills registry (dedicated system, Phase 2a)
  app.use(webmcpRouter(config, storage));  // WebMCP bridge (TARGET-034 phase C) — before appsRouter (shares /v1/apps/:owner/:filename/*)
  app.use(agentOnboardingRouter(config, storage, webhookDispatcher));
  app.use(agentIntegrationRouter(config, storage));
  app.use(agentsRouter(config, storage));
  app.use(ecosystemAppsRouter(config, storage, scheduler));
  app.use(ecosystemEventsRouter(config, storage));
  const notifyDirectoryChange = () => directoryService.notifyChange();
  app.use(consentRouter(config, storage, stats, notifyDirectoryChange));  // Phase 0.3
  app.use(permissionsRouter(config, storage));  // Phase 0.3 — permission listing API
  app.use(schemaRouter(config, storage));  // MUST be before memoryRouter (Phase 0.1)
  app.use('/v1/memory', workspaceAccessMiddleware(config, storage));  // Phase 2.3 — organism workspace access
  app.use(memoryRouter(config, storage, stats, notifyDirectoryChange, peers));
  app.use(librarianRouter(config, storage));  // Tier-1 fan-across full-text retrieval
  app.use(discoverRouter(config, storage));   // Master directory — unified cross-domain discovery
  app.use(livingRouter(config, storage));     // Living Documents — AI template author
  if (config.calibratorEnabled) {
    app.use(calibratorRouter(config, storage));  // Prompt calibration tool
  }
  app.use(openrouterRouter(config, storage));   // OpenRouter AI autopilot
  app.use(aiRouter(config, storage));            // App-level AI completion (user's key, budget-gated)
  app.use(chatRouter(config, storage));         // The person's own chat with their built-in agent
  // AI provenance (TARGET-058). The by-hash detection lookup is PUBLIC + unauthenticated by
  // design — it is the Code of Practice's detection access point, not an admin API.
  app.use(aiProvenanceRouter(config, storage));
  // The node's own AI transparency statement — what it marks, how, in which posture, and who runs
  // it. Linked from llms.txt, AGENTS.md and the bootstrap document so an agent finds it first.
  app.use(aiTransparencyRouter(config, storage));
  app.use(csmRouter(config, storage));       // Phase 0.2 — CSM management
  app.use(msmRouter(config, storage));        // MSM — Machine Service Manifest
  app.use(actionsRouter(config, storage));
  app.use(catalogueRouter(config, storage, directoryService, () => {
    // realtimeManager may be initialized later; use closure to capture the reference
    return null;
  }));
  app.use(workRouter(config, storage, peers, mailboxNotificationService));
  app.use(walletRouter(config, storage));
  app.use(usageRouter(config, storage));
  // The owner's own usage REPORTS, off the precomputed serving layer. A different meaning of
  // "usage" from usageRouter above (which is quota), hence a separate router.
  app.use(usageReportsRouter(config, storage));
  app.use(knowledgeRouter(config, storage));

  // Extended features guard — returns 503 when extended features are disabled
  const requireExtended: express.RequestHandler = (_req, res, next) => {
    if (!config.extendedFeaturesEnabled) {
      res.status(503).json({
        ok: false, protocol: 'aimeat', version: 'v1', node: config.nodeId,
        timestamp: new Date().toISOString(),
        error: { code: 'FEATURE_DISABLED', message: 'Extended features are disabled on this node' },
      });
      return;
    }
    next();
  };

  app.use('/v1/boards', requireExtended);
  app.use('/v1/federation', (req, res, next) => {
    // Allow unauthenticated introduce endpoints (federation join flow)
    if (req.path.startsWith('/peer/introduce')) return next();
    // Allow public directory and heartbeat/ping
    if (req.path === '/directory' || req.path === '/ping' || req.path === '/heartbeat' || req.path === '/service-summary') return next();
    // Allow signed peer-to-peer presence pushes (verified by node signature in the handler)
    if (req.path === '/presence' && req.method === 'POST') return next();
    // Allow public read of the network policy (peers fetch + verify it)
    if (req.path === '/network-policy' && req.method === 'GET') return next();
    // Allow public read of the federation book + node-card (peers mirror/fetch these)
    if ((req.path === '/book' || req.path === '/node-card') && req.method === 'GET') return next();
    // Allow federated auth verification (called by remote nodes)
    if (req.path === '/auth/verify' && req.method === 'POST') return next();
    return requireExtended(req, res, next);
  });
  app.use('/v1/storage', requireExtended);
  app.use('/v1/validate', requireExtended);

  app.use(boardsRouter(config, storage));
  app.use(promptsRouter(config, storage));
  app.use(adminRouter(config, storage, maintenanceState, provenance, consulService, peers));
  app.use(organismsRouter(config, storage));
  app.use(notificationsRouter(config, storage));
  app.use(adminSecurityRouter(config, storage));
  app.use(sharingGroupsRouter(config, storage));
  app.use(connectionsRouter(config, storage));  // TARGET-057: outbound connections + delegations
  app.use(federationRouter(config, storage, peers, networkDirectory));
  app.use(disputesRouter(config, storage));
  app.use(flagsRouter(config, storage));
  app.use(appealsRouter(config, storage));
  app.use(matchesRouter(config, storage));
  app.use(microMemoryRouter(config, storage));
  app.use(storageFilesRouter(config, storage));
  // Data packages: the publish/validate/read door onto services/datapackage/. The CANONICAL
  // address of a package is the /v1/pub storage URL these routes hand back; this is where a
  // producer writes one and where "the newest version" gets resolved.
  app.use(dataPackagesRouter(config, storage));
  // The OData v4 feed for a package. A core route because an extension cannot serve one: the
  // extension surface is POST-only behind auth, the sandbox never sees the query string, and the
  // answer is envelope-wrapped — OData needs GET, query options, XML metadata and a bare body.
  app.use(odataRouter(config, storage));
  app.use(validateRouter(config));
  app.use(unfurlRouter(config));                        // GET /v1/unfurl(/image) — link previews
  app.use(mcpRouter(config, storage, peers));
  app.use(siteRouter(config, storage, siteService));    // Node Portal — GET / + /v1/site/*

  // Site LB sync — manual trigger endpoint + background job
  if (config.siteLbEnabled && config.siteLbOriginUrl) {
    app.post('/v1/admin/site/sync', requireAuth(), requireRole('operator'), async (_req, res) => {
      try {
        const result = await triggerSiteSync(config, storage, siteService);
        res.json(success(config.nodeId, { synced: true, template_updated: result.templateUpdated, memory_keys_synced: result.memoryKeysSynced }));
      } catch (err) {
        res.status(502).json(error(config.nodeId, 'SYNC_FAILED', err instanceof Error ? err.message : 'Sync failed'));
      }
    });
    startSiteSyncJob(config, storage, siteService);
  }
  if (config.portfolioEnabled) {
    app.use(portfolioRouter(config, storage));
  }

  // The KOTI (home) routes — the remake's onboarding path. Additive: mounted beside the profile
  // routes, which are untouched, and a person moves between the two with a switch.
  app.use(homeRouter(config, storage));
  // The agent door: an AI asks us to email someone a link that ends in an account. Open by design
  // (no auth — the caller has no identity yet), fenced by a per-IP limit here and a per-address
  // limit in the service.
  app.use(registrationInvitesRouter(config, storage));

  app.use(portalRouter(config, storage));
  app.use(portalApiRouter(config, storage));
  app.use(publicStatsRouter(config, storage));
  app.use(publicEventsRouter(config, storage));
  // Phase 1.1 — Email service for verification and magic links
  const emailService = createEmailService(config);

  // Push notification service — Phase 3.1
  const pushService = createPushService(config, storage);
  setNotifyPushService(pushService);   // bell notifications (services/notify.ts) mirror to web push
  app.use(pushRouter(config, storage, pushService));

  // EUDIW / VC / MyData services — Phase 3.3
  const sdJwtVerifier = createSdJwtVerifier();
  const eudiwService = createEudiwService(config, storage, sdJwtVerifier);
  const vcIssuerService = createVcIssuerService(config);
  const mydataReceiptService = createMyDataReceiptService(config);

  // FTN OIDC client — Phase 3.3
  let oidcClient: OidcClient | null = null;
  if (config.ftnEnabled && config.ftnProviderUrl && config.ftnClientId) {
    oidcClient = createOidcClient({
      issuerUrl: config.ftnProviderUrl,
      clientId: config.ftnClientId,
      clientSecret: config.ftnClientSecret,
      redirectUri: `${config.baseUrl}/v1/ghii/verify/ftn/callback`,
      scopes: ['openid', 'profile', config.nationalEidPidClaim],
    });
    oidcClient.initialize().catch(err =>
      logger.warn('FTN OIDC discovery failed, FTN endpoints will return 503', { error: String(err) }));
  }

  app.use(verificationRouter(config, storage, eudiwService, vcIssuerService, mydataReceiptService, oidcClient));

  // Social login OIDC providers (Google + Casdoor + Entra ID) — generic, per-provider config-gated.
  // buildOidcProviders creates + lazily discovers each configured client (503 until ready).
  app.use(oauthLoginRouter(config, storage, buildOidcProviders(config)));

  // DID Document + VC signing key — Phase 3.3
  // Node key is loaded async; once available, enable VC signing and serve DID Document
  storage.getNodeKey().then(async (nodeKeyPair) => {
    if (!nodeKeyPair) return;
    vcIssuerService.setNodeKeyPair(nodeKeyPair);
    const publicJwk = await vcIssuerService.getPublicJwk();
    const didDocService = createDidDocumentService(vcIssuerService.getIssuerDid(), publicJwk);
    app.get('/.well-known/did.json', (_req, res) => {
      res.json(didDocService.getDocument());
    });
  }).catch(err => logger.warn('DID Document setup failed', { error: String(err) }));

  // Match notification job — Phase 1.6
  startMatchNotificationJob(config, storage, emailService, directoryService);

  // AI Matching — Phase 2.1
  const matchingEngine = createMatchingEngine(config, storage, directoryService, emailService);
  startMatchingScheduler(config, matchingEngine);

  // Genesis peering service — Phase 3.4
  const genesisPeeringService = createGenesisPeeringService(config, storage);

  // Admin features — Phase 1-3 dashboard endpoints
  app.use(adminFeaturesRouter(config, storage, {
    emailService,
    directoryService,
    matchingEngine,
    pushService,
    genesisPeeringService,
  }));

  app.use(totpRouter(config, storage));   // Phase 0.5 — MUST be before ghiiRouter (TOTP routes use /v1/ghii/totp/*)
  app.use(ghiiRouter(config, storage, emailService, notifyDirectoryChange, peers));
  app.use(chatInstancesRouter(config, storage));
  app.use(libsRouter(config, storage));
  app.use(appTemplatesRouter(config, storage));
  app.use(appdevPitfallsRouter(config, storage));
  app.use(appdevOverviewRouter(config, storage));
  app.use(libraryPacksRouter(config, storage));
  // Backup routes BEFORE appsRouter so /v1/apps/backup/* never collides with
  // the parameterized /v1/apps/:owner/:filename routes.
  app.use(appsBackupRouter(config, storage));
  // Member roster BEFORE appsRouter for the same reason as backup: these are more specific paths
  // under /v1/apps/:owner/:filename/ and must not be swallowed by the parameterized app routes.
  app.use(appMembersRouter(config, storage));
  app.use(appsRouter(config, storage, peers));
  app.use(appStoreRouter(config, storage));
  // Node Extensions (Sandboxed)
  if (config.extensionsEnabled) {
    app.use(extensionsRouter(config, storage, scheduler, emailService));
    logger.info('Extension system enabled');
  }

  // Cortex Extensions (Manifest-based)
  if (config.cortexEnabled) {
    app.use(cortexRouter(config, storage));
    logger.info('Cortex extension system enabled');
  }

  // Packages, Instances & Templates
  if (config.packagesEnabled) {
    app.use(packagesRouter(config, storage));
    app.use(instancesRouter(config, storage, scheduler));
  }
  if (config.packagesEnabled && config.templatesEnabled) {
    app.use(templatesRouter(config, storage));
  }

  // Capability Layer
  app.use(capabilitiesRouter(config, storage));
  app.use(adminCapabilitiesRouter(config, storage));

  // Scheduler admin routes
  app.use(adminSchedulerRouter(config, storage, scheduler));

  // Bundled extensions admin routes
  app.use(adminExtensionsRouter(config, storage, scheduler));

  // System prompts admin routes
  app.use(adminPromptsRouter(config, storage));
  app.use(subdomainAdminRouter(config, storage));

  // Agent tasks + sharing groups admin routes (Phase 1 Agent Dashboard)
  app.use(adminAgentTasksRouter(config, storage));
  app.use(adminStorageStatsRouter(config, storage));
  app.use(adminUsageRouter(config, storage));
  app.use(adminAgentIntegrationRouter(config, storage));
  app.use(adminSharingGroupsRouter(config, storage));
  app.use(adminOrganismsRouter(config, storage));

  // Seed core scheduled jobs (idempotent — only creates if not already present)
  seedCoreScheduledJobs(config, storage).catch(err =>
    logger.error('Failed to seed core scheduled jobs', { error: String(err) }));

  // Wire dispatch + notification deps for ai/agent_task schedules before start.
  scheduler.setWebhookDispatcher(webhookDispatcher);
  scheduler.setPushService(pushService);

  // Wire the workflow engine's deps + start its watchdog (advances in-flight runs after restart).
  workflowEngine.setWebhookDispatcher(webhookDispatcher);
  workflowEngine.setPushService(pushService);
  workflowEngine.setEmailService(emailService);
  workflowEngine.start().catch(err => logger.error('WorkflowEngine start failed', { error: String(err) }));

  // Start the scheduler (loads enabled jobs from storage)
  scheduler.start().catch(err => logger.error('Scheduler start failed', { error: String(err) }));

  // Genesis Sync Scheduler (Phase 3.4)
  const genesisSyncService = createGenesisSyncService(config, storage);
  if (genesisSyncService) {
    genesisSyncService.start();
  }

  // Cache Cleanup Scheduler (G.1) — prunes expired federated/replica/genesis memory entries hourly
  startCacheCleanupJob(config, storage);

  // Sync Scheduler (B.4) — coordinates catalogue sync + memory replication based on syncMode
  startSyncScheduler(config, storage, peers);

  // Direct-message federation retry — re-attempts queued cross-node messages (DECISION #6)
  startMessageRetryJob(config, storage, peers);

  // Memory Contracts — Tracked Responses: rebuild the reactive watched-key registry from live
  // contracts, react to writes on watched keys (event-driven), and run the safety-net reconciler.
  rebuildTrackRegistry(storage).catch(err => logger.error('Track registry rebuild failed', { error: String(err) }));
  onMemoryWrittenEvent(evt => {
    if (!isTracked(evt.key)) return;   // O(1) gate — only watched keys do any work
    evaluateTrackedKey({ config, storage, peers }, evt.key)
      .catch(err => logger.warn('tracked-response reactive evaluate failed', { error: String(err) }));
  });
  startTrackedResponseReconciler(config, storage, peers);

  app.use(specRouter(config));

  // Connector forward tunnel — operator-only stats route (WS upgrade is in index.ts)
  if (config.connectTunnelEnabled) {
    app.use(connectTunnelRouter(config));
  }

  // Personal node management routes
  if (config.personalNodesEnabled) {
    app.use(personalRouter(config, storage, tunnelManager, mailboxNotificationService));
  }

  // Realtime P2P rooms — Phase 0
  let realtimeManager: RealtimeManager | null = null;
  if (config.realtimeEnabled) {
    realtimeManager = new RealtimeManager(config, storage);
    app.use(realtimeRouter(config, storage, realtimeManager, peers));
    realtimeManager.startCleanupJob();
    logger.info('Realtime P2P rooms enabled', { maxRooms: config.realtimeMaxRooms });
  }

  return { realtimeManager };
}
