/**
 * @file src/services/compliance-derived.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What the node can say about the compliance documents from what it already holds, so
 *   a person reviews a filled draft instead of typing an empty form (plan doc-mvlftkh9zmc9, C1.3,
 *   C1.4, C1.6, C4.1, C4.2, C6). Nothing here is stored: a draft becomes a document when a person, or
 *   their AI, writes it back. Every answer the node reads from its own records is marked `evidence`.
 *
 *   - The node's own registers (C1.3): the accounts, the sign-in and security log, the consent
 *     ledger, the AI usage ledger. The node is their controller on every installation.
 *   - An app's register (C1.4, C1.6): read from the app's data map. A key family the map marks as
 *     personal data goes in; one marked `unstated` is named, because silence is not a considered no.
 *   - An organism's register (C1.4): its member list is a personal data register on every organism.
 *     Its workspaces are listed as containers for the person or their AI to sort into registers.
 *   - The processors (C4.1): the AI providers whose prompts leave this machine, the mail server and
 *     the hosting, from the configuration, merged with what the operator wrote about each.
 *   - The transfers (C4.2): every processor whose country is outside the EU and the EEA, or unknown.
 *   - The framework verdicts (C6): each framework's answers run through the AI Act's classifier.
 * @structure nodeRegistersDraft() · appRegisterDraft() · organismRegisterDraft() · derivedProcessors() ·
 *   processorsView() · transfersOf() · frameworkVerdicts() · EEA
 * @usage const draft = await appRegisterDraft(storage, 'alice', 'crm.html');
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C1.3, C1.4, C1.6, C4.1, C4.2, C6).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { nodeAiProviders } from './ai/providers.js';
import { readAppDataMap } from './data-map/data-map-store.js';
import { classifyUseCase, type ComplianceRiskVerdict } from './compliance-register.js';
import { COMPLIANCE_FRAMEWORKS } from '../data/compliance-frameworks.js';
import type { ComplianceFrameworkAnswers, ComplianceProcessor, ComplianceRegister } from './compliance-docs-schemas.js';

const EVIDENCE = 'evidence' as const;

/** EU and EEA member states, by ISO 3166 alpha-2 code and English name, lower case. */
export const EEA = new Set([
  'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr', 'de', 'gr', 'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl', 'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'is', 'li', 'no',
  'austria', 'belgium', 'bulgaria', 'croatia', 'cyprus', 'czechia', 'denmark', 'estonia', 'finland', 'france', 'germany', 'greece', 'hungary', 'ireland', 'italy', 'latvia', 'lithuania', 'luxembourg', 'malta', 'netherlands', 'poland', 'portugal', 'romania', 'slovakia', 'slovenia', 'spain', 'sweden', 'iceland', 'liechtenstein', 'norway', 'suomi',
]);

const src = (fields: string[]) => Object.fromEntries(fields.map(f => [f, EVIDENCE]));

/** C1.3: the registers every node keeps, as a draft. */
export function nodeRegistersDraft(config: Pick<AimeatConfig, 'operator' | 'consentAuditRetentionDays'>): ComplianceRegister[] {
  const controller = [config.operator?.name, config.operator?.email].filter(Boolean).join(', ') || undefined;
  const common = { role: 'controller' as const, controller, reviewEveryMonths: 12 };
  return [
    {
      id: 'node-accounts', title: 'User accounts', type: 'personal', purpose: 'service-operation', ...common,
      legalBasis: ['contract'], subjects: ['account holders'],
      dataCategories: ['account name', 'e-mail address', 'password hash', 'profile', 'sign-in methods'],
      retentionMonths: null, retentionText: 'Until the account is deleted; the person deletes it on their profile.',
      source: 'The person, at registration.',
      answerSources: src(['type', 'purpose', 'role', 'subjects', 'dataCategories', 'retentionText', 'source']),
    },
    {
      id: 'node-security-log', title: 'Sign-in and security log', type: 'personal', purpose: 'service-operation', ...common,
      legalBasis: ['legitimate-interests'], subjects: ['account holders', 'visitors who try to sign in'],
      dataCategories: ['account name', 'IP address', 'time', 'refused requests'],
      source: 'The node, when a request is made.',
      answerSources: src(['type', 'purpose', 'role', 'subjects', 'dataCategories', 'source']),
    },
    {
      id: 'node-consent', title: 'Consent ledger', type: 'personal', purpose: 'service-operation', ...common,
      legalBasis: ['legal-obligation'], subjects: ['account holders'],
      dataCategories: ['who granted what to whom', 'when', 'when revoked'],
      retentionMonths: config.consentAuditRetentionDays ? Math.ceil(config.consentAuditRetentionDays / 30) : null,
      source: 'The person, when they grant or revoke.',
      answerSources: src(['type', 'purpose', 'role', 'subjects', 'dataCategories', 'retentionMonths', 'source']),
    },
    {
      id: 'node-ai-usage', title: 'AI usage ledger', type: 'personal', purpose: 'service-operation', ...common,
      legalBasis: ['contract'], subjects: ['account holders', 'their agents'],
      dataCategories: ['who called which model', 'tokens', 'cost', 'time'],
      source: 'The node, on every AI call it carries.',
      answerSources: src(['type', 'purpose', 'role', 'subjects', 'dataCategories', 'source']),
    },
  ];
}

/**
 * C1.4, C1.6: an app's register from its data map. Null when the app has no map: nobody has said
 * what it keeps, which the report names as a gap.
 */
export async function appRegisterDraft(
  storage: Storage, ownerGhii: string, filename: string,
): Promise<{ register: ComplianceRegister | null; unstated: string[]; hasMap: boolean }> {
  const map = await readAppDataMap(storage, ownerGhii, filename.replace(/\.html$/i, ''));
  if (!map) return { register: null, unstated: [], hasMap: false };
  const personal = map.held.filter(r => r.personalData === 'yes');
  const unstated = map.held.filter(r => r.personalData === 'unstated').map(r => r.what);
  const keptForever = personal.some(r => r.keptFor === 'until-deleted' || r.keptFor === 'append-only');
  return {
    hasMap: true, unstated,
    register: personal.length ? {
      id: `app-${filename.replace(/\.html$/i, '').replace(/[^A-Za-z0-9_-]+/g, '-')}`,
      title: `${map.what.slice(0, 120) || filename}`, type: 'personal', role: 'controller',
      purposeText: map.usedFor.slice(0, 2000) || undefined,
      dataCategories: personal.map(r => `${r.what}: ${r.holds}`.slice(0, 300)),
      recipients: map.leaves.map(l => `${l.what} → ${l.to}`.slice(0, 300)),
      retentionText: keptForever ? 'Kept until deleted (data map).' : undefined,
      containers: [{ kind: 'app', app: filename }], reviewEveryMonths: 12,
      answerSources: src(['type', 'purposeText', 'dataCategories', 'recipients', 'retentionText', 'containers']),
    } : null,
  };
}

/** C1.4: an organism's member register, and its workspaces as containers to sort. */
export async function organismRegisterDraft(storage: Storage, organismId: string): Promise<ComplianceRegister[]> {
  const organism = await storage.getOrganism(organismId);
  if (!organism) return [];
  return [{
    id: 'org-members', title: `Members of ${organism.name}`.slice(0, 300), type: 'personal', purpose: 'member', role: 'controller',
    legalBasis: ['contract'], subjects: ['members', 'invited people'],
    dataCategories: ['account name', 'role', 'membership status', 'invitations'],
    retentionText: 'While the membership lasts, and until the organism is deleted.',
    containers: [{ kind: 'organism', organism_id: organismId }], reviewEveryMonths: 12,
    answerSources: src(['type', 'purpose', 'role', 'subjects', 'dataCategories', 'retentionText', 'containers']),
  }];
}

/** The host of a provider's base URL, or '' when it has none or it does not parse. */
function hostOf(baseUrl: string | undefined | null): string {
  if (!baseUrl || !URL.canParse(baseUrl)) return '';
  return new URL(baseUrl).host;
}

/** C4.1: the processors the configuration names. The operator adds the contract, country and basis. */
export function derivedProcessors(config: AimeatConfig): ComplianceProcessor[] {
  const out: ComplianceProcessor[] = [];
  for (const p of nodeAiProviders(config)) {
    if (!p.leaves) continue;
    const host = hostOf(p.baseUrl);
    out.push({ id: `ai-${p.id}`.replace(/[^A-Za-z0-9._-]+/g, '-'), name: p.title || p.id, service: 'ai', ...(host ? { host } : {}), answerSources: src(['name', 'service', 'host']) });
  }
  if (config.smtpHost) out.push({ id: 'email-smtp', name: config.smtpHost, service: 'email', host: config.smtpHost, answerSources: src(['name', 'service', 'host']) });
  const op = config.operator;
  if (op?.hostingName) {
    out.push({
      id: 'hosting', name: op.hostingName, service: 'hosting', ...(op.hostingLocation ? { country: op.hostingLocation } : {}),
      ...(op.hostingUrl ? { host: op.hostingUrl } : {}), answerSources: src(['name', 'service', 'country', 'host']),
    });
  }
  return out;
}

/** The processors as one list: the derived ones with what the operator wrote merged over, then the operator's own. */
export function processorsView(derived: ComplianceProcessor[], stored: ComplianceProcessor[]): Array<ComplianceProcessor & { derived: boolean }> {
  const byId = new Map(stored.map(p => [p.id, p]));
  const merged = derived.map(d => ({ ...d, ...(byId.get(d.id) ?? {}), derived: true }));
  const ids = new Set(derived.map(d => d.id));
  return [...merged, ...stored.filter(p => !ids.has(p.id)).map(p => ({ ...p, derived: false }))];
}

/** Is a country, as written, inside the EU or the EEA? Unknown when nothing is written. */
export function inEea(country: string | undefined): boolean | null {
  if (!country?.trim()) return null;
  return EEA.has(country.trim().toLowerCase());
}

/** C4.2: every processor outside the EU and the EEA, or whose country nobody wrote. */
export function transfersOf(processors: ComplianceProcessor[]): Array<{ processor: string; country: string | null; basis: string | null; known: boolean }> {
  return processors
    .filter(p => inEea(p.country) !== true)
    .map(p => ({ processor: p.id, country: p.country ?? null, basis: p.transferBasis ?? null, known: inEea(p.country) !== null }));
}

/** C6: each framework the scope answers, with its verdict and the obligations of that verdict. */
export function frameworkVerdicts(doc: ComplianceFrameworkAnswers, scope: 'node' | 'organism'): Array<{
  id: string; name: { fi: string; en: string; es: string }; laws: string[]; verdict: ComplianceRiskVerdict; obligations: string[];
}> {
  return COMPLIANCE_FRAMEWORKS.filter(f => f.scopes.includes(scope)).map(f => {
    const verdict = classifyUseCase({ id: f.id, title: f.name.en, answers: doc.answers?.[f.id] ?? {} }, f.questionnaire);
    return { id: f.id, name: f.name, laws: f.laws, verdict, obligations: f.obligations[verdict.class] ?? [] };
  });
}
