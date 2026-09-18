/**
 * @file app-visitors.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The agent-facing half of "who opened my app": read the visitor report for one of the
 *   owner's own apps, and switch its measurement on or off.
 *
 *   Exists because the capability is not finished while it is only a section in the App Catalog. An
 *   owner working through their own AI asks "did anyone open the shop this month, and was it people
 *   or ChatGPT", and the answer has to come back in the chat.
 *
 *   Does not do the work itself: both tools call services/app-visitors.ts, the same two functions
 *   GET /v1/apps/visitors and PUT /v1/apps/visitors/measurement call.
 *
 *   THE APP IS NAMED BY FILENAME, NEVER BY OWNER. An agent acts in one account, so the owner half
 *   of the app id is taken from the caller's own identity here and is not a parameter. That is the
 *   ownership check the REST door makes by comparing, made here by construction: there is no way to
 *   spell another owner's app on this tool.
 *
 * @structure registerAppVisitorsTools(mcp, storage, config, getAgentGaii)
 * @usage import { registerAppVisitorsTools } from './app-visitors.js';
 * @version-history
 *   v1.0.0 — 2026-09-18 — Initial: aimeat_app_visitors, aimeat_app_visitors_measure.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { ownerGhiiOf } from '../utils/gaii.js';
import { emitChange } from '../services/event-bus.js';
import { SIGNAL_GEO_LEVELS } from '../models/signal-schemas.js';
import {
  AppVisitorsError, clampDays, readAppVisitors, setAppMeasurement,
} from '../services/app-visitors.js';

type ToolAnswer = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const answer = (data: unknown): ToolAnswer => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

function refusal(e: unknown): ToolAnswer {
  if (e instanceof AppVisitorsError) return { content: [{ type: 'text', text: `${e.code}: ${e.message}` }], isError: true };
  throw e;
}

export function registerAppVisitorsTools(
  mcp: McpServer,
  storage: Storage,
  config: AimeatConfig,
  getAgentGaii: () => string,
): void {
  /** The caller's own account, as the bare owner name an app id starts with. */
  const ownerName = (): string => ownerGhiiOf(getAgentGaii()).split('@')[0];

  mcp.tool(
    'aimeat_app_visitors',
    descriptionFor('aimeat_app_visitors'),
    {
      filename: z.string().describe('One of your own apps, with its extension (e.g. "shop.html").'),
      days: z.number().int().min(0).max(360).optional().describe('The trailing window in days, 0 to 360. 0 is today only. Default 30.'),
    },
    annotationsFor('aimeat_app_visitors'),
    async (args: { filename: string; days?: number }) => {
      try {
        return answer(await readAppVisitors(storage, {
          app: { owner: ownerName(), filename: args.filename },
          days: clampDays(args.days),
          geoAvailable: config.geoHeaders, geoAttribution: config.geoAttribution,
        }));
      } catch (e) {
        return refusal(e);
      }
    },
  );

  mcp.tool(
    'aimeat_app_visitors_measure',
    descriptionFor('aimeat_app_visitors_measure'),
    {
      filename: z.string().describe('One of your own apps, with its extension (e.g. "shop.html").'),
      on: z.boolean().describe('true starts counting who opens the app (people, named AIs, other bots); false stops and keeps what was counted.'),
      geo: z.enum(SIGNAL_GEO_LEVELS).optional().describe('How precisely a person\'s place is kept: off, country, region or city. Omit to keep what it was.'),
    },
    annotationsFor('aimeat_app_visitors_measure'),
    async (args: { filename: string; on: boolean; geo?: string }) => {
      try {
        const out = await setAppMeasurement(storage, {
          app: { owner: ownerName(), filename: args.filename }, on: args.on, geo: args.geo,
        });
        // The same announcement the REST door makes, so an open App Catalog hears an agent's switch.
        emitChange('signals', ownerGhiiOf(getAgentGaii()));
        return answer({ app: `${ownerName()}/${args.filename}`, ...out, geo_available: config.geoHeaders });
      } catch (e) {
        return refusal(e);
      }
    },
  );
}
