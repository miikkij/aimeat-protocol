/**
 * @file test/unit/prompts-build-app-agent-txt.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The two `?format=txt` answers of GET /v1/prompts/build-app/agent/:name. The text
 *   carries the caller's `idea` and the agent's name verbatim, because a person pastes it into their
 *   own chat, so the defence is the content type: `text/plain; charset=utf-8` with
 *   `X-Content-Type-Options: nosniff`, set by the route itself (sendPlainText) and not only by the
 *   node's global header middleware, which a request through this route alone does not pass.
 *   The body is the same text the JSON answer carries, byte for byte.
 *
 *   The route runs on a bare Express app: authentication passes through, and the agent section is a
 *   fixed stand-in, so what is asserted is the route's own answer.
 * @usage cd aimeat && pnpm exec vitest run test/unit/prompts-build-app-agent-txt.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-13 — Initial (code scanning alerts 1731 and 1732, js/reflected-xss).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const AGENT_TEXT = '## This app shows the work of one agent\n\nAgent: <b>writer</b>\n';

vi.mock('../../src/auth/middleware.js', () => ({
    requireAuth: () => (req: { auth?: unknown }, _res: unknown, next: () => void) => {
        req.auth = { sub: 'alice', owner: 'alice', roles: ['owner'], scopes: [] };
        next();
    },
    requireScope: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../src/services/classification/reader.js', () => ({ readerFor: () => ({}) }));
vi.mock('../../src/services/build-app-agent-context.js', () => ({
    buildAppAgentContext: async (_deps: unknown, _owner: string, name: string) => ({
        ok: true,
        text: AGENT_TEXT,
        agent: { name, display_name: name },
        has_result: true,
    }),
}));

import { loadConfig } from '../../src/config.js';
import type { Storage } from '../../src/storage/interface.js';
import { registerBuildAppAgentPrompt } from '../../src/routes/prompts-build-app-agent.js';

let server: http.Server;
let base = '';

beforeAll(async () => {
    const config = { ...loadConfig().config, nodeId: 'aimeat-txt-test', baseUrl: 'https://node.test' };
    const app = express();
    const router = express.Router();
    registerBuildAppAgentPrompt(router, config, {} as Storage);
    app.use(router);
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

const IDEA = '<script>alert(1)</script> show the newest summary';

describe('GET /v1/prompts/build-app/agent/:name?format=txt', () => {
    it('answers the whole prompt as plain text the browser may not reinterpret, the same text as the JSON prompt', async () => {
        const q = `idea=${encodeURIComponent(IDEA)}`;
        const asJson = await fetch(`${base}/v1/prompts/build-app/agent/writer?${q}`);
        const prompt = ((await asJson.json()) as { data: { prompt: string } }).data.prompt;
        const res = await fetch(`${base}/v1/prompts/build-app/agent/writer?${q}&format=txt`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        const body = await res.text();
        expect(body).toBe(prompt);
        expect(body.startsWith(AGENT_TEXT)).toBe(true);
    });

    it('answers the agent section alone (?part=context) the same way', async () => {
        const asJson = await fetch(`${base}/v1/prompts/build-app/agent/writer?part=context`);
        const content = ((await asJson.json()) as { data: { content: string } }).data.content;
        const res = await fetch(`${base}/v1/prompts/build-app/agent/writer?part=context&format=txt`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(await res.text()).toBe(content);
    });
});
