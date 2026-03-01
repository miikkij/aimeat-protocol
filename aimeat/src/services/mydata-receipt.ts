import type { AimeatConfig } from '../config.js';
import type { ConsentRecord } from '../storage/interface.js';

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

export interface MyDataReceiptService {
  generateReceipt(consent: ConsentRecord): MyDataConsentReceipt;
}

export function createMyDataReceiptService(config: AimeatConfig): MyDataReceiptService {
  return {
    generateReceipt(consent: ConsentRecord): MyDataConsentReceipt {
      // Extract PII categories from data pattern
      const piiCategories = consent.dataPattern.split('.').filter(s => s !== '*' && s !== '**');

      return {
        version: 'KI-CR-v1.1.0',
        jurisdiction: 'FI',
        consentTimestamp: consent.grantedAt,
        collectionMethod: 'web form',
        consentReceiptID: consent.id,
        language: 'fi',
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
