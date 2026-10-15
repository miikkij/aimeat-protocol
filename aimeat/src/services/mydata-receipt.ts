/**
 * @file src/services/mydata-receipt.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Generates Kantara/MyData-style consent receipts from AIMEAT consent records — mapping a
 *   ConsentRecord (owner, purpose, data pattern, expiry) into a structured MyDataConsentReceipt with
 *   PII principal/controller and purpose metadata (version KI-CR-v1.1.0).
 *
 *   WHERE THE THREE CONTEXT FIELDS COME FROM (feature-list audit #161). They were written as
 *   Finland, Finnish and "web form" for every node and every consent, also for a consent an agent
 *   gave through the API. Now:
 *     - jurisdiction: the node's `operator.country` setting, as an ISO 3166-1 alpha-2 code when it
 *       names a country ("Finland" → "FI"), as written otherwise, `unspecified` when it is empty;
 *     - language: the language of the person whose consent it is (their account's `locale`), else
 *       the node's default language;
 *     - collectionMethod: how the consent was given, stamped on the record when it was granted
 *       (consentCollectionMethod, metadata.collection_method). A record granted before the stamp
 *       existed says `not recorded`.
 *
 * @structure
 *   - MyDataConsentReceipt: the receipt shape (principal, controllers, services/purposes/PII categories)
 *   - consentCollectionMethod(surface, caller): the words stamped at grant
 *   - jurisdictionOf(country): the operator's country as a receipt jurisdiction
 *   - receiptLanguageFor(storage, consent): the consenting person's language
 *   - createMyDataReceiptService(config): returns { generateReceipt(consent, ctx?) }
 *
 * @version-history
 *   2026-10-15 — Jurisdiction from operator.country, language from the person's locale, collection
 *     method from how the consent was given, instead of FI / fi / "web form" for every consent
 *     (feature-list audit #161).
 *   v1.0.0 — 2026-07-13 — Header added; file pre-dates header standard
 */
import type { AimeatConfig } from '../config.js';
import type { ConsentRecord, Storage } from '../storage/interface.js';
import { DEFAULT_LOCALE } from '../i18n.js';
import type { CallerContext, CallerKind } from './caller-context.js';

export interface MyDataConsentReceipt {
  version: string;
  jurisdiction: string;
  consentTimestamp: string;
  collectionMethod: string;
  consentReceiptID: string;
  language: string;
  piiPrincipalId: string;
  piiControllers: Array<{ piiController: string; onBehalf: boolean }>;
  services: Array<{
    service: string;
    purposes: Array<{
      purpose: string;
      consentType: string;
      piiCategory: string[];
      termination: string;
    }>;
  }>;
}

/** What the receipt says when the record does not say how the consent was given. */
export const COLLECTION_METHOD_NOT_RECORDED = 'not recorded';

/** The metadata key grantConsent writes, and nothing a caller sends can set. */
export const COLLECTION_METHOD_KEY = 'collection_method';

/** Who was at a grant, by the caller's kind (services/caller-context.ts). */
const WHO: Record<CallerKind, string> = {
  ecosystem: 'an ecosystem app', app: 'an app', agent: 'an agent', owner: 'the person',
  visitor: 'a visitor from another node', anonymous: 'an anonymous caller',
};

/**
 * How a consent was given, in the words the receipt carries. `surface` is the interface the grant
 * came through; the caller's `kind` and `inPerson` say who was at it.
 */
export function consentCollectionMethod(surface: 'rest' | 'mcp', caller: Pick<CallerContext, 'kind' | 'inPerson'>): string {
  const who = caller.kind === 'owner' && !caller.inPerson ? 'a tool of the person' : WHO[caller.kind];
  if (surface === 'mcp') return `MCP tool call by ${who}`;
  // The person in their own browser session grants a consent on the profile page's form.
  if (who === 'the person') return 'web form';
  return `API call by ${who}`;
}

/** ISO 3166-1 alpha-2 code by English country name, built once from the runtime's region names. */
let regionByName: Map<string, string> | null = null;
function regionCodes(): Map<string, string> {
  if (regionByName) return regionByName;
  regionByName = new Map();
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b);
      const name = names.of(code);
      if (name && name !== code) regionByName.set(name.toLowerCase(), code);
    }
  }
  return regionByName;
}

/** The operator's country as the receipt's jurisdiction: a code when it names a country. */
export function jurisdictionOf(country: string | undefined): string {
  const c = (country ?? '').trim();
  if (!c) return 'unspecified';
  if (/^[A-Za-z]{2}$/.test(c)) return c.toUpperCase();
  return regionCodes().get(c.toLowerCase()) ?? c;
}

/**
 * The language of the person whose consent it is: their account's locale. A consent held under an
 * agent belongs to the agent's owner. Undefined when no locale is set.
 */
export async function receiptLanguageFor(storage: Storage, consent: ConsentRecord): Promise<string | undefined> {
  const holder = consent.ownerGaii;
  if (holder.includes('#')) {
    const agent = await storage.getAgent(holder);
    return agent ? (await storage.getGHIIByOwner(agent.owner))?.locale : undefined;
  }
  return (await storage.getGHII(holder))?.locale;
}

export interface MyDataReceiptService {
  generateReceipt(consent: ConsentRecord, ctx?: { language?: string }): MyDataConsentReceipt;
}

export function createMyDataReceiptService(config: AimeatConfig): MyDataReceiptService {
  return {
    generateReceipt(consent: ConsentRecord, ctx?: { language?: string }): MyDataConsentReceipt {
      // Extract PII categories from data pattern
      const piiCategories = consent.dataPattern.split('.').filter(s => s !== '*' && s !== '**');
      const stamped = consent.metadata?.[COLLECTION_METHOD_KEY];

      return {
        version: 'KI-CR-v1.1.0',
        // Read at each receipt: the operator can change the setting while the node runs.
        jurisdiction: jurisdictionOf(config.operator?.country),
        consentTimestamp: consent.grantedAt,
        collectionMethod: typeof stamped === 'string' && stamped ? stamped : COLLECTION_METHOD_NOT_RECORDED,
        consentReceiptID: consent.id,
        language: ctx?.language || DEFAULT_LOCALE,
        piiPrincipalId: consent.ownerGaii,
        piiControllers: [{
          piiController: config.nodeId,
          onBehalf: false,
        }],
        services: [{
          service: `AIMEAT ${consent.purpose}`,
          purposes: [{
            purpose: consent.purpose,
            consentType: 'EXPLICIT',
            piiCategory: piiCategories.length > 0 ? piiCategories : ['general'],
            termination: consent.expires ? 'expiry' : 'revocation',
          }],
        }],
      };
    },
  };
}
