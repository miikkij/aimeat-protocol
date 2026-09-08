/**
 * @file test/helpers/fake-push.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A real push service for tests: an HTTPS receiver on loopback that answers 201, 410
 *   or 500 by path, and records every request the node made to it.
 *
 *   WHY IT HAS TO BE HTTPS. `web-push` builds its request with `https.request` unconditionally
 *   (node_modules/web-push/src/web-push-lib.js), so a plain HTTP sink is answered with an EPROTO
 *   handshake error and the node's own code never sees a status at all. The three branches worth
 *   proving in services/push.ts are chosen BY STATUS -- 404/410 prunes that one endpoint, anything
 *   else warns and keeps it -- so the receiver has to speak TLS or the test proves nothing.
 *
 *   WHY THE CERTIFICATE IS BUILT HERE. There is no certificate in this repository and no
 *   dependency that makes one, and spawning `openssl` would make the suite depend on a binary that
 *   is on the PATH of some machines and not others. So the DER is assembled from Node's own crypto:
 *   a P-256 key pair, an X.509 v3 body carrying `subjectAltName = IP:127.0.0.1` and
 *   `basicConstraints CA:TRUE`, signed with ecdsa-with-SHA256. The caller points the node at it
 *   with NODE_TLS_REJECT_UNAUTHORIZED=0, which is the honest description of a throwaway loopback
 *   sink: the test is about what the node SENT, never about who it trusted.
 *
 *   WHAT IT RECORDS. The body is encrypted (aes128gcm, the browser's own envelope) and no test can
 *   read it, so what is worth asserting is the request around it: the path, the TTL header, the
 *   Content-Encoding, the VAPID Authorization and the byte count. Those are what say the node
 *   signed and encrypted a real web-push message rather than posting a JSON blob at a URL.
 * @structure
 *   - selfSignedLoopbackCert(): { key, cert } -- the PEM pair, built from DER in this file
 *   - startFakePushReceiver(opts) -> FakePushReceiver: listen, collect, waitForHit, clear, close
 *   - PushHit: one recorded request
 * @usage
 *   const rx = await startFakePushReceiver();
 *   const endpoint = rx.endpoint('/dev-ok');       // 201
 *   const dead = rx.endpoint('/gone/dev-b');       // 410, prunes the subscription
 *   const sick = rx.endpoint('/boom/dev-c');       // 500, warns and keeps it
 *   await rx.waitForHit('/dev-ok');
 *   await rx.close();
 * @version-history
 *   v1.0.0 -- 2026-09-08 -- Initial, for test/e2e-mailbox-push.ts.
 */
import { createServer, type Server } from 'node:https';
import { generateKeyPairSync, randomBytes, sign as cryptoSign } from 'node:crypto';

/** One request the node made to the receiver. The body is encrypted, so only its size is kept. */
export interface PushHit {
    /** Request path, exactly as the node addressed it. */
    path: string;
    method: string;
    /** TTL header, which web-push sets from the caller's `{ TTL: n }` option. */
    ttl: string | undefined;
    /** `aes128gcm` (or `aesgcm` on an older library): proof the payload was really encrypted. */
    contentEncoding: string | undefined;
    /** The VAPID Authorization header, truncated: proof the node signed with its own key pair. */
    authorization: string;
    bytes: number;
    at: string;
}

export interface FakePushReceiver {
    port: number;
    /** `https://127.0.0.1:<port>`. */
    origin: string;
    /** Every request received, oldest first. */
    hits: PushHit[];
    /** A subscription endpoint on this receiver. A path under /gone answers 410, under /boom 500. */
    endpoint(path: string): string;
    hitsFor(path: string): PushHit[];
    waitForHit(path: string, timeoutMs?: number): Promise<PushHit>;
    clear(): void;
    close(): Promise<void>;
}

export interface FakePushOptions {
    /** 0 (the default) takes an ephemeral port, which is what a suite wants. */
    port?: number;
    host?: string;
}

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

// ── The smallest DER writer that can produce one self-signed certificate ──

function derLength(n: number): Buffer {
    if (n < 0x80) return Buffer.from([n]);
    const bytes: number[] = [];
    let v = n;
    while (v > 0) { bytes.unshift(v & 0xff); v >>>= 8; }
    return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
const derSeq = (...parts: Buffer[]): Buffer => tlv(0x30, Buffer.concat(parts));
const derSet = (...parts: Buffer[]): Buffer => tlv(0x31, Buffer.concat(parts));
/** DER INTEGER is signed, so a high top bit needs a leading zero byte. */
const derInt = (raw: Buffer): Buffer => tlv(0x02, raw[0] & 0x80 ? Buffer.concat([Buffer.from([0]), raw]) : raw);
const derBool = (v: boolean): Buffer => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const derOctet = (body: Buffer): Buffer => tlv(0x04, body);
/** DER BIT STRING with no unused bits, which is every case here. */
const derBitString = (body: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0]), body]));
const derUtf8 = (s: string): Buffer => tlv(0x0c, Buffer.from(s, 'utf-8'));
const derExplicit = (n: number, body: Buffer): Buffer => tlv(0xa0 | n, body);

function derOid(dotted: string): Buffer {
    const parts = dotted.split('.').map(Number);
    const out: number[] = [parts[0] * 40 + parts[1]];
    for (const part of parts.slice(2)) {
        const stack = [part & 0x7f];
        let v = part >>> 7;
        while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>>= 7; }
        out.push(...stack);
    }
    return tlv(0x06, Buffer.from(out));
}

/** UTCTime is YYMMDDHHMMSSZ, which is what an X.509 validity field before 2050 uses. */
function derUtcTime(d: Date): Buffer {
    const iso = d.toISOString();
    const text = `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
    return tlv(0x17, Buffer.from(text, 'ascii'));
}

const pem = (label: string, der: Buffer): string =>
    `-----BEGIN ${label}-----\n${(der.toString('base64').match(/.{1,64}/g) ?? []).join('\n')}\n-----END ${label}-----\n`;

/**
 * A self-signed P-256 certificate for 127.0.0.1, valid from yesterday for ten years.
 *
 * The SPKI comes straight from Node's own key export, so the only hand-written parts are the
 * names, the validity, the two extensions and the outer wrapper.
 */
export function selfSignedLoopbackCert(): { key: string; cert: string } {
    const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const spki = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
    const ecdsaSha256 = derSeq(derOid('1.2.840.10045.4.3.2'));
    const commonName = derSeq(derSet(derSeq(derOid('2.5.4.3'), derUtf8('aimeat-e2e-push-receiver'))));
    const now = Date.now();
    const tbs = derSeq(
        derExplicit(0, derInt(Buffer.from([2]))),          // X.509 v3
        derInt(randomBytes(8)),                            // serial
        ecdsaSha256,
        commonName,                                        // issuer (self)
        derSeq(derUtcTime(new Date(now - 86_400_000)), derUtcTime(new Date(now + 3650 * 86_400_000))),
        commonName,                                        // subject (self)
        spki,
        derExplicit(3, derSeq(
            derSeq(derOid('2.5.29.19'), derBool(true), derOctet(derSeq(derBool(true)))),      // basicConstraints CA:TRUE
            derSeq(derOid('2.5.29.17'), derOctet(derSeq(tlv(0x87, Buffer.from([127, 0, 0, 1]))))), // SAN IP:127.0.0.1
        )),
    );
    const signature = cryptoSign('sha256', tbs, privateKey);
    return {
        key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
        cert: pem('CERTIFICATE', derSeq(tbs, ecdsaSha256, derBitString(signature))),
    };
}

/**
 * Start the receiver and resolve once it is listening.
 *
 * The status is decided by the path so that one receiver can stand in for three push services at
 * once: a healthy device, a registration the service says is gone, and one that is failing for
 * some other reason. That is the whole of what services/push.ts branches on.
 */
export function startFakePushReceiver(opts: FakePushOptions = {}): Promise<FakePushReceiver> {
    const hits: PushHit[] = [];
    const { key, cert } = selfSignedLoopbackCert();

    const server: Server = createServer({ key, cert }, (req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c: Buffer) => chunks.push(c));
        req.on('end', () => {
            const path = req.url ?? '/';
            hits.push({
                path,
                method: req.method ?? 'GET',
                ttl: req.headers.ttl as string | undefined,
                contentEncoding: req.headers['content-encoding'] as string | undefined,
                authorization: String(req.headers.authorization ?? '').slice(0, 24),
                bytes: Buffer.concat(chunks).length,
                at: new Date().toISOString(),
            });
            if (path.startsWith('/gone')) { res.writeHead(410); res.end(); return; }
            if (path.startsWith('/boom')) { res.writeHead(500); res.end(); return; }
            res.writeHead(201);
            res.end();
        });
        req.on('error', () => { /* a client hanging up mid-request is not a test's business */ });
    });
    server.on('tlsClientError', () => { /* same: a half-open handshake says nothing */ });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', () => {
            const addr = server.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            const origin = `https://127.0.0.1:${port}`;
            const api: FakePushReceiver = {
                port,
                origin,
                hits,
                endpoint(path: string): string { return `${origin}${path.startsWith('/') ? path : `/${path}`}`; },
                hitsFor(path: string): PushHit[] { return hits.filter(h => h.path === path); },
                async waitForHit(path: string, timeoutMs = 15_000): Promise<PushHit> {
                    const start = Date.now();
                    for (;;) {
                        const found = hits.find(h => h.path === path);
                        if (found) return found;
                        if (Date.now() - start > timeoutMs) {
                            const seen = hits.map(h => h.path).join(', ') || 'nothing';
                            throw new Error(`no push to ${path} after ${timeoutMs}ms. Received: ${seen}`);
                        }
                        await sleep(120);
                    }
                },
                clear(): void { hits.length = 0; },
                close(): Promise<void> { return new Promise(done => server.close(() => done())); },
            };
            resolve(api);
        });
    });
}
