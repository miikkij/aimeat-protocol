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
 *   v1.1.0 — 2026-10-30 — Named stores: name and make_default on set, name on remove, to and from on
 *     move; aimeat_admin_file_store_set and aimeat_admin_file_store_remove; a test by name and a move
 *     with from and to (wish-useampi-tiedostos-il-yksi-oletus-ja-tallentaja-voi-valita-s-).
 *   v1.0.0 — 2026-10-29 — Initial (wish-tiedostot-azure-blob-storageen-tai-aws-s3-een-noden-yhteinen).
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalString, optionalNumber, optionalBoolean } from './tool-call-helpers.js';

const enc = encodeURIComponent;

/** The address and key fields of a store, passed on only when given. */
const STORE_FIELDS = ['kind', 'endpoint', 'region', 'bucket', 'addressing', 'access_key_id', 'secret_access_key', 'account', 'container', 'credential', 'prefix'] as const;

/** The given string and boolean fields of `input`, by name. */
function pick(input: Record<string, unknown>, strings: readonly string[], booleans: readonly string[] = [], numbers: readonly string[] = []): JsonObject {
  const body: JsonObject = {};
  for (const f of strings) { const v = optionalString(input, f); if (v !== undefined) body[f] = v; }
  for (const f of booleans) { const v = optionalBoolean(input, f); if (v !== undefined) body[f] = v; }
  for (const f of numbers) { const v = optionalNumber(input, f); if (v !== undefined) body[f] = v; }
  return body;
}

export const fileStoreCliTools: ConnectCliToolDefinition[] = [
  {
    // → GET /v1/file-store
    name: 'aimeat_file_store_get',
    handler: ({ client }) => client.get('/v1/file-store'),
  },
  {
    // → PUT /v1/file-store
    name: 'aimeat_file_store_set',
    handler: ({ client }, input) => client.put('/v1/file-store', pick(input, [...STORE_FIELDS, 'name', 'reason'], ['make_default'])),
  },
  {
    // → DELETE /v1/file-store?name=
    name: 'aimeat_file_store_remove',
    handler: ({ client }, input) => {
      const name = optionalString(input, 'name');
      return client.delete(`/v1/file-store${name ? `?name=${enc(name)}` : ''}`);
    },
  },
  {
    // → POST /v1/file-store/move
    name: 'aimeat_file_store_move',
    handler: ({ client }, input) => client.post('/v1/file-store/move', pick(input, ['to', 'from', 'direction'], [], ['limit'])),
  },
  {
    // → GET /v1/admin/file-store
    name: 'aimeat_admin_file_store',
    handler: ({ client }) => client.get('/v1/admin/file-store'),
  },
  {
    // → PUT /v1/admin/file-store/stores/:name
    name: 'aimeat_admin_file_store_set',
    handler: ({ client }, input) => client.put(`/v1/admin/file-store/stores/${enc(requiredString(input, 'name'))}`,
      pick(input, STORE_FIELDS, ['selectable', 'make_default'])),
  },
  {
    // → DELETE /v1/admin/file-store/stores/:name
    name: 'aimeat_admin_file_store_remove',
    handler: ({ client }, input) => client.delete(`/v1/admin/file-store/stores/${enc(requiredString(input, 'name'))}`),
  },
  {
    // → POST /v1/admin/file-store/test
    name: 'aimeat_admin_file_store_test',
    handler: ({ client }, input) => client.post('/v1/admin/file-store/test', pick(input, ['name'])),
  },
  {
    // → POST /v1/admin/file-store/move
    name: 'aimeat_admin_file_store_move',
    handler: ({ client }, input) => client.post('/v1/admin/file-store/move', pick(input, ['after', 'from', 'to'], [], ['limit'])),
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
