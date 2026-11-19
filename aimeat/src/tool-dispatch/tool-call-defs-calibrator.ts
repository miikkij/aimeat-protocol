/**
 * @file src/tool-dispatch/tool-call-defs-calibrator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_calibrator for the shell / local-call dispatch and the connector MCP, one action
 *   per /v1/calibrator route (routes/calibrator.ts). The input is checked against the catalog's action
 *   table first (definitions/calibrator.ts checkCalibratorInput); the route decides who may and
 *   checks the body; this file only forwards.
 * @structure calibratorCliTools[]
 * @usage import { calibratorCliTools } from './tool-call-defs-calibrator.js';
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial.
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { checkCalibratorInput, calibratorBody } from '../tool-catalog/definitions/calibrator.js';

const enc = encodeURIComponent;

export const calibratorCliTools: ConnectCliToolDefinition[] = [
    {
        // → /v1/calibrator, /v1/calibrator/templates, /v1/calibrator/{id}[/detail|/versions[/{v}]|/batches[/{batchId}]]
        name: 'aimeat_calibrator',
        handler: ({ client }, input) => {
            const given = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
            const checked = checkCalibratorInput(given);
            if (!checked.ok) throw new Error(`INVALID_INPUT: ${checked.message}`);
            const action = checked.action;
            const body = calibratorBody(action, given) as JsonObject;
            if (action === 'templates') return client.get('/v1/calibrator/templates');
            if (action === 'list') return client.get('/v1/calibrator');
            if (action === 'create') return client.post('/v1/calibrator', body);
            const project = `/v1/calibrator/${enc(String(given.project_id))}`;
            const batch = `${project}/batches/${enc(String(given.batch_id ?? ''))}`;
            switch (action) {
                case 'get': return client.get(project);
                case 'detail': return client.get(`${project}/detail`);
                case 'update': return client.put(project, body);
                case 'delete': return client.delete(project);
                case 'versions': return client.get(`${project}/versions`);
                case 'version': return client.get(`${project}/versions/${enc(String(given.version))}`);
                case 'version_create': return client.post(`${project}/versions`, body);
                case 'batches': return client.get(`${project}/batches${given.version !== undefined ? `?version=${enc(String(given.version))}` : ''}`);
                case 'batch': return client.get(batch);
                case 'batch_create': return client.post(`${project}/batches`, body);
                case 'batch_update': return client.put(batch, body);
                case 'batch_delete': return client.delete(batch);
                default: throw new Error(`INVALID_INPUT: unknown action "${action}"`);
            }
        },
    },
];
