/**
 * @file src/services/web-bot-auth.ts
 * @description Web Bot Auth (draft-meunier-web-bot-auth-architecture / RFC 9421 HTTP Message
 *   Signatures) for the node: makes AIMEAT's outbound agent/crawler traffic cryptographically
 *   verifiable. One state, two faces: (1) the key directory served at
 *   /.well-known/http-message-signatures-directory — a JWKS built from the node's EXISTING
 *   Ed25519 key (same key the DID document / VC issuer publish; kid = RFC 7638 JWK thumbprint) —
 *   with the directory response itself signed (tag "http-message-signatures-directory") so
 *   verifiers can pin it to this origin; (2) an RFC 9421 signer for outbound requests — covered
 *   components ("@authority" "signature-agent"), params created/expires/keyid/alg/nonce +
 *   tag="web-bot-auth" — attached by safeFetch when AIMEAT_WEB_BOT_AUTH_SIGN=true (OFF by
 *   default: it stamps identifying headers on every outbound request, a posture decision for the
 *   operator). The private key never leaves this module's closure.
 * @structure getWebBotAuthState · signatureDirectoryBody · signDirectoryResponse ·
 *   signOutboundRequest · SIGNATURES_DIRECTORY_MEDIA_TYPE · resetWebBotAuth (test seam)
 * @usage
 *   const state = await getWebBotAuthState(storage, config);         // lazy singleton
 *   res.type(SIGNATURES_DIRECTORY_MEDIA_TYPE).send(JSON.stringify(signatureDirectoryBody(state)));
 *   const headers = await signOutboundRequest(state, targetUrl);     // Signature-Agent/-Input/Signature
 * @version-history
 *   v1.0.0 — 2026-07-14 — Initial Web Bot Auth: key directory + RFC 9421 Ed25519 signer
 */
import { createHash, randomBytes } from 'node:crypto';
import * as ed from '@noble/ed25519';
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';

/** draft-meunier-http-message-signatures-directory §3: the directory's required media type. */
export const SIGNATURES_DIRECTORY_MEDIA_TYPE = 'application/http-message-signatures-directory+json';

export interface WebBotAuthState {
  /** Public JWK (kty OKP / crv Ed25519 / x base64url) — the same key did.json publishes. */
  jwk: { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; use: 'sig' };
  /** RFC 7638 JWK SHA-256 thumbprint (base64url) — the signature `keyid`. */
  keyid: string;
  /** This node's origin, sent as the Signature-Agent header (where the directory lives). */
  agentOrigin: string;
}

let statePromise: Promise<WebBotAuthState | null> | null = null;
let privateKeyBytes: Uint8Array | null = null;

/** Test seam: clear between embedded server boots. */
export function resetWebBotAuth(): void {
  statePromise = null;
  privateKeyBytes = null;
}

/** RFC 7638 thumbprint of an OKP JWK: SHA-256 over {"crv","kty","x"} in lexicographic order. */
function jwkThumbprint(crv: string, kty: string, x: string): string {
  const canonical = `{"crv":"${crv}","kty":"${kty}","x":"${x}"}`;
  return createHash('sha256').update(canonical, 'utf8').digest('base64url');
}

/**
 * Lazy singleton: load the node key once and derive the Web Bot Auth state. Null when the node
 * has no keypair yet (fresh boot before key generation) — callers 404/skip in that case.
 */
export function getWebBotAuthState(storage: Storage, config: AimeatConfig): Promise<WebBotAuthState | null> {
  if (!statePromise) {
    statePromise = (async () => {
      const nodeKey = await storage.getNodeKey();
      if (!nodeKey) { statePromise = null; return null; }
      privateKeyBytes = new Uint8Array(Buffer.from(nodeKey.privateKey, 'base64'));
      const x = Buffer.from(nodeKey.publicKey, 'base64').toString('base64url');
      const kid = jwkThumbprint('Ed25519', 'OKP', x);
      let agentOrigin = config.baseUrl;
      try { agentOrigin = new URL(config.baseUrl).origin; } catch { /* keep baseUrl as-is */ }
      return { jwk: { kty: 'OKP', crv: 'Ed25519', x, kid, use: 'sig' }, keyid: kid, agentOrigin };
    })();
  }
  return statePromise;
}

/** The JWKS body of /.well-known/http-message-signatures-directory. */
export function signatureDirectoryBody(state: WebBotAuthState): { keys: WebBotAuthState['jwk'][] } {
  return { keys: [state.jwk] };
}

/**
 * Serialize + sign an RFC 9421 signature base. `componentLines` pairs the FULL serialized
 * component identifier (quotes and any parameters included, e.g. `"@authority"` or
 * `"@authority";req`) with its value; the base ends with the `"@signature-params"` line.
 */
async function signBase(
  componentLines: Array<[string, string]>,
  params: string,
): Promise<string> {
  const base = componentLines.map(([id, v]) => `${id}: ${v}`).join('\n')
    + `\n"@signature-params": ${params}`;
  const sig = await ed.signAsync(new TextEncoder().encode(base), privateKeyBytes!);
  return Buffer.from(sig).toString('base64');
}

/** RFC 9421 @authority of a URL: lowercased host (URL normalizes default ports away). */
function authorityOf(url: string): string {
  return new URL(url).host.toLowerCase();
}

/**
 * Sign the DIRECTORY RESPONSE (draft §5.2): covered component ("@authority") with the `req` flag
 * unset variant used by the published examples, params created/expires/keyid/alg +
 * tag="http-message-signatures-directory". Returns headers for the directory GET response.
 */
export async function signDirectoryResponse(
  state: WebBotAuthState,
  requestAuthority: string,
): Promise<{ 'Signature-Input': string; Signature: string }> {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;
  const params = `("@authority";req);created=${created};keyid="${state.keyid}";alg="ed25519";expires=${expires};tag="http-message-signatures-directory"`;
  const b64 = await signBase([['"@authority";req', requestAuthority.toLowerCase()]], params);
  return {
    'Signature-Input': `sig1=${params}`,
    Signature: `sig1=:${b64}:`,
  };
}

/**
 * Sign an OUTBOUND request (Web Bot Auth): covered components ("@authority" "signature-agent"),
 * params created/expires/keyid/alg/nonce + tag="web-bot-auth". Returns the three headers to
 * attach. Never throws with a loaded key; callers treat failures as best-effort.
 */
export async function signOutboundRequest(
  state: WebBotAuthState,
  targetUrl: string,
): Promise<{ 'Signature-Agent': string; 'Signature-Input': string; Signature: string }> {
  const created = Math.floor(Date.now() / 1000);
  const expires = created + 300;
  const nonce = randomBytes(64).toString('base64');
  const agentValue = `"${state.agentOrigin}"`;
  const params = `("@authority" "signature-agent");created=${created};keyid="${state.keyid}";alg="ed25519";expires=${expires};nonce="${nonce}";tag="web-bot-auth"`;
  const b64 = await signBase(
    [['"@authority"', authorityOf(targetUrl)], ['"signature-agent"', agentValue]],
    params,
  );
  return {
    'Signature-Agent': agentValue,
    'Signature-Input': `sig1=${params}`,
    Signature: `sig1=:${b64}:`,
  };
}
