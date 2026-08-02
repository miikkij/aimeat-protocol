/**
 * @file config.ts
 * @description Central AimeatConfig type and loadConfig() entry point. Reads
 *   env vars + optional file source + CLI overrides into a single config
 *   object consumed by every module. Also defines OperatorConfig (privacy
 *   policy fields rendered into /v1/privacy) and helpers missingOperatorConfig
 *   / operatorTypeLabel used by the portal router to fail loud when the
 *   operator has not identified themselves.
 * @structure
 *   - AimeatConfig (interface)
 *   - OperatorConfig (interface) + OperatorType (union)
 *   - LoadConfigOptions / LoadConfigResult
 *   - loadConfig() (function)
 *   - missingOperatorConfig() / operatorTypeLabel() (helpers)
 * @version-history
 *   v1.0.0 -- pre-2026-05 -- Initial central config module
 *   v1.1.0 -- 2026-05-29 -- Add OperatorConfig section + helpers. Required for
 *     privacy policy template substitution per CLAUDE.md self-host architecture.
 *   v1.1.1 -- 2026-06-02 -- Raise default taskStallThresholdMinutes 30 -> 120 so
 *     long-running orchestrated tasks aren't falsely marked stalled.
 *   v1.2.0 -- 2026-07-10 -- Security posture: resolve securityProfile (local|public) + the
 *     allowPrivateEgress / aiProviderAllowlist knobs from env, normalise AIMEAT_ALLOW_PRIVATE_EGRESS
 *     for url-validator, add securityPostureWarnings() startup self-check. See security-development-dna.md.
 *   v1.5.1 -- 2026-08-01 -- Pure extraction: missingOperatorConfig / operatorTypeLabel moved to
 *     config-operator.ts (max-file-lines) and are re-exported here, so no importer changes.
 *   v1.5.0 -- 2026-08-01 -- TARGET-058 Phase 3: AIMEAT_AI_LABEL_PUBLIC (strict|light|off, `off`
 *     refused + coerced to `strict` on a public node, reported by securityPostureWarnings) and
 *     AIMEAT_AI_SUPERVISORY_NAME/_URL (the AI market-surveillance authority, distinct from the
 *     operator block's data-protection authority).
 *   v1.4.0 -- 2026-08-01 -- AI provenance (TARGET-058): AIMEAT_AI_PROVENANCE + _DETAIL.
 *   v1.3.0 -- 2026-07-14 -- mcpCardCommerceTools: AIMEAT_MCP_CARD_COMMERCE_TOOLS inline|pointer
 *     for the MCP Server Card commerce_tools block (TARGET-034 phase D).
 */
import { loadFileSource } from './services/config-loader.js';
import { CONFIG_FIELDS, DOT_PATH_TO_ENV, MUTABLE_CONFIG_MAP, parseConfigValue, isImmutable } from './services/config-schema.js';
import type { ConfigProvenance } from './services/config-provenance.js';

export type {
  ExtensionHooks,
  HookName,
  RateLimitTier,
  RoleMultipliers,
  RateLimitsConfig,
  NodeType,
  FederationRole,
  OperatorType,
  OperatorConfig,
  AimeatConfig,
  LoadConfigOptions,
  LoadConfigResult,
} from './config-types.js';
import type {
  AimeatConfig,
  NodeType,
  FederationRole,
  OperatorType,
  RateLimitsConfig,
  RateLimitTier,
  LoadConfigOptions,
  LoadConfigResult,
  SiteContact,
} from './config-types.js';

/**
 * The people printed on the public pages, from `AIMEAT_SITE_CONTACTS` (a JSON array of
 * `{ name, role, email, phone }`, ordered by who should field the first contact).
 *
 * Falls back to the single-contact vars this replaced, and finally to the operator email, so a
 * node configured before multi-contact keeps its card. An entry without an email is dropped:
 * a "talk to a human" card with no way to reach anyone is worse than no card.
 *
 * Malformed JSON degrades to the fallback and warns rather than refusing to boot — a typo in a
 * marketing contact must never take a node down.
 */
function parseSiteContacts(): SiteContact[] {
  const raw = (process.env.AIMEAT_SITE_CONTACTS ?? '').trim();
  const clean = (c: Partial<SiteContact>): SiteContact => ({
    name: String(c.name ?? '').trim(),
    role: String(c.role ?? '').trim(),
    email: String(c.email ?? '').trim(),
    phone: String(c.phone ?? '').trim(),
    linkedin: String(c.linkedin ?? '').trim(),
  });
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(c => clean(c as Partial<SiteContact>)).filter(c => c.email !== '');
      logger.warn('AIMEAT_SITE_CONTACTS is not a JSON array — ignoring it and falling back');
    } catch (err) {
      logger.warn('AIMEAT_SITE_CONTACTS is not valid JSON — ignoring it and falling back', { error: String(err) });
    }
  }
  const single = clean({
    name: process.env.AIMEAT_SITE_CONTACT_NAME,
    role: process.env.AIMEAT_SITE_CONTACT_ROLE,
    email: process.env.AIMEAT_SITE_CONTACT_EMAIL ?? process.env.AIMEAT_OPERATOR_EMAIL,
    phone: process.env.AIMEAT_SITE_CONTACT_PHONE,
    linkedin: process.env.AIMEAT_SITE_CONTACT_LINKEDIN,
  });
  return single.email ? [single] : [];
}

/**
 * True if `baseUrl` points at localhost / loopback / RFC1918 / link-local / IPv6-ULA — i.e. NOT a
 * public host. Drives the default security profile (private host → `local`, public host → `public`).
 * A host-less or unparseable baseUrl is treated as private (fail safe toward localhost-flexible dev).
 */
function isPrivateHost(baseUrl: string): boolean {
  let host: string;
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return true; }
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::') return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;      // link-local (incl. cloud metadata)
  if (/^f[cd][0-9a-f]{2}:/.test(host)) return true; // IPv6 unique-local
  return false;
}

/**
 * Derive the app-origin host (`apps.<apexHost>`) from a baseUrl. Returns '' for
 * localhost / IP / host-less baseUrls where a public app subdomain makes no sense
 * (the operator can still set AIMEAT_APP_HOST explicitly, e.g. for local testing).
 */
function deriveAppHost(baseUrl: string): string {
  let host: string;
  // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer here: the input is not of that shape
  try { host = new URL(baseUrl).hostname.toLowerCase(); } catch { return ''; }
  if (!host || host === 'localhost' || /^[\d.]+$/.test(host) || host.endsWith('.localhost')) return '';
  return `apps.${host}`;
}

/** Same derivation for the standalone-portfolio origin (`portfolio.<apexHost>`). */
function derivePortfolioHost(baseUrl: string): string {
  const appHost = deriveAppHost(baseUrl);
  return appHost ? appHost.replace(/^apps\./, 'portfolio.') : '';
}

/**
 * Startup posture self-check. When the resolved security profile is `public`, return a list of
 * unsafe-combination warnings so being insecure on the internet is a conscious operator choice,
 * not an accident. Warn-only by contract (the caller logs them) — never throws, so an operator can
 * still run any combination deliberately. Empty list on a `local` node. See security-development-dna.md.
 */
export function securityPostureWarnings(config: AimeatConfig): string[] {
  const w: string[] = [];
  if (config.securityProfile !== 'public') return w;
  if (config.anonymousMode) w.push('AIMEAT_ANONYMOUS=true — anyone can act as the shared anonymous identity.');
  if (config.allowPrivateEgress) w.push('AIMEAT_ALLOW_PRIVATE_EGRESS=true — server-side fetches can reach loopback/internal services (SSRF).');
  if (config.federationOpenJoin) w.push('AIMEAT_FEDERATION_OPEN_JOIN=true — any peer can federate without operator approval.');
  if (!config.encryptionKey) w.push('AIMEAT_ENCRYPTION_KEY is unset — secrets (AI keys, TOTP) cannot be encrypted at rest.');
  if (config.corsAllowedOrigins.includes('*')) w.push('AIMEAT_CORS_ALLOWED_ORIGINS=* — with credentials this is a CSRF / data-exfil footgun.');
  if (config.statsAccess === 'public') w.push('AIMEAT_STATS_ACCESS=public — internal metrics are exposed to anyone.');
  // Not "you chose something unsafe" but "your choice was not honoured" — the one entry here that
  // reports a coercion rather than a risk, so an operator who set it never believes it took effect.
  if (process.env.AIMEAT_AI_LABEL_PUBLIC?.trim().toLowerCase() === 'off') {
    w.push('AIMEAT_AI_LABEL_PUBLIC=off was REFUSED and reset to `strict` — a publicly reachable node may not hide the visible AI label (EU AI Act Art. 50). Use `light` to label only what the law requires.');
  }
  return w;
}

export function loadConfig(options?: LoadConfigOptions): LoadConfigResult {
  const { configPath, cliOverrides } = options ?? {};

  // ── Source tracking for provenance ──
  const cliKeys: string[] = [];
  const envKeys: string[] = [];
  const fileKeys: string[] = [];

  // 1. Apply CLI overrides to process.env (highest non-DB priority)
  if (cliOverrides) {
    for (const [dotPath, value] of Object.entries(cliOverrides)) {
      const envVar = DOT_PATH_TO_ENV[dotPath];
      if (envVar) {
        process.env[envVar] = value;
        cliKeys.push(dotPath);
      }
    }
  }

  // 2. Track which env vars are already set (before file population)
  for (const field of CONFIG_FIELDS) {
    if (process.env[field.envVar] !== undefined && !cliKeys.includes(field.dotPath)) {
      envKeys.push(field.dotPath);
    }
  }

  // 3. Load file config and populate process.env for unset values
  const fileSource = loadFileSource(configPath);
  if (fileSource) {
    for (const [dotPath, value] of Object.entries(fileSource.values)) {
      const envVar = DOT_PATH_TO_ENV[dotPath];
      if (envVar && process.env[envVar] === undefined) {
        process.env[envVar] = value;
        fileKeys.push(dotPath);
      }
    }
    console.log(`[config] Loaded ${Object.keys(fileSource.values).length} values from ${fileSource.name}`);
  }

  // ── Build config from process.env (now includes CLI + env + file layers) ──
  const nodeType = (process.env.AIMEAT_NODE_TYPE ?? 'full') as NodeType;
  if (!['full', 'relay', 'mirror', 'personal'].includes(nodeType)) {
    throw new Error(`Invalid AIMEAT_NODE_TYPE: ${nodeType}. Must be 'full', 'relay', 'mirror', or 'personal'.`);
  }

  const port = parseInt(process.env.AIMEAT_PORT ?? '40050', 10);

  // Rate limits — parse individual values, per-endpoint falls back to global
  const rlGlobal = Math.max(1, parseInt(process.env.AIMEAT_RL_GLOBAL ?? '300', 10));
  const rlAuth = Math.max(1, parseInt(process.env.AIMEAT_RL_AUTH ?? '20', 10));
  const rlWork = Math.max(1, parseInt(process.env.AIMEAT_RL_WORK ?? '60', 10));
  const rlMemory = Math.max(1, parseInt(process.env.AIMEAT_RL_MEMORY ?? '120', 10));
  const rlBoards = Math.max(1, parseInt(process.env.AIMEAT_RL_BOARDS ?? '60', 10));
  const rlOwners = Math.max(1, parseInt(process.env.AIMEAT_RL_OWNERS ?? String(rlGlobal), 10));
  const rlGhii = Math.max(1, parseInt(process.env.AIMEAT_RL_GHII ?? String(rlGlobal), 10));
  const rlFlags = Math.max(1, parseInt(process.env.AIMEAT_RL_FLAGS ?? String(rlGlobal), 10));
  const rlAppeals = Math.max(1, parseInt(process.env.AIMEAT_RL_APPEALS ?? String(rlGlobal), 10));
  const rlAdminSetup = Math.max(1, parseInt(process.env.AIMEAT_RL_ADMIN_SETUP ?? String(rlGlobal), 10));
  const rlFederation = Math.max(1, parseInt(process.env.AIMEAT_RL_FEDERATION ?? String(rlGlobal), 10));
  const rlCatalogue = Math.max(1, parseInt(process.env.AIMEAT_RL_CATALOGUE ?? String(rlGlobal), 10));
  const rlAuthChallenge = Math.max(1, parseInt(process.env.AIMEAT_RL_AUTH_CHALLENGE ?? String(rlGlobal), 10));

  // ── Security posture (localhost-flexible → public-strict) ──
  // The profile sets safe DEFAULTS; any explicit AIMEAT_* var overrides it. Full rationale + the
  // ten security invariants: docs/coding-guidelines/security-development-dna.md
  const resolvedBaseUrl = (process.env.AIMEAT_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
  const securityProfile: 'local' | 'public' =
    ['local', 'public'].includes(process.env.AIMEAT_SECURITY_PROFILE ?? '')
      ? (process.env.AIMEAT_SECURITY_PROFILE as 'local' | 'public')
      : ((isPrivateHost(resolvedBaseUrl) || nodeType === 'personal') ? 'local' : 'public');
  const allowPrivateEgress = process.env.AIMEAT_ALLOW_PRIVATE_EGRESS !== undefined
    ? process.env.AIMEAT_ALLOW_PRIVATE_EGRESS === 'true'
    : securityProfile === 'local';
  // url-validator is a leaf util that reads AIMEAT_ALLOW_PRIVATE_EGRESS at call time (importing
  // config there would risk a cycle). Normalise the env to the resolved default so the profile
  // actually governs loopback egress even when the operator left the var unset.
  if (process.env.AIMEAT_ALLOW_PRIVATE_EGRESS === undefined) {
    process.env.AIMEAT_ALLOW_PRIVATE_EGRESS = String(allowPrivateEgress);
  }
  const aiProviderAllowlist = (process.env.AIMEAT_AI_PROVIDER_ALLOWLIST ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  // AI provenance (TARGET-058): ON unless explicitly switched off, and _DETAIL governs what is
  // SERVED publicly, never what is stored. Rationale in config-types.ts + .env.example.
  const aiProvenance = process.env.AIMEAT_AI_PROVENANCE !== 'false';
  const aiProvenanceDetail: 'full' | 'minimal' = process.env.AIMEAT_AI_PROVENANCE_DETAIL === 'minimal' ? 'minimal' : 'full';
  // Visible-label posture. `off` is REFUSED on a public node rather than obeyed: this knob decides
  // whether a person is told, and the one combination that must be unreachable by accident is
  // "reachable from the internet, labels hidden". An unknown value falls back to the strict default
  // rather than to the permissive one. securityPostureWarnings() reports the coercion at startup.
  const requestedLabelPublic = process.env.AIMEAT_AI_LABEL_PUBLIC?.trim().toLowerCase();
  const aiLabelPublic: 'strict' | 'light' | 'off' =
    requestedLabelPublic === 'off' && securityProfile === 'public' ? 'strict'
      : (['strict', 'light', 'off'].includes(requestedLabelPublic ?? '')
        ? (requestedLabelPublic as 'strict' | 'light' | 'off')
        : 'strict');

  const config: AimeatConfig = {
    port,
    baseUrl: (process.env.AIMEAT_BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    // App origin: explicit AIMEAT_APP_HOST wins; otherwise derive `apps.<apexHost>`
    // from the baseUrl. Left empty for host-less baseUrls (so nothing breaks in dev).
    appHost: (process.env.AIMEAT_APP_HOST ?? deriveAppHost(process.env.AIMEAT_BASE_URL ?? `http://localhost:${port}`)).trim().toLowerCase(),
    appOriginEnabled: process.env.AIMEAT_APP_ORIGIN_ENABLED === 'true',
    // Portfolio origin: explicit AIMEAT_PORTFOLIO_HOST wins; otherwise derive
    // `portfolio.<apexHost>` from the baseUrl (empty for host-less baseUrls).
    portfolioHost: (process.env.AIMEAT_PORTFOLIO_HOST ?? derivePortfolioHost(process.env.AIMEAT_BASE_URL ?? `http://localhost:${port}`)).trim().toLowerCase(),
    portfolioOriginEnabled: process.env.AIMEAT_PORTFOLIO_ORIGIN_ENABLED === 'true',
    nodeId: process.env.AIMEAT_NODE_ID ?? 'aimeat-local-001-dev',
    nodeType,
    dbUrl: process.env.DATABASE_URL ?? null,
    // Accept `postgres` / `postgresql` as aliases for `postgres-kysely` (the only Postgres
    // backend since the Prisma providers were removed). `mongodb` is passed through so the
    // storage factory can fail fast with migration guidance.
    storageProvider: (['postgres', 'postgresql'].includes(process.env.AIMEAT_STORAGE ?? '')
      ? 'postgres-kysely'
      : (process.env.AIMEAT_STORAGE ?? 'memory')) as 'memory' | 'sqlite' | 'postgres-kysely',
    sqlitePath: process.env.AIMEAT_SQLITE_PATH ?? './data/aimeat.db',
    adminPassword: process.env.AIMEAT_ADMIN_PASSWORD ?? null,
    devMode: process.env.AIMEAT_DEV_MODE === 'true',
    testMode: process.env.AIMEAT_TEST_MODE === 'true',
    anonymousMode: process.env.AIMEAT_ANONYMOUS === 'true',
    perfTrace: process.env.AIMEAT_PERF_TRACE === 'true',
    securityProfile,
    allowPrivateEgress,
    aiProviderAllowlist,
    aiProvenance,
    aiProvenanceDetail,
    aiLabelPublic,
    aiSupervisoryName: process.env.AIMEAT_AI_SUPERVISORY_NAME ?? '',
    aiSupervisoryUrl: process.env.AIMEAT_AI_SUPERVISORY_URL ?? '',
    screenshotAutoCapture: process.env.AIMEAT_SCREENSHOT_AUTO === 'true',
    screenshotIntervalMin: parseInt(process.env.AIMEAT_SCREENSHOT_INTERVAL_MIN ?? '15', 10),
    screenshotSettleMs: parseInt(process.env.AIMEAT_SCREENSHOT_SETTLE_MS ?? '6000', 10),
    jwtTtlSeconds: parseInt(process.env.AIMEAT_JWT_TTL ?? '3600', 10),
    agentJwtTtlSeconds: parseInt(process.env.AIMEAT_AGENT_JWT_TTL ?? '7776000', 10), // 90 days
    ecoJwtTtlSeconds: parseInt(process.env.AIMEAT_ECO_JWT_TTL ?? '7776000', 10),     // 90 days
    accessTtlSeconds: parseInt(process.env.AIMEAT_ACCESS_TTL ?? '900', 10),          // 15 min
    refreshIdleDays: parseInt(process.env.AIMEAT_REFRESH_IDLE_DAYS ?? '30', 10),
    refreshAbsoluteDays: parseInt(process.env.AIMEAT_REFRESH_ABSOLUTE_DAYS ?? '90', 10),
    refreshGraceMs: parseInt(process.env.AIMEAT_REFRESH_GRACE_MS ?? '60000', 10),     // 60s

    welcomeBonus: parseInt(process.env.AIMEAT_WELCOME_BONUS ?? '100', 10),
    dailyAllowance: parseInt(process.env.AIMEAT_DAILY_ALLOWANCE ?? '50', 10),
    dailyAllowanceCap: parseInt(process.env.AIMEAT_DAILY_ALLOWANCE_CAP ?? '500', 10),
    burnRate: parseFloat(process.env.AIMEAT_BURN_RATE ?? '0.10'),
    keyedBrowseEnabled: process.env.AIMEAT_KEYED_BROWSE !== 'false',
    extendedFeaturesEnabled: process.env.AIMEAT_EXTENDED_FEATURES !== 'false',
    maxRelayHops: parseInt(process.env.AIMEAT_MAX_RELAY_HOPS ?? '3', 10),
    depeeringGracePeriodHours: parseInt(process.env.AIMEAT_DEPEERING_GRACE_HOURS ?? '72', 10),
    keyCacheRefreshMinutes: parseInt(process.env.AIMEAT_KEY_CACHE_REFRESH_MINUTES ?? '5', 10),
    memoryQuotaMb: parseInt(process.env.AIMEAT_MEMORY_QUOTA_MB ?? '10', 10),
    memoryMaxValueSizeKb: parseInt(process.env.AIMEAT_MEMORY_MAX_VALUE_SIZE_KB ?? '1024', 10),
    memoryMaxKeysPerAgent: parseInt(process.env.AIMEAT_MEMORY_MAX_KEYS ?? '1000', 10),
    organismDecisionLogCap: parseInt(process.env.AIMEAT_ORGANISM_DECISION_LOG_CAP ?? '500', 10),
    workspaceMaxVersions: parseInt(process.env.AIMEAT_WS_MAX_VERSIONS ?? '20', 10),
    storageQuotaMb: parseInt(process.env.AIMEAT_STORAGE_QUOTA_MB ?? '100', 10),
    storageMaxFileSizeMb: parseInt(process.env.AIMEAT_STORAGE_MAX_FILE_SIZE_MB ?? '10', 10),
    storageMaxChunkedFileSizeGb: parseInt(process.env.AIMEAT_STORAGE_MAX_CHUNKED_FILE_SIZE_GB ?? '5', 10),
    sttMaxMb: parseInt(process.env.AIMEAT_STT_MAX_MB ?? '25', 10),
    sttMaxSeconds: parseInt(process.env.AIMEAT_STT_MAX_SECONDS ?? '600', 10),
    voiceMsgMaxSeconds: parseInt(process.env.AIMEAT_VOICE_MSG_MAX_SECONDS ?? '300', 10),
    microMemoryQuotaKb: parseInt(process.env.AIMEAT_MICRO_MEMORY_QUOTA_KB ?? '500', 10),
    microMemoryMaxSetsPerAgent: parseInt(process.env.AIMEAT_MICRO_MEMORY_MAX_SETS ?? '50', 10),
    microMemoryMaxKeysPerSet: parseInt(process.env.AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET ?? '100', 10),
    microMemoryMaxValueSizeBytes: parseInt(process.env.AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE ?? '1024', 10),
    maxActionsPerAgent: parseInt(process.env.AIMEAT_MAX_ACTIONS_PER_AGENT ?? '20', 10),
    minTrustForPaidActions: parseInt(process.env.AIMEAT_MIN_TRUST_PAID_ACTIONS ?? '10', 10),
    appMaxSizeMb: parseInt(process.env.AIMEAT_APP_MAX_SIZE_MB ?? '5', 10),
    maxAppsPerAgent: parseInt(process.env.AIMEAT_MAX_APPS_PER_AGENT ?? '50', 10),
    agentPortingFeeMorsels: parseInt(process.env.AIMEAT_AGENT_PORTING_FEE ?? '50', 10),
    memoryOverageMorselsPerMbMonth: parseInt(process.env.AIMEAT_MEMORY_OVERAGE_MORSELS ?? '10', 10),
    storageOverageMorselsPerGbMonth: parseInt(process.env.AIMEAT_STORAGE_OVERAGE_MORSELS ?? '100', 10),
    maxOperatorMintPerDay: parseInt(process.env.AIMEAT_MAX_OPERATOR_MINT_PER_DAY ?? '10000', 10),
    boardPostBaseCost: parseInt(process.env.AIMEAT_BOARD_POST_BASE_COST ?? '5', 10),
    boardPostCostPerKb: parseInt(process.env.AIMEAT_BOARD_POST_COST_PER_KB ?? '2', 10),
    appAnnouncementBoardId: process.env.AIMEAT_APP_ANNOUNCEMENT_BOARD_ID ?? 'app-announcements',
    webhookMaxRetries: parseInt(process.env.AIMEAT_WEBHOOK_MAX_RETRIES ?? '5', 10),
    workQueueMaxPending: parseInt(process.env.AIMEAT_WORK_QUEUE_MAX_PENDING ?? '10', 10),
    otkTtlMs: parseInt(process.env.AIMEAT_OTK_TTL_MS ?? '300000', 10),
    otkGraceMs: parseInt(process.env.AIMEAT_OTK_GRACE_MS ?? '60000', 10),
    maxUrlLength: parseInt(process.env.AIMEAT_MAX_URL_LENGTH ?? '8192', 10),
    indexNowKey: process.env.AIMEAT_INDEXNOW_KEY ?? null,
    extensionHooks: {
      pre_owner_registration: [],
      post_owner_registration: [],
      pre_agent_registration: [],
      post_agent_registration: [],
      owner_recovery: [],
      agent_rekey: [],
      pre_work_request: [],
      post_work_delivery: [],
      post_settlement: [],
      pre_board_post: [],
      pre_federation_peer: [],
    },
    federationRole: (process.env.AIMEAT_FEDERATION_ROLE ?? 'standalone') as FederationRole,
    federationAuthPolicy: (process.env.AIMEAT_FEDERATION_AUTH_POLICY ?? 'disabled') as 'disabled' | 'all_peers' | 'specific_peers',
    federationDefaultScopes: (process.env.AIMEAT_FEDERATION_DEFAULT_SCOPES ?? 'memory:read,catalogue:read').split(',').filter(Boolean),
    federationOpenJoin: process.env.AIMEAT_FEDERATION_OPEN_JOIN === 'true',
    federationBookListed: process.env.AIMEAT_FEDERATION_BOOK_LISTED !== 'false',
    federationAvailabilityWindowDays: parseInt(process.env.AIMEAT_FEDERATION_AVAILABILITY_WINDOW_DAYS ?? '30', 10),
    federationAvailabilityPermanentThreshold: parseInt(process.env.AIMEAT_FEDERATION_AVAILABILITY_PERMANENT_THRESHOLD ?? '90', 10),
    federationAvailabilityMinSamples: parseInt(process.env.AIMEAT_FEDERATION_AVAILABILITY_MIN_SAMPLES ?? '288', 10),

    // Security limits
    loginRateLimitMax: parseInt(process.env.AIMEAT_LOGIN_RATE_LIMIT_MAX ?? '15', 10),
    loginRateLimitWindowMs: parseInt(process.env.AIMEAT_LOGIN_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    registrationRateLimitMax: parseInt(process.env.AIMEAT_REGISTRATION_RATE_LIMIT_MAX ?? '5', 10),
    registrationRateLimitWindowMs: parseInt(process.env.AIMEAT_REGISTRATION_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    adminAuthRateLimitMax: parseInt(process.env.AIMEAT_ADMIN_AUTH_RATE_LIMIT_MAX ?? '5', 10),
    adminAuthRateLimitWindowMs: parseInt(process.env.AIMEAT_ADMIN_AUTH_RATE_LIMIT_WINDOW_MS ?? '60000', 10),
    passwordLockoutAttempts: parseInt(process.env.AIMEAT_PASSWORD_LOCKOUT_ATTEMPTS ?? '5', 10),
    passwordLockoutMinutes: parseInt(process.env.AIMEAT_PASSWORD_LOCKOUT_MINUTES ?? '15', 10),
    jsonBodyLimitMb: parseInt(process.env.AIMEAT_JSON_BODY_LIMIT_MB ?? '5', 10),
    jsonBodyLimitLargeMb: parseInt(process.env.AIMEAT_JSON_BODY_LIMIT_LARGE_MB ?? '15', 10),
    genesisUrl: process.env.AIMEAT_GENESIS_URL ?? null,
    consentEnabled: process.env.AIMEAT_CONSENT_ENABLED !== 'false',
    consentAuditRetentionDays: parseInt(process.env.AIMEAT_CONSENT_AUDIT_RETENTION_DAYS ?? '365', 10),
    executionLogRetentionDays: parseInt(process.env.AIMEAT_EXECUTION_LOG_RETENTION_DAYS ?? '30', 10),
    consentMaxPerUser: parseInt(process.env.AIMEAT_CONSENT_MAX_PER_USER ?? '100', 10),
    totpEnabled: process.env.AIMEAT_TOTP_ENABLED !== 'false',
    totpIssuer: process.env.AIMEAT_TOTP_ISSUER ?? 'AIMEAT',
    totpPeriod: parseInt(process.env.AIMEAT_TOTP_PERIOD ?? '30', 10),
    totpWindow: parseInt(process.env.AIMEAT_TOTP_WINDOW ?? '1', 10),
    totpBackupCodeCount: parseInt(process.env.AIMEAT_TOTP_BACKUP_CODE_COUNT ?? '10', 10),
    totpSecretEncryptionKey: process.env.AIMEAT_TOTP_ENCRYPTION_KEY ?? null,
    totpMaxFailedAttempts: parseInt(process.env.AIMEAT_TOTP_MAX_FAILED ?? '5', 10),
    totpLockoutSeconds: parseInt(process.env.AIMEAT_TOTP_LOCKOUT_SECONDS ?? '300', 10),
    encryptionKey: process.env.AIMEAT_ENCRYPTION_KEY ?? null,
    msmInstallRole: (process.env.AIMEAT_MSM_INSTALL_ROLE as 'operator' | 'owner') || 'owner',
    extInstallRole: (process.env.AIMEAT_EXT_INSTALL_ROLE as 'operator' | 'owner') || 'owner',
    // TEST ONLY: register a fake EUR/USD payment handler so the priced-raw-call money chain can be
    // E2E-proven without a real PSP. NEVER set in production (real money = the EE Stripe handler).
    testMoneyHandler: process.env.AIMEAT_TEST_MONEY_HANDLER === 'true',
    personalNodesEnabled: process.env.AIMEAT_PERSONAL_NODES_ENABLED !== 'false',
    personalNodeMaxSlots: parseInt(process.env.AIMEAT_PERSONAL_NODE_MAX_SLOTS ?? '100', 10),
    personalNodeMailboxQuotaMb: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_QUOTA_MB ?? '50', 10),
    personalNodeMailboxRetentionDays: parseInt(process.env.AIMEAT_PERSONAL_MAILBOX_RETENTION_DAYS ?? '7', 10),
    personalNodeHeartbeatIntervalMs: parseInt(process.env.AIMEAT_PERSONAL_HEARTBEAT_MS ?? '30000', 10),
    personalNodeOfflineThresholdMs: parseInt(process.env.AIMEAT_PERSONAL_OFFLINE_MS ?? '300000', 10),
    personalNodeRequestTimeoutMs: parseInt(process.env.AIMEAT_PERSONAL_REQUEST_TIMEOUT_MS ?? '60000', 10),

    // Connector Forward Tunnel — one persistent WS per agent identity carrying
    // forward API calls + realtime reverse delivery. OPT-IN (off by default):
    // the Node connector client that drives it is Phase 3 (unbuilt), so a node
    // shouldn't expose an endpoint nothing uses yet. Flip the default to on once
    // the connector ships. aimeat.io enables it explicitly.
    connectTunnelEnabled: process.env.AIMEAT_CONNECT_TUNNEL_ENABLED === 'true',
    connectTunnelHeartbeatIntervalMs: parseInt(process.env.AIMEAT_CONNECT_TUNNEL_HEARTBEAT_MS ?? '30000', 10),
    connectTunnelOfflineThresholdMs: parseInt(process.env.AIMEAT_CONNECT_TUNNEL_OFFLINE_MS ?? '90000', 10),
    connectTunnelRequestTimeoutMs: parseInt(process.env.AIMEAT_CONNECT_TUNNEL_REQUEST_TIMEOUT_MS ?? '30000', 10),
    smtpHost: process.env.AIMEAT_SMTP_HOST || null,
    smtpPort: parseInt(process.env.AIMEAT_SMTP_PORT ?? '587', 10),
    smtpUser: process.env.AIMEAT_SMTP_USER ?? null,
    smtpPass: process.env.AIMEAT_SMTP_PASS ?? null,
    smtpFrom: process.env.AIMEAT_SMTP_FROM ?? 'AIMEAT <noreply@localhost>',
    smtpSecure: process.env.AIMEAT_SMTP_SECURE === 'true',
    smtpRejectUnauthorized: process.env.AIMEAT_SMTP_REJECT_UNAUTHORIZED !== 'false',
    emailConfirmationRequired: process.env.AIMEAT_EMAIL_CONFIRMATION_REQUIRED === 'true',
    emailEnabled: !!(process.env.AIMEAT_SMTP_HOST),
    matchNotificationIntervalHours: parseInt(process.env.AIMEAT_MATCH_NOTIFICATION_INTERVAL_HOURS ?? '24', 10),
    matchNotificationEnabled: process.env.AIMEAT_MATCH_NOTIFICATION_ENABLED !== 'false',
    matchingEnabled: process.env.AIMEAT_MATCHING_ENABLED !== 'false',
    matchIntervalHours: parseInt(process.env.AIMEAT_MATCH_INTERVAL_HOURS ?? '24', 10),
    matchThreshold: parseFloat(process.env.AIMEAT_MATCH_THRESHOLD ?? '0.5'),
    matchMaxSuggestions: parseInt(process.env.AIMEAT_MATCH_MAX_SUGGESTIONS ?? '5', 10),
    matchMaxDistanceKm: parseInt(process.env.AIMEAT_MATCH_MAX_DISTANCE_KM ?? '100', 10),
    matchCooldownDays: parseInt(process.env.AIMEAT_MATCH_COOLDOWN_DAYS ?? '7', 10),
    marketplaceEnabled: process.env.AIMEAT_MARKETPLACE_ENABLED !== 'false',
    marketplaceListingFeeMorsels: parseInt(process.env.AIMEAT_MARKETPLACE_LISTING_FEE ?? '2', 10),
    marketplaceTransactionFeePercent: parseInt(process.env.AIMEAT_MARKETPLACE_TX_FEE_PERCENT ?? '5', 10),
    marketplaceEscrowEnabled: process.env.AIMEAT_MARKETPLACE_ESCROW !== 'false',
    marketplaceFeeMode: process.env.AIMEAT_MARKETPLACE_FEE_MODE === 'burn' ? 'burn' : 'operator',
    operatorFeeAccount: process.env.AIMEAT_OPERATOR_FEE_ACCOUNT || null,
    commerceFeePercent: process.env.AIMEAT_COMMERCE_FEE_PERCENT
        ? parseInt(process.env.AIMEAT_COMMERCE_FEE_PERCENT, 10) : null,
    commerceEnabled: process.env.AIMEAT_COMMERCE_ENABLED !== 'false',
    commerceSessionTtlMinutes: parseInt(process.env.AIMEAT_COMMERCE_SESSION_TTL_MINUTES ?? '60', 10),
    // MCP Server Card commerce_tools block: 'inline' embeds the priced app-tool catalog in
    // /.well-known/mcp.json (richest single-fetch discovery, the spec's lean); 'pointer' keeps
    // the card lean and points at /v1/commerce/tools instead (TARGET-034 phase D).
    mcpCardCommerceTools: process.env.AIMEAT_MCP_CARD_COMMERCE_TOOLS === 'pointer' ? 'pointer' as const : 'inline' as const,
    // x402 stablecoin settlement (TARGET-042): NON-CUSTODIAL USDC handler for money (USD) sessions.
    // USDC is a payment METHOD for a USD price (model 2), never a currency of its own. Network +
    // facilitator are parameters so Solana / another facilitator drops in without a core change. OFF
    // by default (registers only when enabled) so a node advertises the exact scheme only when it can
    // settle it. Base Sepolia + the public x402.org facilitator are the safe testnet defaults.
    x402Enabled: process.env.AIMEAT_X402_ENABLED === 'true',
    x402Network: process.env.AIMEAT_X402_NETWORK ?? 'base-sepolia',
    x402FacilitatorUrl: process.env.AIMEAT_X402_FACILITATOR_URL ?? 'https://x402.org/facilitator',
    // OPTIONAL read-only RPC used to check that a seller's payout address is an account and not a
    // contract. Unset = the check is skipped (a save never depends on a third party being up).
    x402RpcUrl: process.env.AIMEAT_X402_RPC_URL ?? '',
    x402TestFacilitator: process.env.AIMEAT_X402_TEST_FACILITATOR === 'true',
    // Web Bot Auth (RFC 9421): sign the node's outbound safeFetch traffic with the node Ed25519
    // key so peers/CDNs can verify AIMEAT's agent traffic against the key directory at
    // /.well-known/http-message-signatures-directory. OFF by default: it stamps identifying
    // Signature headers on EVERY outbound request (webhooks, federation, UCP profile fetches) —
    // linkability + a small risk of strict/legacy endpoints rejecting unknown headers. The key
    // DIRECTORY is always served; only outbound signing is gated.
    webBotAuthSign: process.env.AIMEAT_WEB_BOT_AUTH_SIGN === 'true',
    // Content Signals Policy directive served in robots.txt (contentsignals.org). Default matches
    // the per-bot stance already in the file (search bots allowed, GPTBot/ClaudeBot training
    // crawlers disallowed, user-initiated AI fetches allowed). 'off' removes the directive.
    contentSignal: (process.env.AIMEAT_CONTENT_SIGNAL ?? 'search=yes, ai-input=yes, ai-train=no').trim(),
    pushEnabled: process.env.AIMEAT_PUSH_ENABLED !== 'false',
    vapidPublicKey: process.env.AIMEAT_VAPID_PUBLIC_KEY ?? null,
    vapidPrivateKey: process.env.AIMEAT_VAPID_PRIVATE_KEY ?? null,
    vapidSubject: process.env.AIMEAT_VAPID_SUBJECT ?? 'mailto:admin@aimeat.example.com',
    pushNotifyTypes: (process.env.AIMEAT_PUSH_NOTIFY_TYPES ?? 'work_assignment,action_request').split(',').map(s => s.trim()),
    pushCooldownMin: parseInt(process.env.AIMEAT_PUSH_COOLDOWN_MIN ?? '5', 10),
    pushMaxSubscriptionsPerNode: parseInt(process.env.AIMEAT_PUSH_MAX_SUBSCRIPTIONS_PER_NODE ?? '5', 10),
    pushMaxFailures: parseInt(process.env.AIMEAT_PUSH_MAX_FAILURES ?? '3', 10),
    emailRateLimitMin: parseInt(process.env.AIMEAT_EMAIL_RATE_LIMIT_MIN ?? '30', 10),
    eudiwEnabled: process.env.AIMEAT_EUDIW_ENABLED === 'true',
    eudiwClientId: process.env.AIMEAT_EUDIW_CLIENT_ID ?? 'aimeat-verifier-001',
    eudiwRedirectUri: process.env.AIMEAT_EUDIW_REDIRECT_URI ?? '',
    ftnEnabled: process.env.AIMEAT_FTN_ENABLED === 'true',
    ftnProviderUrl: process.env.AIMEAT_FTN_PROVIDER_URL ?? 'https://tunnistautuminen.suomi.fi',
    ftnClientId: process.env.AIMEAT_FTN_CLIENT_ID ?? '',
    ftnClientSecret: process.env.AIMEAT_FTN_CLIENT_SECRET ?? '',
    vcIssuerDid: process.env.AIMEAT_VC_ISSUER_DID ?? '',
    nonceTtlSeconds: parseInt(process.env.AIMEAT_NONCE_TTL_SECONDS ?? '300', 10),
    nationalEidPidClaim: process.env.AIMEAT_NATIONAL_EID_PID_CLAIM ?? 'personal_identity_code',
    googleOAuthEnabled: process.env.AIMEAT_GOOGLE_OAUTH_ENABLED === 'true',
    googleOAuthClientId: process.env.AIMEAT_GOOGLE_OAUTH_CLIENT_ID ?? '',
    googleOAuthClientSecret: process.env.AIMEAT_GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    googleOAuthRedirectUri: process.env.AIMEAT_GOOGLE_OAUTH_REDIRECT_URI ?? '',
    casdoorOAuthEnabled: process.env.AIMEAT_CASDOOR_OAUTH_ENABLED === 'true',
    casdoorOAuthEndpoint: process.env.AIMEAT_CASDOOR_OAUTH_ENDPOINT ?? '',
    casdoorOAuthClientId: process.env.AIMEAT_CASDOOR_OAUTH_CLIENT_ID ?? '',
    casdoorOAuthClientSecret: process.env.AIMEAT_CASDOOR_OAUTH_CLIENT_SECRET ?? '',
    casdoorOAuthRedirectUri: process.env.AIMEAT_CASDOOR_OAUTH_REDIRECT_URI ?? '',
    entraOAuthEnabled: process.env.AIMEAT_ENTRA_OAUTH_ENABLED === 'true',
    entraOAuthTenant: process.env.AIMEAT_ENTRA_OAUTH_TENANT ?? 'common',
    entraOAuthClientId: process.env.AIMEAT_ENTRA_OAUTH_CLIENT_ID ?? '',
    entraOAuthClientSecret: process.env.AIMEAT_ENTRA_OAUTH_CLIENT_SECRET ?? '',
    entraOAuthRedirectUri: process.env.AIMEAT_ENTRA_OAUTH_REDIRECT_URI ?? '',
    // Outbound connections (TARGET-057). Opt-IN: `=== 'true'`, so a node that has never heard of
    // this feature does not start offering to hold people's accounts.
    connectionsEnabled: process.env.AIMEAT_CONNECTIONS_ENABLED === 'true',
    connectGoogleClientId: process.env.AIMEAT_CONNECT_GOOGLE_CLIENT_ID ?? '',
    connectGoogleClientSecret: process.env.AIMEAT_CONNECT_GOOGLE_CLIENT_SECRET ?? '',
    connectLinkedinClientId: process.env.AIMEAT_CONNECT_LINKEDIN_CLIENT_ID ?? '',
    connectLinkedinClientSecret: process.env.AIMEAT_CONNECT_LINKEDIN_CLIENT_SECRET ?? '',
    connectXClientId: process.env.AIMEAT_CONNECT_X_CLIENT_ID ?? '',
    connectXClientSecret: process.env.AIMEAT_CONNECT_X_CLIENT_SECRET ?? '',
    connectRedirectUri: process.env.AIMEAT_CONNECT_REDIRECT_URI ?? '',
    connectFakeBaseUrl: process.env.AIMEAT_CONNECT_FAKE_BASE_URL ?? '',
    crossFederationEnabled: process.env.AIMEAT_CROSS_FEDERATION_ENABLED !== 'false',
    maxGenesisPeers: parseInt(process.env.AIMEAT_MAX_GENESIS_PEERS ?? '10', 10),
    genesisSyncIntervalHours: parseInt(process.env.AIMEAT_GENESIS_SYNC_INTERVAL_HOURS ?? '6', 10),
    syncMode: (process.env.AIMEAT_SYNC_MODE ?? 'hybrid') as 'bulk' | 'instant' | 'hybrid',
    syncIntervalHours: parseInt(process.env.AIMEAT_SYNC_INTERVAL_HOURS ?? '6', 10),
    syncBatchDelayMs: parseInt(process.env.AIMEAT_SYNC_BATCH_DELAY_MS ?? '5000', 10),
    replicationQueueMax: parseInt(process.env.AIMEAT_REPLICATION_QUEUE_MAX ?? '10000', 10),
    replicationQueueTtlHours: parseInt(process.env.AIMEAT_REPLICATION_QUEUE_TTL_HOURS ?? '72', 10),
    maxConcurrentSyncs: parseInt(process.env.AIMEAT_MAX_CONCURRENT_SYNCS ?? '5', 10),
    federationTimeoutMs: parseInt(process.env.AIMEAT_FEDERATION_TIMEOUT_MS ?? '10000', 10),
    messageRetryIntervalMs: parseInt(process.env.AIMEAT_MESSAGE_RETRY_INTERVAL_MS ?? '60000', 10),
    messageRetryTtlHours: parseInt(process.env.AIMEAT_MESSAGE_RETRY_TTL_HOURS ?? '168', 10),
    genesisMemoryCache: process.env.AIMEAT_GENESIS_MEMORY_CACHE === 'true',
    genesisMemoryCacheTtlHours: parseInt(process.env.AIMEAT_GENESIS_MEMORY_CACHE_TTL_HOURS ?? '4', 10),
    cookieConsentEnabled: process.env.AIMEAT_COOKIE_CONSENT_ENABLED === 'true',
    cookieConsentCategories: (process.env.AIMEAT_COOKIE_CONSENT_CATEGORIES ?? 'necessary').split(',').map(s => s.trim()).filter(Boolean),
    cookieConsentPolicyUrl: process.env.AIMEAT_COOKIE_CONSENT_POLICY_URL ?? null,
    realtimeEnabled: process.env.AIMEAT_REALTIME_ENABLED !== 'false',
    realtimeMaxRooms: parseInt(process.env.AIMEAT_REALTIME_MAX_ROOMS ?? '100', 10),
    realtimeMaxPeersPerRoom: parseInt(process.env.AIMEAT_REALTIME_MAX_PEERS_PER_ROOM ?? '20', 10),
    realtimeRoomIdleTimeoutMs: parseInt(process.env.AIMEAT_REALTIME_ROOM_IDLE_TIMEOUT_MS ?? '3600000', 10),
    realtimeMaxMessageSizeBytes: parseInt(process.env.AIMEAT_REALTIME_MAX_MESSAGE_SIZE ?? '16384', 10),
    realtimeRateLimitPerSecond: parseInt(process.env.AIMEAT_REALTIME_RATE_LIMIT ?? '50', 10),
    stunServers: (process.env.AIMEAT_STUN_SERVERS ?? 'stun:stun.l.google.com:19302').split(',').map(s => s.trim()).filter(Boolean),
    turnServer: process.env.AIMEAT_TURN_SERVER ?? null,
    turnUsername: process.env.AIMEAT_TURN_USERNAME ?? null,
    turnCredential: process.env.AIMEAT_TURN_CREDENTIAL ?? null,
    echatAnonymous: process.env.AIMEAT_ECHAT_ANONYMOUS === 'true',
    siteEnabled: process.env.AIMEAT_SITE_ENABLED !== 'false',
    siteMaxTemplateSizeKb: parseInt(process.env.AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB ?? '512', 10),
    siteCacheTtlSeconds: parseInt(process.env.AIMEAT_SITE_CACHE_TTL_SECONDS ?? '60', 10),
    siteKv: Object.fromEntries(
      Object.entries(process.env)
        .filter(([k]) => k.startsWith('AIMEAT_SITE_KV_'))
        .map(([k, v]) => [k.replace('AIMEAT_SITE_KV_', '').toLowerCase(), v ?? ''])
    ),
    siteLbEnabled: process.env.AIMEAT_SITE_LB_ENABLED === 'true',
    siteLbOriginUrl: process.env.AIMEAT_SITE_LB_ORIGIN_URL ?? null,
    siteLbSyncIntervalMin: parseInt(process.env.AIMEAT_SITE_LB_SYNC_INTERVAL_MIN ?? '30', 10),
    siteLbSyncOnStartup: process.env.AIMEAT_SITE_LB_SYNC_ON_STARTUP !== 'false',
    setupAllowedIps: (process.env.AIMEAT_SETUP_ALLOWED_IPS ?? '')
      .split(',').map(s => s.trim()).filter(Boolean),
    autoHideThreshold: parseInt(process.env.AIMEAT_AUTO_HIDE_THRESHOLD ?? '5', 10),
    statsEnabled: process.env.AIMEAT_STATS_ENABLED !== 'false',
    statsAccess: (process.env.AIMEAT_STATS_ACCESS as 'public' | 'authenticated' | 'operator') ?? 'public',
    metricsEnabled: process.env.AIMEAT_METRICS_ENABLED === 'true',
    metricsAccess: (process.env.AIMEAT_METRICS_ACCESS as 'public' | 'authenticated' | 'operator') ?? 'operator',

    // Scoped Agent Capabilities (REQ-006)
    defaultAgentScopes: (process.env.AIMEAT_DEFAULT_AGENT_SCOPES ?? 'memory:read,memory:write,memory:delete,catalogue:read').split(',').map(s => s.trim()),
    maxAgentScopes: (process.env.AIMEAT_MAX_AGENT_SCOPES ?? '*').split(',').map(s => s.trim()),
    // Same-owner device-auth auto-approval (Agent-Bundled Apps): a device-authorize call
    // authenticated as the SAME owner it registers for (owner session, or one of that owner's
    // agents — e.g. crew-forge spawning a deployed sibling) is approved without the manual
    // consent step. Cannot cross owners; an agent approver cannot grant scopes beyond its own
    // (no escalation); approvedBy is recorded. Public-safe default ON — set false to force
    // every registration through the manual consent page.
    sameOwnerAutoApprove: process.env.AIMEAT_SAME_OWNER_AUTO_APPROVE !== 'false',
    // MCP audit Phase 3 (F1): enforce per-agent scopes on the public /v1/mcp tool surface
    // (mirrors the REST requireScope gates). Default true — closes the least-privilege hole.
    // Set false for a warn-only rollout: tools are still registered, but would-be-filtered
    // tools are logged so you can measure impact before enforcing.
    mcpEnforceScopes: process.env.AIMEAT_MCP_ENFORCE_SCOPES !== 'false',

    // Ecosystem application (GEAI) scope bounds. Defaults lean read + deposit (ecosystem apps mostly
    // deposit refined data into owner areas). Events/capability scopes are deferred to later chunks.
    defaultEcoScopes: (process.env.AIMEAT_DEFAULT_ECO_SCOPES ?? 'memory:read,memory:write,knowledge:contribute,organism:read').split(',').map(s => s.trim()),
    maxEcoScopes: (process.env.AIMEAT_MAX_ECO_SCOPES ?? '*').split(',').map(s => s.trim()),

    // Node Extensions (Sandboxed)
    extensionsEnabled: process.env.AIMEAT_EXTENSIONS_ENABLED !== 'false',
    extensionMaxMemoryMb: parseInt(process.env.AIMEAT_EXT_MAX_MEMORY_MB ?? '64', 10),
    extensionTimeoutMs: parseInt(process.env.AIMEAT_EXT_TIMEOUT_MS ?? '5000', 10),
    extensionMaxApiCalls: parseInt(process.env.AIMEAT_EXT_MAX_API_CALLS ?? '500', 10),
    extensionMaxDebitPerCall: parseInt(process.env.AIMEAT_EXT_MAX_DEBIT ?? '100', 10),
    // Morsels burned per metered call when the capability declares no toll of its own. Morsels
    // replenish daily with a hard ceiling, so a non-zero value puts an absolute rate floor under
    // every capability — including money-priced ones, whose only other brake is the buyer's budget.
    // 0 (the default) keeps existing billing unchanged; raising it is an operator decision.
    pacingTollDefault: parseInt(process.env.AIMEAT_PACING_TOLL_DEFAULT ?? '0', 10),
    extensionMaxCodeSizeKb: parseInt(process.env.AIMEAT_EXT_MAX_CODE_SIZE_KB ?? '256', 10),
    extensionMaxInstalled: parseInt(process.env.AIMEAT_EXT_MAX_INSTALLED ?? '20', 10),
    maxExtensionsPerOwner: parseInt(process.env.AIMEAT_MAX_EXTENSIONS_PER_OWNER || '10', 10),


    // Prompt Calibrator
    calibratorEnabled: process.env.AIMEAT_CALIBRATOR_ENABLED !== 'false',

    // Cortex Extensions (Manifest-based)
    cortexEnabled: process.env.AIMEAT_CORTEX_ENABLED !== 'false',
    cortexMaxInstalled: parseInt(process.env.AIMEAT_CORTEX_MAX_INSTALLED ?? '50', 10),
    cortexMaxLibSizeKb: parseInt(process.env.AIMEAT_CORTEX_MAX_LIB_SIZE_KB ?? '512', 10),

    // Packages & Templates
    packagesEnabled: process.env.AIMEAT_PACKAGES_ENABLED !== 'false',
    packageCreateRole: (process.env.AIMEAT_PACKAGE_CREATE_ROLE as 'operator' | 'owner') || 'operator',
    packageMaxSizeMb: parseInt(process.env.AIMEAT_PACKAGE_MAX_SIZE_MB ?? '50', 10),
    packageMaxComponents: parseInt(process.env.AIMEAT_PACKAGE_MAX_COMPONENTS ?? '20', 10),
    packageMaxPerAuthor: parseInt(process.env.AIMEAT_PACKAGE_MAX_PER_AUTHOR ?? '50', 10),
    templatesEnabled: process.env.AIMEAT_TEMPLATES_ENABLED !== 'false',
    templateReviewsEnabled: process.env.AIMEAT_TEMPLATE_REVIEWS_ENABLED !== 'false',
    templateDiscussionsEnabled: process.env.AIMEAT_TEMPLATE_DISCUSSIONS_ENABLED !== 'false',
    packageFederationEnabled: process.env.AIMEAT_PACKAGE_FEDERATION_ENABLED === 'true',
    packageFederationAutoAccept: process.env.AIMEAT_PACKAGE_FEDERATION_AUTO_ACCEPT === 'true',

    // Portfolio
    portfolioEnabled: process.env.AIMEAT_PORTFOLIO !== 'false',
    portfolioMaxSizeKb: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_SIZE_KB ?? '512', 10),
    portfolioMaxImages: parseInt(process.env.AIMEAT_PORTFOLIO_MAX_IMAGES ?? '20', 10),

    // CORS
    capabilityPublishing: (process.env.AIMEAT_CAPABILITY_PUBLISHING ?? 'disabled') as 'disabled' | 'self_only' | 'moderated' | 'open',
    capabilityPublishers: (process.env.AIMEAT_CAPABILITY_PUBLISHERS ?? 'all_users') as 'all_users' | 'trusted_only' | 'allowlist',
    capabilityMinPublisherTrust: parseInt(process.env.AIMEAT_CAPABILITY_MIN_PUBLISHER_TRUST ?? '50', 10),
    capabilityPublisherAllowlist: (process.env.AIMEAT_CAPABILITY_PUBLISHER_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean),
    capabilityWebhooks: (process.env.AIMEAT_CAPABILITY_WEBHOOKS ?? 'disabled') as 'disabled' | 'allowlist_only' | 'open',
    capabilityWebhookDomainAllowlist: (process.env.AIMEAT_CAPABILITY_WEBHOOK_DOMAIN_ALLOWLIST ?? '').split(',').map(s => s.trim()).filter(Boolean),
    capabilityLogRetentionDays: parseInt(process.env.AIMEAT_CAPABILITY_LOG_RETENTION_DAYS ?? '30', 10),

    // Agent Tasks (Phase 1)
    // Default 2h: orchestrated/multi-agent tasks (e.g. aimeat-app-conductor running
    // the full generator pipeline) can legitimately run quiet for long stretches; 30m
    // was too aggressive and falsely failed them. Override via env var if needed.
    taskStallThresholdMinutes: parseInt(process.env.AIMEAT_TASK_STALL_THRESHOLD_MINUTES ?? '120', 10),
    taskAutoArchive: process.env.AIMEAT_TASK_AUTO_ARCHIVE !== 'false',
    taskArchiveAfterHours: parseInt(process.env.AIMEAT_TASK_ARCHIVE_AFTER_HOURS ?? '24', 10),

    // Agent Directives (Phase 1)
    agentSystemPrinciples: JSON.parse(process.env.AIMEAT_AGENT_SYSTEM_PRINCIPLES || '["AIMEAT-first: prefer native systems", "Log all significant actions"]'),
    agentMaxTokensPerTask: parseInt(process.env.AIMEAT_AGENT_MAX_TOKENS_PER_TASK || '100000', 10),
    agentMandatoryLogging: process.env.AIMEAT_AGENT_MANDATORY_LOGGING !== 'false',
    agentAimeatFirstEnabled: process.env.AIMEAT_AGENT_AIMEAT_FIRST !== 'false',

    corsAllowedOrigins: (process.env.AIMEAT_CORS_ALLOWED_ORIGINS ?? '*').split(',').map(s => s.trim()).filter(Boolean),

    operator: {
      name: process.env.AIMEAT_OPERATOR_NAME ?? '',
      type: (process.env.AIMEAT_OPERATOR_TYPE as OperatorType) ?? 'natural_person',
      businessId: process.env.AIMEAT_OPERATOR_BUSINESS_ID ?? '',
      address: process.env.AIMEAT_OPERATOR_ADDRESS ?? '',
      country: process.env.AIMEAT_OPERATOR_COUNTRY ?? '',
      email: process.env.AIMEAT_OPERATOR_EMAIL ?? '',
      securityEmail: process.env.AIMEAT_OPERATOR_SECURITY_EMAIL ?? '',
      hostingName: process.env.AIMEAT_OPERATOR_HOSTING_NAME ?? '',
      hostingUrl: process.env.AIMEAT_OPERATOR_HOSTING_URL ?? '',
      hostingLocation: process.env.AIMEAT_OPERATOR_HOSTING_LOCATION ?? '',
      supervisoryName: process.env.AIMEAT_OPERATOR_SUPERVISORY_NAME ?? '',
      supervisoryUrl: process.env.AIMEAT_OPERATOR_SUPERVISORY_URL ?? '',
      effectiveDate: process.env.AIMEAT_OPERATOR_EFFECTIVE_DATE ?? '',
      policyVersion: process.env.AIMEAT_OPERATOR_POLICY_VERSION ?? '1.0',
    },

    // Public-page links. Empty by design: the marketing pages point at apps that belong to
    // whoever runs the node, and a fresh clone must not advertise aimeat.io's apps or Jouni's
    // phone number. Each empty value hides its link, nav item or section.
    siteLinks: {
      learn: process.env.AIMEAT_SITE_LEARN_URL ?? '',
      exchange: process.env.AIMEAT_SITE_EXCHANGE_URL ?? '',
      assessment: process.env.AIMEAT_SITE_ASSESSMENT_URL ?? '',
      roadmap: process.env.AIMEAT_SITE_ROADMAP_URL ?? '',
      paper: process.env.AIMEAT_SITE_PAPER_URL ?? '',
      crm: process.env.AIMEAT_SITE_CRM_URL ?? '',
      radar: process.env.AIMEAT_SITE_RADAR_URL ?? '',
      briefing: process.env.AIMEAT_SITE_BRIEFING_URL ?? '',
      apiAccelerator: process.env.AIMEAT_SITE_API_ACCELERATOR_URL ?? '',
      playbooks: process.env.AIMEAT_SITE_PLAYBOOKS_URL ?? '',
      showcase: process.env.AIMEAT_SITE_SHOWCASE_URL ?? '',
      contacts: parseSiteContacts(),
    },

    // Consul
    consulEnabled: process.env.AIMEAT_CONSUL_ENABLED === 'true',
    consulUrl: process.env.AIMEAT_CONSUL_URL ?? 'http://localhost:8500',
    consulPrefix: process.env.AIMEAT_CONSUL_PREFIX ?? 'aimeat/config',
    consulToken: process.env.AIMEAT_CONSUL_TOKEN ?? '',
    consulWatchIntervalSeconds: parseInt(process.env.AIMEAT_CONSUL_WATCH_INTERVAL ?? '30', 10),
    consulDatacenter: process.env.AIMEAT_CONSUL_DATACENTER ?? '',

    rlGlobal,
    rlAuth,
    rlWork,
    rlMemory,
    rlBoards,
    rlOwners,
    rlGhii,
    rlFlags,
    rlAppeals,
    rlAdminSetup,
    rlFederation,
    rlCatalogue,
    rlAuthChallenge,

    rateLimits: {
      global: { windowMs: 1_000, max: rlGlobal },
      auth: { windowMs: 1_000, max: rlAuth },
      work: { windowMs: 1_000, max: rlWork },
      memory: { windowMs: 1_000, max: rlMemory },
      boards: { windowMs: 1_000, max: rlBoards },
      owners: { windowMs: 1_000, max: rlOwners },
      ghii: { windowMs: 1_000, max: rlGhii },
      flags: { windowMs: 1_000, max: rlFlags },
      appeals: { windowMs: 1_000, max: rlAppeals },
      adminSetup: { windowMs: 1_000, max: rlAdminSetup },
      federation: { windowMs: 1_000, max: rlFederation },
      catalogue: { windowMs: 1_000, max: rlCatalogue },
      authChallenge: { windowMs: 1_000, max: rlAuthChallenge },
      openrouter: { windowMs: 60_000, max: parseInt(process.env.AIMEAT_RL_OPENROUTER ?? '30', 10) },
      roleMultipliers: { operator: 10, owner: 2, agent: 1, anonymous: 0.5 },
    },
  };

  return { config, envKeys, fileKeys, cliKeys, fileName: fileSource?.name ?? null };
}

// ── Database Config Overrides ──

import type { Storage } from './storage/interface.js';
import { logger } from './utils/logger.js';

/**
 * Apply config overrides from database (called after storage is initialized).
 * Only applies to mutable fields — immutable fields are ignored.
 * Updates provenance registry.
 */
export async function applyConfigOverrides(
  config: AimeatConfig,
  storage: Storage,
  provenance: ConfigProvenance,
): Promise<{ applied: string[]; skipped: string[] }> {
  if (!storage.supportsConfigPersistence()) {
    return { applied: [], skipped: [] };
  }

  const dbValues = await storage.getAllConfigValues();
  const applied: string[] = [];
  const skipped: string[] = [];

  for (const [dotPath, rawValue] of Object.entries(dbValues)) {
    if (isImmutable(dotPath)) {
      skipped.push(dotPath);
      continue;
    }
    const field = MUTABLE_CONFIG_MAP[dotPath];
    if (!field) { skipped.push(dotPath); continue; }

    try {
      const value = parseConfigValue(field, rawValue);
      if (!field.validate(value)) { skipped.push(dotPath); continue; }
      (config as unknown as Record<string, unknown>)[field.key] = value;
      applied.push(dotPath);
    } catch (err) {
      logger.warn('config: suppressed failure, continuing', { error: String(err) });
      skipped.push(dotPath);
    }
  }

  // Sync rl* individual keys back to rateLimits tiers
  const rlKeys: Array<{ key: keyof AimeatConfig; tier: keyof Omit<RateLimitsConfig, 'roleMultipliers'> }> = [
    { key: 'rlGlobal', tier: 'global' },
    { key: 'rlAuth', tier: 'auth' },
    { key: 'rlWork', tier: 'work' },
    { key: 'rlMemory', tier: 'memory' },
    { key: 'rlBoards', tier: 'boards' },
    { key: 'rlOwners', tier: 'owners' },
    { key: 'rlGhii', tier: 'ghii' },
    { key: 'rlFlags', tier: 'flags' },
    { key: 'rlAppeals', tier: 'appeals' },
    { key: 'rlAdminSetup', tier: 'adminSetup' },
    { key: 'rlFederation', tier: 'federation' },
    { key: 'rlCatalogue', tier: 'catalogue' },
    { key: 'rlAuthChallenge', tier: 'authChallenge' },
  ];
  for (const { key, tier } of rlKeys) {
    const val = config[key] as number;
    if (typeof val === 'number' && val >= 1) {
      (config.rateLimits[tier] as RateLimitTier).max = val;
    }
  }

  if (applied.length > 0) provenance.markDatabase(applied);
  return { applied, skipped };
}

// Pure extraction (2026-08-01, max-file-lines): the operator-identity helpers moved to
// config-operator.ts. Re-exported here so every existing `from './config.js'` importer is unaffected.
export { missingOperatorConfig, operatorTypeLabel } from './config-operator.js';
