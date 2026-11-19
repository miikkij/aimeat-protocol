/**
 * @file test/helpers/fake-oidc-idp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A real OpenID Connect provider over HTTPS for a node a suite starts itself, so the
 *   node's sign-in with Casdoor or Microsoft Entra runs its own code against the network: the
 *   discovery document, the token exchange, the ID token's signature and nonce
 *   (services/oidc-client.ts, openid-client).
 *
 *   WHY HTTPS AND A PROXY. openid-client refuses an issuer over plain HTTP, and the Entra issuer is
 *   fixed to https://login.microsoftonline.com/<tenant>/v2.0 (services/oidc-providers.ts
 *   entraIssuerUrl). So the provider serves TLS with a certificate for `localhost` and for
 *   `login.microsoftonline.com`, signed by a CA made here; the node trusts that CA through
 *   NODE_EXTRA_CA_CERTS, and reaches login.microsoftonline.com through the HTTP CONNECT proxy this
 *   helper also runs (NODE_USE_ENV_PROXY with HTTPS_PROXY). The proxy tunnels that one host to the
 *   provider and refuses every other, so nothing of the test leaves the machine. Casdoor's issuer is
 *   a setting, so it is https://localhost:<port> and needs no proxy.
 *
 *   THE CODE. The suite reads `state` and `nonce` from the node's redirect to the provider, then
 *   names the claims an authorization code stands for with `issueCode`; the token endpoint answers
 *   that code once, with an ID token carrying those claims, the nonce, the issuer the request came
 *   to and the client id as the audience.
 * @structure startFakeOidcIdp(dir) → FakeOidcIdp { port, proxyPort, caFile, nodeEnv(), issueCode(), close() }
 * @usage const idp = await startFakeOidcIdp(dir); spawn('node', [...], { env: { ...env, ...idp.nodeEnv() } });
 * @version-history
 *   v1.0.0 — 2026-11-19 — Initial (feature audit 2026-11-19, item 4.5).
 */
import https from 'node:https';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT, exportJWK } from 'jose';
import { makeCert, name, newRsa, pem } from '../fixtures/docsign/pdf-sign.js';

/** The one host the proxy tunnels: Microsoft Entra's sign-in address. */
export const ENTRA_HOST = 'login.microsoftonline.com';

export interface FakeOidcIdp {
  port: number;
  proxyPort: number;
  caFile: string;
  /** The environment a spawned node needs to reach this provider. */
  nodeEnv(): Record<string, string>;
  /** The claims the next token exchange of `code` answers with (the nonce is the node's own). */
  issueCode(code: string, claims: Record<string, unknown>): void;
  close(): Promise<void>;
}

const WELL_KNOWN = '/.well-known/openid-configuration';

export async function startFakeOidcIdp(dir: string): Promise<FakeOidcIdp> {
  const ca = newRsa();
  const caName = name('E2E OIDC CA', 'AIMEAT test');
  const caCert = makeCert({ subject: caName, issuer: caName, publicKey: ca.publicKey, signer: ca.privateKey, ca: true, serial: 1 });
  const leaf = newRsa();
  const leafCert = makeCert({
    subject: name('localhost', 'AIMEAT test'), issuer: caName, publicKey: leaf.publicKey, signer: ca.privateKey, ca: false, serial: 2,
    dnsNames: ['localhost', ENTRA_HOST],
  });
  const caFile = join(dir, 'oidc-ca.pem');
  writeFileSync(caFile, pem(caCert), 'utf-8');

  const signing = newRsa();
  const kid = randomUUID();
  const jwk = { ...(await exportJWK(signing.publicKey)), kid, alg: 'RS256', use: 'sig' };
  const codes = new Map<string, Record<string, unknown>>();

  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const server = https.createServer({ key: leaf.privateKey.export({ type: 'pkcs8', format: 'pem' }), cert: pem(leafCert) }, (req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `https://${req.headers.host}`);
      const path = url.pathname;
      const base = (suffix: string) => `https://${req.headers.host}${path.slice(0, path.length - suffix.length)}`;
      if (req.method === 'GET' && path.endsWith(WELL_KNOWN)) {
        const issuer = base(WELL_KNOWN).replace(/\/$/, '');
        return send(res, 200, {
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        });
      }
      if (req.method === 'GET' && path.endsWith('/jwks')) return send(res, 200, { keys: [jwk] });
      if (req.method === 'POST' && path.endsWith('/token')) {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
        const basic = /^Basic (.+)$/.exec(String(req.headers.authorization ?? ''))?.[1];
        const clientId = form.get('client_id') ?? (basic ? decodeURIComponent(Buffer.from(basic, 'base64').toString('utf8').split(':')[0]) : '');
        const claims = codes.get(form.get('code') ?? '');
        if (form.get('grant_type') !== 'authorization_code' || !claims) return send(res, 400, { error: 'invalid_grant' });
        codes.delete(form.get('code')!);
        const issuer = base('/token');
        const idToken = await new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', kid })
          .setIssuer(issuer).setAudience(clientId).setIssuedAt().setExpirationTime('5m')
          .sign(signing.privateKey);
        return send(res, 200, { access_token: `at-${randomUUID()}`, token_type: 'Bearer', expires_in: 300, id_token: idToken });
      }
      send(res, 404, { error: 'not_found' });
    })().catch((err) => send(res, 500, { error: String(err) }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as net.AddressInfo).port;

  // The CONNECT proxy: login.microsoftonline.com:443 goes to the provider; anything else is refused.
  const proxy = http.createServer((_req, res) => { res.writeHead(405); res.end(); });
  proxy.on('connect', (req, socket) => {
    if (req.url !== `${ENTRA_HOST}:443`) { socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
    const upstream = net.connect(port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });
  await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
  const proxyPort = (proxy.address() as net.AddressInfo).port;

  return {
    port, proxyPort, caFile,
    nodeEnv: () => ({
      NODE_EXTRA_CA_CERTS: caFile,
      NODE_USE_ENV_PROXY: '1',
      HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`,
      NO_PROXY: 'localhost,127.0.0.1,::1',
    }),
    issueCode: (code, claims) => { codes.set(code, claims); },
    close: async () => {
      server.closeAllConnections();
      proxy.closeAllConnections();
      await Promise.all([new Promise<void>((r) => server.close(() => r())), new Promise<void>((r) => proxy.close(() => r()))]);
    },
  };
}
