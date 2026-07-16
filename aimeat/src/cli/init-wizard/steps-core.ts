/**
 * @file src/cli/init-wizard/steps-core.ts
 * @description Core-settings wizard step (identity, storage, admin, network role, push/SMTP/metrics/site) for `aimeat init`. Extracted from src/cli/init-wizard.ts to satisfy max-file-lines.
 * @version-history
 *   v1.0.0 — 2026-07-13 — Extracted from src/cli/init-wizard.ts (max-file-lines)
 */

import * as p from '@clack/prompts';
import type { TFunction } from '../../i18n.js';
import type { Preset, UseCase } from './presets.js';
import {
  checkCancel,
  validateDbUrl,
  validatePort,
  validatePositiveNum,
  validateNodeIdInput,
  validateUrl,
} from './helpers.js';

// ── Wizard steps ────────────────────────────────────────────────────

export async function askCoreSettings(
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
      validate: val => validateNodeIdInput(val, t),
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

  // Storage backend selection
  const storageBackend = checkCancel(
    await p.select({
      message: t('init.storage_label'),
      options: [
        { value: 'memory', label: t('init.storage_memory') },
        { value: 'sqlite', label: t('init.storage_sqlite') },
        { value: 'postgres-kysely', label: t('init.storage_postgresql') },
      ],
      initialValue: useCase === 'dev' ? 'memory' : useCase === 'personal' ? 'sqlite' : 'postgres-kysely',
    }),
    t,
  );
  settings.AIMEAT_STORAGE = storageBackend as string;

  // If sqlite, ask for path
  if (storageBackend === 'sqlite') {
    const sqlitePath = checkCancel(
      await p.text({
        message: t('init.sqlite_path_label'),
        placeholder: './data/aimeat.db',
        defaultValue: './data/aimeat.db',
      }),
      t,
    );
    settings.AIMEAT_SQLITE_PATH = sqlitePath;
  }

  // DATABASE_URL — when PostgreSQL storage is selected
  if (storageBackend === 'postgres-kysely') {
    const samplePlaceholder = 'postgresql://user:pass@localhost:5432/aimeat';
    if (useCase === 'public') {
      const dbDefault = env.DATABASE_URL || preset.dbUrl || '';
      const dbUrl = checkCancel(
        await p.text({
          message: t('init.dbUrl'),
          placeholder: dbDefault || samplePlaceholder,
          ...(dbDefault ? { defaultValue: dbDefault } : {}),
          validate: val => {
            if (!val) return undefined;
            return validateDbUrl(val, t);
          },
        }),
        t,
      );
      if (dbUrl) settings.DATABASE_URL = dbUrl;
    } else {
      const dbDefault = env.DATABASE_URL || preset.dbUrl || '';
      const dbUrl = checkCancel(
        await p.text({
          message: t('init.dbUrl'),
          placeholder: dbDefault || samplePlaceholder,
          defaultValue: dbDefault,
          validate: val => validateDbUrl(val, t),
        }),
        t,
      );
      if (dbUrl) settings.DATABASE_URL = dbUrl;
    }
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

  // ── Push Notifications ──
  if (useCase === 'public' || useCase === 'custom') {
    const pushDefault = env.AIMEAT_PUSH_ENABLED === 'true';
    const pushEnabled = checkCancel(
      await p.confirm({
        message: t('init.pushEnabled'),
        initialValue: pushDefault,
      }),
      t,
    );

    if (pushEnabled) {
      settings.AIMEAT_PUSH_ENABLED = 'true';

      const pubKeyDefault = env.AIMEAT_VAPID_PUBLIC_KEY || '';
      const pubKey = checkCancel(
        await p.text({
          message: t('init.vapidPublicKey'),
          placeholder: pubKeyDefault || t('init.vapidPublicKeyHint'),
          ...(pubKeyDefault ? { defaultValue: pubKeyDefault } : {}),
        }),
        t,
      );
      if (pubKey) settings.AIMEAT_VAPID_PUBLIC_KEY = pubKey;

      const privKeyDefault = env.AIMEAT_VAPID_PRIVATE_KEY || '';
      const privKey = checkCancel(
        await p.text({
          message: t('init.vapidPrivateKey'),
          placeholder: privKeyDefault ? '••••••••' : t('init.vapidPrivateKeyHint'),
          ...(privKeyDefault ? { defaultValue: privKeyDefault } : {}),
        }),
        t,
      );
      if (privKey) settings.AIMEAT_VAPID_PRIVATE_KEY = privKey;

      const subjectDefault = env.AIMEAT_VAPID_SUBJECT || 'mailto:admin@aimeat.example.com';
      const subject = checkCancel(
        await p.text({
          message: t('init.vapidSubject'),
          placeholder: t('init.vapidSubjectHint'),
          defaultValue: subjectDefault,
          validate: (val) => {
            if (val && !val.startsWith('mailto:') && !val.startsWith('https://')) {
              return t('init.vapidSubjectInvalid');
            }
          },
        }),
        t,
      );
      settings.AIMEAT_VAPID_SUBJECT = subject;
    }

    // ── Email / SMTP ──
    const smtpDefault = !!env.AIMEAT_SMTP_HOST;
    const smtpEnabled = checkCancel(
      await p.confirm({
        message: t('init.smtpEnabled'),
        initialValue: smtpDefault,
      }),
      t,
    );

    if (smtpEnabled) {
      const hostDefault = env.AIMEAT_SMTP_HOST || '';
      const smtpHost = checkCancel(
        await p.text({
          message: t('init.smtpHost'),
          placeholder: hostDefault || t('init.smtpHostHint'),
          ...(hostDefault ? { defaultValue: hostDefault } : {}),
        }),
        t,
      );
      if (smtpHost) settings.AIMEAT_SMTP_HOST = smtpHost;

      const portDefault = env.AIMEAT_SMTP_PORT || '587';
      const smtpPort = checkCancel(
        await p.text({
          message: t('init.smtpPort'),
          placeholder: t('init.smtpPortHint'),
          defaultValue: portDefault,
          validate: (val) => validatePort(val, t),
        }),
        t,
      );
      settings.AIMEAT_SMTP_PORT = smtpPort;

      const userDefault = env.AIMEAT_SMTP_USER || '';
      const smtpUser = checkCancel(
        await p.text({
          message: t('init.smtpUser'),
          placeholder: userDefault || t('init.smtpUserHint'),
          ...(userDefault ? { defaultValue: userDefault } : {}),
        }),
        t,
      );
      if (smtpUser) settings.AIMEAT_SMTP_USER = smtpUser;

      const smtpPass = checkCancel(
        await p.text({
          message: t('init.smtpPass'),
          placeholder: '••••••••',
        }),
        t,
      );
      if (smtpPass) settings.AIMEAT_SMTP_PASS = smtpPass;

      const fromDefault = env.AIMEAT_SMTP_FROM || 'AIMEAT <noreply@localhost>';
      const smtpFrom = checkCancel(
        await p.text({
          message: t('init.smtpFrom'),
          placeholder: t('init.smtpFromHint'),
          defaultValue: fromDefault,
        }),
        t,
      );
      settings.AIMEAT_SMTP_FROM = smtpFrom;

      const secureDefault = env.AIMEAT_SMTP_SECURE === 'true';
      const smtpSecure = checkCancel(
        await p.confirm({
          message: t('init.smtpSecure'),
          initialValue: secureDefault,
        }),
        t,
      );
      if (smtpSecure) settings.AIMEAT_SMTP_SECURE = 'true';
    }
  }

  // ── Metrics & Observability ──
  if (useCase === 'public' || useCase === 'custom') {
    const metricsDefault = env.AIMEAT_METRICS_ENABLED === 'true';
    const metricsEnabled = checkCancel(
      await p.confirm({
        message: t('init.metricsEnabled'),
        initialValue: metricsDefault,
      }),
      t,
    );

    if (metricsEnabled) {
      settings.AIMEAT_METRICS_ENABLED = 'true';

      const accessDefault = env.AIMEAT_METRICS_ACCESS || 'operator';
      const metricsAccess = checkCancel(
        await p.select({
          message: t('init.metricsAccess'),
          initialValue: accessDefault,
          options: [
            { value: 'public', label: t('init.metricsAccessPublic') },
            { value: 'authenticated', label: t('init.metricsAccessAuthenticated') },
            { value: 'operator', label: t('init.metricsAccessOperator') },
          ],
        }),
        t,
      );
      settings.AIMEAT_METRICS_ACCESS = metricsAccess as string;
    }
  }

  // Node Portal (Site) — ask for public and custom
  if (useCase === 'public' || useCase === 'custom') {
    const siteDefault = env.AIMEAT_SITE_ENABLED !== 'false';
    const siteEnabled = checkCancel(
      await p.confirm({
        message: t('init.siteEnabled'),
        initialValue: siteDefault,
      }),
      t,
    );
    if (!siteEnabled) {
      settings.AIMEAT_SITE_ENABLED = 'false';
    } else {
      const tmplSizeDefault = env.AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB || '512';
      const tmplSize = checkCancel(
        await p.text({
          message: t('init.siteMaxTemplateSizeKb'),
          defaultValue: tmplSizeDefault,
          validate: val => validatePositiveNum(val, t),
        }),
        t,
      );
      if (tmplSize !== '512') settings.AIMEAT_SITE_MAX_TEMPLATE_SIZE_KB = tmplSize;

      const cacheTtlDefault = env.AIMEAT_SITE_CACHE_TTL_SECONDS || '60';
      const cacheTtl = checkCancel(
        await p.text({
          message: t('init.siteCacheTtlSeconds'),
          defaultValue: cacheTtlDefault,
          validate: val => validatePositiveNum(val, t),
        }),
        t,
      );
      if (cacheTtl !== '60') settings.AIMEAT_SITE_CACHE_TTL_SECONDS = cacheTtl;
    }
  }

  return settings;
}
