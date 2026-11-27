/**
 * @file iam/membership.js
 * @description AIMEAT.iam.membership: buying a membership of this app, for an app on the node roster
 *   (init({ app })). The owner prices a role in the member plan; the node sells it (routes/apps/membership.ts,
 *   commerce/membership-sale.ts), and this is the app's side of that.
 *
 *     joinUrl()           the node's own join page for this app (/v1/app-join?app=…)
 *     status()            what is for sale (price, period, renewal, seller) and the caller's standing
 *     buy(role, opts)     signed in: a checkout for one period and Stripe's card page; not signed in,
 *                         with opts.email: the purchase without an account (the address gets the link)
 *     finish()            on the page the card page returned to: completes the purchase
 *     cancel(role)        stops the renewal; the paid period runs to its end
 *
 *   The money goes to the app owner's own Stripe account, and the person pays on Stripe's own page.
 *   An app needs no spend permission for its own membership (commerce/app-checkout-reach.ts).
 * @structure makeMembership
 * @usage
 *   await AIMEAT.iam.init({ app: 'alice/club.html' });
 *   const s = await AIMEAT.iam.membership.status();   // { for_sale: [{ role, amount, currency, days, renews }], me }
 *   await AIMEAT.iam.membership.buy('member');           // sends the person to the card page
 *   const done = await AIMEAT.iam.membership.finish(); // on the return page: null, { cancelled }, or { member, guest }
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-).
 */
import { resolveNodeUrl } from '../_core/config.js';

/** `owner/file.html` → `/v1/apps/<owner>/<file>/membership`. */
function base(appId) {
  const [owner, filename] = String(appId).split('/');
  return '/v1/apps/' + encodeURIComponent(owner || '') + '/' + encodeURIComponent(filename || '') + '/membership';
}

/** An error carrying the node's code, so a page can say it in its own words. */
function refusal(res, fallback) {
  const e = /** @type {Error & { code?: string, status?: number }} */ (new Error((res && res.error && res.error.message) || fallback));
  e.code = res && res.error && res.error.code;
  e.status = res && res.status;
  return e;
}

/** A request without a session (the purchase without an account), in the envelope shape authFetch answers. */
async function plain(path, opts) {
  const r = await fetch(resolveNodeUrl() + path, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts && opts.headers) } });
  let body;
  try {
    body = await r.json();
  } catch (e) {
    // An answer that is not the node's envelope (a proxy's page) is a refusal with its own words.
    return { ok: false, status: r.status, data: undefined, error: { code: 'UNREADABLE_ANSWER', message: 'The node answered something that is not JSON (' + String(e) + ')' } };
  }
  return { ok: r.ok, status: r.status, data: body && body.data, error: body && body.error };
}

/**
 * @param {() => string|null} appOf   the app init() was given
 * @param {(path: string, opts?: RequestInit) => Promise<any>} call   the account session's fetch
 * @param {() => boolean} signedIn
 */
export function makeMembership(appOf, call, signedIn) {
  const app = function () {
    const a = appOf();
    if (!a) throw new Error('aimeat-iam: membership needs AIMEAT.iam.init({ app: "owner/file.html" }) first');
    return a;
  };
  const returnUrl = function (opts) { return (opts && opts.returnUrl) || window.location.href.split('#')[0]; };

  const membership = {
    /** The node's own join page for this app, where anybody, signed in or not, sees the price and buys. */
    joinUrl() {
      return resolveNodeUrl() + '/v1/app-join?app=' + encodeURIComponent(app());
    },

    /** What is for sale and the caller's own standing (GET /v1/apps/:owner/:filename/membership). */
    async status() {
      const res = signedIn() ? await call(base(app())) : await plain(base(app()));
      if (!res.ok) throw refusal(res, 'The membership could not be read');
      return res.data;
    },

    /**
     * Buy one period of `role`. Signed in: opens a checkout and sends the person to the card page.
     * Not signed in: `opts.email` is required, and the purchase is made for that address.
     * @param {string} role
     * @param {{ email?: string, autoRenew?: boolean, returnUrl?: string, redirect?: boolean }} [opts]
     *   redirect: false resolves with { url } instead of leaving the page.
     */
    async buy(role, opts) {
      const autoRenew = !(opts && opts.autoRenew === false);
      let url;
      if (signedIn()) {
        const open = await call('/v1/commerce/checkout-sessions', { method: 'POST', body: JSON.stringify({
          items: [{ kind: 'membership', app: app(), tool: role, input: { auto_renew: autoRenew } }] }) });
        if (!open.ok) throw refusal(open, 'The purchase could not be opened');
        const card = await call('/v1/commerce/checkout-sessions/' + encodeURIComponent(open.data.session.id) + '/card', {
          method: 'POST', body: JSON.stringify({ return_url: returnUrl(opts) }) });
        if (!card.ok) throw refusal(card, 'The card page could not be opened');
        url = card.data.url;
      } else {
        if (!opts || !opts.email) throw new Error('aimeat-iam: buy() without a signed-in account needs { email }');
        const open = await plain(base(app()) + '/guest', { method: 'POST', body: JSON.stringify({
          role: role, email: opts.email, return_url: returnUrl(opts), auto_renew: autoRenew }) });
        if (!open.ok) throw refusal(open, 'The purchase could not be opened');
        url = open.data.url;
      }
      if (opts && opts.redirect === false) return { url: url };
      window.location.assign(url);
      return { url: url };
    },

    /**
     * On the page the card page returned to: complete the purchase. Resolves with null when this page
     * was not opened by a card page, { cancelled: true } when the person gave up, { member: true } for
     * a signed-in purchase, and { guest: true, message } for a purchase made without an account (the
     * next step is in the person's email).
     */
    async finish() {
      const q = new URLSearchParams(window.location.search);
      const id = q.get('aimeat_checkout');
      if (!id) return null;
      // The return address is read once: a reload or a second component does not complete it again.
      const clean = new URL(window.location.href);
      for (const k of ['aimeat_checkout', 'stripe_session', 'cancelled']) clean.searchParams.delete(k);
      window.history.replaceState(window.history.state, '', clean.toString());
      if (q.get('cancelled') === '1') return { cancelled: true };
      const cs = q.get('stripe_session');
      if (/^gm_/.test(id)) {
        const res = await plain(base(app()) + '/guest/complete', { method: 'POST', body: JSON.stringify({ purchase: id, stripe_session: cs }) });
        if (!res.ok) throw refusal(res, 'The purchase could not be completed');
        return { guest: true, message: res.data.message };
      }
      const res = await call('/v1/commerce/checkout-sessions/' + encodeURIComponent(id) + '/complete', {
        method: 'POST', body: JSON.stringify({ payment: { handler: 'com.stripe.checkout', instrument: cs } }) });
      if (!res.ok && !(res.error && res.error.code === 'SESSION_NOT_OPEN')) throw refusal(res, 'The card payment could not be completed');
      return { member: true };
    },

    /** Stop the renewal of the caller's membership as `role`; the paid period runs to its end. */
    async cancel(role) {
      const s = await membership.status();
      const sub = ((s.me && s.me.subscriptions) || []).find(function (x) { return x.role === role && x.auto_renew; });
      if (!sub) throw new Error('aimeat-iam: no renewing membership as ' + role);
      const res = await call('/v1/commerce/subscriptions/' + encodeURIComponent(sub.ext) + '/' + encodeURIComponent(role) + '/cancel', { method: 'POST', body: '{}' });
      if (!res.ok) throw refusal(res, 'The renewal could not be stopped');
      return res.data.subscription;
    },
  };
  return membership;
}
