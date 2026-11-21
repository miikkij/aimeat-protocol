/**
 * @file test/unit/lint-close-and-host.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Two lint rules that replace pitfall entries. In src/, `req.on('close')` is refused,
 *   because on Express 5 the request's close fires when its body is read, before most handlers listen
 *   (formerly docs/pitfalls.md §61). In test/, aimeat/no-fetch-host-header refuses a Host header in a fetch,
 *   which undici drops without a word (formerly §19's first bullet). The first is read through the project's own
 *   eslint.config.js, so the test fails if the selector leaves the config.
 * @usage cd aimeat && pnpm exec vitest run test/unit/lint-close-and-host.test.ts
 * @version-history
 *   v1.0.0 -- 2026-11-21 -- Initial.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ESLint, RuleTester } from 'eslint';
import { noFetchHostHeader } from '../../eslint-rules/no-fetch-host-header.js';

const AIMEAT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The no-restricted-syntax messages the project's config gives this text as a file under src/routes/. */
async function closeFindings(code: string): Promise<string[]> {
    const eslint = new ESLint({ cwd: AIMEAT, cache: false });
    const [result] = await eslint.lintText(code, { filePath: join(AIMEAT, 'src', 'routes', 'lint-probe.ts') });
    return result!.messages.filter(m => m.ruleId === 'no-restricted-syntax').map(m => m.message);
}

describe("src/: the request's close is refused, the response's is not", () => {
    it('refuses req.on, req.once and request.on with close or aborted', async () => {
        const found = await closeFindings([
            "export function h(req: any, res: any, c: AbortController): void {",
            "  req.on('close', () => c.abort());",
            "  req.once('close', () => c.abort());",
            "  request.on('aborted', () => c.abort());",
            "  void res;",
            "}",
            "declare const request: any;",
        ].join('\n'));
        expect(found).toHaveLength(3);
        expect(found[0]).toMatch(/Listen on the response/);
    }, 30_000);

    it("accepts res.on('close'), a socket's close and a request's other events", async () => {
        const found = await closeFindings([
            "export function h(req: any, res: any, socket: any, c: AbortController): void {",
            "  res.on('close', () => { if (!res.writableEnded) c.abort(); });",
            "  socket.once('close', () => c.abort());",
            "  req.on('data', () => undefined);",
            "}",
        ].join('\n'));
        expect(found).toEqual([]);
    }, 30_000);
});

describe('aimeat/no-fetch-host-header', () => {
    const ruleTester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });
    it('refuses Host in a fetch, a Request and a Headers literal, and passes everything else', () => {
        ruleTester.run('no-fetch-host-header', noFetchHostHeader as never, {
            valid: [
                { code: "await fetch(url, { headers: { Authorization: 'x' } });" },
                // A body field named host is data, not a header.
                { code: "await fetch(url, { method: 'POST', body: JSON.stringify({ host: 'a.example' }) });" },
                // node:http sends Host as written, which is what host-request.ts uses.
                { code: "request({ host: '127.0.0.1', headers: { Host: 'a.example' } });" },
                { code: 'await fetch(url, { headers });' },
            ],
            invalid: [
                { code: "await fetch(url, { headers: { Host: 'co.example' } });", errors: [{ messageId: 'host' }] },
                { code: "await globalThis.fetch(url, { headers: { 'host': 'co.example', a: 'b' } });", errors: [{ messageId: 'host' }] },
                { code: "new Request(url, { headers: { HOST: 'x' } });", errors: [{ messageId: 'host' }] },
                { code: "new Headers({ Host: 'x' });", errors: [{ messageId: 'host' }] },
            ],
        });
        expect(true).toBe(true);
    });
});
