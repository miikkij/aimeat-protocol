/**
 * @file src/tool-dispatch/tool-call-defs-file-store.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The tools of where stored files keep their bytes, for the shell / local-call dispatch and
 *   the connector MCP: thin proxies over the REST routes in routes/file-store.ts, which decide who may
 *   do what. test/unit/cli-tool-param-forwarding.test.ts invokes every handler.
 * @structure fileStoreCliTools[]
 * @usage import { fileStoreCliTools } from './tool-call-defs-file-store.js';
 * @version-history
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { ConnectCliToolDefinition } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber } from './tool-call-helpers.js';

const enc = encodeURIComponent;

/** The optional string fields of a connect call, passed on only when given. */
const SET_FIELDS = ['endpoint', 'region', 'bucket', 'addressing', 'access_key_id', 'secret_access_key', 'account', 'container', 'credential', 'prefix', 'reason'] as const;

export const fileStoreCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/file-store
    name: 'aimeat_file_store_get',
    handler: ({ client }) => client.get('/v1/file-store'),
  },
  {
    // → PUT /v1/file-store
    name: 'aimeat_file_store_set',
    handler: ({ client }, input) => {
      const body: Record<string, string> = { kind: requiredString(input, 'kind') };
      for (const f of SET_FIELDS) {
        const v = optionalString(input, f);
        if (v !== undefined) body[f] = v;
      }
      return client.put('/v1/file-store', body);
    },
  },
  {
    // → DELETE /v1/file-store
    name: 'aimeat_file_store_remove',
    handler: ({ client }) => client.delete('/v1/file-store'),
  },
  {
    // → POST /v1/file-store/move
    name: 'aimeat_file_store_move',
    handler: ({ client }, input) => {
      const limit = optionalNumber(input, 'limit');
      return client.post('/v1/file-store/move', { direction: requiredString(input, 'direction'), ...(limit !== undefined ? { limit } : {}) });
    },
  },
  {
    // → GET /v1/admin/file-store
    name: 'aimeat_admin_file_store',
    handler: ({ client }) => client.get('/v1/admin/file-store'),
  },
  {
    // → POST /v1/admin/file-store/test
    name: 'aimeat_admin_file_store_test',
    handler: ({ client }) => client.post('/v1/admin/file-store/test', {}),
  },
  {
    // → POST /v1/admin/file-store/move
    name: 'aimeat_admin_file_store_move',
    handler: ({ client }, input) => {
      const limit = optionalNumber(input, 'limit');
      const after = optionalString(input, 'after');
      return client.post('/v1/admin/file-store/move', { ...(limit !== undefined ? { limit } : {}), ...(after ? { after } : {}) });
    },
  },
  {
    // → POST /v1/admin/file-store/owners/:owner/decision
    name: 'aimeat_admin_file_store_decide',
    handler: ({ client }, input) => {
      const note = optionalString(input, 'note');
      return client.post(`/v1/admin/file-store/owners/${enc(requiredString(input, 'owner'))}/decision`, {
        decision: requiredString(input, 'decision'), ...(note ? { note } : {}),
      });
    },
  },
];
