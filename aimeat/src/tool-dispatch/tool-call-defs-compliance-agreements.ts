/**
 * @file tool-dispatch/tool-call-defs-compliance-agreements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_compliance_agreement on the CLI dispatch (`/local/call/<tool>`) and the connector
 *   MCP: a thin REST proxy over /v1/compliance/agreements/*, so the node decides everything (plan
 *   doc-mvmr4i2wdk0p, D1.5). Each action is one route; the action table below is the whole mapping.
 * @version-history
 *   2026-10-27 — confirm forwards uploaded_at (secaudit2026oct26).
 *   v1.0.0 — 2026-10-24 — Initial (plan doc-mvmr4i2wdk0p, D1.5).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalBoolean, optionalNumber, optionalRecord, query } from './tool-call-helpers.js';

const BASE = '/v1/compliance/agreements';

export const complianceAgreementCliTools: ConnectCliToolDefinition[] = [
  {
    // → the route of the action named (routes/compliance-agreements.ts)
    name: 'aimeat_compliance_agreement',
    handler: ({ client }, input) => {
      const action = requiredString(input, 'action');
      const at = () => `${BASE}/${encodeURIComponent(requiredString(input, 'id'))}`;
      const body = optionalRecord(input, 'input') ?? {};
      const reason = optionalString(input, 'reason');
      switch (action) {
        case 'list': return client.get(BASE);
        case 'mine': return client.get(`${BASE}/mine`);
        case 'gaps': return client.get(`${BASE}/gaps`);
        case 'get': return client.get(at());
        case 'document': return client.get(`${at()}/document${query({ format: 'json', version: optionalNumber(input, 'version') })}`);
        case 'create': return client.post(`${BASE}${query({ dry_run: optionalBoolean(input, 'dry_run') })}`, body);
        case 'update': return client.patch(at(), body);
        case 'new_version': return client.post(`${at()}/versions`, {});
        case 'send': { const message = optionalString(input, 'message'); return client.post(`${at()}/send`, message ? { message } : {}); }
        case 'notice': return client.post(`${at()}/notice`, {});
        case 'object': return client.post(`${at()}/object`, reason ? { reason } : {});
        case 'signed_copy': {
          const party = optionalString(input, 'party');
          return client.post(`${at()}/signed-copy`, { storage_key: requiredString(input, 'storage_key'), kind: requiredString(input, 'kind'), ...(party ? { party } : {}) });
        }
        case 'confirm': {
          const seen = optionalString(input, 'uploaded_at');
          return client.post(`${at()}/confirm`, { accept: optionalBoolean(input, 'accept') === true, ...(reason ? { reason } : {}), ...(seen ? { uploaded_at: seen } : {}) });
        }
        case 'end': { const choice = optionalString(input, 'choice'); return client.post(`${at()}/end`, { ...(choice ? { choice } : {}), ...(reason ? { reason } : {}) }); }
        case 'deletion_done': { const note = optionalString(input, 'note'); return client.post(`${at()}/deletion-done`, note ? { note } : {}); }
        case 'breach_notice': return client.post(`${BASE}/breach-notice`, body);
        default: throw new Error(`action is one of list, mine, get, gaps, document, create, update, new_version, send, notice, object, signed_copy, confirm, end, deletion_done, breach_notice.`);
      }
    },
  },
];
