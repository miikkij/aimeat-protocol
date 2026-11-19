/**
 * @file src/tool-dispatch/tool-call-defs-living.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description aimeat_living_author for the shell / local-call dispatch and the connector MCP, over
 *   POST /v1/living/author (routes/living.ts). The route decides who may and who pays; this file
 *   only forwards.
 * @structure livingCliTools[]
 * @usage import { livingCliTools } from './tool-call-defs-living.js';
 * @version-history
 *   v1.0.0 -- 2026-11-19 -- Initial.
 */
import type { ConnectCliToolDefinition, JsonObject } from './tool-call-helpers.js';
import { requiredString, optionalArray } from './tool-call-helpers.js';

export const livingCliTools: ConnectCliToolDefinition[] = [
    {
        // → POST /v1/living/author
        name: 'aimeat_living_author',
        handler: ({ client }, input) => {
            const body: JsonObject = { need: requiredString(input, 'need') };
            const catalogue = optionalArray(input, 'catalogue');
            if (catalogue !== undefined) body.catalogue = catalogue;
            return client.post('/v1/living/author', body);
        },
    },
];
