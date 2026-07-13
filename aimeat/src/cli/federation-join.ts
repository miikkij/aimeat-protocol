/**
 * @file src/cli/federation-join.ts
 * @description `aimeat join [url]` CLI wizard (@clack/prompts) — guided federation join: discovery →
 *   role selection → signed introduce → approval polling → Ed25519 key exchange → .env update. Persists
 *   a resumable pending-join file so an interrupted operator approval can be resumed later.
 *
 * @structure
 *   - runFederationJoin(config, targetUrl?, locale?): main flow orchestrating the 9 join steps
 *   - pollApproval(...): polls the peer's introduce status until approved/rejected/interrupted
 *   - doKeyExchange(...): POSTs public key + capabilities to the target's key-exchange endpoint
 *   - ensureKeypair/setEnvVar/saveFederationState: keypair provisioning and .env persistence
 *   - load/save/clearPendingJoin: resumable pending-request state on disk
 *
 * @version-history
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as p from '@clack/prompts';
import { createT, type Locale, type TFunction } from '../i18n.js';
import { generateKeyPair, sign } from '../auth/keypair.js';
import type { AimeatConfig } from '../config.js';

// Package root: from dist/src/cli/federation-join.js -> go up 3 levels to aimeat/
const __pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const PENDING_JOIN_FILE = '.aimeat-pending-join.json';
const POLL_INTERVAL_MS = 10_000;

// ── Helpers ─────────────────────────────────────────────────────────

function bail(t: TFunction): never {
  p.cancel(t('join.done'));
  process.exit(0);
}

function checkCancel<T>(value: T | symbol, t: TFunction): T {
  if (p.isCancel(value)) bail(t);
  return value as T;
}

interface PendingJoin {
  requestId: string;
  targetUrl: string;
  nodeId: string;
  role: string;
  createdAt: string;
}

function loadPendingJoin(): PendingJoin | null {
  const path = existsSync(PENDING_JOIN_FILE) ? PENDING_JOIN_FILE
    : existsSync(join(__pkgRoot, PENDING_JOIN_FILE)) ? join(__pkgRoot, PENDING_JOIN_FILE)
      : null;
  if (!path) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as PendingJoin;
  } catch {
    return null;
  }
}

function savePendingJoin(pending: PendingJoin): void {
  writeFileSync(PENDING_JOIN_FILE, JSON.stringify(pending, null, 2) + '\n');
}

function clearPendingJoin(): void {
  try {
    const filePath = existsSync(PENDING_JOIN_FILE) ? PENDING_JOIN_FILE
      : existsSync(join(__pkgRoot, PENDING_JOIN_FILE)) ? join(__pkgRoot, PENDING_JOIN_FILE)
        : null;
    if (filePath) unlinkSync(filePath);
  } catch {
    // Ignore cleanup errors
  }
}

/** Find .env: CWD first, then package root. */
function findEnvFile(): string {
  if (existsSync('.env')) return '.env';
  const pkgEnv = join(__pkgRoot, '.env');
  if (existsSync(pkgEnv)) return pkgEnv;
  return '.env'; // default: create in CWD
}

/** Ensure we have an Ed25519 keypair. Reads from env or generates new. */
async function ensureKeypair(t: TFunction): Promise<{ publicKey: string; privateKey: string }> {
  // Check for existing keys in env
  if (process.env.AIMEAT_PUBLIC_KEY && process.env.AIMEAT_PRIVATE_KEY) {
    return {
      publicKey: process.env.AIMEAT_PUBLIC_KEY,
      privateKey: process.env.AIMEAT_PRIVATE_KEY,
    };
  }

  // Generate new keypair
  const keys = await generateKeyPair();

  // Append to .env
  const envFile = findEnvFile();
  const lines = [
    '',
    '# ── Node Keypair ─────────────────────────────────────────────────',
    `AIMEAT_PUBLIC_KEY="${keys.publicKey}"`,
    `AIMEAT_PRIVATE_KEY="${keys.privateKey}"`,
    '',
  ];

  if (existsSync(envFile)) {
    appendFileSync(envFile, lines.join('\n'));
  } else {
    writeFileSync(envFile, lines.join('\n'));
  }

  // Set in current process
  process.env.AIMEAT_PUBLIC_KEY = keys.publicKey;
  process.env.AIMEAT_PRIVATE_KEY = keys.privateKey;

  p.log.info(t('join.keypairGenerated'));
  return keys;
}

/** Update or append an env var in the .env file. */
function setEnvVar(key: string, value: string): void {
  const envFile = findEnvFile();
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      writeFileSync(envFile, content.replace(regex, `${key}="${value}"`));
    } else {
      appendFileSync(envFile, `${key}="${value}"\n`);
    }
  } else {
    writeFileSync(envFile, `${key}="${value}"\n`);
  }
}

interface DiscoveryInfo {
  node_id: string;
  type?: string;
  protocol: string;
  version?: string | number;
  capabilities?: string[];
}

// ── Main join flow ──────────────────────────────────────────────────

export async function runFederationJoin(
  config: AimeatConfig,
  targetUrl?: string,
  locale?: string,
): Promise<void> {
  const t = createT((locale ?? 'en') as Locale);
  p.intro(t('join.title'));

  // Show config source for transparency
  const configSource = config.genesisUrl ? 'config' :
    config.nodeId !== 'aimeat-local-001-dev' ? 'config' : null;
  if (!configSource && !targetUrl) {
    p.log.warn(t('join.noConfig'));
  }

  // 1. Target URL (from arg, config, or prompt)
  if (!targetUrl) {
    targetUrl = checkCancel(await p.text({
      message: t('join.targetUrl'),
      placeholder: t('join.targetUrlPlaceholder'),
      validate: (val) => {
        if (!val) return t('join.targetUrlRequired');
        if (!val.startsWith('http://') && !val.startsWith('https://')) return t('join.targetUrlInvalid');
      },
    }), t);
  }

  // Normalize: strip trailing slash
  targetUrl = targetUrl.replace(/\/+$/, '');

  // Check for a pending join request to this target
  const pending = loadPendingJoin();
  if (pending && pending.targetUrl === targetUrl) {
    const resume = checkCancel(await p.select({
      message: t('join.resumeFound', { requestId: pending.requestId }),
      options: [
        { value: 'yes', label: t('join.resumeYes') },
        { value: 'no', label: t('join.resumeNo') },
      ],
    }), t);

    if (resume === 'yes') {
      // Resume polling
      const finalStatus = await pollApproval(t, targetUrl, pending.requestId);
      if (finalStatus === 'approved') {
        const keys = await ensureKeypair(t);
        await doKeyExchange(t, targetUrl, config, keys);
        saveFederationState(config, targetUrl, pending.role);
        clearPendingJoin();
        showDone(t);
      } else if (finalStatus === 'rejected') {
        clearPendingJoin();
        p.outro(t('join.rejectedMessage'));
      }
      return;
    }
    // If 'no', continue with fresh flow
  }

  // 2. Discover target
  const s = p.spinner();
  s.start(t('join.discovering'));
  let targetInfo: DiscoveryInfo;
  try {
    const resp = await fetch(`${targetUrl}/.well-known/aimeat`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const body = await resp.json() as { data?: DiscoveryInfo };
    targetInfo = body.data!;
    if (!targetInfo || targetInfo.protocol !== 'aimeat') {
      s.stop(t('join.discoveryFailed'));
      p.log.error(t('join.notAimeat'));
      return;
    }
  } catch (e) {
    s.stop(t('join.discoveryFailed'));
    p.log.error(t('join.connectionFailed', {
      url: targetUrl,
      error: e instanceof Error ? e.message : String(e),
    }));
    return;
  }
  s.stop(t('join.discovered', { nodeId: targetInfo.node_id }));

  // Show target info
  const ver = String(targetInfo.version ?? 'v1').replace(/^v/, '');
  const infoLines = [
    t('join.targetInfoNodeId', { nodeId: targetInfo.node_id }),
    t('join.targetInfoType', { nodeType: targetInfo.type ?? 'full' }),
    t('join.targetInfoProtocol', { protocol: targetInfo.protocol, version: ver }),
  ];
  if (targetInfo.capabilities?.length) {
    infoLines.push(`Capabilities: ${targetInfo.capabilities.join(', ')}`);
  }
  p.note(infoLines.join('\n'), t('join.targetInfo'));

  // 3. Role (from config or ask)
  let role: string;
  if (config.federationRole !== 'standalone') {
    role = config.federationRole;
  } else {
    role = checkCancel(await p.select({
      message: t('join.rolePrompt'),
      options: [
        { value: 'contributor', label: t('join.roleContributor'), hint: t('join.roleContributorHint') },
        { value: 'operator', label: t('join.roleOperator'), hint: t('join.roleOperatorHint') },
      ],
    }), t) as string;
  }

  // 4. Ensure we have a keypair
  const keys = await ensureKeypair(t);

  // 5. Introduce ourselves (with signature)
  const introSpinner = p.spinner();
  introSpinner.start(t('join.sending'));
  let introData: { request_id: string; status: string };
  try {
    const timestamp = new Date().toISOString();
    const messageToSign = `${config.nodeId}${config.baseUrl}${timestamp}`;
    const signature = await sign(keys.privateKey, messageToSign);

    const introResp = await fetch(`${targetUrl}/v1/federation/peer/introduce`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: config.nodeId,
        node_url: config.baseUrl,
        node_type: config.nodeType,
        public_key: keys.publicKey,
        role,
        message: '',
        signature,
        timestamp,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!introResp.ok) {
      const contentType = introResp.headers.get('content-type') ?? '';
      let msg = `HTTP ${introResp.status}`;
      if (contentType.includes('json')) {
        const errBody = await introResp.json().catch(() => null) as { error?: { code?: string; message?: string } } | null;
        msg = errBody?.error?.message ?? msg;
        if (errBody?.error?.code === 'MAINTENANCE') {
          msg = t('join.targetMaintenance');
        }
      } else if (introResp.status === 503) {
        msg = t('join.targetMaintenance');
      }
      introSpinner.stop(t('join.sendFailed', { error: msg }));
      if (introResp.status === 409) {
        p.log.warn(t('join.alreadyPeer'));
      }
      return;
    }

    const introBody = await introResp.json() as { data: { request_id: string; status: string } };
    introData = introBody.data;
  } catch (e) {
    introSpinner.stop(t('join.sendFailed', {
      error: e instanceof Error ? e.message : String(e),
    }));
    return;
  }
  introSpinner.stop();

  // 6. Handle approval
  if (introData.status === 'auto_approved') {
    p.log.success(t('join.autoApproved'));
  } else {
    p.log.info(t('join.pendingApproval'));

    // Save pending state for resume
    savePendingJoin({
      requestId: introData.request_id,
      targetUrl,
      nodeId: config.nodeId,
      role,
      createdAt: new Date().toISOString(),
    });

    const finalStatus = await pollApproval(t, targetUrl, introData.request_id);
    if (finalStatus === 'rejected') {
      clearPendingJoin();
      p.outro(t('join.rejectedMessage'));
      return;
    }
    if (finalStatus === 'interrupted') {
      // User pressed Ctrl+C — show resume hint
      p.log.info(t('join.resumeHint', { url: targetUrl }));
      p.log.info(`Request ID: ${introData.request_id}`);
      return;
    }
    // approved
    clearPendingJoin();
  }

  // 7. Key exchange
  await doKeyExchange(t, targetUrl, config, keys);

  // 8. Save federation state
  saveFederationState(config, targetUrl, role);

  // 9. Done
  showDone(t);
}

/** Poll for approval status. Returns 'approved', 'rejected', or 'interrupted'. */
async function pollApproval(
  t: TFunction,
  targetUrl: string,
  requestId: string,
): Promise<'approved' | 'rejected' | 'interrupted'> {
  const s = p.spinner();
  s.start(t('join.waitingApproval'));

  let interrupted = false;
  const onSigint = () => { interrupted = true; };
  process.on('SIGINT', onSigint);

  try {
    while (!interrupted) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
      if (interrupted) break;

      try {
        const statusResp = await fetch(
          `${targetUrl}/v1/federation/peer/introduce/${requestId}/status`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (statusResp.ok) {
          const body = await statusResp.json() as { data: { status: string } };
          const status = body.data.status;
          if (status === 'approved') {
            s.stop(t('join.approved'));
            return 'approved';
          }
          if (status === 'rejected') {
            s.stop(t('join.rejected'));
            return 'rejected';
          }
          // 'pending' — keep polling
        }
      } catch {
        // Network error during poll — keep trying
      }
    }

    s.stop();
    return 'interrupted';
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

/** Perform key exchange with the target node. */
async function doKeyExchange(
  t: TFunction,
  targetUrl: string,
  config: AimeatConfig,
  keys: { publicKey: string; privateKey: string },
): Promise<void> {
  const s = p.spinner();
  s.start(t('join.keyExchange'));

  try {
    const resp = await fetch(`${targetUrl}/v1/federation/key-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        node_id: config.nodeId,
        public_key: keys.publicKey,
        capabilities: ['memory', 'actions', 'work', 'wallet', 'boards', 'federation'],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!resp.ok) {
      s.stop(t('join.keyExchangeFailed', { error: `HTTP ${resp.status}` }));
      return;
    }

    s.stop(t('join.keyExchangeDone'));
  } catch (e) {
    s.stop(t('join.keyExchangeFailed', {
      error: e instanceof Error ? e.message : String(e),
    }));
  }
}

/** Save federation role and genesis URL to .env if not already set. */
function saveFederationState(config: AimeatConfig, targetUrl: string, role: string): void {
  if (!process.env.AIMEAT_FEDERATION_ROLE || process.env.AIMEAT_FEDERATION_ROLE === 'standalone') {
    setEnvVar('AIMEAT_FEDERATION_ROLE', role);
  }
  if (!process.env.AIMEAT_GENESIS_URL) {
    setEnvVar('AIMEAT_GENESIS_URL', targetUrl);
  }
}

/** Show the final success message with next steps. */
function showDone(t: TFunction): void {
  p.note([
    t('join.nextStep1'),
    t('join.nextStep2'),
  ].join('\n'), t('join.nextSteps'));
  p.outro(t('join.done'));
}
