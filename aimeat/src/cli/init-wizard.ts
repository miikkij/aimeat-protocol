/**
 * Interactive `aimeat init` wizard using @clack/prompts.
 * Guides users through node configuration with use-case-based defaults.
 * Reads existing .env / config values so users see their current settings.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { createT, type Locale, type TFunction } from '../i18n.js';
import type { AimeatConfig } from '../config.js';

// Package root: from dist/src/cli/init-wizard.js -> go up 3 levels to aimeat/
const __pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ── Use-case preset defaults ────────────────────────────────────────

type UseCase = 'public' | 'personal' | 'dev' | 'custom';

interface Preset {
  nodeId: string;
  port: number;
  baseUrl: string;
  dbUrl: string;
  adminPassword: string;
  anonymousMode: boolean;
  devMode: boolean;
  extendedFeatures: boolean;
}

function buildPresets(cfg: AimeatConfig): Record<Exclude<UseCase, 'custom'>, Preset> {
  return {
    public: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'my-node-001',
      port: cfg.port,
      baseUrl: cfg.baseUrl.startsWith('http://localhost') ? '' : cfg.baseUrl,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: cfg.anonymousMode,
      devMode: false,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
    personal: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'personal-home',
      port: cfg.port,
      baseUrl: `http://localhost:${cfg.port}`,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: true,
      devMode: false,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
    dev: {
      nodeId: cfg.nodeId !== 'aimeat-local-001-dev' ? cfg.nodeId : 'dev-local',
      port: cfg.port,
      baseUrl: `http://localhost:${cfg.port}`,
      dbUrl: cfg.dbUrl ?? '',
      adminPassword: '',
      anonymousMode: true,
      devMode: true,
      extendedFeatures: cfg.extendedFeaturesEnabled,
    },
  };
}

// Defaults from config.ts for summary comparison
const CONFIG_DEFAULTS: Record<string, string> = {
  AIMEAT_NODE_ID: 'aimeat-local-001-dev',
  AIMEAT_PORT: '40050',
  AIMEAT_NODE_TYPE: 'full',
  AIMEAT_BASE_URL: '',
  DATABASE_URL: '',
  AIMEAT_ADMIN_PASSWORD: '',
  AIMEAT_DEV_MODE: 'false',
  AIMEAT_ANONYMOUS: 'false',
  AIMEAT_EXTENDED_FEATURES: 'true',
  AIMEAT_KEYED_BROWSE: 'true',
  AIMEAT_JWT_TTL: '3600',
  AIMEAT_WELCOME_BONUS: '100',
  AIMEAT_DAILY_ALLOWANCE: '50',
  AIMEAT_DAILY_ALLOWANCE_CAP: '500',
  AIMEAT_BURN_RATE: '0.10',
  AIMEAT_MAX_OPERATOR_MINT_PER_DAY: '10000',
  AIMEAT_BOARD_POST_BASE_COST: '5',
  AIMEAT_BOARD_POST_COST_PER_KB: '2',
  AIMEAT_MEMORY_QUOTA_MB: '10',
  AIMEAT_STORAGE_QUOTA_MB: '100',
  AIMEAT_MAX_RELAY_HOPS: '3',
  AIMEAT_FEDERATION_ROLE: 'standalone',
  AIMEAT_GENESIS_URL: '',
  AIMEAT_INDEXNOW_KEY: '',
  AIMEAT_COOKIE_CONSENT_ENABLED: 'false',
  AIMEAT_COOKIE_CONSENT_CATEGORIES: 'necessary',
  AIMEAT_COOKIE_CONSENT_POLICY_URL: '',
};

// ── Helpers ─────────────────────────────────────────────────────────

/** Parse a .env file into key-value pairs (ignores comments, handles quotes). */
function parseEnvFile(path: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(path)) return result;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Handle quoted values: extract content between first pair of quotes
    if (val.startsWith('"')) {
      const closeIdx = val.indexOf('"', 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else if (val.startsWith("'")) {
      const closeIdx = val.indexOf("'", 1);
      val = closeIdx > 0 ? val.slice(1, closeIdx) : val.slice(1);
    } else {
      // Unquoted: strip inline comments
      const hashIdx = val.indexOf('#');
      if (hashIdx >= 0) val = val.slice(0, hashIdx).trim();
    }
    result[key] = val;
  }
  return result;
}

function bail(t: TFunction): never {
  p.cancel(t('init.cancelled'));
  process.exit(0);
}

function checkCancel<T>(value: T | symbol, t: TFunction): T {
  if (p.isCancel(value)) bail(t);
  return value as T;
}

// Note: @clack/prompts calls validate() with undefined when input is empty,
// BEFORE applying defaultValue. So all validators must allow empty/undefined
// when a defaultValue is set (the prompt handles it).

function validatePort(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;  // empty = will use defaultValue
  const n = parseInt(val, 10);
  if (isNaN(n) || n < 1 || n > 65535) return t('init.portInvalid');
}

function validateUrl(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  if (!val.startsWith('http://') && !val.startsWith('https://')) {
    return t('init.baseUrlInvalid');
  }
}

function validateDbUrl(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  if (!val.startsWith('mongodb://') && !val.startsWith('mongodb+srv://')) {
    return t('init.dbUrlInvalid');
  }
}

function validatePositiveNum(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  const n = Number(val);
  if (isNaN(n) || n < 0) return t('init.numInvalid');
}

function validateBurnRate(val: string | undefined, t: TFunction): string | undefined {
  if (!val) return;
  const n = parseFloat(val);
  if (isNaN(n) || n < 0 || n > 1) return t('init.burnRateInvalid');
}

// ── .env generation ─────────────────────────────────────────────────

function generateEnvContent(settings: Record<string, string>): string {
  const lines: string[] = [
    '# AIMEAT Node Configuration',
    '# Generated by: aimeat init',
    '',
  ];

  const sections: Array<{ title: string; vars: Array<{ key: string; comment?: string }> }> = [
    {
      title: 'Node Identity',
      vars: [
        { key: 'AIMEAT_NODE_ID' },
        { key: 'AIMEAT_PORT' },
        { key: 'AIMEAT_NODE_TYPE' },
        { key: 'AIMEAT_BASE_URL', comment: 'Public URL (default: http://localhost:$PORT)' },
      ],
    },
    {
      title: 'Database',
      vars: [
        { key: 'DATABASE_URL', comment: 'Leave empty for in-memory storage (data lost on restart)' },
      ],
    },
    {
      title: 'Operator / Admin',
      vars: [
        { key: 'AIMEAT_ADMIN_PASSWORD', comment: 'Auto-generated on startup if not set' },
      ],
    },
    {
      title: 'Modes',
      vars: [
        { key: 'AIMEAT_DEV_MODE' },
        { key: 'AIMEAT_ANONYMOUS' },
      ],
    },
    {
      title: 'Auth & Tokens',
      vars: [
        { key: 'AIMEAT_JWT_TTL', comment: 'JWT lifetime in seconds (default: 1h)' },
      ],
    },
    {
      title: 'Morsel Economy',
      vars: [
        { key: 'AIMEAT_WELCOME_BONUS' },
        { key: 'AIMEAT_DAILY_ALLOWANCE' },
        { key: 'AIMEAT_DAILY_ALLOWANCE_CAP' },
        { key: 'AIMEAT_BURN_RATE' },
        { key: 'AIMEAT_MAX_OPERATOR_MINT_PER_DAY' },
        { key: 'AIMEAT_BOARD_POST_BASE_COST' },
        { key: 'AIMEAT_BOARD_POST_COST_PER_KB' },
      ],
    },
    {
      title: 'Features',
      vars: [
        { key: 'AIMEAT_KEYED_BROWSE' },
        { key: 'AIMEAT_EXTENDED_FEATURES' },
      ],
    },
    {
      title: 'Quotas',
      vars: [
        { key: 'AIMEAT_MEMORY_QUOTA_MB' },
        { key: 'AIMEAT_STORAGE_QUOTA_MB' },
      ],
    },
    {
      title: 'Federation',
      vars: [
        { key: 'AIMEAT_FEDERATION_ROLE', comment: 'operator = genesis directory | contributor = join genesis | standalone = independent' },
        { key: 'AIMEAT_GENESIS_URL', comment: 'Genesis node URL (for contributor role)' },
        { key: 'AIMEAT_MAX_RELAY_HOPS' },
      ],
    },
    {
      title: 'IndexNow (Bing/Yandex search indexing)',
      vars: [
        { key: 'AIMEAT_INDEXNOW_KEY', comment: 'Hex key for IndexNow. Generate: openssl rand -hex 16. After setting, run: pnpm indexnow' },
      ],
    },
  ];

  for (const section of sections) {
    const hasValues = section.vars.some(v => v.key in settings);
    if (!hasValues) continue;

    lines.push(`# ${'─'.repeat(2)} ${section.title} ${'─'.repeat(Math.max(0, 55 - section.title.length))}`);

    for (const v of section.vars) {
      if (v.comment) lines.push(`# ${v.comment}`);
      if (v.key in settings) {
        const val = settings[v.key];
        const isNumOrBool = /^(\d+(\.\d+)?|true|false)$/.test(val);
        lines.push(`${v.key}=${isNumOrBool ? val : `"${val}"`}`);
      } else {
        lines.push(`# ${v.key}=`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

function generateJsonContent(settings: Record<string, string>): string {
  const keyMap: Record<string, string> = {
    AIMEAT_NODE_ID: 'nodeId',
    AIMEAT_PORT: 'port',
    AIMEAT_NODE_TYPE: 'nodeType',
    AIMEAT_BASE_URL: 'baseUrl',
    DATABASE_URL: 'db',
    AIMEAT_ADMIN_PASSWORD: 'adminPassword',
    AIMEAT_DEV_MODE: 'devMode',
    AIMEAT_ANONYMOUS: 'anonymousMode',
    AIMEAT_JWT_TTL: 'jwtTtlSeconds',
    AIMEAT_WELCOME_BONUS: 'welcomeBonus',
    AIMEAT_DAILY_ALLOWANCE: 'dailyAllowance',
    AIMEAT_DAILY_ALLOWANCE_CAP: 'dailyAllowanceCap',
    AIMEAT_BURN_RATE: 'burnRate',
    AIMEAT_MAX_OPERATOR_MINT_PER_DAY: 'maxOperatorMintPerDay',
    AIMEAT_BOARD_POST_BASE_COST: 'boardPostBaseCost',
    AIMEAT_BOARD_POST_COST_PER_KB: 'boardPostCostPerKb',
    AIMEAT_EXTENDED_FEATURES: 'extendedFeaturesEnabled',
    AIMEAT_KEYED_BROWSE: 'keyedBrowseEnabled',
    AIMEAT_MEMORY_QUOTA_MB: 'memoryQuotaMb',
    AIMEAT_STORAGE_QUOTA_MB: 'storageQuotaMb',
    AIMEAT_MAX_RELAY_HOPS: 'maxRelayHops',
    AIMEAT_FEDERATION_ROLE: 'federationRole',
    AIMEAT_GENESIS_URL: 'genesisUrl',
    AIMEAT_INDEXNOW_KEY: 'indexNowKey',
  };

  const cfg: Record<string, unknown> = {};
  for (const [envKey, val] of Object.entries(settings)) {
    const jsonKey = keyMap[envKey] ?? envKey;
    if (/^\d+$/.test(val)) cfg[jsonKey] = parseInt(val, 10);
    else if (/^\d+\.\d+$/.test(val)) cfg[jsonKey] = parseFloat(val);
    else if (val === 'true') cfg[jsonKey] = true;
    else if (val === 'false') cfg[jsonKey] = false;
    else cfg[jsonKey] = val;
  }

  return JSON.stringify(cfg, null, 2) + '\n';
}

// ── Wizard steps ────────────────────────────────────────────────────

async function askCoreSettings(
  t: TFunction,
  preset: Preset,
  useCase: UseCase,
  env: Record<string, string>,
): Promise<Record<string, string>> {
  const settings: Record<string, string> = {};

  // Node ID — prefer existing env value, then preset
  const nodeIdDefault = env.AIMEAT_NODE_ID || preset.nodeId;
  const nodeId = checkCancel(
    await p.text({
      message: t('init.nodeId'),
      placeholder: nodeIdDefault,
      defaultValue: nodeIdDefault,
    }),
    t,
  );
  settings.AIMEAT_NODE_ID = nodeId;

  // Port — prefer existing env value
  const portDefault = env.AIMEAT_PORT || String(preset.port);
  const port = checkCancel(
    await p.text({
      message: t('init.port'),
      placeholder: portDefault,
      defaultValue: portDefault,
      validate: val => validatePort(val, t),
    }),
    t,
  );
  settings.AIMEAT_PORT = port;

  // Public URL — required for public nodes
  if (useCase === 'public') {
    const urlDefault = env.AIMEAT_BASE_URL || preset.baseUrl || '';
    const baseUrl = checkCancel(
      await p.text({
        message: t('init.baseUrl'),
        placeholder: urlDefault || 'https://mynode.example.com',
        ...(urlDefault ? { defaultValue: urlDefault } : {}),
        validate: val => {
          if (!val) return urlDefault ? undefined : t('init.baseUrlInvalid');
          return validateUrl(val, t);
        },
      }),
      t,
    );
    settings.AIMEAT_BASE_URL = baseUrl;
  } else if (useCase === 'custom') {
    const urlDefault = env.AIMEAT_BASE_URL || `http://localhost:${port}`;
    const baseUrl = checkCancel(
      await p.text({
        message: t('init.baseUrl'),
        placeholder: urlDefault,
        defaultValue: urlDefault,
        validate: val => validateUrl(val, t),
      }),
      t,
    );
    if (baseUrl && baseUrl !== `http://localhost:${port}`) {
      settings.AIMEAT_BASE_URL = baseUrl;
    }
  }

  // MongoDB URL — prefer existing env value
  if (useCase === 'public') {
    const dbDefault = env.DATABASE_URL || preset.dbUrl || '';
    const dbUrl = checkCancel(
      await p.text({
        message: t('init.dbUrl'),
        placeholder: dbDefault || 'mongodb://user:pass@localhost:27017/aimeat',
        ...(dbDefault ? { defaultValue: dbDefault } : {}),
        validate: val => {
          if (!val) return undefined;
          return validateDbUrl(val, t);
        },
      }),
      t,
    );
    if (dbUrl) settings.DATABASE_URL = dbUrl;
  } else if (useCase === 'personal' || useCase === 'custom') {
    const dbDefault = env.DATABASE_URL || preset.dbUrl || '';
    const dbUrl = checkCancel(
      await p.text({
        message: t('init.dbUrl'),
        placeholder: dbDefault || t('init.dbUrlHint'),
        defaultValue: dbDefault,
        validate: val => validateDbUrl(val, t),
      }),
      t,
    );
    if (dbUrl) settings.DATABASE_URL = dbUrl;
  }

  // Admin password — required for public, optional for others
  if (useCase === 'public') {
    const pw = checkCancel(
      await p.password({
        message: t('init.adminPassword'),
        validate: val => {
          if (!val || val.length < 8) return t('init.adminPasswordWeak');
        },
      }),
      t,
    );
    settings.AIMEAT_ADMIN_PASSWORD = pw;
  } else if (useCase === 'personal' || useCase === 'custom') {
    const pw = checkCancel(
      await p.password({
        message: `${t('init.adminPassword')} (${t('init.adminPasswordSkip')})`,
        validate: val => {
          if (val && val.length < 8) return t('init.adminPasswordWeak');
        },
      }),
      t,
    );
    if (pw) settings.AIMEAT_ADMIN_PASSWORD = pw;
  }

  // Anonymous mode
  if (useCase === 'public') {
    const anonDefault = env.AIMEAT_ANONYMOUS === 'true' || preset.anonymousMode;
    const anon = checkCancel(
      await p.confirm({
        message: t('init.anonymous'),
        initialValue: anonDefault,
      }),
      t,
    );
    if (anon) settings.AIMEAT_ANONYMOUS = 'true';
  } else if (preset.anonymousMode) {
    settings.AIMEAT_ANONYMOUS = 'true';
  }

  // Dev mode
  if (preset.devMode) {
    settings.AIMEAT_DEV_MODE = 'true';
  }

  // Extended features — ask for public
  if (useCase === 'public') {
    const extDefault = env.AIMEAT_EXTENDED_FEATURES !== 'false';
    const ext = checkCancel(
      await p.confirm({
        message: t('init.extended'),
        initialValue: extDefault,
      }),
      t,
    );
    if (!ext) settings.AIMEAT_EXTENDED_FEATURES = 'false';
  }

  // Network role — ask for public and custom
  if (useCase === 'public' || useCase === 'custom') {
    const currentRole = env.AIMEAT_FEDERATION_ROLE || 'standalone';
    const role = checkCancel(
      await p.select({
        message: t('init.networkRole'),
        initialValue: currentRole,
        options: [
          { value: 'operator', label: t('init.networkRoleOperator'), hint: t('init.networkRoleOperatorDesc') },
          { value: 'contributor', label: t('init.networkRoleContributor'), hint: t('init.networkRoleContributorDesc') },
          { value: 'standalone', label: t('init.networkRoleStandalone'), hint: t('init.networkRoleStandaloneDesc') },
        ],
      }),
      t,
    );
    settings.AIMEAT_FEDERATION_ROLE = role as string;

    // Contributor needs genesis URL
    if (role === 'contributor') {
      const genesisDefault = env.AIMEAT_GENESIS_URL || '';
      const genesisUrl = checkCancel(
        await p.text({
          message: t('init.genesisUrl'),
          placeholder: genesisDefault || 'https://aimeat.io',
          ...(genesisDefault ? { defaultValue: genesisDefault } : {}),
          validate: val => {
            if (!val) return genesisDefault ? undefined : t('init.genesisUrlInvalid');
            return validateUrl(val, t);
          },
        }),
        t,
      );
      settings.AIMEAT_GENESIS_URL = genesisUrl;
    }
  }

  // IndexNow key — ask for public nodes (enables Bing/Yandex search indexing)
  if (useCase === 'public') {
    const indexNowDefault = env.AIMEAT_INDEXNOW_KEY || '';
    const indexNow = checkCancel(
      await p.text({
        message: t('init.indexNowKey'),
        placeholder: indexNowDefault || t('init.indexNowKeyHint'),
        defaultValue: indexNowDefault,
      }),
      t,
    );
    if (indexNow) settings.AIMEAT_INDEXNOW_KEY = indexNow;
  }

  // Cookie consent banner — ask for public and custom (service builders)
  if (useCase === 'public' || useCase === 'custom') {
    const ccDefault = env.AIMEAT_COOKIE_CONSENT_ENABLED === 'true';
    const ccEnabled = checkCancel(
      await p.confirm({
        message: t('init.cookieConsent'),
        initialValue: ccDefault,
      }),
      t,
    );
    if (ccEnabled) {
      settings.AIMEAT_COOKIE_CONSENT_ENABLED = 'true';

      // Categories
      const catDefault = env.AIMEAT_COOKIE_CONSENT_CATEGORIES || 'necessary,analytics,marketing';
      const categories = checkCancel(
        await p.text({
          message: t('init.cookieConsentCategories'),
          placeholder: catDefault,
          defaultValue: catDefault,
        }),
        t,
      );
      if (categories && categories !== 'necessary') {
        settings.AIMEAT_COOKIE_CONSENT_CATEGORIES = categories;
      }

      // Privacy policy URL
      const policyDefault = env.AIMEAT_COOKIE_CONSENT_POLICY_URL || '';
      const policyUrl = checkCancel(
        await p.text({
          message: t('init.cookieConsentPolicyUrl'),
          placeholder: policyDefault || 'https://example.com/privacy',
          ...(policyDefault ? { defaultValue: policyDefault } : {}),
          validate: val => {
            if (!val) return undefined; // optional
            return validateUrl(val, t);
          },
        }),
        t,
      );
      if (policyUrl) settings.AIMEAT_COOKIE_CONSENT_POLICY_URL = policyUrl;
    }
  }

  return settings;
}

async function askEconomySettings(
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

  return settings;
}

async function askAllAdvancedSettings(
  t: TFunction,
  cfg: AimeatConfig,
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

  const storQuota = checkCancel(
    await p.text({
      message: t('init.storageQuota'),
      defaultValue: String(cfg.storageQuotaMb),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (storQuota !== '100') settings.AIMEAT_STORAGE_QUOTA_MB = storQuota;

  const relayHops = checkCancel(
    await p.text({
      message: t('init.maxRelayHops'),
      defaultValue: String(cfg.maxRelayHops),
      validate: val => validatePositiveNum(val, t),
    }),
    t,
  );
  if (relayHops !== '3') settings.AIMEAT_MAX_RELAY_HOPS = relayHops;

  return settings;
}

// ── Main wizard ─────────────────────────────────────────────────────

/** Find .env: CWD first, then package root. */
function findEnvFile(): string | null {
  if (existsSync('.env')) return '.env';
  const pkgEnv = join(__pkgRoot, '.env');
  if (existsSync(pkgEnv)) return pkgEnv;
  return null;
}

export async function runInitWizard(config: AimeatConfig): Promise<void> {
  // Read existing .env for current values
  const envFilePath = findEnvFile();
  const env = envFilePath ? parseEnvFile(envFilePath) : {};

  // Step 1: Language selection (always bilingual)
  p.intro('AIMEAT Node Configuration Wizard');

  const lang = checkCancel(
    await p.select({
      message: 'Select language / Valitse kieli',
      options: [
        { value: 'en', label: 'English' },
        { value: 'fi', label: 'Suomi' },
      ],
    }),
    createT('en'),
  );

  const locale = lang as Locale;
  const t = createT(locale);

  // Step 2: Use case selection
  const useCase = checkCancel(
    await p.select({
      message: t('init.useCase'),
      options: [
        { value: 'public', label: t('init.useCasePublic'), hint: t('init.useCasePublicDesc') },
        { value: 'personal', label: t('init.useCasePersonal'), hint: t('init.useCasePersonalDesc') },
        { value: 'dev', label: t('init.useCaseDev'), hint: t('init.useCaseDevDesc') },
        { value: 'custom', label: t('init.useCaseCustom'), hint: t('init.useCaseCustomDesc') },
      ],
    }),
    t,
  ) as UseCase;

  // Build presets from loaded config (which already has env var values)
  const presets = buildPresets(config);
  const preset = useCase === 'custom' ? presets.personal : presets[useCase];

  // Step 3: Gather core settings — pass env so prompts show existing values
  const settings = await askCoreSettings(t, preset, useCase, env);

  // Step 4: Advanced settings (skip for dev)
  if (useCase !== 'dev') {
    const advanced = checkCancel(
      await p.select({
        message: t('init.advancedPrompt'),
        options: [
          { value: 'none', label: t('init.advancedNo') },
          { value: 'economy', label: t('init.advancedEconomy'), hint: t('init.advancedEconomyDesc') },
          { value: 'all', label: t('init.advancedAll'), hint: t('init.advancedAllDesc') },
        ],
      }),
      t,
    );

    if (advanced === 'economy') {
      Object.assign(settings, await askEconomySettings(t, config));
    } else if (advanced === 'all') {
      Object.assign(settings, await askAllAdvancedSettings(t, config));
    }
  }

  // Step 5: Summary
  const changedEntries = Object.entries(settings).filter(
    ([key, val]) => CONFIG_DEFAULTS[key] !== val,
  );

  if (changedEntries.length > 0) {
    const summaryLines = changedEntries
      .map(([key, val]) => {
        const display = key === 'AIMEAT_ADMIN_PASSWORD'
          ? val.slice(0, 2) + '*'.repeat(Math.max(0, val.length - 4)) + val.slice(-2)
          : val;
        return `  ${key} = ${display}`;
      })
      .join('\n');

    p.note(
      `${t('init.summaryChanged')}\n\n${summaryLines}\n\n${t('init.summaryDefault')}`,
      t('init.summaryTitle'),
    );
  }

  // Step 6: Output format
  const outputFormat = checkCancel(
    await p.select({
      message: t('init.outputPrompt'),
      options: [
        { value: 'env', label: t('init.outputEnv') },
        { value: 'json', label: t('init.outputJson') },
        { value: 'cancel', label: t('init.outputCancel') },
      ],
    }),
    t,
  );

  if (outputFormat === 'cancel') bail(t);

  let fileName: string;
  if (outputFormat === 'env') {
    fileName = '.env';
  } else {
    // Build smart name suggestions from node ID
    const nodeId = settings.AIMEAT_NODE_ID || 'aimeat';
    const nameOptions = [
      { value: `${nodeId}.production.json`, label: `${nodeId}.production.json` },
      { value: `${nodeId}.staging.json`, label: `${nodeId}.staging.json` },
      { value: `${nodeId}.development.json`, label: `${nodeId}.development.json` },
      { value: 'custom', label: t('init.jsonNameCustom') },
    ];
    const jsonName = checkCancel(
      await p.select({
        message: t('init.jsonNamePrompt'),
        options: nameOptions,
      }),
      t,
    );

    if (jsonName === 'custom') {
      fileName = checkCancel(
        await p.text({
          message: t('init.jsonNamePrompt'),
          placeholder: 'aimeat.config.json',
          defaultValue: 'aimeat.config.json',
          validate: val => {
            if (!val) return;
            if (!val.endsWith('.json')) return 'Must end with .json';
          },
        }),
        t,
      );
    } else {
      fileName = jsonName as string;
    }
  }

  const content = outputFormat === 'env'
    ? generateEnvContent(settings)
    : generateJsonContent(settings);

  // Handle existing file
  if (existsSync(fileName)) {
    const action = checkCancel(
      await p.select({
        message: t('init.existingFile', { file: fileName }),
        options: [
          { value: 'merge', label: t('init.existingMerge') },
          { value: 'overwrite', label: t('init.existingOverwrite') },
          { value: 'cancel', label: t('init.existingCancel') },
        ],
      }),
      t,
    );

    if (action === 'cancel') bail(t);

    // Backup existing file before any modification
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `${fileName}.backup.${timestamp}`;
    writeFileSync(backupName, readFileSync(fileName, 'utf-8'));
    p.log.info(t('init.backupCreated', { file: backupName }));

    if (action === 'merge' && outputFormat === 'env') {
      const existing = readFileSync(fileName, 'utf-8');
      const existingKeys = new Set(
        existing
          .split('\n')
          .filter(line => line.match(/^[A-Z_]+=/) )
          .map(line => line.split('=')[0]),
      );

      const newLines: string[] = [];
      for (const line of content.split('\n')) {
        const keyMatch = line.match(/^([A-Z_]+)=/);
        if (keyMatch && existingKeys.has(keyMatch[1])) continue;
        newLines.push(line);
      }

      const merged = existing.trimEnd() + '\n\n' + newLines.join('\n');
      writeFileSync(fileName, merged);
    } else if (action === 'merge' && outputFormat === 'json') {
      const existing = JSON.parse(readFileSync(fileName, 'utf-8'));
      const newCfg = JSON.parse(content);
      const merged = { ...existing, ...newCfg };
      writeFileSync(fileName, JSON.stringify(merged, null, 2) + '\n');
    } else {
      writeFileSync(fileName, content);
    }
  } else {
    writeFileSync(fileName, content);
  }

  p.log.success(t('init.written', { file: fileName }));

  // Offer to join federation if role is not standalone and genesis URL is set
  const fedRole = settings.AIMEAT_FEDERATION_ROLE;
  const genesisUrl = settings.AIMEAT_GENESIS_URL;
  if (fedRole && fedRole !== 'standalone' && genesisUrl) {
    const shouldJoin = checkCancel(await p.confirm({
      message: t('init.joinNow'),
    }), t);

    if (shouldJoin) {
      const { runFederationJoin } = await import('./federation-join.js');
      await runFederationJoin(config, genesisUrl, locale);
      return; // join flow handles its own outro
    }
  }

  const nextSteps = [
    t('init.nextStep1', { file: fileName }),
  ];
  if (outputFormat === 'env') {
    nextSteps.push(t('init.nextStep2'));
    nextSteps.push(t('init.nextStep3'));
  } else {
    nextSteps.push(t('init.nextStepJson', { file: fileName }));
  }
  p.note(nextSteps.join('\n'), t('init.nextSteps'));

  p.outro(t('init.done'));
}
