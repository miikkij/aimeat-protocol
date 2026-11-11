/**
 * @file auth/modal.js
 * @description aimeat-auth sign-in modal (SDK-libs migration Phase 3): the password + social login
 *   modal with its own EN/FI switcher, forgot-password / forgot-username sub-views, and the
 *   email-completion sub-view (legacy accounts + the register-under-email-gate flow).
 *
 *   TWO TABS, one job each. Sign in takes a username OR the email the account was verified with
 *   (the server resolves it) and never creates anything. Create account takes the username, the
 *   password, an optional display name, and — when this node's gate requires one (config prelude
 *   `emailRequired`) — the email, asked up front rather than demanded after a failed create.
 *   Social buttons sit outside both tabs because one provider button serves both.
 * @structure showLoginModal(opts, renderBtn, onClosed?) → { buildModalInner, wireModal, render, switchLang,
 *   openEmailCompletion (modal-email-step.js), showView, capture/restoreInputs, keep/resumeView }.
 * @usage import { showLoginModal } from './modal.js';
 * @version-history
 *   v1.24.0 — 2026-11-11 — The sign-in side's headline and line take the operator's own words for the
 *     dialog's language when it set them (auth.sign_in_title_*, auth.sign_in_line_*; signInText in config.js).
 *   v1.23.0 — 2026-11-10 — Another node's full address (`name@node-id`) that this node cannot sign in
 *     with gets a sentence naming what to type instead of "Cannot reach home node" (foreignAddressText).
 *   v1.22.0 -- 2026-11-08 -- The language switch keeps the view on screen and what it holds (modal-view-keep.js):
 *     a code key's first sign-in keeps its details step, the two-step, code, link, email and recovery
 *     views keep theirs. The complete-account step moved to modal-email-step.js unchanged (max-file-lines)
 *     (secaudit2026nov08b round 15b).
 *   v1.21.0 — 2026-11-08 — A code key's first sign-in opens the sign-in details step (modal-key-credentials.js)
 *     before the dialog closes, and opts.keyCredentials opens it from the front page (secaudit2026nov08 round 14).
 *   v1.20.0 — 2026-11-04 — opts.line replaces the line under the headline on both tabs: why the person is here.
 *   v1.19.0 — 2026-11-02 — The operator's sign-in policy. With password sign-in off the dialog shows no
 *     password form and says which ways in remain; with `operators` the form stands under a line
 *     naming the operators; unless `on`, no register tab. TWO_STEP_SETUP_REQUIRED opens the two-step
 *     enrolment step (modal-two-step.js), and so does opts.twoStepSetup from an emailed link. The
 *     typed-values helpers and the username rules moved to modal-fields.js unchanged (max-file-lines).
 *     The code step and the enrolment step hide the masthead and the tabs; a PASSWORD_SIGN_IN_OFF
 *     refusal is said in the dialog's language and by the policy (modal-constants.js); the
 *     operators-only line stands behind the divider, above the username field.
 *   v1.18.0 — 2026-10-31 — opts.signInOnly: no register tab, and the dialog opens on signing in
 *     whatever opts.tab says (a node the store sold, v31 K24), headed "Kirjaudu omaan AIMEATiisi"
 *     with no "Forgot username?". The two identifier rules moved to
 *     modal-constants.js unchanged (max-file-lines).
 *   v1.17.0 — 2026-10-31 — Without opts.linkFirst the node decides (LINK_FIRST): a store-bought node that mails opens on the link (v28 #7).
 *   v1.16.0 — 2026-10-31 — opts.linkFirst opens on the emailed-link step (modal-login-link.js; v27 P1).
 *   v1.15.0 — 2026-10-19 — Opens nothing while a first-time provider sign-up is choosing its username
 *     (signup-state.js): the app-open page's sign-in dialog replaced that step on load.
 *   v1.14.0 — 2026-10-09 — opts.secondFactorLink opens the dialog on the code view in link mode (secaudit 2026-10-09, S1).
 *   v1.13.1 — 2026-10-05 — The language comes from _core/lang.js, the one resolver (secaudit 2026-10, M7).
 *   v1.13.0 — 2026-10-05 — A sign-up reaches the code step every time. The late dictionary load no
 *     longer redraws the dialog while a step is open or a button is working (the redraw threw a
 *     person whose POST /v1/ghii had answered 201 back to the form, and a second press then met
 *     "already registered"). A taken name with the same password gets a new code through attach-email,
 *     or a sign-in when the address is already confirmed. The forgot-password and forgot-username
 *     handlers moved to modal-recovery-views.js (pure extraction, for the line ceiling).
 *   v1.12.0 — 2026-09-29 — opts.authError: a refused sign-in's reason in the error line (auth-error.js).
 *   v1.12.0 — 2026-09-29 — opts.redirect names the place an emailed sign-in link returns to; without
 *     it the link returns to this page (modal-login-link.js).
 *   v1.11.0 — 2026-09-29 — "Email me a sign-in link" joins the link row on a node that sends mail
 *     (modal-login-link.js); a person with no password signs in from their inbox.
 *   v1.10.0 — 2026-09-13 — The modal stops calling opts.onLogin. The developer decided that onLogin runs
 *     for every session that becomes available, restores included, with { restored }; it is called
 *     from the 'login' event through on-login.js, by whoever opened the modal (the pill,
 *     AIMEAT.auth.signIn, AIMEAT.auth.showLoginModal). A modal that also called it would have made
 *     one interactive sign-in call it twice.
 *   v1.9.0 — 2026-09-13 — An optional third argument, called when the dialog leaves the page by any
 *     road, so AIMEAT.auth.signIn() can settle with the session or with null when it is dismissed.
 *   v1.8.0 — 2026-09-04 — The passkey button, first in the sign-in tab (modal-passkey.js). Pressed
 *     with the name field empty it starts a discoverable ceremony and the person types nothing at
 *     all; absent on a browser without WebAuthn.
 *   v1.7.0 — 2026-09-04 — The second-factor step (modal-totp.js). An account with two-step sign-in
 *     answered the login with TOTP_REQUIRED, which this modal rendered as a red line with nowhere to
 *     go, so arming TOTP locked the person out of every AIMEAT front end. Now the refusal opens a
 *     code view that takes the six digits or one backup code and finishes the same login. The three
 *     recovery sub-views' markup left for modal-recovery-views.js in the same change, as a pure
 *     extraction: the new step took this file past the 800-line ceiling.
 *   v1.6.1 — 2026-08-29 — The hints and the username rules show only while the person is in the field
 *     (modal-styles.js, :focus-within); the has-value class that kept them on screen is gone.
 *   v1.6.0 — 2026-08-29 — Three ways out: an X in the top-right corner (the one people look for first),
 *     Escape, and a click on the page behind; the last two close only while nothing has been typed.
 *   v1.5.1 — 2026-08-29 — A field's hint shows only while the person is in that field or has written in
 *     it (the has-value class modal-styles.js reads); the create tab's headline is "Welcome in.".
 *   v1.5.0 — 2026-08-29 — The poster face (design canvas "AIMEAT Sign-in Dialog", headline-led): the
 *     wordmark and the node's domain as a crumb, the sentence as the masthead, ink frame and sun
 *     shadow, underlined fields, the styles class-based and token-driven in modal-styles.js. The
 *     username field keeps only what the server accepts and shows the three name rules from the
 *     first typed character; the display-name hint says why it is worth filling in.
 *   v1.4.1 — 2026-08-24 — SECURITY (CodeQL js/xss-through-dom): the provider id is read back from the
 *     DOM before it is spliced into the login URL, so it is validated to the provider-id shape (a
 *     slug, optionally scheme:tenant) first; a tampered data-provider no longer steers navigation.
 *   v1.4.0 — 2026-08-24 — SSO connection buttons (BR-04): a colon provider id (saml:contoso)
 *     navigates to its slash login path; no icon is fine, the organisation name is the label.
 *   v1.3.0 — 2026-08-12 — The language switch is generated from MODAL_LANGS instead of two written-out
 *     buttons. Spanish arrived and the modal kept offering EN and FI while serving Spanish text.
 *   v1.0.0 — 2026-07-19 — Extracted from src/routes/libs/auth-lib-part2/3.ts (SDK-libs migration Phase 3).
 *   v1.0.1 — 2026-07-25 — Fix: adopt the node's full locale dict when any key differs, so newer modal
 *     keys (email-step strings) missing from a host's opts.i18n no longer fall back to English.
 *   v1.2.0 — 2026-08-08 — opts.tab opens straight on 'register', so a button that says "register"
 *     no longer opens a sign-in form and leave the person to find the tab.
 *   v1.1.0 — 2026-08-07 — Split the single register-or-login form into Sign in / Create account tabs;
 *     the email field appears in Create account when the node's gate asks for it; Sign in accepts the
 *     account's verified email as the identifier. Measured problem: one form doing both jobs asked for
 *     a display name to sign in, never mentioned email until a create attempt had already failed, and
 *     turned a mistyped username into a second empty account.
 */
import { auth, api, restoreSessionFromCookie } from './session.js';
import { escHtml } from './theme.js';
import { currentModalLang, loadModalI18n, MODAL_LANGS } from './i18n.js';
import { writeLang } from '../_core/lang.js';
import { NODE_URL, NODE_ID, AUTH_PROVIDERS, PROVIDER_ICONS, EMAIL_REQUIRED, LINK_FIRST, PASSWORD_SIGN_IN, signInText } from './config.js';
import { MODAL_CSS, HEART_SVG, RULE_MARKS } from './modal-styles.js';
import { totpViewHtml, wireTotpStep } from './modal-totp.js';
import { recoveryViewsHtml, wireRecoveryViews } from './modal-recovery-views.js';
import { passkeyButtonHtml, wirePasskeyButton } from './modal-passkey.js';
import { loginLinkAskHtml, loginLinkViewHtml, wireLoginLinkStep } from './modal-login-link.js';
import { showAuthErrorIn } from './auth-error.js';
import { signupInProgress } from './signup-state.js';
import { EMAIL_RE, OWNER_NAME_RE, passwordRefusalText, foreignAddressText, operatorsOnlyNoteHtml } from './modal-constants.js';
import { captureInputs, restoreInputs, wireUsernameRules, wireEnterSubmits } from './modal-fields.js';
import { twoStepViewHtml, wireTwoStepStep } from './modal-two-step.js';
import { keyCredentialsViewHtml, wireKeyCredentialsStep } from './modal-key-credentials.js';
import { wireEmailStep } from './modal-email-step.js';
import { keepView, resumeView } from './modal-view-keep.js';

/** The domain in the crumb above the headline: this node's own, so a self-hosted node shows its
 *  domain there and the wordmark beside it says what the software is. */
const NODE_HOST = (function () {
  try { return new URL(NODE_URL).host; } catch { return (typeof location !== 'undefined' && location.host) || ''; }
})();

export function showLoginModal(opts, renderBtn, onClosed) {
  // A first-time provider sign-in is choosing its username in the same #aimeat-modal; opening the
  // sign-in dialog now would replace that step and send the person round to the provider again
  // (signup-state.js). The sign-up finishes by loading the page it started from, signed in.
  if (signupInProgress()) return;
  var i = opts.i18n || {};
  var lang = currentModalLang();
  // Which of the two tabs is showing. One modal, two separate jobs: signing in needs an identifier
  // and a password, creating an account needs a name to be known by and (on nodes with the email
  // gate) an address. Merging them into one form meant neither said what it wanted.
  // A caller that already knows which job the person came to do can say so: a button reading
  // "Register your home" opening a sign-in form is a small lie, and the person has to find the
  // tab themselves. Anything other than 'register' keeps the previous behaviour.
  // signInOnly: the caller's node takes no new accounts here, so the dialog has no register tab
  // (a node the store sold has its owner already, and others come in by invitation: v31 K24).
  var signInOnly = !!opts.signInOnly;
  // A node whose password sign-in policy is not 'on' refuses a new password, so it shows no register tab.
  var noRegister = signInOnly || PASSWORD_SIGN_IN !== 'on', passwordOff = PASSWORD_SIGN_IN === 'off';
  var tab = opts.tab === 'register' && !noRegister ? 'register' : 'signin', linkFirst = opts.linkFirst === undefined ? LINK_FIRST : !!opts.linkFirst;
  // Remove existing modal
  const old = document.getElementById('aimeat-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'aimeat-modal';
  // The opener may want to hear the dialog leave the page, however it leaves: the X, Cancel,
  // Escape, the page behind, a finished sign-in, or a newer dialog replacing this one. Each of those
  // calls modal.remove(), so that is the one place to listen (AIMEAT.auth.signIn settles on it).
  if (typeof onClosed === 'function') {
    var removeModal = modal.remove.bind(modal);
    modal.remove = function () { removeModal(); onClosed(); };
  }

  // Typed values survive a re-render (captureInputs, restoreInputs: modal-fields.js).
  // Switch language: persist the choice, reload translations, re-render in place (no page reload).
  // The view on screen and what it holds come back too (modal-view-keep.js): the steps are set by
  // each wireModal(), so `steps` names the drawing on screen.
  /** @type {Record<string, any>} */ var steps = {};
  function switchLang(next) {
    if (next === lang) return;
    writeLang(next);
    var vals = captureInputs();
    var kept = keepView(steps);
    loadModalI18n(next).then(function (fresh) {
      lang = next;
      if (fresh && Object.keys(fresh).length) i = fresh;
      render(false);
      restoreInputs(vals);
      resumeView(steps, kept);
    });
  }

  /** True when the person has left the two tabs for a step, or a button is waiting on a request. */
  function busyOrAway() {
    var body = document.getElementById('aimeat-modal-body'), away = !!body && body.style.display === 'none';
    // The emailed-link step a linkFirst dialog opened by itself is not "away": it is redrawn in the
    // page's words and opened again, once (v27 P1; it stayed English on a Finnish page).
    if (away && linkFirst && !opts.linkFirstRedrawn) { opts.linkFirstRedrawn = true; opts.linkFirstOpened = false; away = false; }
    return away || !!modal.querySelector('button:disabled');
  }

  function render(anim) {
    modal.innerHTML = buildModalInner(i, lang, anim, tab);
    wireModal();
    if (opts.authError) showAuthErrorIn(i, opts.authError);
  }

  document.body.appendChild(modal);
  render(true);

  // Adopt the node's full, correct-language dictionary. `fresh` is authoritative: it corrects a
  // wrong-language opts.i18n AND — the common case — fills newer keys the host's opts.i18n predates
  // (e.g. the email-step strings), which a signInBtn/descNew-only guard would wrongly skip, leaving
  // those keys undefined and rendering their English fallbacks.
  loadModalI18n(lang).then(function (fresh) {
    if (!fresh || !Object.keys(fresh).length) return;
    var differs = false;
    for (var k in fresh) {
      if (Object.prototype.hasOwnProperty.call(fresh, k) && fresh[k] !== i[k]) { differs = true; break; }
    }
    if (!differs) return;
    i = fresh;
    // The redraw replaces every element. Pressed under a request that is still running, it threw the
    // person back to the form while the request's answer opened the code step in the new, hidden copy:
    // a sign-up whose POST /v1/ghii answered 201 showed no code field (3 of 11 finished on 2026-10-05;
    // the dictionary fetch is uncached and can arrive seconds late). Once a step is open or a button is
    // working, the new strings wait for the next redraw.
    if (busyOrAway()) return;
    var vals = captureInputs();
    render(false);
    restoreInputs(vals);
  });

  function buildModalInner(i, lang, anim, tab) {
    var isReg = tab === 'register';
    // One rule line under the username: the mark on the left flips from a hollow square to a
    // check when the rule is met (wireModal keeps it in step with the typed value).
    function rule(key, text) {
      return '<div class="aimeat-rule" data-rule="' + key + '">' + RULE_MARKS + '<span>' + escHtml(text) + '</span></div>';
    }
    function field(label, input, hint, opt) {
      return '<div class="aimeat-field"><label class="aimeat-label"><span>' + escHtml(label) + '</span>'
        + (opt ? '<span class="aimeat-opt">' + escHtml(opt) + '</span>' : '') + '</label>'
        + input + (hint || '') + '</div>';
    }
    return '<style>' + MODAL_CSS + '</style>'
      + '<div class="aimeat-scrim">'
      + '<div class="aimeat-dlg' + (anim ? ' aimeat-in' : '') + '">'
      + '<div class="aimeat-head">'
      // The crumb: the wordmark (AIME, the heart, AT) and this node's own domain, so a self-hosted
      // node shows its domain here and the wordmark beside it says what the software is.
      + '<div class="aimeat-crumb">'
      + '<div class="aimeat-brand"><span class="aimeat-mark">AIME' + HEART_SVG + '<b>AT</b></span>'
      + (NODE_HOST ? '<span class="aimeat-host">' + escHtml(NODE_HOST) + ' /</span>' : '')
      + '</div>'
      // One button per language the NODE ships, from MODAL_LANGS — the modal loads its strings from
      // that node's /locales/<tag>.json, so the list of buttons and the list of files are the same
      // list. Writing the languages out here is how the switch came to offer two while the node
      // served three.
      + '<div class="aimeat-crumb-right">'
      + '<div class="aimeat-langsw" role="group" aria-label="' + escHtml(i.switchLanguage || 'Language') + '">'
      + MODAL_LANGS.map(function (l) {
        return '<button type="button" class="aimeat-lang' + (lang === l ? ' active' : '')
          + '" data-lang="' + l + '">' + l.toUpperCase() + '</button>';
      }).join('')
      + '</div>'
      // The close control people look for first: top-right, always there. Cancel under the
      // form stays for the people who read.
      + '<button type="button" id="aimeat-close-btn" class="aimeat-close" aria-label="' + escHtml(i.closeDialog || 'Close') + '">'
      + '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3L3 13"></path></svg></button>'
      + '</div>'
      + '</div>'
      // The masthead: one sentence in the poster face, and the line under it. Which tab is open
      // decides both.
      + '<h2 class="aimeat-headline">'
      // The operator's own words for this language come first (auth.sign_in_title_*, signInText): a
      // node such as a store says what is signed in to. A buyer (signInOnly) is otherwise signing in to
      // the AIMEAT they bought, with the address they bought it with. A caller's opts.line, the reason
      // for this one dialog, still wins over the operator's line.
      + escHtml(isReg ? (i.headlineNew || 'Welcome in.') : (signInText('title', lang) || ((signInOnly || linkFirst) && i.loginLinkTitleFirst) || i.headlineReturning || 'Welcome back.'))
      + '</h2>'
      + '<p class="aimeat-line">'
      + escHtml(opts.line || (isReg
        ? (i.lineNew || 'Pick a username and password.')
        : (signInText('line', lang) || ((signInOnly || linkFirst) && i.loginLinkDescFirst) || i.descReturning || 'Enter the username or email you signed up with.')))
      + '</p>'
      // Two tabs, two jobs. Which one is showing decides what the body asks for.
      + (noRegister ? '' : '<div class="aimeat-tabs" role="tablist">'
      + '<button type="button" role="tab" class="aimeat-tab' + (isReg ? '' : ' active') + '" data-tab="signin" aria-selected="' + (isReg ? 'false' : 'true') + '">' + escHtml(i.tabSignIn || 'Sign in') + '</button>'
      + '<button type="button" role="tab" class="aimeat-tab' + (isReg ? ' active' : '') + '" data-tab="register" aria-selected="' + (isReg ? 'true' : 'false') + '">' + escHtml(i.tabRegister || 'Create account') + '</button>'
      + '</div>')
      + '</div>'
      // Body
      + '<div id="aimeat-modal-body" class="aimeat-body">'
      // ── Sign-in tab: an identifier the person actually remembers, and a password.
      + '<div id="aimeat-tab-signin"' + (isReg ? ' style="display:none"' : '') + '>'
      // The passkey offer sits FIRST, because it is the shortest way in and needs nothing typed.
      // Absent entirely on a browser without WebAuthn: an offer that cannot be taken is worse than
      // no offer.
      + passkeyButtonHtml(i)
      // The password form: hidden when the node takes no password sign-in, and under a line naming
      // the operators when only they may use it (auth.password_sign_in).
      + '<div id="aimeat-pw-form"' + (passwordOff ? ' style="display:none"' : '') + '>'
      + operatorsOnlyNoteHtml(i, !!passkeyButtonHtml(i))
      + field(i.identifierLabel || 'Username or email',
        '<input id="aimeat-username" class="aimeat-inp" autocomplete="username" placeholder="' + escHtml(i.identifierPlaceholder || 'Username or email') + '">')
      + field(i.passwordLabel || 'Password',
        '<input id="aimeat-password" type="password" autocomplete="current-password" class="aimeat-inp" placeholder="' + escHtml(i.passwordPlaceholder || 'Password') + '">')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i.signInOnlyBtn || 'Sign in') + '</button>'
      + '<button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
      + '</div></div>'
      + '<p id="aimeat-error" class="aimeat-err"></p>'
      + (passwordOff ? '<p class="aimeat-hint">' + escHtml(i.passwordSignInOff || 'This server does not use passwords. Sign in with a passkey, your organisation\'s sign-in or a sign-in link sent to your email.') + '</p>' : '')
      + '<div class="aimeat-links">'
      + '<a href="#" id="aimeat-forgot-pw" class="aimeat-link"' + (passwordOff ? ' style="display:none"' : '') + '>' + escHtml(i.forgotPassword || 'Forgot password?') + '</a>'
      + '<a href="#" id="aimeat-forgot-user" class="aimeat-link"' + (signInOnly || passwordOff ? ' style="display:none"' : '') + '>' + escHtml(i.forgotUsername || 'Forgot username?') + '</a>'
      + loginLinkAskHtml(i)
      + '</div>'
      + '</div>'
      // ── Register tab: the account being made. The email field is here from the start when the
      //    node's gate requires one, rather than appearing after a failed create. The username's
      //    three rules sit under it, shown from the first typed character.
      + '<div id="aimeat-tab-register"' + (isReg ? '' : ' style="display:none"') + '>'
      + field(i.usernameLabel || 'Username',
        '<input id="aimeat-reg-username" class="aimeat-inp" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="64" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '">'
        + '<div id="aimeat-reg-rules" class="aimeat-rules">'
        + rule('len', i.usernameRuleLength || '3 to 64 characters')
        + rule('chars', i.usernameRuleChars || 'Letters a to z, digits and hyphens')
        + rule('edges', i.usernameRuleEdges || 'Starts and ends with a letter or digit')
        + '</div>',
        '<p class="aimeat-hint">' + escHtml(i.usernameLowercase || 'Capital letters become lowercase.') + ' ' + escHtml(i.usernameHint || 'This becomes your permanent name here.') + '</p>')
      + (EMAIL_REQUIRED
        ? field(i.emailLabel || 'Email',
          '<input id="aimeat-reg-email" type="email" autocomplete="email" class="aimeat-inp" placeholder="you@example.com">',
          '<p class="aimeat-hint">' + escHtml(i.registerEmailHint || 'We send a 6-digit code here to confirm the address. You can sign in with it later.') + '</p>')
        : '')
      + field(i.passwordLabel || 'Password',
        '<input id="aimeat-reg-password" type="password" autocomplete="new-password" class="aimeat-inp" placeholder="' + escHtml(i.passwordPlaceholder || 'Password (min 8 chars)') + '">')
      + field(i.displayNameLabel || 'Display Name',
        '<input id="aimeat-reg-displayname" class="aimeat-inp" placeholder="' + escHtml(i.displayNamePlaceholder || 'Display Name') + '">',
        '<p class="aimeat-hint">' + escHtml(i.displayNameWhy || 'Worth filling in: without it, your username is the name everyone sees.') + '</p>',
        i.displayNameOptional || 'optional')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-reg-btn" class="aimeat-go">' + escHtml(i.createAccountBtn || 'Create account') + '</button>'
      + '<button id="aimeat-reg-cancel-btn" class="aimeat-cancel">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
      + '</div>'
      + '<p id="aimeat-reg-error" class="aimeat-err"></p>'
      + '</div>'
      // Social login — one button per enabled OIDC provider, baked from config. Outside both tabs:
      // the same button both creates an account and signs an existing one in.
      + (AUTH_PROVIDERS.length ? (
        '<div class="aimeat-or"><span></span><b>' + escHtml(i.orLabel || 'OR') + '</b><span></span></div>'
        + AUTH_PROVIDERS.map(function (p) {
          return '<button type="button" class="aimeat-oauth-btn" data-provider="' + escHtml(p.id) + '">'
            + (PROVIDER_ICONS[p.id] || '')
            + escHtml((i[p.i18nKey]) || p.label) + '</button>';
        }).join('')
      ) : '')
      + '</div>'
      // The forgot-password, forgot-username and complete-account sub-views (all hidden here).
      + recoveryViewsHtml(i, field)
      + loginLinkViewHtml(i, field, linkFirst, lang)
      // Second-factor sub-view (hidden) — opened when the login answers TOTP_REQUIRED.
      + totpViewHtml(i, field)
      // Two-step enrolment (hidden): the operator requires two-step sign-in (modal-two-step.js).
      + twoStepViewHtml(i, field)
      // A code key's first sign-in: the new sign-in details (modal-key-credentials.js).
      + keyCredentialsViewHtml(i, field)
      // Features footer — an argument FOR creating an account, so it rides with the Register tab.
      // A returning person signing in does not need to be sold the thing they already have. A
      // numbered index under an ink rule, the last line in bold.
      + '<div id="aimeat-why" class="aimeat-why"' + (isReg ? '' : ' style="display:none"') + '>'
      + '<h4 class="aimeat-why-title">' + escHtml(i.whyTitle || 'What do you get?') + '</h4>'
      + '<div class="aimeat-why-row"><span class="aimeat-why-num">01</span><span>' + escHtml(i.whyGhii || 'Your own digital identity. Only you control it') + '</span></div>'
      + '<div class="aimeat-why-row"><span class="aimeat-why-num">02</span><span>' + escHtml(i.whyPrivacy || 'Your own private memory space, protected by your password') + '</span></div>'
      + '<div class="aimeat-why-row"><span class="aimeat-why-num">03</span><span>' + escHtml(i.whyAgents || 'Connect AI agents that remember you and work on your behalf') + '</span></div>'
      + '<div class="aimeat-why-row strong"><span class="aimeat-why-num">04</span><span>' + escHtml(i.whyMorsels || 'Your own AI-built apps and agents work for you: your own AI operating system.') + '</span></div>'
      + '</div>'
      + '</div></div>';
  } // end buildModalInner

  function wireModal() {

    // Language switcher (EN/FI) — persists choice + re-renders the modal in place
    modal.querySelectorAll('.aimeat-lang').forEach(function (b) {
      b.addEventListener('click', function () { switchLang(b.getAttribute('data-lang')); });
    });

    ['aimeat-cancel-btn', 'aimeat-reg-cancel-btn', 'aimeat-close-btn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function () { modal.remove(); });
    });

    // Three ways out, and one rule: the X and Cancel always close; a click on the dim page
    // behind the dialog, and Escape, close only while nothing has been typed, because losing
    // a half-filled form to a stray click is worse than a dialog that stays.
    function holdsTypedInput() {
      // The sign-in details step holds a password shown once: only its own button closes it.
      if (/** @type {any} */ (document.getElementById('aimeat-key-view') || {}).style?.display === '') return true;
      var inputs = modal.querySelectorAll('.aimeat-inp');
      for (var k = 0; k < inputs.length; k++) if (/** @type {any} */ (inputs[k]).value) return true;
      return false;
    }
    var scrim = modal.querySelector('.aimeat-scrim');
    if (scrim) scrim.addEventListener('mousedown', function (e) {
      if (e.target === scrim && !holdsTypedInput()) modal.remove();
    });
    function onKey(e) {
      if (!document.body.contains(modal)) { document.removeEventListener('keydown', onKey); return; }
      if (e.key === 'Escape' && !holdsTypedInput()) modal.remove();
    }
    document.addEventListener('keydown', onKey);

    // Tab switch. Re-renders (so the header line, the body and the benefits footer all follow) and
    // carries every typed value across, because switching tabs is not a reason to lose your work.
    modal.querySelectorAll('.aimeat-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        var next = b.getAttribute('data-tab');
        if (next === tab) return;
        var vals = captureInputs();
        tab = next;
        render(false);
        restoreInputs(vals);
        var focusId = tab === 'register' ? 'aimeat-reg-username' : 'aimeat-username';
        setTimeout(function () { var el = document.getElementById(focusId); if (el) el.focus(); }, 30);
      });
    });

    // The username rules, live (modal-fields.js).
    wireUsernameRules();

    // Social sign-in — full-page navigation to the provider's OIDC start endpoint.
    modal.querySelectorAll('.aimeat-oauth-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-provider') || '';
        // `id` is read back from the DOM, so treat it as untrusted here even though it was escaped
        // when written. A provider id is a slug, optionally `scheme:tenant` for an SSO connection;
        // anything else is a tampered attribute and must not steer the navigation.
        if (!/^[a-z0-9_-]+(?::[a-z0-9_-]+)?$/i.test(id)) return;
        var back = encodeURIComponent(location.pathname + location.search + location.hash);
        // SSO connections carry a colon id ('saml:contoso'); their login path is /saml/contoso.
        location.href = NODE_URL + '/v1/ghii/login/' + id.split(':').join('/') + '?redirect=' + back;
      });
    });

    // Helper to toggle between views
    function showView(view) {
      document.getElementById('aimeat-modal-body').style.display = view === 'login' ? '' : 'none';
      document.getElementById('aimeat-forgot-pw-view').style.display = view === 'forgot-pw' ? '' : 'none';
      document.getElementById('aimeat-forgot-user-view').style.display = view === 'forgot-user' ? '' : 'none';
      document.getElementById('aimeat-email-view').style.display = view === 'email' ? '' : 'none';
      document.getElementById('aimeat-totp-view').style.display = view === 'totp' ? '' : 'none';
      document.getElementById('aimeat-two-step-view').style.display = view === 'two-step' ? '' : 'none';
      document.getElementById('aimeat-key-view').style.display = view === 'key' ? '' : 'none';
      var ll = document.getElementById('aimeat-login-link-view'); if (ll) ll.style.display = view === 'login-link' ? '' : 'none';
      // The code step, the two-step enrolment and the sign-in details carry their own heading.
      var step = view === 'totp' || view === 'two-step' || view === 'key';
      modal.querySelectorAll('.aimeat-headline, .aimeat-line, .aimeat-tabs').forEach(function (el) { /** @type {any} */ (el).style.display = step ? 'none' : ''; });
    }

    /** A finished sign-in, whichever step produced it. The caller's onLogin is not called here: the
     *  session core's 'login' event reaches it through on-login.js, once, with the road it came by. */
    function finishLogin() {
      // A code key's first sign-in answered new sign-in details: they are shown before the dialog goes.
      var s = /** @type {any} */ (typeof auth.getSession === 'function' ? auth.getSession() : null);
      var kc = s && s._keyCredentials;
      if (kc && kc.password) { s._keyCredentials = null; keyStep.open({ credentials: kc, jwt: s.jwt }); return; }
      modal.remove();
      renderBtn();
    }
    var keyStep = wireKeyCredentialsStep({ i: i, showView: showView, onDone: function () { modal.remove(); renderBtn(); } });
    if (opts.keyCredentials) { var owed = opts.keyCredentials; opts.keyCredentials = null; keyStep.open(owed); }

    // The passkey button. Its whole ceremony lives in the auth lib; the modal only says where the
    // finished session goes, which is the same place every other sign-in ends.
    wirePasskeyButton({
      i: i,
      signIn: function (username) { return auth.signInWithPasskey(username); },
      onSuccess: finishLogin,
    });

    // "Email me a sign-in link": absent on a node that sends no mail.
    var linkStep = wireLoginLinkStep({ i: i, api: api, showView: showView, redirect: opts.redirect, openFirst: linkFirst && tab === 'signin' ? opts : null });

    // The second-factor step. It holds the password for its own call and drops it when it closes.
    var totpStep = wireTotpStep({
      i: i,
      showView: showView,
      submit: function (user, pass, secondFactor) { return auth.loginWithPassword(user, pass, secondFactor); },
      restoreSession: restoreSessionFromCookie,
      onSuccess: finishLogin,
    });
    // An emailed link on a two-step account opens the dialog on the code view, once (modal-totp.js).
    if (opts.secondFactorLink) { opts.secondFactorLink = false; totpStep.openLinkStep(); }

    // Required two-step enrolment (modal-two-step.js). The node answers a checked sign-in with
    // TWO_STEP_SETUP_REQUIRED and a setup token; an emailed link brings the token in opts.twoStepSetup.
    var twoStep = wireTwoStepStep({ i: i, showView: showView, adopt: function (data) { return auth.adoptLoginAnswer(data); }, onSuccess: finishLogin });
    /** True when the error opened the enrolment step. */
    function twoStepAsked(e) {
      if (!e || e.code !== 'TWO_STEP_SETUP_REQUIRED' || !e.details || !e.details.setup_token) return false;
      twoStep.open(e.details.setup_token);
      return true;
    }
    if (opts.twoStepSetup) { var setupToken = opts.twoStepSetup; opts.twoStepSetup = null; twoStep.open(setupToken); }

    // The complete-account step: an address to confirm before the first session (modal-email-step.js).
    var emailStep = wireEmailStep({ i: i, api: api, auth: auth, showView: showView, finishLogin: finishLogin, twoStepAsked: twoStepAsked, totpStep: totpStep });
    var openEmailCompletion = emailStep.open;

    // Forgot password link
    document.getElementById('aimeat-forgot-pw').addEventListener('click', function (e) {
      e.preventDefault();
      showView('forgot-pw');
      document.getElementById('aimeat-fpw-step1').style.display = '';
      document.getElementById('aimeat-fpw-step2').style.display = 'none';
    });

    // Forgot username link
    document.getElementById('aimeat-forgot-user').addEventListener('click', function (e) {
      e.preventDefault();
      showView('forgot-user');
    });

    // Back to login buttons
    ['aimeat-fpw-back', 'aimeat-fpw-back2', 'aimeat-fu-back', 'aimeat-em-back', 'aimeat-em-back2'].forEach(function (id) {
      document.getElementById(id).addEventListener('click', function () { showView('login'); });
    });

    // Forgot password and forgot username.
    var recovery = wireRecoveryViews({ i: i, api: api, showView: showView });

    // The steps of this drawing, by view name, for the language switch (modal-view-keep.js).
    steps = {
      key: keyStep, 'two-step': twoStep, totp: totpStep, 'login-link': linkStep, email: emailStep,
      'forgot-pw': recovery.forgotPw, 'forgot-user': recovery.forgotUser,
    };

    // Enter submits the tab the field belongs to (modal-fields.js).
    wireEnterSubmits();

    /** Restore a submit button after a failed attempt. */
    function releaseBtn(id, label) {
      var b = /** @type {any} */ (document.getElementById(id));
      if (!b) return;
      b.textContent = label;
      b.disabled = false;
    }

    // ── Sign in: an existing account only. Never creates one, so a typo in the username can no
    //    longer silently register a second account under the misspelling.
    document.getElementById('aimeat-go-btn').addEventListener('click', async () => {
      const raw = /** @type {any} */ (document.getElementById('aimeat-username')).value.trim().toLowerCase();
      const password = /** @type {any} */ (document.getElementById('aimeat-password')).value;
      const errEl = document.getElementById('aimeat-error');
      const signInLabel = i.signInOnlyBtn || 'Sign in';
      errEl.style.display = 'none';

      // Three shapes reach this field: an email (the server resolves it to the account by its
      // verified address), a full GHII `name@node-id` (federated when the node part is not ours),
      // and a plain username. Only the middle one needs splitting here.
      const isEmail = EMAIL_RE.test(raw);
      let isFederated = false;
      let localName = raw;
      if (!isEmail && raw.includes('@')) {
        const nodePart = raw.substring(raw.indexOf('@') + 1);
        if (nodePart && nodePart !== NODE_ID) isFederated = true;
        else localName = raw.substring(0, raw.indexOf('@'));
      }

      if (!raw || (!isEmail && localName.length < 3)) {
        errEl.textContent = i.errIdentifierRequired || i.errUserShort || 'Enter your username or email.';
        errEl.style.display = 'block';
        return;
      }
      if (!password) {
        errEl.textContent = i.errPassRequired || 'Enter your password.';
        errEl.style.display = 'block';
        return;
      }

      const btn = /** @type {any} */ (document.getElementById('aimeat-go-btn'));
      btn.textContent = isFederated ? (i.connectingHome || 'Connecting to home node...') : (i.working || 'Working...');
      btn.disabled = true;
      try {
        // Email and federated GHII go over as typed; a local GHII goes as the bare name.
        await auth.loginWithPassword(isEmail || isFederated ? raw : localName, password);
        finishLogin();
      } catch (e) {
        // Password correct but the account still needs a verified email — finish that here.
        if (e.code === 'EMAIL_NOT_VERIFIED' && !isFederated) {
          releaseBtn('aimeat-go-btn', signInLabel);
          openEmailCompletion(localName, password, !!(e.details && e.details.has_email));
          return;
        }
        // Password correct, account has two-step sign-in — ask for the code and finish there. The
        // identifier goes on as it was typed, so the second call resolves the same account.
        if (e.code === 'TOTP_REQUIRED') {
          releaseBtn('aimeat-go-btn', signInLabel);
          totpStep.openTotpStep(isEmail || isFederated ? raw : localName, password);
          return;
        }
        // Password correct, and the operator requires two-step sign-in that the account has not set up.
        if (twoStepAsked(e)) { releaseBtn('aimeat-go-btn', signInLabel); return; }
        // A locked account is not a wrong password: say what the server said, not "does not match".
        if (e.code === 'TOTP_LOCKED') {
          errEl.textContent = e.message;
          errEl.style.display = 'block';
          releaseBtn('aimeat-go-btn', signInLabel);
          return;
        }
        const foreign = isFederated ? foreignAddressText(i, raw, e) : null;
        errEl.textContent = foreign ? foreign
          : e.message.includes('Invalid username or password')
          ? (i.errWrongCredentials || 'That username or email and password do not match an account here.')
          : e.code === 'PASSWORD_SIGN_IN_OFF' ? passwordRefusalText(i, e.message) : e.message;
        errEl.style.display = 'block';
        releaseBtn('aimeat-go-btn', signInLabel);
      }
    });

    // ── Create account: only ever creates. A taken username says so and offers the other tab
    //    instead of quietly attempting a login the person did not ask for.
    document.getElementById('aimeat-reg-btn').addEventListener('click', async () => {
      const username = /** @type {any} */ (document.getElementById('aimeat-reg-username')).value.trim().toLowerCase();
      const password = /** @type {any} */ (document.getElementById('aimeat-reg-password')).value;
      const emailEl = /** @type {any} */ (document.getElementById('aimeat-reg-email'));
      const email = emailEl ? emailEl.value.trim() : '';
      const displayName = /** @type {any} */ (document.getElementById('aimeat-reg-displayname')).value.trim() || username;
      const errEl = document.getElementById('aimeat-reg-error');
      const createLabel = i.createAccountBtn || 'Create account';
      errEl.style.display = 'none';

      if (!username || username.length < 3) {
        errEl.textContent = i.errUserShort || 'Username must be at least 3 characters';
        errEl.style.display = 'block';
        return;
      }
      // The field filters as the person types, so this only fires on a value that arrived some
      // other way (autofill, a paste the input event did not see). Same rule as the server's.
      if (!OWNER_NAME_RE.test(username)) {
        errEl.textContent = i.errUserInvalid || 'A username is 3 to 64 characters: letters a to z, digits and hyphens, starting and ending with a letter or digit.';
        errEl.style.display = 'block';
        return;
      }
      // The email field only exists when this node's gate asks for one, so its presence IS the rule.
      if (emailEl && !EMAIL_RE.test(email)) {
        errEl.textContent = i.errEmailInvalid || 'Please enter a valid email address.';
        errEl.style.display = 'block';
        return;
      }
      // 8 is the server's registration floor (models/schemas.ts). Keep the two in step: a
      // client that accepts 4 just moves the rejection to a server error the user cannot read.
      if (!password || password.length < 8) {
        errEl.textContent = i.errPassShort || 'Password must be at least 8 characters';
        errEl.style.display = 'block';
        return;
      }

      const btn = /** @type {any} */ (document.getElementById('aimeat-reg-btn'));
      btn.textContent = i.working || 'Working...';
      btn.disabled = true;

      // Gate on: the create call carries the email and the code step takes over from there.
      if (emailEl) {
        releaseBtn('aimeat-reg-btn', createLabel);
        openEmailCompletion(username, password, false, 'register', displayName, email);
        return;
      }

      try {
        await auth.register(username, displayName, { password, locale: currentModalLang() });
        finishLogin();
      } catch (e) {
        // A node that turned its gate on after this page loaded still lands here — same step.
        if (e.code === 'EMAIL_REQUIRED') {
          releaseBtn('aimeat-reg-btn', createLabel);
          openEmailCompletion(username, password, false, 'register', displayName);
          return;
        }
        // The account was made, and the operator requires two-step sign-in before its first session.
        if (twoStepAsked(e)) { releaseBtn('aimeat-reg-btn', createLabel); return; }
        errEl.textContent = (e.message.includes('already registered') || e.message.includes('NAME_TAKEN'))
          ? (i.errNameTaken || 'That username is taken. If it is yours, sign in instead.')
          : e.message;
        errEl.style.display = 'block';
        releaseBtn('aimeat-reg-btn', createLabel);
      }
    });

  } // end wireModal
}
