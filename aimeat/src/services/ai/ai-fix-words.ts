/**
 * @file ai-fix-words.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What a person reads when their AI is off, and where it takes them. Every AI refusal
 *   and every capability that is off carries three things: `fix`, one sentence for the person in
 *   their language with no tool or field names in it; `agentFix`, the same fix written for an AI
 *   that can act on it (tool names, parameters); and `settingsUrl`, the address of the AI settings
 *   page opened at the provider to fix, with its test chosen when a test is the fix.
 *
 *   Why: an app showed a person "The owner's rules use only tested providers. Test one:
 *   aimeat_ai_provider_test { provider, capability: "text" }", because the SDK's docs said `fix` is
 *   the sentence an app shows the person and the node wrote it for an AI. Jouni, 2026-10-02: the test
 *   is right, but nothing led the person to the place where they press it.
 *
 *   The language: the language the person chose in the interface (the aimeat-lang cookie), then the
 *   one saved on their account, then their browser's, then English.
 * @structure CapabilityReason · reasonOf · agentFixFor · aiSettingsUrl · personLocale · personFixFor ·
 *   withPersonFix
 * @version-history
 *   v1.0.0 — 2026-10-02 — Initial: reasonOf and the AI-facing fix moved here from capabilities.ts; the
 *     person's sentence, the settings link and the refusal decorator added.
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import { createT, LOCALES, type Locale } from '../../i18n.js';
import { displayPrefsFor } from '../display-prefs.js';
import { AiCompletionError } from './errors.js';
import type { AiCapability } from './types.js';

export type CapabilityReason =
  | 'NO_MODEL' | 'NO_PROVIDER_SUPPORTS' | 'NO_KEY' | 'POLICY_EMPTY' | 'BUDGET_EXHAUSTED' | 'RETIRED_MODEL'
  | 'UNTESTED' | 'APP_NOT_ALLOWED' | 'UNAVAILABLE';

const KEY_CODES = new Set(['NO_API_KEY', 'NODE_KEY_HOST', 'ENCRYPTION_NOT_CONFIGURED']);
const MODEL_CODES = new Set(['NO_IMAGE_MODEL', 'NO_STT_MODEL', 'NO_TTS_MODEL', 'NO_EMBED_MODEL']);
const BUDGET_CODES = new Set(['QUOTA_EXHAUSTED', 'APP_QUOTA_EXHAUSTED', 'AGENT_QUOTA_EXHAUSTED']);

/** The reason a refusal stands for. */
export function reasonOf(e: AiCompletionError): CapabilityReason {
  if (MODEL_CODES.has(e.code)) return 'NO_MODEL';
  if (KEY_CODES.has(e.code)) return 'NO_KEY';
  if (BUDGET_CODES.has(e.code)) return 'BUDGET_EXHAUSTED';
  if (e.code === 'AI_MODEL_POLICY_EMPTY' || e.code === 'AI_MODEL_NOT_ALLOWED') return 'POLICY_EMPTY';
  if (e.code === 'APP_NOT_ALLOWED' || e.code === 'APP_ID_REQUIRED') return 'APP_NOT_ALLOWED';
  if (e.code === 'AI_PROVIDER_TYPE_NOT_ALLOWED') return 'NO_PROVIDER_SUPPORTS';
  if (e.code === 'AI_CAPABILITY_UNAVAILABLE') {
    const reasons = rejectedOf(e).map(r => r.reason);
    if (reasons.length === 0 || reasons.every(r => r === 'capability-off' || r === 'type-not-allowed' || r === 'requires-local')) return 'NO_PROVIDER_SUPPORTS';
    if (reasons.includes('no-model')) return 'NO_MODEL';
    if (reasons.includes('no-key')) return 'NO_KEY';
    if (reasons.includes('policy')) return 'POLICY_EMPTY';
    if (reasons.includes('untested')) return 'UNTESTED';
  }
  return 'UNAVAILABLE';
}

interface Rejected { provider: string; title?: string; reason: string }
function rejectedOf(e: AiCompletionError): Rejected[] {
  const r = (e.details as { rejected?: unknown } | undefined)?.rejected;
  return Array.isArray(r) ? r.filter((x): x is Rejected => !!x && typeof x === 'object' && typeof (x as Rejected).provider === 'string') : [];
}

/** The fix written for an AI that can act on it, or pass it to the owner. */
export function agentFixFor(reason: CapabilityReason, cap: AiCapability, providersThatCan: string[]): string {
  switch (reason) {
    case 'NO_MODEL': return `Set a model for ${cap} on one of the owner's AI providers (the owner does it on the AI settings page), or ask the operator for a node default.`;
    case 'NO_PROVIDER_SUPPORTS': return `None of the owner's providers serves ${cap}. The owner adds a provider of type ${providersThatCan.join(', ') || '(none allowed on this node)'} on the AI settings page and turns ${cap} on.`;
    case 'NO_KEY': return 'The provider has no key. The owner sets it on the AI settings page; never ask for a key in chat.';
    case 'POLICY_EMPTY': return `The owner's model policy allows no model for ${cap} here. Propose a change with aimeat_ai_policy_set; the owner confirms it.`;
    case 'BUDGET_EXHAUSTED': return 'Today\'s AI budget is spent. The owner raises it in Settings, or it resets at midnight UTC.';
    case 'RETIRED_MODEL': return `The model is retired. Find another with aimeat_ai_models { capability: "${cap}" } and propose it to the owner.`;
    case 'UNTESTED': return `The owner's rules use only tested providers. Offer to test it: with the owner's yes, aimeat_ai_provider_test { provider, capability: "${cap}" } (a text test costs a fraction of a cent). Or give the owner settingsUrl, which opens the provider with its test.`;
    case 'APP_NOT_ALLOWED': return 'The owner allows AI only for listed apps. The owner adds this app to the list in Settings.';
    default: return 'Read aimeat_ai_providers for why each provider is left out.';
  }
}

/**
 * The AI settings page, opened at one provider with its test chosen (`open=ai-provider-<id>`,
 * `test=<capability>`), or at the providers section. Absolute, so an app on its own subdomain can
 * link to it.
 */
export function aiSettingsUrl(config: AimeatConfig, target?: { provider?: string; capability?: AiCapability }): string {
  const q = new URLSearchParams({ tab: 'ai', open: target?.provider ? `ai-provider-${target.provider}` : 'ai-providers' });
  if (target?.provider && target.capability) q.set('test', target.capability);
  return `${config.baseUrl}/v1/profile?${q.toString()}`;
}

/** What the request says about the person's language: the interface's choice, or the browser's. */
export interface RequestLanguage { chosen?: string; browser?: string }

/** The person's language: the interface's choice, their account's, their browser's, then English. */
export async function personLocale(storage: Storage, gaii: string, lang?: RequestLanguage): Promise<Locale> {
  const known = (v: unknown): Locale | undefined => {
    const tag = typeof v === 'string' ? v.slice(0, 2).toLowerCase() : '';
    return (LOCALES as readonly string[]).includes(tag) ? tag as Locale : undefined;
  };
  return known(lang?.chosen) ?? known((await displayPrefsFor(storage, gaii)).locale) ?? known(lang?.browser) ?? 'en';
}

/**
 * The sentences a person reads, in their language: what is off (`aipage.off.<reason>`), then what to
 * do (`aipage.offDo.<reason>`). The AI page shows the first alone beside its own button, since the
 * person is already where the second sends them. The SPA's keys use single braces.
 */
export function personFixFor(locale: Locale, reason: CapabilityReason, cap: AiCapability, provider?: string): string {
  const t = createT(locale);
  const vars: Record<string, string> = { cap: t(`aipage.cap.${cap}`), provider: provider ?? '' };
  const what = reason === 'UNTESTED' && !provider ? 'aipage.off.UNTESTED_ANY' : `aipage.off.${reason}`;
  return `${t(what)} ${t(`aipage.offDo.${reason}`)}`.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

/** The provider to test, when a test is the fix. */
export function untestedProviderOf(e: AiCompletionError): { id: string; title: string } | undefined {
  const r = rejectedOf(e).find(x => x.reason === 'untested');
  return r ? { id: r.provider, title: r.title ?? r.provider } : undefined;
}

/**
 * The refusal with the person's sentence, the AI's fix and the settings link in its details. The
 * message stays as it was, so a caller that matched on it sees no change.
 */
export async function withPersonFix(
  e: AiCompletionError, storage: Storage, config: AimeatConfig, gaii: string, cap: AiCapability, lang?: RequestLanguage,
): Promise<AiCompletionError> {
  const reason = reasonOf(e);
  const details = e.details ?? {};
  // A refusal the gate does not name a reason for (a bad request) has nothing to fix in settings.
  if (reason === 'UNAVAILABLE' && e.code !== 'AI_CAPABILITY_UNAVAILABLE') return e;
  const untested = reason === 'UNTESTED' ? untestedProviderOf(e) : undefined;
  const locale = await personLocale(storage, gaii, lang);
  e.details = {
    ...details,
    reason,
    fix: personFixFor(locale, reason, cap, untested?.title),
    agentFix: agentFixFor(reason, cap, []),
    settingsUrl: aiSettingsUrl(config, untested ? { provider: untested.id, capability: cap } : undefined),
    ...(untested ? { testProvider: { id: untested.id, title: untested.title, capability: cap } } : {}),
  };
  return e;
}
