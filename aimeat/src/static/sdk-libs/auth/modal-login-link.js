/**
 * @file auth/modal-login-link.js
 * @description "Email me a sign-in link" in the sign-in modal: the link under the password field,
 *   the step that asks for the address, and what happens when it is sent.
 *
 *   The node mails a link that works once, for 15 minutes (POST /v1/ghii/magic-link). Opening it
 *   lands on GET /v1/ghii/magic-link/open, which opens the session and redirects to the place the
 *   link was asked from, so the person needs no password at all. Accounts an install set creates
 *   have no password until they set one; this is how they sign in again after their welcome link is
 *   used.
 *
 *   THE PLACE IS THIS PAGE, unless the opener names another (showLoginModal's `opts.redirect`, which
 *   the consent popup uses to name the app, because its own page does not outlive the popup). On
 *   the node it is the path; on an app origin it is the whole address, and the node accepts that
 *   only for one of its own published app origins. The node checks it again when the link is
 *   opened, and anything it does not accept lands on the front page.
 *
 *   THE ANSWER NEVER SAYS WHETHER THE ACCOUNT EXISTS. The node answers 200 for any address, and the
 *   step shows the same sentence whatever it answered, including a network failure: telling a
 *   stranger that an address has no account here is the enumeration the endpoint refuses to do.
 *
 *   IT IS NOT RENDERED WHERE IT CANNOT WORK. On a node that sends no mail (EMAIL_LOGIN false) there
 *   is no link, because the request would answer 200 and nothing would ever arrive.
 *
 * @structure loginLinkAskHtml(i) · loginLinkViewHtml(i, field, linkFirst) · hereAddress() · wireLoginLinkStep(ctx) → { open, keep, resume }
 * @usage import { loginLinkAskHtml, loginLinkViewHtml, wireLoginLinkStep } from './modal-login-link.js';
 * @version-history
 *   v1.7.0 -- 2026-11-08 -- keep() and resume(): the language switch draws the step again with the typed
 *     address and, once the link was sent, the sent line (modal-view-keep.js; secaudit2026nov08b round 15b).
 *   v1.6.0 — 2026-11-01 — Opened first, the link to the password reads "Muut kirjautumistavat"
 *     (modal.loginLinkOtherWays), and the address field's example is in the page's language
 *     (modal.emailPlaceholder: "sinä@esimerkki.fi"; Jouni's review of v33, K24).
 *   v1.5.0 — 2026-11-01 — Opened first, the way to the password is a link under the notes that says
 *     when it applies (modal.loginLinkPasswordWhy: "if you set a password yourself"), not a second
 *     button beside Send (Jouni's review, K24 with K62: explain it or hide it).
 *   v1.4.0 — 2026-10-31 — Opened first, the step also says that the demo, the store and the buyer's
 *     own AIMEAT are three places with three sign-ins (modal.loginLinkPlacesFirst), which is why
 *     this one asks again (Jouni's K62: no signed handover from the store; people are told instead).
 *   v1.3.0 — 2026-10-31 — Opened first, the step uses the buyer's words when the page has them
 *     (modal.loginLinkTitleFirst, …DescFirst, emailLabelFirst, …SendFirst and the note under the
 *     button, …NoteFirst): "Kirjaudu omaan AIMEATiisi" (Jouni's review of v31, K24 with K25).
 *   v1.2.0 — 2026-10-31 — The request carries the dialog's language (`lang`), so the mail is in it;
 *     wireLoginLinkStep returns `open`, and opened first the way back reads "Use a password instead" (v27 P1).
 *   v1.1.0 — 2026-09-29 — The request carries `redirect`, so the link returns to this page or to
 *     the place the opener names.
 *   v1.0.0 — 2026-09-29 — Initial (install packages: users created at install sign in by link).
 */
import { escHtml } from './theme.js';
import { EMAIL_LOGIN, APEX_URL, NODE_URL } from './config.js';
import { inIsolatedFrame } from './app-frame.js';
import { currentModalLang } from './i18n.js';

/** The link in the sign-in form's link row, or nothing on a node that sends no mail. */
export function loginLinkAskHtml(i) {
  if (!EMAIL_LOGIN) return '';
  return '<a href="#" id="aimeat-login-link" class="aimeat-link">' + escHtml(i.loginLinkAsk || 'Email me a sign-in link') + '</a>';
}

/**
 * The hidden step that asks for the address.
 * @param {Record<string, string>} i Modal strings.
 * @param {(label: string, input: string, hint?: string, opt?: string) => string} field The modal's field wrapper.
 */
export function loginLinkViewHtml(i, field, linkFirst) {
  if (!EMAIL_LOGIN) return '';
  // Opened first, the way back is the password form, offered as "other ways to sign in".
  var back = linkFirst ? (i.loginLinkOtherWays || i.loginLinkUsePassword || 'Other ways to sign in') : (i.backToLogin || 'Back to Login');
  // Opened first (a node the store sold), it speaks to the buyer: their own AIMEAT, the address
  // they bought with, how long the link lasts and that no password is needed (v31 K24).
  var first = function (key, plain, fallback) { return (linkFirst && i[key]) || i[plain] || fallback; };
  // With the buyer's words the dialog's own heading already says them (modal.js), so the step does
  // not repeat its title and line under it.
  var said = linkFirst && i.loginLinkTitleFirst;
  return '<div id="aimeat-login-link-view" class="aimeat-body" style="display:none">'
    + (said ? '' : '<h3 class="aimeat-sub-title">' + escHtml(first('loginLinkTitleFirst', 'loginLinkTitle', 'Sign in with an emailed link')) + '</h3>'
      + '<p class="aimeat-sub-desc">' + escHtml(first('loginLinkDescFirst', 'loginLinkDesc', 'Enter the email address of your account. We send a link that signs you in. It works once, for 15 minutes.')) + '</p>')
    + field(first('emailLabelFirst', 'emailLabel', 'Email'), '<input id="aimeat-ll-email" class="aimeat-inp" type="email" autocomplete="email" placeholder="' + escHtml(i.emailPlaceholder || 'you@example.com') + '">')
    + '<div class="aimeat-actions">'
    + '<button id="aimeat-ll-send" class="aimeat-go">' + escHtml(first('loginLinkSendFirst', 'loginLinkSend', 'Send the link')) + '</button>'
    // Opened first, the password is not a second button beside Send: a buyer never chose one, so it
    // is a link at the end that says when it applies (Jouni 2026-11-01, K24 with K62).
    + (linkFirst ? '' : '<button id="aimeat-ll-back" class="aimeat-cancel">' + escHtml(back) + '</button>')
    + '</div>'
    + (linkFirst && i.loginLinkNoteFirst ? '<p class="aimeat-sub-desc">' + escHtml(i.loginLinkNoteFirst) + '</p>' : '')
    // Why this place asks again although the store already knows the buyer (K62).
    + (linkFirst && i.loginLinkPlacesFirst ? '<p class="aimeat-sub-desc">' + escHtml(i.loginLinkPlacesFirst) + '</p>' : '')
    + (linkFirst ? '<p class="aimeat-sub-desc">' + (i.loginLinkPasswordWhy ? escHtml(i.loginLinkPasswordWhy) + ' ' : '')
      + '<a href="#" id="aimeat-ll-back" class="aimeat-link">' + escHtml(back) + '</a></p>' : '')
    + '<p id="aimeat-ll-msg" class="aimeat-msg"></p>'
    + '</div>';
}

/**
 * Where this page is, as the link should return to it: the path on the node itself, the whole
 * address on any other origin (an app's own), and nothing in the isolated frame, whose address is
 * not a page a person can be sent to.
 * @returns {string}
 */
export function hereAddress() {
  if (inIsolatedFrame()) return '';
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return '';
  var node = '';
  try { node = new URL(APEX_URL || NODE_URL).origin; } catch { /* no node address known: this page is the node */ }
  if (!node || location.origin === node) return location.pathname + location.search + location.hash;
  return location.href;
}

/**
 * Wire the link and the step. Called once per modal render, alongside the other views' wiring.
 *
 * @param {object} ctx
 * @param {Record<string, string>} ctx.i Modal strings.
 * @param {(path: string, opts: any) => Promise<any>} ctx.api The modal's request helper.
 * @param {(view: string) => void} ctx.showView Shows one view of the modal.
 * @param {string} [ctx.redirect] The place the link returns to; this page when absent.
 * @param {{ linkFirstOpened?: boolean } | null} [ctx.openFirst] The dialog's options, when it opens on this step.
 * @returns {{ open: () => void, keep?: () => any, resume?: (state: any) => void }}
 */
export function wireLoginLinkStep(ctx) {
  var i = ctx.i;
  var ask = document.getElementById('aimeat-login-link');
  if (!ask) return { open: function () { /* no mail on this node: nothing to open */ } };
  var emailEl = /** @type {any} */ (document.getElementById('aimeat-ll-email'));
  var sendBtn = /** @type {any} */ (document.getElementById('aimeat-ll-send'));
  var msgEl = document.getElementById('aimeat-ll-msg');

  function open() {
    // An address already typed into the sign-in field comes along.
    var typed = /** @type {any} */ (document.getElementById('aimeat-username'));
    if (typed && typed.value.indexOf('@') > 0 && !emailEl.value) emailEl.value = typed.value.trim();
    msgEl.style.display = 'none';
    ctx.showView('login-link');
    setTimeout(function () { emailEl.focus(); }, 30);
  }
  ask.addEventListener('click', function (e) {
    e.preventDefault();
    open();
  });
  document.getElementById('aimeat-ll-back').addEventListener('click', function (e) { e.preventDefault(); ctx.showView('login'); });

  async function send() {
    var email = emailEl.value.trim();
    if (!email) { emailEl.focus(); return; }
    var label = i.loginLinkSend || 'Send the link';
    sendBtn.textContent = i.working || 'Working...';
    sendBtn.disabled = true;
    /** @type {Record<string, string>} */
    var body = { email: email, lang: currentModalLang() };
    var back = (typeof ctx.redirect === 'string' && ctx.redirect) ? ctx.redirect : hereAddress();
    if (back) body.redirect = back;
    try {
      await ctx.api('/v1/ghii/magic-link', { method: 'POST', body: JSON.stringify(body) });
    } catch { /* the same sentence either way: the answer must not say whether the account exists */ }
    msgEl.textContent = i.loginLinkSent || 'If an account here has this verified address, we sent a sign-in link to it. Check your inbox.';
    msgEl.style.display = 'block';
    sendBtn.textContent = label;
    sendBtn.disabled = false;
  }
  sendBtn.addEventListener('click', send);
  emailEl.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (!sendBtn.disabled) send();
  });

  // A caller whose people mostly have no password (the store's buyers, v27 P1) opens the dialog on
  // this step, with the password one press away. Once per dialog: the flag lives on the dialog's
  // own options, so a redraw of the same dialog does not pull the person back here.
  var first = ctx.openFirst;
  if (first && !first.linkFirstOpened) { first.linkFirstOpened = true; open(); }
  return {
    open: open,
    /** The typed address and whether the link was sent, for the language switch (modal-view-keep.js). */
    keep: function () { return { email: emailEl.value, sent: msgEl.style.display === 'block' }; },
    /** Draw the step again with what keep() returned, the sent line in this drawing's words. Sends nothing. */
    resume: function (state) {
      open();
      emailEl.value = state.email || '';
      if (!state.sent) return;
      msgEl.textContent = i.loginLinkSent || 'If an account here has this verified address, we sent a sign-in link to it. Check your inbox.';
      msgEl.style.display = 'block';
    },
  };
}
