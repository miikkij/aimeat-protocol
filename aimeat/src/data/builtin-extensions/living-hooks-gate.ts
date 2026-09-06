/**
 * @file src/data/builtin-extensions/living-hooks-gate.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The gate both `living-hooks` actions pass, as JavaScript SOURCE: who is calling,
 *   whether they may, which hosts they are allowed to reach, and the per-owner pacing record.
 *
 *   It is shared for the reason "one capability, one implementation" gives: the difference between
 *   `send` and `read` is one scope word and one counter, and every other question — is there a
 *   real caller, is this host allowed, has this owner had their minute's worth — has exactly one
 *   right answer. Two copies of that answer is how one door ends up admitting what the other
 *   refuses.
 *
 *   REFUSE BEFORE YOU WRITE, and in this order: no caller, then no permission, then a URL that is
 *   not a URL, then a host nobody allowed. Only after all four does the pacing counter move, and
 *   only when a call is actually about to go out — a refused call must not spend the owner's
 *   minute, and a cached read makes no outbound call at all, so it does not count either.
 * @structure
 *   - LIVING_HOOKS_GATE_JS — livingOpen (async, needs ctx), livingCount, livingStateKey
 * @usage
 *   const script = LIVING_HOOKS_LIB_JS + LIVING_HOOKS_GATE_JS + '\n\n' + SEND_ACTION_JS;
 * @version-history
 *   v1.1.0 — 2026-09-06 — livingHeaders no longer resolves {{secret:NAME}}; it validates which
 *     headers may be sent and passes the placeholder through for ctx.fetch to fill from the owner's
 *     vault. Two things follow: the credential never enters this VM, and a person's own vault entry
 *     now beats the operator's shared map for everyone on the node.
 *   v1.0.0 — 2026-09-06 — Initial (living hooks, the node-side half).
 */

/** The shared gate, verbatim as the sandbox receives it. ES5, and it reads `ctx` from its caller. */
export const LIVING_HOOKS_GATE_JS = String.raw`
/** A refusal in the shape both actions answer with. The browser half reads error.code. */
function livingRefuse(code, message, extra) {
  var err = { code: code, message: message };
  if (extra && typeof extra === 'object') {
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) err[k] = extra[k];
  }
  return { error: err };
}

/** Where this owner's pacing record and read cache live inside ext:living-hooks. */
function livingStateKey(account) {
  var a = String(account === null || account === undefined ? '' : account).toLowerCase();
  a = a.replace(/[^a-z0-9_-]/g, '-');
  return 'state.' + (a || 'unknown');
}

/**
 * Move a per-minute counter, or say no.
 *
 * A fixed window, not a sliding one: the minute starts at the first call after the last window
 * ended. That admits a burst across a boundary and is the right trade for a pacer whose whole job
 * is to keep a document from hammering someone else's server.
 */
function livingCount(state, field, limit, now) {
  if (!state || typeof state !== 'object') return false;
  var started = typeof state.w === 'number' ? state.w : 0;
  if (!(now - started < 60000)) { state.w = now; state.sends = 0; state.reads = 0; }
  var used = typeof state[field] === 'number' ? state[field] : 0;
  if (used >= limit) return false;
  state[field] = used + 1;
  return true;
}

/**
 * Everything both actions need before they can call out, or the refusal that stops them.
 *
 * needScope is the permission word an agent or an app must carry. A person signed in at their
 * own screen carries no scopes at all — owner sessions bypass them everywhere on this node — and
 * an unattended run of the owner's own clock arrives as 'operator', which is the node acting under
 * the owner's authority on a schedule they set. Everything else is a scoped credential and is held
 * to the word.
 */
async function livingOpen(ctx, input, needScope) {
  if (!ctx.caller || !ctx.caller.gaii) {
    return livingRefuse('NOT_AUTHORIZED',
      'This action needs somebody signed in. Open the document as yourself, or give your agent a token for this node.');
  }
  var roles = ctx.caller.roles || [];
  var scopes = ctx.caller.scopes || [];
  var inPerson = roles.indexOf('owner') >= 0 && roles.indexOf('agent') < 0;
  var unattended = roles.indexOf('operator') >= 0;
  var scoped = scopes.indexOf('*') >= 0 || scopes.indexOf('memory:*') >= 0 || scopes.indexOf(needScope) >= 0;
  if (!inPerson && !unattended && !scoped) {
    return livingRefuse('SCOPE_DENIED',
      'This caller may not do that: it needs the ' + needScope + ' permission and holds '
      + (scopes.length ? scopes.join(', ') : 'none') + '. Give the agent that permission on the Agents page and connect it again.');
  }

  var url = typeof input.url === 'string' ? input.url.trim() : '';
  if (!url) return livingRefuse('INVALID_INPUT', 'url is required.');
  var host = livingHost(url);
  if (!host) {
    return livingRefuse('INVALID_INPUT',
      'url must be a whole http:// or https:// address, including the host. Got "' + url + '".');
  }

  // The caller's GHII, whichever principal form arrived: an agent is claude#alice@node, and the
  // settings record belongs to alice@node. Derived from the identity the NODE resolved, never
  // from anything the request carried.
  var ownerGhii = String(ctx.caller.gaii).split('#').pop();
  var account = String(ctx.caller.owner || ownerGhii.split('@')[0] || '');
  var settings = await ctx.memory.getPublic(ownerGhii, 'living-hooks.settings');
  var hosts = livingHosts(ctx.config, settings);
  if (!livingHostAllowed(host, hosts)) {
    return livingRefuse('ALLOWLIST_REFUSED',
      'This node will not call ' + host + ' until you allow it. Write the record living-hooks.settings '
      + 'in your own memory as {"allow_hosts": ["' + host + '"]}. An entry beginning with a dot '
      + '(".example.com") allows that host and everything under it. The node operator can also add '
      + 'a host for everyone in the living-hooks extension settings. Right now this account allows '
      + (hosts.length ? hosts.join(', ') : 'nothing') + '.');
  }

  var stateKey = livingStateKey(account);
  var state = await ctx.memory.get(stateKey);
  if (!state || typeof state !== 'object') state = { w: 0, sends: 0, reads: 0, cache: {} };
  if (!state.cache || typeof state.cache !== 'object') state.cache = {};

  return {
    host: host,
    url: url,
    ownerGhii: ownerGhii,
    account: account,
    stateKey: stateKey,
    state: state,
    now: Date.parse(ctx.now()),
  };
}

/**
 * The headers this call may carry. Refuses a header name nobody allowed, a value that is not a
 * string, a value over 4096 bytes, and more than 16 of them.
 *
 * A {{secret:NAME}} placeholder is passed through UNTOUCHED and on purpose. ctx.fetch fills it in
 * from the owner's vault after this script has handed the request over, so the value never enters
 * this VM and cannot be read back out of it by anything running here. What stays this script's job
 * is which headers may be sent at all, which is a living-hooks decision and not the platform's.
 */
function livingHeaders(raw, defaults) {
  var out = {};
  var k;
  for (k in defaults) if (Object.prototype.hasOwnProperty.call(defaults, k)) out[k] = defaults[k];
  if (raw === null || raw === undefined) return { ok: true, headers: out };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { refusal: livingRefuse('INVALID_INPUT', 'headers must be a map of name to value.') };
  }
  var seen = 0;
  for (k in raw) {
    if (!Object.prototype.hasOwnProperty.call(raw, k)) continue;
    seen++;
    if (seen > 16) return { refusal: livingRefuse('INVALID_INPUT', 'headers carries more than 16 names.') };
    if (!livingHeaderAllowed(k)) {
      return { refusal: livingRefuse('HEADER_REFUSED',
        'The header "' + k + '" may not be sent from here. Allowed: Authorization, Content-Type, '
        + 'Accept, X-Api-Key, X-Requested-With, and any name starting with X-Living-.') };
    }
    var v = raw[k];
    if (typeof v !== 'string') {
      return { refusal: livingRefuse('INVALID_INPUT', 'The header "' + k + '" must be a string.') };
    }
    if (livingBytes(v) > 4096) {
      return { refusal: livingRefuse('INVALID_INPUT', 'The header "' + k + '" is longer than 4096 bytes.') };
    }
    out[k] = v;
  }
  return { ok: true, headers: out };
}
`;
