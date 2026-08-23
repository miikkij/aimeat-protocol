/**
 * @file test/helpers/fake-saml-idp.ts
 * @description A fake SAML identity provider for tests: builds and SIGNS real SAML 2.0 Responses
 *   with xml-crypto, so the node's ACS is exercised against genuine XML signatures — including the
 *   refusals (unsigned, wrong certificate, wrong audience, expired). It is not a server: the ACS
 *   is an HTTP POST, so the test client posts the crafted Response itself, and the IdP "metadata"
 *   is the certificate constant pasted into the connection record.
 *
 *   Two long-lived keypairs are embedded: IDP1 is "the organisation's IdP", IDP2 exists so a
 *   response signed by a DIFFERENT valid key can prove the certificate pinning refuses it.
 *   Test fixtures only — generated for this repository, never used anywhere real.
 * @usage
 *   const samlResponse = buildSamlResponse({ acsUrl, audience, issuer, nameId: 'u1', email: 'u@x.fi' });
 *   await fetch(acsUrl, { method: 'POST', body: new URLSearchParams({ SAMLResponse: samlResponse }) });
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial (BR-04 phase 2).
 */
import { SignedXml } from 'xml-crypto';
import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';

const IDP1_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC8ZjebdPTxvvEY
/6cULZprKpjPo9QJYJgOyCZpul7Ob7oGapetfcQru97wxGI7HbApY/yapcHjH4oX
b1drNkX0Mghook7oo9ccyN6KFRYgzadDEIRA3edd9/LFx/WY/bM32/wPZsFE3r5e
J6oZ5YSdvJOBvXNL10Zw5Ucc4YHsTz1sQgyvDJDQDFGjjgpgIu0tCTI7meDpKttP
0xaN5Wv5A8RvLlCrHSlFXWIRXP7bD5+efUf33WSZQqcfgdk4xUiurV1oVxWBCnXQ
YBabKN4MMTzuN0px/E2FT/j2sUY+t5Fpg5hvE6MO/NLyiJDshX36gkUpVvERgFWg
0u7J48WlAgMBAAECggEAF0swHul0C5vHJYceelE1IYDvyeSAp/QoeNNoZHQlmrKX
tolhXZMKOToOU4iEeLiv+j4hkmFiOpnAsisTDO918L5q6bz/sqXnR+jSExKOXNnw
j0swfvCw1Z59htS1WggsK4DohmL3DHPZ57xRvMfzAKm7NzRcWAky7Wx7wWdkb/oZ
zLdNGCj5favQmoGyO3JqrO1S7tXODtwGU/kRPNISXy9uOlzX1XglxLhYRC9zePJO
dAf9SIIK5Q/0qSWTpeMKEwk9omsju1MNtmIxgDjrPgq6kPWiQ/7ZKkQXZj+hDwJX
yQBf8dSlhgxJPJgSE40Ylt39C7BuTCkQVB60CP3t1QKBgQDk1494J8JS99i9iLBN
aDMWp0iQOnANCGG+ausYJIDYKN6j/kyqZ06S3wVv47OC1VAXBjHwzYn9hqZhYayR
evJrXo/1IZOfKPbT5ndb4TF6kcj69Tfrev6/PIvRSkm/NySGz8Ug5cxYdAzcEMWu
vH5vtUPrLV61cCMT/9YaUeht7wKBgQDSwfeuOxW+oTg2zMowsKRbnSm/edubLcaU
WSgnK6ZhSZBngCuaYD3R3MhzMDrjKWyGh9oRnOd3p+SpSeDhpiuUXJ2nmZuugI3t
wViq+th5yMJn1MkOGQtbYkkUCxajme7jssraaqVdabCEI5eENa1jw1Bcxk8tjXsQ
nzem03oZqwKBgQDNDzQqcUY6XolDXYbN9j9BX2kwhIz/wLEFln1PxvYFvKm0vh0o
3SWVim8u0hV7eXYpC44Yv7WVDuFshb/DJS6xc6z/9bR4fJahTvVJycMymAxGhRI0
2qQH7VNEmZL324vJmciFMCYqZONZF1Zsu894fi98P82MPA3Sz/+k2hyy1QKBgQCa
Qh5nCBgCTz413e6fdKrX41CLNUXnbrnKGveos+oziwSGvOktNQQKdu7AYKy5V7h3
Pzf9bDp++gQDZG+UuWtsS92YrnWkY7N+MeYUP0Xy3V5tYPFHwEzvtiCG6xbG6ARR
5KtU8nnWxWTNUr+zpRYjzvEi9oM9dDB/GgpBsMfNwQKBgFe2z4wXUyQFolKbpo2z
Qh+atzGAEavb2oHFpt7HnXAn7Vt/MISAfvX1H4Jyk6DOtAguw1/zcdaH+ObspII5
s56EHf6/Meqy/2oWZslmj5e/E4PGTT8iqAh7uNEN76D3a2h8XDOs/ayd7buLVKUo
NR2UUizgZ79VplGdexkjk7F/
-----END PRIVATE KEY-----`;

const IDP1_CERT = `-----BEGIN CERTIFICATE-----
MIIDETCCAfmgAwIBAgIUWU587JqCRGJvmq7gXEp2A3rP2HgwDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMZmFrZS1pZHAtb25lMCAXDTI2MDgyMzIxMDAxOFoYDzIx
MjYwNzMwMjEwMDE4WjAXMRUwEwYDVQQDDAxmYWtlLWlkcC1vbmUwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQC8ZjebdPTxvvEY/6cULZprKpjPo9QJYJgO
yCZpul7Ob7oGapetfcQru97wxGI7HbApY/yapcHjH4oXb1drNkX0Mghook7oo9cc
yN6KFRYgzadDEIRA3edd9/LFx/WY/bM32/wPZsFE3r5eJ6oZ5YSdvJOBvXNL10Zw
5Ucc4YHsTz1sQgyvDJDQDFGjjgpgIu0tCTI7meDpKttP0xaN5Wv5A8RvLlCrHSlF
XWIRXP7bD5+efUf33WSZQqcfgdk4xUiurV1oVxWBCnXQYBabKN4MMTzuN0px/E2F
T/j2sUY+t5Fpg5hvE6MO/NLyiJDshX36gkUpVvERgFWg0u7J48WlAgMBAAGjUzBR
MB0GA1UdDgQWBBSlH09r1aJac02S1+3LbA7xNQuFTTAfBgNVHSMEGDAWgBSlH09r
1aJac02S1+3LbA7xNQuFTTAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQAMud5vb8JTBlQZ/iJMSan3RiH3tkxeiitl6bRysO+MbGypcJPVd+fF9BNP
84lWrX3BjkDrGWhM15dKUXpytDMd1itR7MJYWdsy0cJY25sPAEaPU/9oLXzDuv4I
gef7THZhB5CCHIprq0g3x4S376Dwf/p2IFLmV+LJujGuwrRrFTxIxRlDFq1YtUVP
2NagnCWSmG36h0uinNJXPW4YusPQGCrfori8DdRQLFoGIJ2ehP3aCidO28089iNt
I78T2vrT8YTaZlYjT0akrBCAMSn6gCl9AO7f/oHbs32HATAip/VWU2/DOdlhNc2J
6Rw4+mAdutaXfnVdWN7YV85GxB1t
-----END CERTIFICATE-----`;

const IDP2_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC6Va+MuuLHuWC+
YfKQO+yohVbjcDPOH7wfgg3p4mDHb5SvcVy91sjYBcn2rZ3iYcFb82G7voYG60SH
E77f0aBvMzLSmE/C3k29Zjib2N1SjW8DoPr6unt9sZFs3hoX+WTbLJNQd/sa0Quc
64flswBB/dpdNAQ7maQ6qnHd7gZCVWrJhto6ZZ68CoqfjccSgIgoFjbNjBcKJ6Ae
QQ0Z8m9Zf6VX4oPOWJJKdz2/tAa7h1Md+2+qlMB7ODcpffGh989hZpcV/tzgIuJ7
d/SdjtKbBjryYb6P7RECV7lIG5KUQADi/GHTxJM63TMACUeWDUUgwGDGrDnSbHNm
drNBXtKvAgMBAAECggEAR9FZyaCIYtlg39ApqQznsKY/8IZg+TvDCtPaIAC4M3Ye
tSY4zBSaMaS9jH2rQkNSPuoGC9Ipn0YTkgp6wZJuxx1RI9k/uMhs5yicffjuiPBp
Ttk/kt7IVRBZEEBkh0QA6vb5yoSL/HCBDNi89rvwx/6bKNwxG3Wi1le2bobc07im
6lPHno5dUfpGxmgK9YsTyieQLd6IJOl+i1qf7MBfqTCHOO7u+rG1E7V3SwQeW1UQ
BzzST5IQlI1rIqqjpb65D25NtQfFCOFaHDEoNXDaFAuLsceNQt7mWABuq81FL7oA
Ae+TAD7SuI8B/ddDiXIbVvTkNLjSHHSfOttrqAlyKQKBgQDiPgBK6/lCUn7+mVOU
Q1azfrtOzWOIHW1Ot2ynRCWvYQlBUr99BtspJq7yWjj+CZvHWOIOf/BKf1hGk247
qIwpIFCSYrSdmEA/KkdBfNmxYs69yKIiimSsdVTlcaZc7Bo17+HO+Vz8SowhLAMJ
kh46avxs7rBa+Ex1hRAFZYZ1yQKBgQDS1+zCeTpPwB2XimmOAFT/G9rA3aMc/Wc5
Iqvi2/vsVw8MCk3SUfrkWXIbr+BBrvjAxuZLaxsoe1xFiQPdedHSAS6x+L56PQ1m
32ykm9HFQJy3y2/EX8V7sdP2YTv5MpzJxQKI139sA5SjShuAUKr+b6aKKCZeD69d
6wXGbQugtwKBgQCJ81ZIWNSW7SiEY8eDuv+t2ROrPC95esAA5HU7FKGJ67gx/ZvH
R5vw3qaEHiFsPT2gcwD76GUDd9zCw/jOJbq5BPw8FjWddo2ONmBWfSNcNyxqqmC6
gPpb8fs/IGpZdJmS098zTfe12lrRiz2a417NLhkW7v/XqFkuu2EGeV5giQKBgQCP
N/buPvSaGZDAUFfVCmqyA1S7r5HN7l+AkwmZBv8AEj75WcJ0/BTlqdB1+Cjn1RfJ
sxHZ5v5CqFEMNr72YXpiIUV7xNB2LiR9XYTp56I9T99khX79MGTv2eJ2OKRJaNTR
xc4r793xHBmKNZuqtKECRgslS5KMUDE6JZv9pjLAzwKBgA7d5SKzDOa/pXWt6Zks
p0K4+RRHGOpUGJgLiDQd5PczJCbmLtLtPcC3y7biKIZmq7Nn9PUuqY84A2FF+mVf
sYFYXUUjJxMm1F4fOg2RAcKY6YygxU0w0SBbroWkrjfmhi9aHF22jf8ff+0i3sft
WfF24VhsybmeN5UKsAzsDoN0
-----END PRIVATE KEY-----`;

const IDP2_CERT = `-----BEGIN CERTIFICATE-----
MIIDETCCAfmgAwIBAgIUX7Okz8arR7ksRAvD5gThOZzr7t0wDQYJKoZIhvcNAQEL
BQAwFzEVMBMGA1UEAwwMZmFrZS1pZHAtdHdvMCAXDTI2MDgyMzIxMDAxOFoYDzIx
MjYwNzMwMjEwMDE4WjAXMRUwEwYDVQQDDAxmYWtlLWlkcC10d28wggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQC6Va+MuuLHuWC+YfKQO+yohVbjcDPOH7wf
gg3p4mDHb5SvcVy91sjYBcn2rZ3iYcFb82G7voYG60SHE77f0aBvMzLSmE/C3k29
Zjib2N1SjW8DoPr6unt9sZFs3hoX+WTbLJNQd/sa0Quc64flswBB/dpdNAQ7maQ6
qnHd7gZCVWrJhto6ZZ68CoqfjccSgIgoFjbNjBcKJ6AeQQ0Z8m9Zf6VX4oPOWJJK
dz2/tAa7h1Md+2+qlMB7ODcpffGh989hZpcV/tzgIuJ7d/SdjtKbBjryYb6P7REC
V7lIG5KUQADi/GHTxJM63TMACUeWDUUgwGDGrDnSbHNmdrNBXtKvAgMBAAGjUzBR
MB0GA1UdDgQWBBR61+G1DVavWmy0XlGyX0cGxrwr2zAfBgNVHSMEGDAWgBR61+G1
DVavWmy0XlGyX0cGxrwr2zAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3DQEBCwUA
A4IBAQCxvpgudZfL4KQD6hHORHTlOUZgmjytSLLQ9SVXsnEES6eRjZubzMvOqmSb
Xc3jXn9fC0VMdepbqGLQNb1lYUqY71GV5ZmYlPH85j0WzOGKMFJJQvDyxxqDh/XY
+fcOVsMyenRcVQ+jg/DwQpvg67q1KSQtoztVzydTtIA6kRWZyQBCPsQMJHHdvlRn
ZvV4XgZDwD7+PAEOvCWx8ngz91BLeuIAirBwNbqmlXcibMRxoN1+XMUznwA6RRgG
2ivqSaEdBqOru1wfoNKe8Rrr1M407UcbSkGDwe1YADWV+hXiVWxBA+S7ODzJ3cFF
TTtGAjDQGZQ2ZPmt0YibkLNoK8UW
-----END CERTIFICATE-----`;

/** Certificate body only (no PEM armour, no whitespace) — the shape a connection record stores. */
const certBody = (pem: string): string => pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '');

/** "The organisation's IdP": pin THIS cert on the connection, sign with THIS key. */
export const FAKE_IDP = { key: IDP1_KEY, cert: certBody(IDP1_CERT), entityId: 'https://fake-idp-one.example/metadata' };
/** A different, equally valid IdP — for proving the certificate pinning refuses foreign signatures. */
export const OTHER_IDP = { key: IDP2_KEY, cert: certBody(IDP2_CERT), entityId: 'https://fake-idp-two.example/metadata' };

export interface FakeResponseOpts {
  acsUrl: string;
  audience: string;
  nameId: string;
  issuer?: string;
  inResponseTo?: string;
  email?: string;
  displayName?: string;
  /** Sign the assertion with this key (default FAKE_IDP.key). null = leave it UNSIGNED. */
  signWith?: string | null;
  /** Shift the validity window: e.g. { notOnOrAfterMs: -60_000 } builds an EXPIRED assertion. */
  notOnOrAfterMs?: number;
}

const xmlEscape = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Build (and by default sign) a SAML 2.0 Response, returned base64-encoded for the ACS POST. */
export function buildSamlResponse(opts: FakeResponseOpts): string {
  const now = new Date();
  const issueInstant = now.toISOString();
  const notBefore = new Date(now.getTime() - 60_000).toISOString();
  const notOnOrAfter = new Date(now.getTime() + (opts.notOnOrAfterMs ?? 5 * 60_000)).toISOString();
  const responseId = `_r${randomUUID().replace(/-/g, '')}`;
  const assertionId = `_a${randomUUID().replace(/-/g, '')}`;
  const issuer = xmlEscape(opts.issuer ?? FAKE_IDP.entityId);
  const inResponseTo = opts.inResponseTo ? ` InResponseTo="${xmlEscape(opts.inResponseTo)}"` : '';

  const attributes: string[] = [];
  if (opts.email) {
    attributes.push(`<saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue>${xmlEscape(opts.email)}</saml:AttributeValue></saml:Attribute>`);
  }
  if (opts.displayName) {
    attributes.push(`<saml:Attribute Name="http://schemas.microsoft.com/identity/claims/displayname"><saml:AttributeValue>${xmlEscape(opts.displayName)}</saml:AttributeValue></saml:Attribute>`);
  }
  const attributeStatement = attributes.length ? `<saml:AttributeStatement>${attributes.join('')}</saml:AttributeStatement>` : '';

  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${issueInstant}">` +
      `<saml:Issuer>${issuer}</saml:Issuer>` +
      `<saml:Subject>` +
        `<saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${xmlEscape(opts.nameId)}</saml:NameID>` +
        `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">` +
          `<saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}" Recipient="${xmlEscape(opts.acsUrl)}"${inResponseTo}/>` +
        `</saml:SubjectConfirmation>` +
      `</saml:Subject>` +
      `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">` +
        `<saml:AudienceRestriction><saml:Audience>${xmlEscape(opts.audience)}</saml:Audience></saml:AudienceRestriction>` +
      `</saml:Conditions>` +
      `<saml:AuthnStatement AuthnInstant="${issueInstant}">` +
        `<saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext>` +
      `</saml:AuthnStatement>` +
      attributeStatement +
    `</saml:Assertion>`;

  let signedAssertion = assertion;
  if (opts.signWith !== null) {
    const sig = new SignedXml({
      privateKey: opts.signWith ?? FAKE_IDP.key,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    sig.addReference({
      xpath: `//*[@ID='${assertionId}']`,
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
    });
    sig.computeSignature(assertion, {
      // Signature goes right after the Issuer, where consumers expect it.
      location: { reference: `//*[local-name(.)='Issuer']`, action: 'after' },
    });
    signedAssertion = sig.getSignedXml();
  }

  const response =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ` +
      `ID="${responseId}" Version="2.0" IssueInstant="${issueInstant}" Destination="${xmlEscape(opts.acsUrl)}"${inResponseTo}>` +
      `<saml:Issuer>${issuer}</saml:Issuer>` +
      `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
      signedAssertion +
    `</samlp:Response>`;

  return Buffer.from(response, 'utf8').toString('base64');
}

/** The IdP metadata document an operator pastes into POST /v1/admin/sso/connections/:id/idp-metadata. */
export function buildIdpMetadataXml(idp: { cert: string; entityId: string } = FAKE_IDP, ssoUrl = 'https://fake-idp-one.example/sso'): string {
  return `<?xml version="1.0"?>` +
    `<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${idp.entityId}">` +
      `<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
        `<md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#">` +
          `<ds:X509Data><ds:X509Certificate>${idp.cert}</ds:X509Certificate></ds:X509Data>` +
        `</ds:KeyInfo></md:KeyDescriptor>` +
        `<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${ssoUrl}"/>` +
      `</md:IDPSSODescriptor>` +
    `</md:EntityDescriptor>`;
}

/**
 * Pull the AuthnRequest ID out of an SP authorize redirect URL (deflated, base64, in the
 * SAMLRequest query param) — the value a real IdP would echo back as InResponseTo.
 */
export function requestIdFromAuthorizeUrl(url: string): string {
  const raw = new URL(url).searchParams.get('SAMLRequest');
  if (!raw) throw new Error('authorize URL carries no SAMLRequest');
  const xml = inflateRawSync(Buffer.from(raw, 'base64')).toString('utf8');
  const m = /\sID="([^"]+)"/.exec(xml);
  if (!m) throw new Error('AuthnRequest has no ID');
  return m[1];
}
