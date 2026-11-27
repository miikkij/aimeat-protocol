/**
 * @file public/views/app-join.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's own join page of an app: what a membership costs, and buying it
 *   (wish-sovelluksen-j-senyyden-voi-myyd-maksu-uusinta-ja-p-ttyminen-). `/v1/app-join?app=<owner>/<file>`.
 *   The app's join panel (AIMEAT.iam JoinPanel, the Atelier joinRequest) and the expiry notice of a
 *   self-serve term lead here, and an app may link here itself (AIMEAT.iam.membership.joinUrl()).
 *
 *   It reads GET /v1/apps/:owner/:filename/membership: the roles for sale with price, period, renewal
 *   and seller, and the person's own standing. Signed in, the person buys through the checkout and
 *   Stripe's card page; signed out, they give the email address the membership is for (the purchase
 *   is an invitation, routes/app-membership.ts), or sign in. Back from the card page it completes the
 *   purchase and opens the app, or says that the next step is in the email.
 *
 *   Same page shape as the app-open page (components/AskPage.js).
 * @structure appOf() · money() · AppJoin()
 * @usage '/v1/app-join': () => import('/views/app-join.js')   // spa.html ROUTES
 * @version-history
 *   v1.0.0 — 2026-11-27 — Initial.
 */
import { h } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';
import { t } from '/js/i18n.js';
import { api } from '/js/api.js';
import { showLoginModal } from '/js/services/auth.js';
import { useSession } from '/js/use-session.js';
import { date as fmtDate, money as fmtMoney } from '/js/format.js';
import { AskPage } from '/components/AskPage.js';
import { Action, Loud } from '/components/Action.js';
import { Note } from '/components/Note.js';
import { TextField } from '/components/TextField.js';

const html = htm.bind(h);
const tr = (key, fallback, vars) => {
  const v = t(key, vars);
  if (v && v !== key) return v;
  let s = fallback;
  if (vars) for (const [k, val] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(val));
  return s;
};

/** `?app=owner/file` → its parts, or null. */
function appOf(params) {
  const app = params.get('app') || '';
  const slash = app.indexOf('/');
  return slash > 0 && slash < app.length - 1 ? { owner: app.slice(0, slash), file: app.slice(slash + 1), id: app } : null;
}

/** A price in micro-units, in the reader's own format (/js/format.js). */
const money = (micros, currency) => fmtMoney(micros / 1_000_000, currency);

export default function AppJoin() {
  const params = new URLSearchParams(window.location.search);
  const app = appOf(params);
  const base = app ? `/v1/apps/${encodeURIComponent(app.owner)}/${encodeURIComponent(app.file)}` : '';
  const session = useSession();
  const [offer, setOffer] = useState(null);
  const [state, setState] = useState({ status: 'loading', error: '', note: '' });
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  // A purchase made without an account is paid: the next step is in the person's email.
  const [guestDone, setGuestDone] = useState(false);

  const back = html`<${Action} onClick=${() => { window.location.href = '/v1/home'; }}>${tr('common.back', 'Back')}<//>`;
  const openApp = () => { window.location.href = `${base}?mode=inline`; };
  const returnUrl = () => {
    const u = new URL(window.location.href);
    for (const k of ['aimeat_checkout', 'stripe_session', 'cancelled']) u.searchParams.delete(k);
    return u.toString();
  };

  async function load(note = '') {
    try {
      const res = await api(`${base}/membership`);
      setOffer(res.data);
      setState({ status: 'ready', error: '', note });
    } catch (e) {
      setState({ status: 'error', error: e?.code === 'NOT_FOUND' ? tr('appJoin.notFound', 'This app cannot be found.') : (e?.message || ''), note: '' });
    }
  }

  /** Back from the card page: complete the purchase, then read the standing again. */
  async function finish() {
    const id = params.get('aimeat_checkout');
    if (!id) return '';
    window.history.replaceState(window.history.state, '', returnUrl());
    if (params.get('cancelled') === '1') return tr('appJoin.cancelled', 'The payment was cancelled. Nothing was charged.');
    const cs = params.get('stripe_session');
    if (/^gm_/.test(id)) {
      await api(`${base}/membership/guest/complete`, { method: 'POST', body: JSON.stringify({ purchase: id, stripe_session: cs }) });
      setGuestDone(true);
      return '';
    }
    try {
      await api(`/v1/commerce/checkout-sessions/${encodeURIComponent(id)}/complete`, {
        method: 'POST', body: JSON.stringify({ payment: { handler: 'com.stripe.checkout', instrument: cs } }) });
    } catch (e) {
      if ((e?.response?.error?.code || e?.code) !== 'SESSION_NOT_OPEN') throw e;
    }
    return '';
  }

  // Read once, and again when the person signs in or out on this page.
  const signedIn = !!session;
  useEffect(() => {
    if (!app) { setState({ status: 'error', error: tr('appJoin.noApp', 'This address names no app.'), note: '' }); return; }
    finish().then((note) => load(note), (e) => load(e?.message || ''));
  }, [signedIn]); // eslint-disable-line react-hooks/exhaustive-deps -- app, finish and load are this render's; the query string does not change

  async function buy(role) {
    setBusy(true);
    try {
      if (session) {
        const open = await api('/v1/commerce/checkout-sessions', { method: 'POST', body: JSON.stringify({
          items: [{ kind: 'membership', app: app.id, tool: role, input: { auto_renew: true } }] }) });
        const card = await api(`/v1/commerce/checkout-sessions/${encodeURIComponent(open.data.session.id)}/card`, {
          method: 'POST', body: JSON.stringify({ return_url: returnUrl() }) });
        window.location.assign(card.data.url);
        return;
      }
      const open = await api(`${base}/membership/guest`, { method: 'POST', body: JSON.stringify({ role, email: email.trim(), return_url: returnUrl() }) });
      if (open.data.url) { window.location.assign(open.data.url); return; }
      setState({ status: 'ready', error: '', note: tr('appJoin.testMoney', 'Payments here are test payments, so no card page opens.') });
    } catch (e) {
      setState((s) => ({ ...s, error: e?.message || tr('appJoin.failed', 'The purchase did not start.') }));
    } finally { setBusy(false); }
  }

  if (state.status === 'loading') return html`<${AskPage} message=${tr('appJoin.loading', 'Reading the membership…')} />`;
  if (state.status === 'error') return html`<${AskPage} title=${tr('appJoin.errorTitle', 'The membership cannot be shown')} doors=${back}><${Note} kind="lead">${state.error}<//><//>`;

  const name = offer.name;
  const seller = offer.seller?.display_name || offer.seller?.name || '';
  const me = offer.me;
  const note = state.note ? html`<${Note} kind="lead">${state.note}<//>` : null;
  const err = state.error ? html`<${Note} kind="message" error>${state.error}<//>` : null;

  if (guestDone && !me?.member) {
    return html`<${AskPage} title=${tr('appJoin.guestDoneTitle', 'The membership is paid')}
      doors=${html`<${Action} onClick=${() => { if (!showLoginModal({ redirect: window.location.href })) window.location.href = '/v1/profile'; }}>${tr('appJoin.signIn', 'Sign in')}<//>`}>
      <${Note} kind="lead">${tr('appJoin.guestDone', 'Open the message sent to your email address. Its link makes your account, and you are a member of {app} at once. If you already have an account with that address, sign in: you are a member.', { app: name })}<//><//>`;
  }
  if (me?.is_owner) {
    return html`<${AskPage} title=${tr('appJoin.ownerTitle', 'You own {app}', { app: name })} doors=${html`<${Loud} onClick=${openApp}>${tr('appJoin.open', 'Open the app')}<//>`}>
      <${Note} kind="lead">${tr('appJoin.ownerBody', 'You reach everything in your own app. Members buy here; you set the price in the app\'s member plan.')}<//><//>`;
  }
  if (me?.member) {
    const m = me.member;
    const until = m.expires_at ? fmtDate(m.expires_at) : '';
    const body = !until ? tr('appJoin.memberOpen', 'You are a member of {app} as {role}.', { app: name, role: m.role })
      : m.renews ? tr('appJoin.memberRenews', 'You are a member of {app} as {role} until {date}. It renews by itself; you can stop the renewal in your wallet.', { app: name, role: m.role, date: until })
        : tr('appJoin.memberEnds', 'You are a member of {app} as {role} until {date}. It does not renew.', { app: name, role: m.role, date: until });
    return html`<${AskPage} title=${tr('appJoin.memberTitle', 'You are a member')}
      doors=${html`<${Loud} onClick=${openApp}>${tr('appJoin.open', 'Open the app')}<//><${Action} onClick=${() => { window.location.href = '/v1/profile?tab=wallet'; }}>${tr('appJoin.wallet', 'Your wallet')}<//>`}>
      ${note}<${Note} kind="lead">${body}<//><//>`;
  }

  const roles = (offer.for_sale || []).filter((r) => r.buy_here);
  if (!roles.length) {
    return html`<${AskPage} title=${tr('appJoin.noneTitle', '{app} sells no membership here', { app: name })} doors=${back}>
      ${note}<${Note} kind="lead">${tr('appJoin.noneBody', 'Ask its owner, {seller}, for access.', { seller })}<//><//>`;
  }
  const signIn = html`<${Action} onClick=${() => { if (!showLoginModal({ redirect: window.location.href })) window.location.href = '/v1/profile'; }}>${tr('appJoin.signIn', 'Sign in')}<//>`;
  const guestOpen = !session && offer.guest?.open;
  const doors = roles.map((r) => html`<${Loud} onClick=${() => buy(r.role)} disabled=${busy || (!session && (!guestOpen || !email.trim()))}>${
    roles.length > 1 ? tr('appJoin.buyRole', 'Buy {role}', { role: r.role }) : tr('appJoin.buy', 'Buy membership')}<//>`);
  return html`
    <${AskPage} title=${tr('appJoin.title', 'A membership of {app}', { app: name })} doors=${html`${doors}${session ? null : signIn}`}>
      ${note}
      ${roles.map((r) => html`<${Note} kind="lead">${tr('appJoin.line', '{role}: {price} for {days} days.', { role: r.role, price: money(r.amount, r.currency), days: r.days })} ${
        r.renews ? tr('appJoin.renews', 'It renews by itself, and you can stop the renewal in your wallet at any time.') : tr('appJoin.once', 'One payment, no renewal.')}<//>`)}
      <${Note}>${tr('appJoin.seller', 'Sold by {seller}. You pay on Stripe\'s own page, and the money goes to the seller.', { seller })}<//>
      ${guestOpen ? html`
        <${TextField} label=${tr('appJoin.email', 'Your email address')} value=${email} onInput=${setEmail} />
        <${Note}>${tr('appJoin.guestBody', 'No account yet? Give your email address. After the payment you get a link that makes your account, and you are a member at once. Have an account? Sign in.')}<//>`
        : !session ? html`<${Note}>${tr('appJoin.signInBody', 'Sign in to buy a membership.')}<//>` : null}
      ${err}
    <//>`;
}
