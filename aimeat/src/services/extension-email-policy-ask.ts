/**
 * @file src/services/extension-email-policy-ask.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description An extension's `emailPolicy: 'unrestricted'` is the operator's grant: it lifts
 *   ctx.email's recipient check, so the extension's code mails any address under this node's mail
 *   identity (services/extension-email.ts). The operator in person and the operator's agent holding
 *   operator:admin set it at once. Anyone else who may manage the extension ASKS, and the change
 *   waits for an operator's one-press answer under the approval standard
 *   (services/approval-standard.ts); the extension keeps the policy it has until then.
 *
 *   WHY ASK AND NOT REFUSE (secaudit2026oct22; Jouni, 2026-10-25). Round 6 answered such a caller
 *   403 OPERATOR_REQUIRED, and a script change by it dropped the grant. The developer rejected both:
 *   a fix makes a use safe and never forbids it. So:
 *     - a request for 'unrestricted' through the config route, its MCP twin or a manifest the caller
 *       installs or redeploys files a question to the operators; nothing about the policy changes;
 *     - a new script written by such a caller holds the grant back from the new code (the extension
 *       mails under the normal recipient rules meanwhile) and asks the operators to confirm it.
 *   A narrowing (any other value) is not a grant and is set at once.
 *
 *   WHAT AN APPROVAL CONFIRMS. That extension, installed by that account, at that version and with
 *   those action scripts (their digest): code written after the question was asked is not what the
 *   operator saw, and the request ends `outdated` (publish-requests/apply-extension-email-policy.ts).
 * @structure EMAIL_POLICY_KEY · UNRESTRICTED_EMAIL · grantsUnrestrictedEmail · actionCodeDigest ·
 *   manifestAsksUnrestrictedEmail · EmailPolicyAsk · askOperatorsForEmailPolicy
 * @usage
 *   const asked = await askOperatorsForEmailPolicy({ storage, config }, ext, requesterOf(ctx, caller), 'asked');
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (secaudit2026oct22, leads 294 and 354 reworked; the approval standard).
 */
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import type { ExtensionRecord } from '../storage/interface.js';
import { fileAsk, publishRequestedBody } from './publish-requests/ask.js';
import type { PublishRequester, PublishStoreCtx } from './publish-requests/store.js';
import { stableStringify } from '../utils/stable-json.js';
import { logger } from '../utils/logger.js';

export const EMAIL_POLICY_KEY = 'emailPolicy';
export const UNRESTRICTED_EMAIL = 'unrestricted';

/** Does this config hold the operator's grant? Only 'unrestricted' lifts the recipient check. */
export function grantsUnrestrictedEmail(config: Record<string, unknown> | undefined): boolean {
  return config?.[EMAIL_POLICY_KEY] === UNRESTRICTED_EMAIL;
}

/** The digest of the extension's action scripts, by action id: the code an operator confirms. */
export function actionCodeDigest(actions: ExtensionRecord['actions'] | undefined): string {
  const code = (actions ?? []).map(a => ({ id: a.id, script: a.scriptContent ?? '' })).sort((x, y) => x.id.localeCompare(y.id));
  return createHash('sha256').update(stableStringify(code)).digest('hex');
}

/**
 * Does this manifest ask for the grant? Read from the YAML the caller sent, because the builder
 * strips the key for a caller that is not an operator (extension-manifest.ts stripNodeOwnedConfig).
 * A descriptor (`emailPolicy: { default: unrestricted }`) and a bare value both count.
 */
export function manifestAsksUnrestrictedEmail(manifestYaml: unknown): boolean {
  if (typeof manifestYaml !== 'string' || !manifestYaml.includes(EMAIL_POLICY_KEY)) return false;
  try {
    const cfg = (parseYaml(manifestYaml) as { config?: Record<string, unknown> } | null)?.config;
    const raw = cfg?.[EMAIL_POLICY_KEY];
    const value = raw && typeof raw === 'object' && 'default' in raw ? (raw as { default: unknown }).default : raw;
    return value === UNRESTRICTED_EMAIL;
  } catch (err) {
    // The builder refused this manifest already, with the parser's own words.
    logger.warn('emailPolicy ask: the manifest does not parse', { error: String(err) });
    return false;
  }
}

/** What a route adds to its answer: the filed question, or why none was filed. */
export type EmailPolicyAsk =
  | { approval_request: ReturnType<typeof publishRequestedBody> }
  | { warnings: Array<{ code: 'APPROVAL_NOT_ASKED'; message: string }> };

/**
 * Ask the operators to let `ext` (as it is stored now) mail any address. `reason` says why: the
 * caller asked for it, or the caller wrote new code for an extension that held the grant. Files one
 * question per (asker, extension); a second ask names the newest code. Never throws.
 */
export async function askOperatorsForEmailPolicy(
  ctx: PublishStoreCtx, ext: ExtensionRecord, requester: PublishRequester, reason: 'asked' | 'code-changed',
): Promise<EmailPolicyAsk> {
  const why = reason === 'code-changed'
    ? `The code of ${ext.name} changed, and the permission to email any address belonged to its earlier code. `
      + 'Until an operator confirms it for the new code, the extension emails only the addresses the normal rules allow.'
    : 'Emailing any address goes out under this node\'s own mail identity, so an operator of the node decides it. '
      + 'Until then the extension emails only the addresses the normal rules allow.';
  try {
    const filed = await fileAsk(ctx, ext.installedBy, requester, {
      kind: 'extension-email-policy',
      // `digest` and `version` bind the code; they are left out of the fingerprint, so a second ask
      // about the same extension moves the standing question to the newest code (store.ts).
      target: { extension: ext.name, installer: ext.installedBy, version: ext.version, digest: actionCodeDigest(ext.actions) },
      title: `the extension ${ext.name} emailing any address`,
      name: ext.name,
      change: { field: EMAIL_POLICY_KEY, from: reason === 'code-changed' ? 'held back from new code' : (ext.config?.[EMAIL_POLICY_KEY] ?? null), to: UNRESTRICTED_EMAIL },
      approval: {
        approver: 'operators',
        asks: `let the extension ${ext.name} email any address`,
        why,
        // The answered notice says where an operator changes it later: the extensions page of administration.
        change: { link: '/v1/admin?tab=extensions', key: 'approval_change.extensions' },
        i18n: { key: reason === 'code-changed' ? 'approval_email_policy_code' : 'approval_email_policy', vars: { extension: ext.name, account: ext.installedBy } },
      },
    });
    if (filed.ok) return { approval_request: publishRequestedBody(ctx, filed) };
    return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: `The operators were not asked, so ${ext.name} emails only the addresses the normal rules allow: ${filed.message}` }] };
  } catch (err) {
    logger.warn('emailPolicy ask: the question could not be filed', { extension: ext.name, error: String(err) });
    return { warnings: [{ code: 'APPROVAL_NOT_ASKED', message: `The operators could not be asked, so ${ext.name} emails only the addresses the normal rules allow. Try again in a moment.` }] };
  }
}
