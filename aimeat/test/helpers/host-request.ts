/**
 * @file host-request.ts
 * @description A test request that arrives with a chosen `Host` header, over node:http.
 *
 *   `fetch` silently drops `Host` — it is a forbidden header name in undici, so a test that passes
 *   one in a headers bag still reaches the server as `localhost:<port>` and nothing reports it.
 *   That matters since subdomain.ts v1.5.0: the origin-family markers (`X-App-Origin`,
 *   `X-Portfolio-Origin`, `X-Co-Origin`) are only honoured on a Host in that family, so a suite
 *   that wants to be on an app origin has to actually address one, the way a browser does and the
 *   way nginx forwards it (`proxy_set_header Host $host`).
 * @structure
 *   - HostRequestOptions / HostResponse — the request and what comes back
 *   - hostRequest(base, path, host, opts) — one request, body read to a string
 * @usage
 *   import { hostRequest } from './helpers/host-request.js';
 *   const res = await hostRequest(BASE, '/', `${SUB}.${APP_HOST}:${PORT}`, {
 *       headers: { 'x-app-origin': '1', 'x-subdomain': SUB },
 *   });
 *   res.status; res.header('content-security-policy'); res.json<{ resource: string }>();
 * @version-history
 *   v1.0.0 — 2026-08-11 — Initial. Extracted from the raw-socket helper in e2e-app-origin.ts when
 *     the Host check landed and three suites needed the same thing.
 */
import { request as httpRequest } from 'node:http';

export interface HostRequestOptions {
    method?: string;
    /** Extra request headers. `Host` comes from the `host` argument and wins over anything here. */
    headers?: Record<string, string>;
    /** Request body, sent as-is. Content-Length is set from it. */
    body?: string;
}

export interface HostResponse {
    status: number;
    /** Header names lowercased; repeated headers joined with ', '. */
    headers: Record<string, string>;
    /** Name/value pairs as they came off the wire, for size accounting. */
    rawHeaders: string[];
    body: string;
    /** One header, or null. */
    header(name: string): string | null;
    /** The body parsed as JSON. Throws with the status and a body excerpt when it is not JSON. */
    json<T = unknown>(): T;
}

/**
 * GET (or any method) `path` on the server behind `base`, addressed as `host`.
 *
 * `base` gives the address to connect to (`http://localhost:40262`); `host` is what goes in the
 * request line's Host header, port included when the server is not on 80 — the two differ on
 * purpose, which is the whole point of this helper. Redirects are never followed, so a 301/302 is
 * returned as itself.
 */
export function hostRequest(
    base: string,
    path: string,
    host: string,
    opts: HostRequestOptions = {},
): Promise<HostResponse> {
    const target = new URL(base);
    const headers: Record<string, string> = { ...(opts.headers ?? {}), host };
    if (opts.body !== undefined) headers['content-length'] = String(Buffer.byteLength(opts.body));

    return new Promise((resolve, reject) => {
        const req = httpRequest({
            host: target.hostname,
            port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)),
            path,
            method: opts.method ?? 'GET',
            headers,
        }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                const flat: Record<string, string> = {};
                for (const [name, value] of Object.entries(res.headers)) {
                    flat[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
                }
                const status = res.statusCode ?? 0;
                resolve({
                    status,
                    headers: flat,
                    rawHeaders: res.rawHeaders,
                    body: data,
                    header: (name: string) => flat[name.toLowerCase()] ?? null,
                    json: <T,>(): T => {
                        try { return JSON.parse(data) as T; }
                        catch (err) { throw new Error(`${status} is not JSON: ${data.slice(0, 200)} (${String(err)})`); }
                    },
                });
            });
        });
        req.on('error', reject);
        if (opts.body !== undefined) req.write(opts.body);
        req.end();
    });
}
