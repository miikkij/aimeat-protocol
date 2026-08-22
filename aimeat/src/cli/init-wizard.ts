/**
 * @file init-wizard.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Interactive `aimeat init` wizard using @clack/prompts. Guides users
 *   through node configuration with use-case-based defaults; reads existing .env /
 *   config values so users see their current settings; writes .env / .ini / .json.
 *   Presets, helpers, generators, and per-section wizard steps live in
 *   ./init-wizard/*; this file orchestrates them.
 * @version-history
 *   v1.26.0 — 2026-08-21 — Per-instance at-rest encryption secrets: the wizard now auto-generates
 *     AIMEAT_TOTP_ENCRYPTION_KEY (64-hex AES-256-GCM) and AIMEAT_KEY_PASSPHRASE once and writes them
 *     to the config, so a sold/provisioned instance never ships with plaintext 2FA secrets, an
 *     unencrypted node key, or a shared template key. Existing values are preserved, never
 *     regenerated (a new value would strand the data it protects). ensureEncryptionSecrets() is
 *     exported and unit-tested in test/unit/init-wizard-secrets.test.ts.
 *   v1.25.3 — 2026-07-13 — Split into ./init-wizard/* sibling modules
 *   (presets, helpers, generate, steps-core, steps-operator, steps-advanced) to
 *   satisfy max-file-lines; pure extraction, no behavior change.
 * @version-history v1.25.2 — 2026-06-20 — Add App Origin Isolation (H-2) prompt to
 *   advanced settings (public/custom nodes with a real base URL): confirm + app-host
 *   text, derives apps.<host>, sets AIMEAT_APP_HOST/AIMEAT_APP_ORIGIN_ENABLED.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import ini from 'ini';
import { createT, type Locale } from '../i18n.js';
import type { AimeatConfig } from '../config.js';
import { buildPresets, CONFIG_DEFAULTS, type UseCase } from './init-wizard/presets.js';
import { bail, checkCancel, parseEnvFile } from './init-wizard/helpers.js';
import { generateEnvContent, generateIniContent, generateJsonContent } from './init-wizard/generate.js';
import { askCoreSettings } from './init-wizard/steps-core.js';
import { askOperatorSettings } from './init-wizard/steps-operator.js';
import { askAllAdvancedSettings, askEconomySettings } from './init-wizard/steps-advanced.js';

// Package root: from dist/src/cli/init-wizard.js -> go up 3 levels to aimeat/
const __pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Setting keys that hold a secret and must be masked in the on-screen summary, never printed raw. */
const SECRET_SETTING_KEYS = new Set([
  'AIMEAT_ADMIN_PASSWORD',
  'AIMEAT_TOTP_ENCRYPTION_KEY',
  'AIMEAT_KEY_PASSPHRASE',
]);

/**
 * Fill in the two at-rest encryption secrets for this instance, generating a fresh value only when
 * one is not already present. The order is deliberate: a value the operator typed this run wins,
 * then a value already in the loaded environment (an existing instance being re-configured), and
 * only a genuinely absent secret is generated. This is what makes re-running `aimeat init` safe —
 * regenerating either secret would strand the data it protects (stored 2FA secrets, the encrypted
 * node key). AIMEAT_TOTP_ENCRYPTION_KEY is 32 bytes as 64 hex chars (AES-256-GCM, the length
 * config.ts expects); AIMEAT_KEY_PASSPHRASE is 32 random bytes, url-safe.
 */
export function ensureEncryptionSecrets(settings: Record<string, string>, env: Record<string, string>): void {
  settings.AIMEAT_TOTP_ENCRYPTION_KEY =
    settings.AIMEAT_TOTP_ENCRYPTION_KEY || env.AIMEAT_TOTP_ENCRYPTION_KEY || randomBytes(32).toString('hex');
  settings.AIMEAT_KEY_PASSPHRASE =
    settings.AIMEAT_KEY_PASSPHRASE || env.AIMEAT_KEY_PASSPHRASE || randomBytes(32).toString('base64url');
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

  // Step 3.5: Operator info (privacy policy fields rendered into /v1/privacy).
  // Skip for dev; ask-with-confirm for personal; ask required for public/custom.
  Object.assign(settings, await askOperatorSettings(t, useCase, env));

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
      Object.assign(settings, await askAllAdvancedSettings(t, config, useCase, settings.AIMEAT_BASE_URL ?? ''));
    }
  }

  // Step 4.5: Per-instance encryption secrets. These protect data AT REST — the TOTP key
  // (AES-256-GCM) encrypts stored 2FA secrets, and the passphrase encrypts the node's Ed25519
  // identity key on disk. Every instance needs its OWN, or a shared/template value would let one
  // operator decrypt another instance's secrets. Generated ONCE and persisted into the config:
  // NEVER regenerate an existing value (a new TOTP key cannot decrypt already-stored 2FA secrets,
  // a new passphrase cannot decrypt the existing node key), so any value already in the environment
  // is carried forward untouched. This is unlike AIMEAT_ADMIN_PASSWORD, which is a login secret the
  // node may safely regenerate on boot.
  ensureEncryptionSecrets(settings, env);

  // Step 5: Summary
  const changedEntries = Object.entries(settings).filter(
    ([key, val]) => CONFIG_DEFAULTS[key] !== val,
  );

  if (changedEntries.length > 0) {
    const summaryLines = changedEntries
      .map(([key, val]) => {
        const display = SECRET_SETTING_KEYS.has(key)
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
        { value: 'ini', label: t('init.outputIni') },
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
  } else if (outputFormat === 'ini') {
    fileName = 'aimeat.ini';
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
    : outputFormat === 'ini'
      ? generateIniContent(settings)
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
          .filter(line => line.match(/^[A-Z_]+=/))
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
    } else if (action === 'merge' && outputFormat === 'ini') {
      const existing = ini.parse(readFileSync(fileName, 'utf-8'));
      const newCfg = ini.parse(content);
      // Deep merge sections
      for (const [section, values] of Object.entries(newCfg)) {
        if (typeof values === 'object' && values !== null) {
          existing[section] = { ...(existing[section] as Record<string, string> || {}), ...values };
        } else {
          existing[section] = values;
        }
      }
      writeFileSync(fileName, '; AIMEAT Node Configuration (INI format)\n; Merged by aimeat init\n\n' + ini.stringify(existing));
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

  // ── Scaffold runtime files ──
  const shouldScaffold = checkCancel(await p.confirm({
    message: t('init.scaffoldPrompt'),
    initialValue: true,
  }), t);

  if (shouldScaffold) {
    const { scaffoldFiles: doScaffold, findPackageRoot } = await import('./scaffold.js');
    const pkgRoot = findPackageRoot(dirname(fileURLToPath(import.meta.url)));
    if (pkgRoot) {
      const pkgJsonPath = join(pkgRoot, 'package.json');
      const pkgVersion = existsSync(pkgJsonPath)
        ? (JSON.parse(readFileSync(pkgJsonPath, 'utf-8')) as { version: string }).version
        : '0.0.0';
      const spinner = p.spinner();
      spinner.start(t('init.scaffoldCopying'));
      const scaffoldResult = doScaffold(pkgRoot, process.cwd(), pkgVersion);
      spinner.stop(t('init.scaffoldDone', {
        copied: String(scaffoldResult.copied),
        updated: String(scaffoldResult.updated),
        skipped: String(scaffoldResult.skippedModified),
      }));
      for (const file of scaffoldResult.modifiedFiles) {
        p.log.warn(t('init.scaffoldSkippedFile', { file }));
      }
    } else {
      p.log.warn(t('init.scaffoldNoSource'));
    }
  }

  // Offer to join federation if role is not standalone and genesis URL is set
  const fedRole = settings.AIMEAT_FEDERATION_ROLE;
  const genesisUrl = settings.AIMEAT_GENESIS_URL;
  if (fedRole && fedRole !== 'standalone' && genesisUrl) {
    const shouldJoin = checkCancel(await p.confirm({
      message: t('init.joinNow'),
    }), t);

    if (shouldJoin) {
      try {
        // Build a config reflecting the user's NEW settings (not the startup defaults)
        const port = settings.AIMEAT_PORT || String(config.port);
        const joinConfig: AimeatConfig = {
          ...config,
          nodeId: settings.AIMEAT_NODE_ID || config.nodeId,
          baseUrl: settings.AIMEAT_BASE_URL || `http://localhost:${port}`,
          nodeType: (settings.AIMEAT_NODE_TYPE as AimeatConfig['nodeType']) || config.nodeType,
          federationRole: (fedRole as AimeatConfig['federationRole']) || config.federationRole,
          genesisUrl: genesisUrl || config.genesisUrl,
        };
        const { runFederationJoin } = await import('./federation-join.js');
        await runFederationJoin(joinConfig, genesisUrl, locale);
      } catch (e) {
        p.log.warn(t('init.joinFailed', {
          error: e instanceof Error ? e.message : String(e),
        }));
        p.log.info(t('init.joinRetryHint'));
      }
    }
  }

  const nextSteps = [
    t('init.nextStep1', { file: fileName }),
  ];
  if (outputFormat === 'env') {
    nextSteps.push(t('init.nextStep2'));
    nextSteps.push(t('init.nextStep3'));
  } else if (outputFormat === 'ini') {
    nextSteps.push(t('init.nextStepIni', { file: fileName }));
  } else {
    nextSteps.push(t('init.nextStepJson', { file: fileName }));
  }
  p.note(nextSteps.join('\n'), t('init.nextSteps'));

  p.outro(t('init.done'));
}
