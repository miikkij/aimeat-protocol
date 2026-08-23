/**
 * @file src/services/saml-sp.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The SAML service-provider half of an SSO connection (BR-04), as a thin wrapper over
 *   @node-saml/node-saml — chosen precisely so that XML signature validation is NEVER ours:
 *   signature wrapping and comment-injection bypasses have been found in every hand-rolled
 *   verifier, and in this library's own past (CVE-2025-54419, fixed in the pinned >=5.1.0).
 *
 *   WHAT THE WRAPPER DECIDES, so the routes do not:
 *   - The SP identity: entityID and metadata URL are `<baseUrl>/v1/sso/<id>/metadata`, the ACS is
 *     `<baseUrl>/v1/ghii/login/saml/<id>/acs`. One connection, one SP identity — two organisations
 *     never share an Audience.
 *   - InResponseTo: 'always' unless the connection explicitly allows IdP-initiated login, in which
 *     case 'ifPresent' (an unsolicited Response is the classic replay surface). The request-id
 *     cache is node-saml's in-process default, same per-instance scope as the rate limiter.
 *   - IdP metadata parsing (entityID, HTTP-Redirect SSO URL, signing certificates) lives here too,
 *     because it is the one other place XML is read; @xmldom/xmldom with namespace-aware lookups,
 *     never regex.
 * @structure samlForConnection() / spEntityId() / spAcsUrl() / spMetadataXml() / parseIdpMetadata()
 * @usage const saml = samlForConnection(config, conn); const url = await saml.getAuthorizeUrlAsync(state, undefined, {});
 * @version-history
 *   v1.0.0 — 2026-08-23 — Initial (BR-04 phase 2).
 */
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import { DOMParser, type Element as XmlElement } from '@xmldom/xmldom';
import type { AimeatConfig } from '../config.js';
import type { SsoConnectionRecord, SsoConnectionSaml } from '../storage/interface.js';

const MD_NS = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DSIG_NS = 'http://www.w3.org/2000/09/xmldsig#';
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

/** The SP entityID doubles as the public metadata URL — one string to paste into an IdP console. */
export function spEntityId(config: AimeatConfig, connectionId: string): string {
  return `${config.baseUrl}/v1/sso/${connectionId}/metadata`;
}

export function spAcsUrl(config: AimeatConfig, connectionId: string): string {
  return `${config.baseUrl}/v1/ghii/login/saml/${connectionId}/acs`;
}

/**
 * One LIVE node-saml instance per connection, rebuilt when the connection's record changes
 * (keyed by updatedAt). Not an optimisation: node-saml's InResponseTo request-id cache lives on
 * the instance, so the authorize step and the ACS must share one — a fresh instance per request
 * would refuse every SP-initiated login as unsolicited. Per-process, like the rate limiter; a
 * restart between authorize and ACS costs that one login a retry.
 */
const instanceCache = new Map<string, { fingerprint: string; instance: SAML }>();

/** Build the node-saml instance for one connection. Throws if the connection has no SAML half. */
export function samlForConnection(config: AimeatConfig, conn: SsoConnectionRecord): SAML {
  const saml = conn.saml;
  if (!saml || !saml.ssoUrl || saml.idpCerts.length === 0) {
    throw new Error(`SSO connection "${conn.id}" has no usable SAML configuration`);
  }
  const fingerprint = `${conn.updatedAt}|${conn.allowIdpInitiated}|${config.baseUrl}`;
  const cached = instanceCache.get(conn.id);
  if (cached && cached.fingerprint === fingerprint) return cached.instance;
  const instance = buildSaml(config, conn);
  instanceCache.set(conn.id, { fingerprint, instance });
  return instance;
}

function buildSaml(config: AimeatConfig, conn: SsoConnectionRecord): SAML {
  const saml = conn.saml!;
  return new SAML({
    callbackUrl: spAcsUrl(config, conn.id),
    entryPoint: saml.ssoUrl,
    issuer: spEntityId(config, conn.id),
    audience: spEntityId(config, conn.id),
    idpCert: saml.idpCerts.length === 1 ? saml.idpCerts[0] : saml.idpCerts,
    identifierFormat: saml.nameIdFormat || null,
    // The ASSERTION signature is the requirement. Requiring the outer Response to be signed as
    // well (node-saml's default) would refuse Entra's out-of-the-box behaviour, which signs the
    // assertion only; one signature over the assertion is the SAML profile's own minimum.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: conn.allowIdpInitiated
      ? ValidateInResponseTo.ifPresent
      : ValidateInResponseTo.always,
    acceptedClockSkewMs: 5000,
  });
}

/**
 * The SP metadata document an IdP imports. No signing/decryption certs: this SP does neither.
 * Deliberately does NOT require the IdP half to be configured yet — an operator hands this URL to
 * the IdP console FIRST, so the instance here uses placeholder IdP values that metadata
 * generation never reads.
 */
export function spMetadataXml(config: AimeatConfig, conn: SsoConnectionRecord): string {
  const sp = new SAML({
    callbackUrl: spAcsUrl(config, conn.id),
    issuer: spEntityId(config, conn.id),
    entryPoint: conn.saml?.ssoUrl || 'https://idp.invalid/sso',
    idpCert: conn.saml?.idpCerts?.length ? conn.saml.idpCerts : 'placeholder',
    identifierFormat: conn.saml?.nameIdFormat || null,
  });
  return sp.generateServiceProviderMetadata(null, null);
}

/** First text content of a namespaced descendant, trimmed, or null. */
function textOf(el: XmlElement, ns: string, local: string): string | null {
  const nodes = el.getElementsByTagNameNS(ns, local);
  const raw = nodes.length ? nodes.item(0)?.textContent : null;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Read the three things a connection needs out of an IdP metadata document. Returns null when the
 * document is not IdP metadata at all; throws nothing — the caller turns null into a 400.
 */
export function parseIdpMetadata(xml: string): Pick<SsoConnectionSaml, 'idpEntityId' | 'ssoUrl' | 'idpCerts'> | null {
  let doc: ReturnType<DOMParser['parseFromString']>;
  try {
    doc = new DOMParser({ onError: () => { /* collected below: a broken doc has no EntityDescriptor */ } })
      .parseFromString(xml, 'text/xml');
  } catch {
    // eslint-disable-next-line aimeat/no-silent-catch -- the exception IS the answer: not XML
    return null;
  }
  const entity = doc.getElementsByTagNameNS(MD_NS, 'EntityDescriptor').item(0);
  const idp = doc.getElementsByTagNameNS(MD_NS, 'IDPSSODescriptor').item(0);
  const idpEntityId = entity?.getAttribute('entityID')?.trim();
  if (!entity || !idp || !idpEntityId) return null;

  // The HTTP-Redirect SSO endpoint — the binding this SP's authorize step uses.
  let ssoUrl: string | null = null;
  const ssoNodes = idp.getElementsByTagNameNS(MD_NS, 'SingleSignOnService');
  for (let i = 0; i < ssoNodes.length; i++) {
    const n = ssoNodes.item(i)!;
    if (n.getAttribute('Binding') === REDIRECT_BINDING) { ssoUrl = n.getAttribute('Location'); break; }
  }
  if (!ssoUrl) return null;

  // Signing certificates. A KeyDescriptor with no `use` attribute counts (many IdPs omit it), and
  // several certificates are kept — that is how an IdP's certificate rollover works.
  const idpCerts: string[] = [];
  const keys = idp.getElementsByTagNameNS(MD_NS, 'KeyDescriptor');
  for (let i = 0; i < keys.length; i++) {
    const key = keys.item(i)! as unknown as XmlElement;
    const use = key.getAttribute('use');
    if (use && use !== 'signing') continue;
    const cert = textOf(key, DSIG_NS, 'X509Certificate');
    if (cert) idpCerts.push(cert.replace(/\s+/g, ''));
  }
  if (idpCerts.length === 0) return null;

  return { idpEntityId, ssoUrl, idpCerts };
}
