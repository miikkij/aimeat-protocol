/**
 * @file auth/passkey.js
 * @description The browser half of passkeys: turn the node's JSON options into the binary shapes
 *   navigator.credentials wants, run the ceremony, and turn the answer back into JSON. One
 *   implementation, used by BOTH surfaces — the sign-in modal and the profile's device list — so
 *   the two cannot disagree about what a passkey response looks like.
 *
 *   WHY BY HAND AND NOT A LIBRARY. All of it is base64url in one direction and back in the other.
 *   @simplewebauthn/browser does exactly this and nothing else, and taking it would mean a new
 *   vendored file under public/lib/ with its own licence entry and its own version pin, for eighty
 *   lines. The SERVER half is a different judgement: parsing CBOR and checking a COSE signature is
 *   where WebAuthn implementations get broken, and that one is the library's.
 *
 *   TWO CALLS, ONE CEREMONY. Every flow is options-then-verify, and the ceremony id ties the two
 *   together for sixty seconds. Nothing is remembered between them on this side.
 *
 * @structure passkeySupported() · passkeySignIn(username) · passkeyAdd(jwt, label)
 * @usage import { passkeySupported, passkeySignIn } from './passkey.js';
 * @version-history
 *   v1.0.0 — 2026-09-04 — Initial.
 */
import { api, authApi } from './http.js';

/** Does this browser have WebAuthn at all? An old one, or an insecure origin, does not. */
export function passkeySupported() {
  try {
    return typeof window !== 'undefined'
      && typeof window.PublicKeyCredential === 'function'
      && !!(navigator.credentials && navigator.credentials.create && navigator.credentials.get);
  } catch { return false; }
}

/** base64url text → the ArrayBuffer navigator.credentials expects. */
function toBuffer(value) {
  var s = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  var raw = atob(s);
  var bytes = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes.buffer;
}

/** An ArrayBuffer from the authenticator → the base64url the node reads. */
function toB64u(buffer) {
  var bytes = new Uint8Array(buffer);
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The node's creation options, with every base64url field turned into bytes. */
function creationOptions(options) {
  var out = Object.assign({}, options);
  out.challenge = toBuffer(options.challenge);
  out.user = Object.assign({}, options.user, { id: toBuffer(options.user.id) });
  if (Array.isArray(options.excludeCredentials)) {
    out.excludeCredentials = options.excludeCredentials.map(function (c) {
      return Object.assign({}, c, { id: toBuffer(c.id) });
    });
  }
  return out;
}

/** The node's request options, same treatment. */
function requestOptions(options) {
  var out = Object.assign({}, options);
  out.challenge = toBuffer(options.challenge);
  if (Array.isArray(options.allowCredentials)) {
    out.allowCredentials = options.allowCredentials.map(function (c) {
      return Object.assign({}, c, { id: toBuffer(c.id) });
    });
  }
  return out;
}

/**
 * The person cancelled, or the browser refused. Distinguished from a real failure because
 * "you closed the prompt" is not an error to show in red; it is the person changing their mind.
 */
function isCancellation(err) {
  var name = err && err.name;
  return name === 'NotAllowedError' || name === 'AbortError';
}

/** Marks the error so a caller can tell a cancellation from a refusal without matching on text. */
function cancelled() {
  var e = /** @type {Error & { code?: string }} */ (new Error('cancelled'));
  e.code = 'PASSKEY_CANCELLED';
  return e;
}

/**
 * Sign in with a device. `username` is optional and leaving it out is the better path: the ceremony
 * is then discoverable, the device offers whatever it holds for this domain, and its answer names
 * the account. Returns the raw login response; the caller builds the session from it.
 */
export async function passkeySignIn(username) {
  var started = await api('/v1/ghii/login/passkey/options', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify(username ? { username: username } : {}),
  });

  /** @type {any} navigator.credentials is typed to the base Credential; this one is a PublicKeyCredential. */
  var assertion;
  try {
    assertion = await navigator.credentials.get({ publicKey: requestOptions(started.data.options) });
  } catch (err) {
    if (isCancellation(err)) throw cancelled();
    throw err;
  }
  if (!assertion) throw cancelled();

  var response = {
    id: assertion.id,
    rawId: toB64u(assertion.rawId),
    type: assertion.type,
    clientExtensionResults: assertion.getClientExtensionResults ? assertion.getClientExtensionResults() : {},
    response: {
      clientDataJSON: toB64u(assertion.response.clientDataJSON),
      authenticatorData: toB64u(assertion.response.authenticatorData),
      signature: toB64u(assertion.response.signature),
      userHandle: assertion.response.userHandle ? toB64u(assertion.response.userHandle) : undefined,
    },
  };

  return api('/v1/ghii/login/passkey/verify', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ ceremony_id: started.data.ceremony_id, response: response }),
  });
}

/**
 * Add this device to the account the given token belongs to. Returns the stored passkey as the
 * node describes it, so a list can render the new row without a re-read.
 */
export async function passkeyAdd(jwt, label) {
  var started = await authApi('/v1/ghii/passkeys/register/options', jwt, { method: 'POST', body: '{}' });

  /** @type {any} As above: the base Credential type has none of the WebAuthn fields. */
  var credential;
  try {
    credential = await navigator.credentials.create({ publicKey: creationOptions(started.data.options) });
  } catch (err) {
    if (isCancellation(err)) throw cancelled();
    throw err;
  }
  if (!credential) throw cancelled();

  var response = {
    id: credential.id,
    rawId: toB64u(credential.rawId),
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {},
    response: {
      clientDataJSON: toB64u(credential.response.clientDataJSON),
      attestationObject: toB64u(credential.response.attestationObject),
      transports: credential.response.getTransports ? credential.response.getTransports() : [],
    },
  };

  return authApi('/v1/ghii/passkeys/register/verify', jwt, {
    method: 'POST',
    body: JSON.stringify({ ceremony_id: started.data.ceremony_id, response: response, label: label || '' }),
  });
}
