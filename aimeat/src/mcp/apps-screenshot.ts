/**
 * @file apps-screenshot.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The MCP tool that lets an agent look at an app it published.
 *
 *   It exists because of something measured rather than assumed: given the draft tools and a node to
 *   publish to, a real agent built an app, shipped it, and then immediately reached for a shell to
 *   fetch the page and check what it had made. A hosted agent has no shell and no browser, so
 *   without this it finishes blind and reports success on the strength of a 200.
 *
 *   The tool returns a URL, never bytes. That is not a size decision: the screenshot route is
 *   unauthenticated, so the address is one a model provider can fetch for itself, and a URL is text
 *   — which matters because goose's code mode drops images and binary from tool results and would
 *   silently discard a picture handed back inline.
 * @structure
 *   - registerAppScreenshotTool() — registers aimeat_app_screenshot on an McpServer instance
 * @usage
 *   import { registerAppScreenshotTool } from './apps-screenshot.js';
 *   registerAppScreenshotTool(mcp, storage, config, () => agentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-16 — Initial.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { annotationsFor } from './annotations.js';
import { descriptionFor } from './catalog/shape.js';
import { resolveAppOwnerScope } from '../services/app-lifecycle.js';
import { captureAppScreenshot } from '../services/screenshot-capture.js';

export function registerAppScreenshotTool(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    mcp.tool(
        'aimeat_app_screenshot',
        descriptionFor('aimeat_app_screenshot'),
        {
            filename: z.string().describe('The published app to photograph (e.g. "pong.html").'),
        },
        annotationsFor('aimeat_app_screenshot'),
        async ({ filename }) => {
            const agentGaii = getAgentGaii();
            const scope = await resolveAppOwnerScope(storage, config, agentGaii);
            if (!scope) {
                return { content: [{ type: 'text' as const, text: 'Failed to parse agent GAII' }], isError: true };
            }

            // Deliberately no storage lookup here. "Is there an app to render, and which bucket does
            // its thumbnail belong in" is one decision, and it lives in the service both doors call.
            const out = await captureAppScreenshot(config, storage, { ownerName: scope.ownerName, filename });
            if (!out.ok) {
                return { content: [{ type: 'text' as const, text: `${out.code}: ${out.message}` }], isError: true };
            }

            const base = config.baseUrl.replace(/\/+$/, '');
            const url = `${base}/v1/apps/${encodeURIComponent(scope.ownerName)}/${encodeURIComponent(filename)}/screenshot`;
            return {
                content: [{
                    type: 'text' as const,
                    text: JSON.stringify({
                        filename,
                        captured: true,
                        size_bytes: out.sizeBytes,
                        screenshot_url: url,
                        note: 'The page was rendered at 1200x750 and the image stored. The URL needs no '
                            + 'authentication, so you can pass it straight to a vision model to look at what '
                            + 'you built. It also replaces whatever thumbnail the catalogue showed before.',
                    }, null, 2),
                }],
            };
        },
    );
}
