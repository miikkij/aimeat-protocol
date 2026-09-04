/**
 * @file test/helpers/soft-authenticator.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description A WebAuthn authenticator in software, so the passkey flow can be driven end to end
 *   without a browser and without a phone. It holds a P-256 key, builds the two response shapes the
 *   node's verifier expects, and signs.
 *
 *   IT IS NOT A MOCK OF OUR CODE. Nothing here stubs the node: the responses go over HTTP to the
 *   real routes and are checked by the real library, against the real challenge, origin and relying
 *   party id. What it replaces is the hardware, which is exactly the part a test cannot have. If the
 *   node's verification is wrong in the permissive direction this helper will not hide it, because
 *   the helper only ever produces CORRECT answers — the refusals are asserted by feeding it the
 *   wrong challenge or the wrong origin, which is what the suite does.
 *
 *   THE SHAPES, since they are easy to get subtly wrong:
 *     authData = rpIdHash(32) || flags(1) || signCount(4) [|| attestedCredentialData]
 *     attestedCredentialData = aaguid(16) || credIdLen(2) || credId || COSE public key
 *     assertion signature = ECDSA-SHA256 over (authenticatorData || sha256(clientDataJSON))
 *   Flags: UP 0x01, UV 0x04, BE 0x08, BS 0x10, AT 0x40.
 *
 * @structure SoftAuthenticator — register(options) · authenticate(options) · id · counter
 * @usage const auth = new SoftAuthenticator('http://localhost:40251', 'localhost');
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial, with passkeys.
 */
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64u = (b: Uint8Array | Buffer): string => Buffer.from(b).toString('base64url');

/** The uncompressed P-256 point (0x04 || X || Y) out of a node public key. */
function rawPoint(publicKey: KeyObject): { x: Buffer; y: Buffer } {
  const der = publicKey.export({ type: 'spki', format: 'der' }) as Buffer;
  // The last 65 bytes of an SPKI P-256 key are the uncompressed point.
  const point = der.subarray(der.length - 65);
  if (point[0] !== 0x04) throw new Error('expected an uncompressed P-256 point');
  return { x: point.subarray(1, 33), y: point.subarray(33, 65) };
}

export class SoftAuthenticator {
  /** The credential id, base64url. Assigned at registration. */
  id = '';
  /** What the authenticator reports it has signed. Bumped on every assertion. */
  counter = 0;

  private privateKey: KeyObject | null = null;
  private publicKey: KeyObject | null = null;
  private readonly aaguid = Buffer.alloc(16, 0);

  constructor(
    /** The origin the browser would report, e.g. http://localhost:40251. */
    private readonly origin: string,
    /** The relying party id, i.e. the host. */
    private readonly rpId: string,
  ) {}

  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, originOverride?: string): Buffer {
    return Buffer.from(JSON.stringify({
      type,
      challenge,
      origin: originOverride ?? this.origin,
      crossOrigin: false,
    }), 'utf8');
  }

  private authData(flags: number, includeCredential: boolean, rpIdOverride?: string): Buffer {
    const rpIdHash = createHash('sha256').update(rpIdOverride ?? this.rpId).digest();
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.counter, 0);
    if (!includeCredential) return Buffer.concat([rpIdHash, Buffer.from([flags]), count]);

    const credId = Buffer.from(this.id, 'base64url');
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(credId.length, 0);
    const { x, y } = rawPoint(this.publicKey!);
    // COSE_Key for ES256: kty EC2(2), alg ES256(-7), crv P-256(1), x, y.
    const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([
      [1, 2], [3, -7], [-1, 1], [-2, new Uint8Array(x)], [-3, new Uint8Array(y)],
    ]));
    return Buffer.concat([rpIdHash, Buffer.from([flags]), count, this.aaguid, idLen, credId, Buffer.from(cose)]);
  }

  /**
   * Make a credential for these registration options and answer as the browser would.
   * `opts.challengeOverride` / `opts.originOverride` exist so a suite can prove the refusals.
   */
  register(
    options: { challenge: string },
    opts: { challengeOverride?: string; originOverride?: string; backedUp?: boolean; credentialIdOverride?: string } = {},
  ): Record<string, unknown> {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
    // The id goes into the attested credential data, so an override is a device claiming to BE
    // another credential — the shape a second account would need to steal somebody's key.
    this.id = opts.credentialIdOverride ?? b64u(randomBytes(32));
    this.counter = 0;

    const clientDataJSON = this.clientData('webauthn.create', opts.challengeOverride ?? options.challenge, opts.originOverride);
    // UP | UV | AT, plus BE|BS when this is a synced key.
    const flags = 0x01 | 0x04 | 0x40 | (opts.backedUp ? 0x08 | 0x10 : 0);
    const authData = this.authData(flags, true);
    const attestationObject = isoCBOR.encode(new Map<string, unknown>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', new Uint8Array(authData)],
    ]));

    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        attestationObject: b64u(Buffer.from(attestationObject)),
        transports: ['internal'],
      },
    };
  }

  /** Answer an authentication ceremony. Bumps the counter, as a hardware key would. */
  authenticate(
    options: { challenge: string },
    opts: { challengeOverride?: string; originOverride?: string; rpIdOverride?: string; credentialIdOverride?: string } = {},
  ): Record<string, unknown> {
    if (!this.privateKey) throw new Error('register() first');
    this.counter += 1;

    const clientDataJSON = this.clientData('webauthn.get', opts.challengeOverride ?? options.challenge, opts.originOverride);
    const authData = this.authData(0x01 | 0x04, false, opts.rpIdOverride);
    const signed = Buffer.concat([authData, createHash('sha256').update(clientDataJSON).digest()]);
    const signature = createSign('SHA256').update(signed).sign(this.privateKey);

    return {
      id: opts.credentialIdOverride ?? this.id,
      rawId: opts.credentialIdOverride ?? this.id,
      type: 'public-key',
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64u(clientDataJSON),
        authenticatorData: b64u(authData),
        signature: b64u(signature),
      },
    };
  }
}
