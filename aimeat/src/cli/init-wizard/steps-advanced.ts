/**
 * @file src/cli/init-wizard/steps-advanced.ts
 * @description Economy + advanced-settings wizard steps (quotas, federation, consent, CORS, TOTP, matching, marketplace, realtime, extensions, app/portfolio origin) for `aimeat init`. Extracted from src/cli/init-wizard.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/cli/init-wizard.ts (max-file-lines)
 */

import * as p from '@clack/prompts';
import type { TFunction } from '../../i18n.js';
import type { AimeatConfig } from '../../config.js';
import type { UseCase } from './presets.js';
import { checkCancel, validateBurnRate, validatePositiveNum } from './helpers.js';

export async function askEconomySettings(
  t: TFunction,
  cfg: AimeatConfig,
): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};

  const bonus = checkCancel(
    await p.text({
      message: t('init.welcomeBonus'),
      defaultValue: String(cfg.welcomeBonus),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (bonus !== '100') settings.AIMEAT_WELCOME_BONUS = bonus;

  const daily = checkCancel(
    await p.text({
      message: t('init.dailyAllowance'),
      defaultValue: String(cfg.dailyAllowance),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (daily !== '50') settings.AIMEAT_DAILY_ALLOWANCE = daily;

  const cap = checkCancel(
    await p.text({
      message: t('init.dailyAllowanceCap'),
      defaultValue: String(cfg.dailyAllowanceCap),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (cap !== '500') settings.AIMEAT_DAILY_ALLOWANCE_CAP = cap;

  const burn = checkCancel(
    await p.text({
      message: t('init.burnRate'),
      defaultValue: String(cfg.burnRate),
      validate: val => validateBurnRate(val, t),
    }),
    t,
  );
  if (burn !== '0.10') settings.AIMEAT_BURN_RATE = burn;

  const mint = checkCancel(
    await p.text({
      message: t('init.maxMint'),
      defaultValue: String(cfg.maxOperatorMintPerDay),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mint !== '10000') settings.AIMEAT_MAX_OPERATOR_MINT_PER_DAY = mint;

  const postCost = checkCancel(
    await p.text({
      message: t('init.boardPostCost'),
      defaultValue: String(cfg.boardPostBaseCost),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (postCost !== '5') settings.AIMEAT_BOARD_POST_BASE_COST = postCost;

  const postCostKb = checkCancel(
    await p.text({
      message: t('init.boardPostCostKb'),
      defaultValue: String(cfg.boardPostCostPerKb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (postCostKb !== '2') settings.AIMEAT_BOARD_POST_COST_PER_KB = postCostKb;

  const feeMode = checkCancel(
    await p.select({
      message: t('init.marketplaceFeeMode'),
      options: [
        { value: 'operator', label: t('init.marketplaceFeeModeOperator'), hint: t('init.marketplaceFeeModeOperatorDesc') },
        { value: 'burn', label: t('init.marketplaceFeeModeBurn'), hint: t('init.marketplaceFeeModeBurnDesc') },
      ],
      initialValue: cfg.marketplaceFeeMode,
    }),
    t,
  ) as string;
  if (feeMode !== 'operator') settings.AIMEAT_MARKETPLACE_FEE_MODE = feeMode;

  const commerceFee = checkCancel(
    await p.text({
      message: t('init.commerceFeePercent'),
      defaultValue: cfg.commerceFeePercent != null ? String(cfg.commerceFeePercent) : '',
      validate: val => (val === '' ? undefined : validatePositiveNum(val, t)),
    }),
    t,
  );
  if (commerceFee !== '') settings.AIMEAT_COMMERCE_FEE_PERCENT = commerceFee;

  return settings;
}

export async function askAllAdvancedSettings(
  t: TFunction,
  cfg: AimeatConfig,
  useCase: UseCase,
  baseUrl: string,
): Promise<Record<string, string>> {
  const settings = await askEconomySettings(t, cfg);

  const jwt = checkCancel(
    await p.text({
      message: t('init.jwtTtl'),
      defaultValue: String(cfg.jwtTtlSeconds),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (jwt !== '3600') settings.AIMEAT_JWT_TTL = jwt;

  const memQuota = checkCancel(
    await p.text({
      message: t('init.memoryQuota'),
      defaultValue: String(cfg.memoryQuotaMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (memQuota !== '10') settings.AIMEAT_MEMORY_QUOTA_MB = memQuota;

  const memValueSize = checkCancel(
    await p.text({
      message: t('init.memoryMaxValueSizeKb'),
      defaultValue: String(cfg.memoryMaxValueSizeKb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (memValueSize !== '1024') settings.AIMEAT_MEMORY_MAX_VALUE_SIZE_KB = memValueSize;

  const memKeys = checkCancel(
    await p.text({
      message: t('init.memoryMaxKeys'),
      defaultValue: String(cfg.memoryMaxKeysPerAgent),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (memKeys !== '1000') settings.AIMEAT_MEMORY_MAX_KEYS = memKeys;

  const storQuota = checkCancel(
    await p.text({
      message: t('init.storageQuota'),
      defaultValue: String(cfg.storageQuotaMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (storQuota !== '100') settings.AIMEAT_STORAGE_QUOTA_MB = storQuota;

  const storFileSize = checkCancel(
    await p.text({
      message: t('init.storageMaxFileSize'),
      defaultValue: String(cfg.storageMaxFileSizeMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (storFileSize !== '10') settings.AIMEAT_STORAGE_MAX_FILE_SIZE_MB = storFileSize;

  const mmSets = checkCancel(
    await p.text({
      message: t('init.microMemoryMaxSets'),
      defaultValue: String(cfg.microMemoryMaxSetsPerAgent),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mmSets !== '50') settings.AIMEAT_MICRO_MEMORY_MAX_SETS = mmSets;

  const mmKeys = checkCancel(
    await p.text({
      message: t('init.microMemoryMaxKeysPerSet'),
      defaultValue: String(cfg.microMemoryMaxKeysPerSet),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mmKeys !== '100') settings.AIMEAT_MICRO_MEMORY_MAX_KEYS_PER_SET = mmKeys;

  const mmValueSize = checkCancel(
    await p.text({
      message: t('init.microMemoryMaxValueSize'),
      defaultValue: String(cfg.microMemoryMaxValueSizeBytes),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (mmValueSize !== '16384') settings.AIMEAT_MICRO_MEMORY_MAX_VALUE_SIZE = mmValueSize;

  const maxActions = checkCancel(
    await p.text({
      message: t('init.maxActionsPerAgent'),
      defaultValue: String(cfg.maxActionsPerAgent),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (maxActions !== '20') settings.AIMEAT_MAX_ACTIONS_PER_AGENT = maxActions;

  const appSize = checkCancel(
    await p.text({
      message: t('init.appMaxSize'),
      defaultValue: String(cfg.appMaxSizeMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (appSize !== '5') settings.AIMEAT_APP_MAX_SIZE_MB = appSize;

  const portingFee = checkCancel(
    await p.text({
      message: t('init.agentPortingFee'),
      defaultValue: String(cfg.agentPortingFeeMorsels),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (portingFee !== '50') settings.AIMEAT_AGENT_PORTING_FEE = portingFee;

  const relayHops = checkCancel(
    await p.text({
      message: t('init.maxRelayHops'),
      defaultValue: String(cfg.maxRelayHops),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (relayHops !== '3') settings.AIMEAT_MAX_RELAY_HOPS = relayHops;

  // ── Cross-Federation (Genesis Peering) ──
  p.note(t('init.crossFedNote'));

  const crossFedEnabled = checkCancel(
    await p.confirm({
      message: t('init.crossFedEnabled'),
      initialValue: cfg.crossFederationEnabled,
    }),
    t,
  );
  if (!crossFedEnabled) settings.AIMEAT_CROSS_FEDERATION_ENABLED = 'false';

  if (crossFedEnabled) {
    const maxPeers = checkCancel(
      await p.text({
        message: t('init.crossFedMaxPeers'),
        defaultValue: String(cfg.maxGenesisPeers),
        validate: (val: string | undefined) => {
          const n = parseInt(val ?? '', 10);
          if (isNaN(n) || n < 1 || n > 100) return t('init.crossFedMaxPeersInvalid');
        },
      }),
      t,
    );
    if (maxPeers !== '10') settings.AIMEAT_MAX_GENESIS_PEERS = maxPeers;

    const syncInterval = checkCancel(
      await p.text({
        message: t('init.crossFedSyncInterval'),
        defaultValue: String(cfg.genesisSyncIntervalHours),
        validate: (val: string | undefined) => {
          const n = parseInt(val ?? '', 10);
          if (isNaN(n) || n < 1 || n > 168) return t('init.crossFedSyncIntervalInvalid');
        },
      }),
      t,
    );
    if (syncInterval !== '6') settings.AIMEAT_GENESIS_SYNC_INTERVAL_HOURS = syncInterval;
  }

  const rateLimitGlobal = checkCancel(
    await p.text({
      message: t('init.rateLimitGlobal'),
      defaultValue: String(cfg.rlGlobal),
      validate: (val: string | undefined) => {
        const n = parseInt(val ?? '', 10);
        if (isNaN(n) || n < 1) return t('init.numInvalid');
      },
    }),
    t,
  );
  if (rateLimitGlobal !== '300') settings.AIMEAT_RL_GLOBAL = rateLimitGlobal;

  // ── Consent Layer ──
  const consentEnabled = checkCancel(
    await p.confirm({
      message: t('init.consentEnabled'),
      initialValue: cfg.consentEnabled,
    }),
    t,
  );
  if (!consentEnabled) settings.AIMEAT_CONSENT_ENABLED = 'false';

  if (consentEnabled) {
    const consentMaxPerUser = checkCancel(
      await p.text({
        message: t('init.consentMaxPerUser'),
        defaultValue: String(cfg.consentMaxPerUser),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (consentMaxPerUser !== '100') settings.AIMEAT_CONSENT_MAX_PER_USER = consentMaxPerUser;

    const consentAuditDays = checkCancel(
      await p.text({
        message: t('init.consentAuditDays'),
        defaultValue: String(cfg.consentAuditRetentionDays),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (consentAuditDays !== '365') settings.AIMEAT_CONSENT_AUDIT_RETENTION_DAYS = consentAuditDays;
  }

  // ── CORS ──
  const corsOrigins = checkCancel(
    await p.text({
      message: t('init.corsOrigins'),
      defaultValue: cfg.corsAllowedOrigins.join(', '),
      placeholder: '* or https://example.com, https://app.example.com',
    }),
    t,
  );
  if (corsOrigins !== '*') settings.AIMEAT_CORS_ALLOWED_ORIGINS = corsOrigins;

  // ── TOTP / 2FA ──
  const totpEnabled = checkCancel(
    await p.confirm({
      message: t('init.totpEnabled'),
      initialValue: cfg.totpEnabled,
    }),
    t,
  );
  if (!totpEnabled) settings.AIMEAT_TOTP_ENABLED = 'false';

  if (totpEnabled) {
    const totpIssuer = checkCancel(
      await p.text({
        message: t('init.totpIssuer'),
        defaultValue: cfg.totpIssuer,
      }),
      t,
    );
    if (totpIssuer !== 'AIMEAT') settings.AIMEAT_TOTP_ISSUER = totpIssuer;

    const totpMaxFailed = checkCancel(
      await p.text({
        message: t('init.totpMaxFailed'),
        defaultValue: String(cfg.totpMaxFailedAttempts),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (totpMaxFailed !== '5') settings.AIMEAT_TOTP_MAX_FAILED = totpMaxFailed;

    const totpLockout = checkCancel(
      await p.text({
        message: t('init.totpLockoutSeconds'),
        defaultValue: String(cfg.totpLockoutSeconds),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (totpLockout !== '300') settings.AIMEAT_TOTP_LOCKOUT_SECONDS = totpLockout;
  }

  // ── AI Matching ──
  const matchingEnabled = checkCancel(
    await p.confirm({
      message: t('init.matchingEnabled'),
      initialValue: cfg.matchingEnabled,
    }),
    t,
  );
  if (!matchingEnabled) settings.AIMEAT_MATCHING_ENABLED = 'false';

  if (matchingEnabled) {
    const matchInterval = checkCancel(
      await p.text({
        message: t('init.matchIntervalHours'),
        defaultValue: String(cfg.matchIntervalHours),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (matchInterval !== '24') settings.AIMEAT_MATCH_INTERVAL_HOURS = matchInterval;

    const matchThreshold = checkCancel(
      await p.text({
        message: t('init.matchThreshold'),
        defaultValue: String(cfg.matchThreshold),
        validate: val => validateBurnRate(val, t),
      }),
      t,
    );
    if (matchThreshold !== '0.5') settings.AIMEAT_MATCH_THRESHOLD = matchThreshold;

    const matchMaxSuggestions = checkCancel(
      await p.text({
        message: t('init.matchMaxSuggestions'),
        defaultValue: String(cfg.matchMaxSuggestions),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (matchMaxSuggestions !== '5') settings.AIMEAT_MATCH_MAX_SUGGESTIONS = matchMaxSuggestions;

    const matchMaxDistance = checkCancel(
      await p.text({
        message: t('init.matchMaxDistanceKm'),
        defaultValue: String(cfg.matchMaxDistanceKm),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (matchMaxDistance !== '100') settings.AIMEAT_MATCH_MAX_DISTANCE_KM = matchMaxDistance;
  }

  // ── Marketplace ──
  const marketplaceEnabled = checkCancel(
    await p.confirm({
      message: t('init.marketplaceEnabled'),
      initialValue: cfg.marketplaceEnabled,
    }),
    t,
  );
  if (!marketplaceEnabled) settings.AIMEAT_MARKETPLACE_ENABLED = 'false';

  if (marketplaceEnabled) {
    const listingFee = checkCancel(
      await p.text({
        message: t('init.marketplaceListingFee'),
        defaultValue: String(cfg.marketplaceListingFeeMorsels),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (listingFee !== '2') settings.AIMEAT_MARKETPLACE_LISTING_FEE = listingFee;

    const txFee = checkCancel(
      await p.text({
        message: t('init.marketplaceTxFeePercent'),
        defaultValue: String(cfg.marketplaceTransactionFeePercent),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (txFee !== '5') settings.AIMEAT_MARKETPLACE_TX_FEE_PERCENT = txFee;

    const escrow = checkCancel(
      await p.confirm({
        message: t('init.marketplaceEscrow'),
        initialValue: cfg.marketplaceEscrowEnabled,
      }),
      t,
    );
    if (!escrow) settings.AIMEAT_MARKETPLACE_ESCROW = 'false';
  }

  // ── Realtime P2P ──
  const realtimeEnabled = checkCancel(
    await p.confirm({
      message: t('init.realtimeEnabled'),
      initialValue: cfg.realtimeEnabled,
    }),
    t,
  );
  if (!realtimeEnabled) settings.AIMEAT_REALTIME_ENABLED = 'false';

  if (realtimeEnabled) {
    const maxRooms = checkCancel(
      await p.text({
        message: t('init.realtimeMaxRooms'),
        defaultValue: String(cfg.realtimeMaxRooms),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (maxRooms !== '100') settings.AIMEAT_REALTIME_MAX_ROOMS = maxRooms;

    const maxPeersRoom = checkCancel(
      await p.text({
        message: t('init.realtimeMaxPeersPerRoom'),
        defaultValue: String(cfg.realtimeMaxPeersPerRoom),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (maxPeersRoom !== '20') settings.AIMEAT_REALTIME_MAX_PEERS_PER_ROOM = maxPeersRoom;
  }

  // ── Extensions ──
  const extensionsEnabled = checkCancel(
    await p.confirm({
      message: t('init.extensionsEnabled'),
      initialValue: cfg.extensionsEnabled,
    }),
    t,
  );
  if (extensionsEnabled) {
    settings.AIMEAT_EXTENSIONS_ENABLED = 'true';

    const extMemory = checkCancel(
      await p.text({
        message: t('init.extensionMaxMemoryMb'),
        defaultValue: String(cfg.extensionMaxMemoryMb),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (extMemory !== '64') settings.AIMEAT_EXT_MAX_MEMORY_MB = extMemory;

    const extTimeout = checkCancel(
      await p.text({
        message: t('init.extensionTimeoutMs'),
        defaultValue: String(cfg.extensionTimeoutMs),
        validate: val => validatePositiveNum(val, t),
      }),
      t,
    );
    if (extTimeout !== '5000') settings.AIMEAT_EXT_TIMEOUT_MS = extTimeout;
  }

  // ── App Origin Isolation (H-2) ──
  // Only relevant for public/custom nodes that serve user-published apps from a
  // real domain. Serving apps from *.apps.<domain> isolates them from the
  // operator's session (they can't steal cookies). Requires DNS + wildcard TLS.
  if ((useCase === 'public' || useCase === 'custom') && /^https?:\/\//.test(baseUrl)) {
    const appOriginEnabled = checkCancel(
      await p.confirm({
        message: t('init.appOrigin'),
        initialValue: false,
      }),
      t,
    );
    if (appOriginEnabled) {
      // Derive apps.<host-of-baseUrl> as the default app host.
      let appHostDefault = '';
      try {
        appHostDefault = `apps.${new URL(baseUrl).hostname}`;
      } catch {
        appHostDefault = '';
      }
      const appHost = checkCancel(
        await p.text({
          message: t('init.appHost'),
          placeholder: appHostDefault || 'apps.example.com',
          ...(appHostDefault ? { defaultValue: appHostDefault } : {}),
          validate: val => {
            const v = val ?? appHostDefault;
            if (!v?.trim()) return t('init.appHostRequired');
          },
        }),
        t,
      );
      settings.AIMEAT_APP_HOST = appHost.trim();
      settings.AIMEAT_APP_ORIGIN_ENABLED = 'true';
    }

    // ── Portfolio Origin ──
    // Same isolation model for standalone published portfolios:
    // <username>.portfolio.<domain>. Requires DNS + wildcard TLS.
    const portfolioOriginEnabled = checkCancel(
      await p.confirm({
        message: t('init.portfolioOrigin'),
        initialValue: false,
      }),
      t,
    );
    if (portfolioOriginEnabled) {
      let portfolioHostDefault = '';
      try {
        portfolioHostDefault = `portfolio.${new URL(baseUrl).hostname}`;
      } catch {
        portfolioHostDefault = '';
      }
      const portfolioHost = checkCancel(
        await p.text({
          message: t('init.portfolioHost'),
          placeholder: portfolioHostDefault || 'portfolio.example.com',
          ...(portfolioHostDefault ? { defaultValue: portfolioHostDefault } : {}),
          validate: val => {
            const v = val ?? portfolioHostDefault;
            if (!v?.trim()) return t('init.portfolioHostRequired');
          },
        }),
        t,
      );
      settings.AIMEAT_PORTFOLIO_HOST = portfolioHost.trim();
      settings.AIMEAT_PORTFOLIO_ORIGIN_ENABLED = 'true';
    }
  }

  return settings;
}
