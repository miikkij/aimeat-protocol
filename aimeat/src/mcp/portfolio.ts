/**
 * @file src/mcp/portfolio.ts
 * @description `aimeat_portfolio_publish` — the person's own welcome page, written by their AI.
 *
 *   The moment this exists for: somebody says "make my welcome page better" in their chat, and the
 *   page changes. No copying, no pasting a blob back into a box. It is the first time the
 *   difference between a copy-prompt and a connected AI is something they can see rather than be
 *   told about, and until now there was no way for an agent to do it over MCP at all.
 *
 *   A separate tool from `aimeat_company_portfolio_publish` rather than a target parameter on it.
 *   The parameter version was considered and rejected: it would leave a tool whose name says
 *   `company` publishing a person's page, and renaming that tool breaks agents already connected.
 *   Two honest names cost less than one that lies. This is the exception the "no new MCP tools"
 *   rule allows, and this paragraph is the justification that rule requires.
 *
 *   Measured 2026-08-09 before writing this: an agent token already reaches the REST portfolio
 *   routes (`PUT /v1/portfolio/config` answered 200 and the owner read the change back). The gap
 *   was never permission, only that MCP had no door to it.
 * @structure registerPortfolioTools(mcp, storage, config, getAgentGaii)
 * @usage registerPortfolioTools(mcp, storage, config, getAgentGaii);
 * @version-history
 *   v1.0.0 — 2026-08-09 — Initial (P23).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { parseGAII } from '../utils/gaii.js';
import { descriptionFor } from './catalog/shape.js';
import { annotationsFor } from './annotations.js';
import { portfolioWriteGaii, writePortfolioHtml } from '../routes/portfolio.js';
import { emitChange } from '../services/event-bus.js';

type TextResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const out = (payload: unknown, isError = false): TextResult => ({
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
});

export function registerPortfolioTools(
    mcp: McpServer,
    storage: Storage,
    config: AimeatConfig,
    getAgentGaii: () => string,
): void {
    // The operator's kill switch, honoured here too. server-bootstrap/routes-loader.ts mounts
    // the whole portfolio router only when config.portfolioEnabled is true, so on a node with the
    // feature off there is no upload route at all. This tool registered regardless, so an agent
    // could still write portfolio/index.html as a PUBLIC storage file under the owner's namespace
    // and be handed a /p/{owner} address the node does not serve.
    if (!config.portfolioEnabled) return;

    mcp.tool(
        'aimeat_portfolio_publish',
        descriptionFor('aimeat_portfolio_publish'),
        {
            html: z.string().describe('The complete HTML document to serve as this person\'s welcome page. It replaces the current one.'),
        },
        annotationsFor('aimeat_portfolio_publish'),
        async ({ html }): Promise<TextResult> => {
            const parsed = parseGAII(getAgentGaii());
            const owner = parsed?.owner;
            if (!owner) {
                return out({ error: 'NO_OWNER', message: 'Could not resolve the owner from this session' }, true);
            }

            const maxBytes = (config.portfolioMaxSizeKb ?? 512) * 1024;
            const data = Buffer.from(html, 'utf8');
            if (data.length > maxBytes) {
                return out({
                    error: 'QUOTA_EXCEEDED',
                    message: `The page is ${Math.round(data.length / 1024)}KB and the limit is ${config.portfolioMaxSizeKb ?? 512}KB`,
                    size_kb: Math.round(data.length / 1024),
                }, true);
            }

            // Same target the REST route writes, so the page an agent publishes is the same file the
            // browser reads. Resolving it anywhere else is how two "welcome pages" come to exist.
            const target = await portfolioWriteGaii(storage, owner, config.nodeId);
            await writePortfolioHtml(storage, target, data);
            emitChange('portfolio');
            return out({
                published: true,
                size_kb: Math.round(data.length / 1024),
                url: `${config.baseUrl.replace(/\/+$/, '')}/p/${owner}`,
                note: 'Tell the person the address and let them look. A page they have not seen is not finished.',
            });
        },
    );
}
