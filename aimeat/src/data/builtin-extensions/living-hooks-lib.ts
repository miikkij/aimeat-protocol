/**
 * @file src/data/builtin-extensions/living-hooks-lib.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The pure half of the `living-hooks` extension, as JavaScript SOURCE.
 *
 *   Both action scripts are prepended with this text, so the host that decides whether a URL may be
 *   called and the reader that pulls one value out of an answer are written once. It is a string
 *   rather than a TypeScript module because an extension script runs in QuickJS with no imports:
 *   the sandbox sees source, and the only way to share code between two actions is to ship the same
 *   bytes into both.
 *
 *   IT IS A STRING AND STILL TESTED. `test/unit/living-hooks-lib.test.ts` evaluates THIS text with
 *   `new Function` and exercises the functions it defines, the same way `/v1/ext-hash` evaluates
 *   EXT_HASH_REFERENCE_JS to prove the published hash is the one the sandbox runs. So the tested
 *   bytes are the shipped bytes; there is no second copy to drift.
 *
 *   Written with String.raw so a regex literal keeps its backslashes. A `${` sequence anywhere in
 *   here would still be interpolation, so there is none.
 * @structure
 *   - LIVING_HOOKS_LIB_JS — livingHost, livingHostAllowed, livingPath, livingHeaderAllowed,
 *     livingBytes, livingSecrets, livingResolveSecret, livingHosts, livingShape, livingPrune
 * @usage
 *   const script = LIVING_HOOKS_LIB_JS + '\n\n' + SEND_ACTION_JS;
 * @version-history
 *   v1.0.0 — 2026-09-06 — Initial (living hooks, the node-side half).
 */

/**
 * The shared helpers, verbatim as the sandbox receives them.
 *
 * ES5 on purpose: QuickJS runs it, the transform in extension-runtime.ts keeps top-level
 * declarations that sit ABOVE `export default`, and nothing here allocates or awaits.
 */
export const LIVING_HOOKS_LIB_JS = String.raw`
/**
 * The host an http(s) URL will actually be contacted on, lowercased, or null when the string is
 * not an absolute http(s) URL.
 *
 * Userinfo is stripped at the LAST '@', which is what a URL parser does — so
 * "http://allowed.example@evil.example/" resolves to evil.example and is refused, rather than
 * matching an allowlist on the part before the '@'. The allowlist and safeFetch have to agree
 * about which host is being called, or the check guards a different address than the fetch uses.
 */
function livingHost(url) {
  var s = String(url === null || url === undefined ? '' : url).trim();
  var m = /^https?:\/\/([^\/?#]+)/i.exec(s);
  if (!m) return null;
  var authority = m[1];
  var at = authority.lastIndexOf('@');
  if (at >= 0) authority = authority.slice(at + 1);
  if (authority.charAt(0) === '[') {
    var close = authority.indexOf(']');
    if (close < 0) return null;
    return authority.slice(0, close + 1).toLowerCase();
  }
  var colon = authority.indexOf(':');
  if (colon >= 0) authority = authority.slice(0, colon);
  authority = authority.trim();
  return authority ? authority.toLowerCase() : null;
}

/**
 * Is this host on the list?
 *
 * An entry is either an exact host ("api.example.com") or a leading-dot suffix
 * (".example.com"), which admits example.com itself and every subdomain of it. An empty list
 * admits nothing: that is the default, and it is what makes a fresh install unable to call
 * anywhere until its owner says where.
 */
function livingHostAllowed(host, list) {
  if (!host || !list || !list.length) return false;
  var h = String(host).toLowerCase();
  for (var i = 0; i < list.length; i++) {
    var raw = list[i];
    if (raw === null || raw === undefined) continue;
    var entry = String(raw).trim().toLowerCase();
    if (!entry) continue;
    if (entry.charAt(0) === '.') {
      if (entry.length < 2) continue;
      if (h === entry.slice(1)) return true;
      if (h.length > entry.length && h.slice(h.length - entry.length) === entry) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

/**
 * The allowlist for this call: the owner's own record first, then whatever the node ships in the
 * extension's config. The union, because the operator's entry is a default and the owner's is an
 * addition — neither should silently delete the other.
 */
function livingHosts(config, settings) {
  var out = [];
  var add = function (v) {
    if (typeof v === 'string') {
      var parts = v.split(',');
      for (var k = 0; k < parts.length; k++) { var p = parts[k].trim(); if (p) out.push(p); }
      return;
    }
    if (Array.isArray(v)) {
      for (var j = 0; j < v.length; j++) if (typeof v[j] === 'string' && v[j].trim()) out.push(v[j].trim());
    }
  };
  if (settings && typeof settings === 'object') add(settings.allow_hosts);
  if (config && typeof config === 'object') add(config.allow_hosts);
  return out;
}

/**
 * Read one value out of a parsed JSON answer by a path written the way a person writes it:
 * "prices[0].price", "a.b", "items[2]", and a quoted segment for a key with a dot in it
 * ("data['total.eur']").
 *
 * Returns { ok: true, value } or { ok: false, at }, where "at" is the part of the path that had
 * nowhere to go — so the refusal can say WHICH step failed instead of "not found". A missing key
 * is a failure rather than undefined: a document reading a live price would otherwise render a
 * blank where the answer changed shape, and never say so.
 */
function livingPath(value, path) {
  var p = String(path === null || path === undefined ? '' : path).trim();
  if (!p) return { ok: true, value: value };
  var tokens = [];
  var i = 0;
  var n = p.length;
  while (i < n) {
    var ch = p.charAt(i);
    if (ch === '.') { i++; continue; }
    if (ch === '[') {
      var close = p.indexOf(']', i);
      if (close < 0) return { ok: false, at: p.slice(i) };
      var inner = p.slice(i + 1, close).trim();
      var q = inner.charAt(0);
      if (q === '"' || q === "'") {
        if (inner.length < 2 || inner.charAt(inner.length - 1) !== q) return { ok: false, at: p.slice(i, close + 1) };
        var quoted = inner.slice(1, inner.length - 1);
        if (!quoted) return { ok: false, at: p.slice(i, close + 1) };
        tokens.push(quoted);
      } else {
        if (!/^[0-9]+$/.test(inner)) return { ok: false, at: p.slice(i, close + 1) };
        tokens.push(inner);
      }
      i = close + 1;
      continue;
    }
    var j = i;
    while (j < n && p.charAt(j) !== '.' && p.charAt(j) !== '[') j++;
    var name = p.slice(i, j).trim();
    if (!name) return { ok: false, at: p.slice(i) };
    tokens.push(name);
    i = j;
  }
  if (!tokens.length) return { ok: false, at: p };

  var cur = value;
  var walked = '';
  for (var k = 0; k < tokens.length; k++) {
    var t = tokens[k];
    walked = walked ? walked + '.' + t : t;
    if (cur === null || cur === undefined || typeof cur !== 'object') return { ok: false, at: walked };
    if (Array.isArray(cur)) {
      if (!/^[0-9]+$/.test(t)) return { ok: false, at: walked };
      var idx = parseInt(t, 10);
      if (idx >= cur.length) return { ok: false, at: walked };
      cur = cur[idx];
    } else {
      if (!Object.prototype.hasOwnProperty.call(cur, t)) return { ok: false, at: walked };
      cur = cur[t];
    }
  }
  return { ok: true, value: cur };
}

/**
 * May this header name be sent?
 *
 * A short fixed set plus anything under X-Living-, which is the space a document's own receiver
 * gets to name freely. Everything else is refused: a header is how a caller would reach past the
 * allowlist (Host), forge an origin, or smuggle a cookie, and there is no request here that needs
 * one this list does not carry.
 */
function livingHeaderAllowed(name) {
  var n = String(name === null || name === undefined ? '' : name).trim().toLowerCase();
  if (!n || !/^[a-z0-9-]+$/.test(n)) return false;
  var fixed = ['authorization', 'content-type', 'accept', 'x-api-key', 'x-requested-with'];
  if (fixed.indexOf(n) >= 0) return true;
  return n.length > 9 && n.slice(0, 9) === 'x-living-';
}

/** How many BYTES this string is as UTF-8. The size limits are in bytes; String.length is not. */
function livingBytes(s) {
  var str = String(s === null || s === undefined ? '' : s);
  var n = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xD800 && c <= 0xDBFF) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

/**
 * The owner's secret map, from the extension's one encrypted "secrets" config field.
 *
 * It is a single string holding JSON because the node encrypts STRING config values and nothing
 * else, so a map of secrets has to travel as one. A value that will not parse yields an empty
 * map, and the placeholder that wanted it then refuses by name — which says "that secret is not
 * set" rather than sending a header with the word undefined in it.
 */
function livingSecrets(raw) {
  if (raw === null || raw === undefined || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  var parsed = null;
  try { parsed = JSON.parse(String(raw)); } catch (err) { parsed = null; }
  return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
}

/**
 * Replace every {{secret:NAME}} in a header value with what the owner stored under NAME.
 *
 * Returns { ok: false, missing } when a placeholder names a secret that is not set, so the caller
 * refuses instead of sending a half-built credential. The resolved value is never returned to the
 * caller by either action: the whole point of the placeholder is that the secret stays out of the
 * document that names it.
 */
function livingResolveSecret(value, secrets) {
  var s = String(value === null || value === undefined ? '' : value);
  var missing = null;
  var out = s.replace(/\{\{secret:([A-Za-z0-9_.\-]{1,64})\}\}/g, function (whole, name) {
    var v = secrets[name];
    if (typeof v !== 'string' || !v) { if (!missing) missing = name; return ''; }
    return v;
  });
  return missing ? { ok: false, missing: missing } : { ok: true, value: out };
}

/**
 * Turn an answer's BODY TEXT into the value a document node will hold.
 *
 * raw takes the whole body: a number when the body is one ("18.42" becomes 18.42, because a
 * gauge needs a number and every plain-text price endpoint answers a bare one), otherwise the
 * trimmed string. Without raw the body is JSON, and "path" picks one value out of it; no path
 * means the whole document.
 *
 * A body that is not JSON is UPSTREAM_FAILED and not BAD_PATH: the path was fine, the answer was
 * not, and telling those two apart is the difference between fixing your document and fixing
 * nothing for an hour.
 */
function livingShape(text, raw, path) {
  var s = String(text === null || text === undefined ? '' : text);
  if (raw) {
    var t = s.trim();
    var num = Number(t);
    if (t !== '' && isFinite(num)) return { ok: true, value: num };
    return { ok: true, value: t };
  }
  var parsed = null;
  var failed = false;
  try { parsed = JSON.parse(s); } catch (err) { failed = true; }
  if (failed) {
    return { ok: false, code: 'UPSTREAM_FAILED',
      message: 'The answer is not JSON, so no path can be read out of it. Ask for raw to take the '
        + 'whole body as one value. The answer began: "' + s.slice(0, 120) + '".' };
  }
  if (!path) return { ok: true, value: parsed };
  var got = livingPath(parsed, path);
  if (!got.ok) {
    return { ok: false, code: 'BAD_PATH',
      message: 'The path "' + path + '" has nowhere to go in this answer: it stops at "' + got.at
        + '". Write it the way you would say it, in dots and brackets, such as prices[0].price.' };
  }
  return { ok: true, value: got.value };
}

/**
 * The read cache, with everything older than ten seconds dropped and the newest 24 kept.
 *
 * Pruned on every write rather than never, because this record is ONE memory key per owner and a
 * key that only grows becomes the 1024 kB ceiling's problem eventually. Twenty-four URLs is more
 * than a document has open at once.
 */
function livingPrune(cache, now) {
  var live = [];
  var k;
  for (k in cache) {
    if (!Object.prototype.hasOwnProperty.call(cache, k)) continue;
    var e = cache[k];
    if (e && typeof e === 'object' && typeof e.at === 'number' && now - e.at < 10000) live.push(k);
  }
  live.sort(function (a, b) { return cache[b].at - cache[a].at; });
  var out = {};
  for (var i = 0; i < live.length && i < 24; i++) out[live[i]] = cache[live[i]];
  return out;
}
`;
