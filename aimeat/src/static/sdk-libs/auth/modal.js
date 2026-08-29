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
 * @structure showLoginModal(opts, renderBtn) → { buildModalInner, wireModal, render, switchLang,
 *   openEmailCompletion, sendEmailCode, showView, capture/restoreInputs }.
 * @usage import { showLoginModal } from './modal.js';
 * @version-history
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
import { auth, api } from './session.js';
import { escHtml } from './theme.js';
import { currentModalLang, loadModalI18n, MODAL_LANG_KEY, MODAL_LANGS } from './i18n.js';
import { NODE_URL, NODE_ID, AUTH_PROVIDERS, PROVIDER_ICONS, EMAIL_REQUIRED } from './config.js';
import { MODAL_CSS } from './modal-styles.js';

/** An identifier is an email when it carries a dot-bearing domain. A GHII (`alice@node-id`) never
 *  does, so this separates the two without asking the person which one they typed. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The server's owner-name rule (OWNER_RE in src/utils/gaii.ts): lowercase letters, digits and
 *  hyphens, a letter or digit at both ends, 3 to 64 characters. Mirrored here so the field can say
 *  what it wants while the person types instead of in a refusal afterwards. */
const OWNER_NAME_RE = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;

/** The domain in the crumb above the headline: this node's own, so a self-hosted node shows its
 *  domain there and the wordmark beside it says what the software is. */
const NODE_HOST = (function () {
  try { return new URL(NODE_URL).host; } catch { return (typeof location !== 'undefined' && location.host) || ''; }
})();

const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.8 8.2 3 4.5 6.7 4.5c2 0 3.6 1.1 4.5 2.6.9-1.5 2.5-2.6 4.5-2.6 3.7 0 5.9 3.7 4.3 7.3C19.5 16.4 12 21 12 21z"></path></svg>';
const RULE_MARKS = '<svg class="r-ok" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"><path d="M2 6.5 5 9.5 10 3"></path></svg>'
  + '<svg class="r-no" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2" y="2" width="8" height="8"></rect></svg>';

export function showLoginModal(opts, renderBtn) {
  var i = opts.i18n || {};
  var lang = currentModalLang();
  // Which of the two tabs is showing. One modal, two separate jobs: signing in needs an identifier
  // and a password, creating an account needs a name to be known by and (on nodes with the email
  // gate) an address. Merging them into one form meant neither said what it wanted.
  // A caller that already knows which job the person came to do can say so: a button reading
  // "Register your home" opening a sign-in form is a small lie, and the person has to find the
  // tab themselves. Anything other than 'register' keeps the previous behaviour.
  var tab = opts.tab === 'register' ? 'register' : 'signin';
  // Remove existing modal
  const old = document.getElementById('aimeat-modal');
  if (old) old.remove();

  const modal = document.createElement('div');
  modal.id = 'aimeat-modal';

  // Capture typed values so they survive a re-render (language change).
  function captureInputs() {
    var g = function (id) { var el = /** @type {any} */ (document.getElementById(id)); return el ? el.value : ''; };
    return {
      u: g('aimeat-username'), p: g('aimeat-password'),
      ru: g('aimeat-reg-username'), rp: g('aimeat-reg-password'),
      rd: g('aimeat-reg-displayname'), re: g('aimeat-reg-email'),
    };
  }
  function restoreInputs(vals) {
    // The input event is what keeps the username rules in step with the value, so a restored value
    // announces itself the way a typed one would.
    var s = function (id, val) {
      var el = /** @type {any} */ (document.getElementById(id));
      if (!el || !val) return;
      el.value = val;
      try { el.dispatchEvent(new Event('input')); } catch { /* no Event constructor */ }
    };
    s('aimeat-username', vals.u); s('aimeat-password', vals.p);
    s('aimeat-reg-username', vals.ru); s('aimeat-reg-password', vals.rp);
    s('aimeat-reg-displayname', vals.rd); s('aimeat-reg-email', vals.re);
  }

  // Switch language: persist the choice, reload translations, re-render in place (no page reload).
  function switchLang(next) {
    if (next === lang) return;
    try {
      localStorage.setItem(MODAL_LANG_KEY, next);
      document.cookie = 'aimeat-lang=' + next + ';path=/;max-age=31536000;SameSite=Lax';
    } catch { /* storage blocked */ }
    var vals = captureInputs();
    loadModalI18n(next).then(function (fresh) {
      lang = next;
      if (fresh && Object.keys(fresh).length) i = fresh;
      render(false);
      restoreInputs(vals);
    });
  }

  function render(anim) {
    modal.innerHTML = buildModalInner(i, lang, anim, tab);
    wireModal();
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
    var vals = captureInputs();
    i = fresh;
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
      + '<div class="aimeat-langsw" role="group" aria-label="' + escHtml(i.switchLanguage || 'Language') + '">'
      + MODAL_LANGS.map(function (l) {
        return '<button type="button" class="aimeat-lang' + (lang === l ? ' active' : '')
          + '" data-lang="' + l + '">' + l.toUpperCase() + '</button>';
      }).join('')
      + '</div>'
      + '</div>'
      // The masthead: one sentence in the poster face, and the line under it. Which tab is open
      // decides both.
      + '<h2 class="aimeat-headline">'
      + escHtml(isReg ? (i.headlineNew || 'Your account lives right here.') : (i.headlineReturning || 'Welcome back.'))
      + '</h2>'
      + '<p class="aimeat-line">'
      + escHtml(isReg
        ? (i.lineNew || 'Pick a username and password.')
        : (i.descReturning || 'Enter the username or email you signed up with.'))
      + '</p>'
      // Two tabs, two jobs. Which one is showing decides what the body asks for.
      + '<div class="aimeat-tabs" role="tablist">'
      + '<button type="button" role="tab" class="aimeat-tab' + (isReg ? '' : ' active') + '" data-tab="signin" aria-selected="' + (isReg ? 'false' : 'true') + '">' + escHtml(i.tabSignIn || 'Sign in') + '</button>'
      + '<button type="button" role="tab" class="aimeat-tab' + (isReg ? ' active' : '') + '" data-tab="register" aria-selected="' + (isReg ? 'true' : 'false') + '">' + escHtml(i.tabRegister || 'Create account') + '</button>'
      + '</div>'
      + '</div>'
      // Body
      + '<div id="aimeat-modal-body" class="aimeat-body">'
      // ── Sign-in tab: an identifier the person actually remembers, and a password.
      + '<div id="aimeat-tab-signin"' + (isReg ? ' style="display:none"' : '') + '>'
      + field(i.identifierLabel || 'Username or email',
        '<input id="aimeat-username" class="aimeat-inp" autocomplete="username" placeholder="' + escHtml(i.identifierPlaceholder || 'Username or email') + '">')
      + field(i.passwordLabel || 'Password',
        '<input id="aimeat-password" type="password" autocomplete="current-password" class="aimeat-inp" placeholder="' + escHtml(i.passwordPlaceholder || 'Password') + '">')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-go-btn" class="aimeat-go">' + escHtml(i.signInOnlyBtn || 'Sign in') + '</button>'
      + '<button id="aimeat-cancel-btn" class="aimeat-cancel">' + escHtml(i.cancelBtn || 'Cancel') + '</button>'
      + '</div>'
      + '<p id="aimeat-error" class="aimeat-err"></p>'
      + '<div class="aimeat-links">'
      + '<a href="#" id="aimeat-forgot-pw" class="aimeat-link">' + escHtml(i.forgotPassword || 'Forgot password?') + '</a>'
      + '<a href="#" id="aimeat-forgot-user" class="aimeat-link">' + escHtml(i.forgotUsername || 'Forgot username?') + '</a>'
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
      // Forgot password sub-view (hidden by default)
      + '<div id="aimeat-forgot-pw-view" class="aimeat-body" style="display:none">'
      + '<div id="aimeat-fpw-step1">'
      + '<h3 class="aimeat-sub-title">' + escHtml(i.resetPasswordTitle || 'Reset Password') + '</h3>'
      + '<p class="aimeat-sub-desc">' + escHtml(i.resetPasswordDesc || 'Enter your username to receive a reset code by email.') + '</p>'
      + field(i.usernameLabel || 'Username', '<input id="aimeat-fpw-username" class="aimeat-inp" placeholder="' + escHtml(i.usernamePlaceholder || 'Username') + '">')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-fpw-send" class="aimeat-go">' + escHtml(i.sendResetCode || 'Send Reset Code') + '</button>'
      + '<button id="aimeat-fpw-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-fpw-msg" class="aimeat-msg"></p>'
      + '<p id="aimeat-fpw-err" class="aimeat-err"></p>'
      + '</div>'
      + '<div id="aimeat-fpw-step2" style="display:none">'
      + '<h3 class="aimeat-sub-title">' + escHtml(i.enterNewPasswordTitle || 'Enter New Password') + '</h3>'
      + '<p class="aimeat-sub-desc">' + escHtml(i.resetCodeSent || 'A reset code was sent to your email. Enter it below with your new password.') + '</p>'
      + field(i.codeLabel || 'Reset Code', '<input id="aimeat-fpw-code" class="aimeat-inp" placeholder="123456" maxlength="6">')
      + field(i.newPasswordLabel || 'New Password', '<input id="aimeat-fpw-newpass" type="password" class="aimeat-inp" placeholder="' + escHtml(i.newPasswordPlaceholder || 'New password (min 8 chars)') + '">')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-fpw-reset" class="aimeat-go">' + escHtml(i.resetPassword || 'Reset Password') + '</button>'
      + '<button id="aimeat-fpw-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-fpw-msg2" class="aimeat-msg"></p>'
      + '<p id="aimeat-fpw-err2" class="aimeat-err"></p>'
      + '</div>'
      + '</div>'
      // Forgot username sub-view (hidden by default)
      + '<div id="aimeat-forgot-user-view" class="aimeat-body" style="display:none">'
      + '<h3 class="aimeat-sub-title">' + escHtml(i.recoverUsernameTitle || 'Recover Username') + '</h3>'
      + '<p class="aimeat-sub-desc">' + escHtml(i.recoverUsernameDesc || 'Enter the email address associated with your account.') + '</p>'
      + field(i.emailLabel || 'Email', '<input id="aimeat-fu-email" class="aimeat-inp" type="email" placeholder="you@example.com">')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-fu-send" class="aimeat-go">' + escHtml(i.sendUsername || 'Send My Username') + '</button>'
      + '<button id="aimeat-fu-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-fu-msg" class="aimeat-msg"></p>'
      + '</div>'
      // Complete-account sub-view (hidden) — email verification (legacy accounts + register-under-gate).
      + '<div id="aimeat-email-view" class="aimeat-body" style="display:none">'
      + '<div id="aimeat-em-step1">'
      + '<h3 class="aimeat-sub-title">' + escHtml(i.completeAccountTitle || 'One last step') + '</h3>'
      + '<p class="aimeat-sub-desc">' + escHtml(i.completeAccountDesc || 'Add an email to finish setting up your account. We’ll send a verification code to confirm it.') + '</p>'
      + field(i.emailLabel || 'Email', '<input id="aimeat-em-email" class="aimeat-inp" type="email" placeholder="you@example.com">')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-em-send" class="aimeat-go">' + escHtml(i.sendVerificationCode || 'Send Verification Code') + '</button>'
      + '<button id="aimeat-em-back" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-em-err" class="aimeat-err"></p>'
      + '</div>'
      + '<div id="aimeat-em-step2" style="display:none">'
      + '<h3 class="aimeat-sub-title">' + escHtml(i.enterCodeTitle || 'Enter Verification Code') + '</h3>'
      + '<p class="aimeat-sub-desc">' + escHtml(i.enterCodeDesc || 'We sent a 6-digit code to your email. Enter it below to finish and sign in.') + '</p>'
      + field(i.codeLabel || 'Verification Code', '<input id="aimeat-em-code" class="aimeat-inp" placeholder="123456" maxlength="6" inputmode="numeric">')
      + '<div class="aimeat-actions">'
      + '<button id="aimeat-em-confirm" class="aimeat-go">' + escHtml(i.confirmAndSignIn || 'Confirm & Sign In') + '</button>'
      + '<button id="aimeat-em-back2" class="aimeat-cancel">' + escHtml(i.backToLogin || 'Back to Login') + '</button>'
      + '</div>'
      + '<p id="aimeat-em-msg2" class="aimeat-msg"></p>'
      + '<p id="aimeat-em-err2" class="aimeat-err"></p>'
      + '</div>'
      + '</div>'
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

    ['aimeat-cancel-btn', 'aimeat-reg-cancel-btn'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.addEventListener('click', function () { modal.remove(); });
    });

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

    // The username rules, live. The field keeps only what the server's owner-name rule accepts
    // (lowercase a to z, digits and hyphens; capitals are lowered as typed) and the three rules
    // under it turn green as they are met, from the first typed character. The person sees what
    // the name may be while choosing it rather than in a refusal afterwards.
    var regUser = /** @type {any} */ (document.getElementById('aimeat-reg-username'));
    var rulesEl = document.getElementById('aimeat-reg-rules');
    function syncUsernameRules() {
      if (!regUser || !rulesEl) return;
      var raw = String(regUser.value || '');
      var clean = raw.toLowerCase().replace(/[^a-z0-9-]/g, '');
      if (clean !== raw) {
        var pos = Math.max(0, (regUser.selectionStart == null ? raw.length : regUser.selectionStart) - (raw.length - clean.length));
        regUser.value = clean;
        try { regUser.setSelectionRange(pos, pos); } catch { /* not a text control */ }
      }
      rulesEl.classList.toggle('on', clean.length > 0);
      var met = {
        len: clean.length >= 3 && clean.length <= 64,
        chars: clean.length > 0,
        edges: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(clean),
      };
      rulesEl.querySelectorAll('.aimeat-rule').forEach(function (r) {
        r.classList.toggle('ok', !!met[r.getAttribute('data-rule') || '']);
      });
    }
    if (regUser) regUser.addEventListener('input', syncUsernameRules);

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
    }

    // Credentials captured from the last correct-password attempt that hit the email gate.
    var pendingEmailLogin = null;

    // Open the email step. 'attach' — existing account needs a verified email. 'register' — brand-new
    // account under the email gate: step1 POST /v1/ghii (with email) creates it. Both finish identically.
    // `prefillEmail` comes from the Register tab, which already asked: the address is filled in and
    // the code sent straight away, so the person never types it twice.
    function openEmailCompletion(user, pass, hasEmail, mode, displayName, prefillEmail) {
      pendingEmailLogin = { username: user, password: pass, mode: mode || 'attach', displayName: displayName || user };
      showView('email');
      document.getElementById('aimeat-em-step1').style.display = '';
      document.getElementById('aimeat-em-step2').style.display = 'none';
      var emailInput = /** @type {any} */ (document.getElementById('aimeat-em-email'));
      emailInput.value = prefillEmail || '';
      var titleEl = document.querySelector('#aimeat-em-step1 h3');
      var desc = document.querySelector('#aimeat-em-step1 p');
      if (pendingEmailLogin.mode === 'register') {
        if (titleEl) titleEl.textContent = i.registerEmailTitle || 'Add your email';
        if (desc) desc.textContent = i.registerEmailDesc || 'Enter your email to create your account. We’ll send a verification code to confirm it.';
      } else {
        if (titleEl) titleEl.textContent = i.completeAccountTitle || 'One last step';
        if (desc) {
          desc.textContent = hasEmail
            ? (i.completeAccountDescResend || 'Confirm your email to finish signing in. We’ll send a verification code — edit the address if it’s wrong.')
            : (i.completeAccountDesc || 'Add an email to finish setting up your account. We’ll send a verification code to confirm it.');
        }
      }
      document.getElementById('aimeat-em-err').style.display = 'none';
      if (prefillEmail) { sendEmailCode(); return; }
      setTimeout(function () { emailInput.focus(); }, 50);
    }

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

    // Complete-account step 1 — send a verification code (re-verifies password server-side).
    // Named rather than inline so the Register tab can drive the same step with the address it
    // already collected, instead of repeating the create-and-verify calls.
    async function sendEmailCode() {
      var email = /** @type {any} */ (document.getElementById('aimeat-em-email')).value.trim();
      var errEl = document.getElementById('aimeat-em-err');
      errEl.style.display = 'none';
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        errEl.textContent = i.errEmailInvalid || 'Please enter a valid email address.';
        errEl.style.display = 'block';
        return;
      }
      if (!pendingEmailLogin) { showView('login'); return; }
      var btn = /** @type {any} */ (document.getElementById('aimeat-em-send'));
      btn.textContent = i.working || 'Working...';
      btn.disabled = true;
      try {
        var res;
        if (pendingEmailLogin.mode === 'register') {
          // Brand-new account under the email gate: create it now WITH the email (returns verification_id).
          res = await api('/v1/ghii', {
            method: 'POST',
            credentials: 'include',
            body: JSON.stringify({
              username: pendingEmailLogin.username,
              display_name: pendingEmailLogin.displayName,
              password: pendingEmailLogin.password,
              email: email,
              // The account's locale, so the verification code arrives in the language the
              // person is reading right now. Without it every account was created locale-less
              // and every system email fell back to English (UX-remake v3, measured).
              locale: currentModalLang(),
            }),
          });
        } else {
          res = await api('/v1/ghii/login/attach-email', {
            method: 'POST',
            body: JSON.stringify({ username: pendingEmailLogin.username, password: pendingEmailLogin.password, email: email }),
          });
        }
        pendingEmailLogin.verificationId = res.data && res.data.verification_id;
        document.getElementById('aimeat-em-step1').style.display = 'none';
        document.getElementById('aimeat-em-step2').style.display = '';
        setTimeout(function () { /** @type {any} */ (document.getElementById('aimeat-em-code')).focus(); }, 50);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
      } finally {
        btn.textContent = i.sendVerificationCode || 'Send Verification Code';
        btn.disabled = false;
      }
    }
    document.getElementById('aimeat-em-send').addEventListener('click', sendEmailCode);

    // Complete-account step 2 — confirm the code, then re-run the password login for a normal session.
    document.getElementById('aimeat-em-confirm').addEventListener('click', async function () {
      var code = /** @type {any} */ (document.getElementById('aimeat-em-code')).value.trim();
      var msgEl = document.getElementById('aimeat-em-msg2');
      var errEl = document.getElementById('aimeat-em-err2');
      msgEl.style.display = 'none';
      errEl.style.display = 'none';
      if (!code) { errEl.textContent = i.errCodeRequired || 'Enter the verification code.'; errEl.style.display = 'block'; return; }
      if (!pendingEmailLogin) { showView('login'); return; }
      var btn = /** @type {any} */ (document.getElementById('aimeat-em-confirm'));
      btn.textContent = i.working || 'Working...';
      btn.disabled = true;
      try {
        await api('/v1/ghii/verify-email', {
          method: 'POST',
          body: JSON.stringify({ verification_id: pendingEmailLogin.verificationId, code: code }),
        });
        msgEl.textContent = i.emailVerifiedSigningIn || 'Verified! Signing you in...';
        msgEl.style.display = 'block';
        var session = await auth.loginWithPassword(pendingEmailLogin.username, pendingEmailLogin.password);
        pendingEmailLogin = null;
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(session);
      } catch (e) {
        errEl.textContent = e.message;
        errEl.style.display = 'block';
        btn.textContent = i.confirmAndSignIn || 'Confirm & Sign In';
        btn.disabled = false;
      }
    });

    // Send password reset code
    document.getElementById('aimeat-fpw-send').addEventListener('click', async function () {
      var username = /** @type {any} */ (document.getElementById('aimeat-fpw-username')).value.trim().toLowerCase();
      var msgEl = document.getElementById('aimeat-fpw-msg');
      var errEl = document.getElementById('aimeat-fpw-err');
      msgEl.style.display = 'none';
      errEl.style.display = 'none';
      if (!username) { errEl.textContent = i.errUserShort || 'Username is required'; errEl.style.display = 'block'; return; }
      try {
        await api('/v1/ghii/password/reset-request', { method: 'POST', body: JSON.stringify({ username: username }) });
        msgEl.textContent = i.resetCodeSent || 'If your account has a verified email, a reset code was sent.';
        msgEl.style.display = 'block';
        document.getElementById('aimeat-fpw-step1').style.display = 'none';
        document.getElementById('aimeat-fpw-step2').style.display = '';
        window.__aimeatResetUser = username;
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
      }
    });

    // Reset password with code
    document.getElementById('aimeat-fpw-reset').addEventListener('click', async function () {
      var code = /** @type {any} */ (document.getElementById('aimeat-fpw-code')).value.trim();
      var newPass = /** @type {any} */ (document.getElementById('aimeat-fpw-newpass')).value;
      var msgEl = document.getElementById('aimeat-fpw-msg2');
      var errEl = document.getElementById('aimeat-fpw-err2');
      msgEl.style.display = 'none';
      errEl.style.display = 'none';
      if (!code) { errEl.textContent = 'Code is required'; errEl.style.display = 'block'; return; }
      if (!newPass || newPass.length < 8) { errEl.textContent = i.errPassWeak || 'Password must be at least 8 characters'; errEl.style.display = 'block'; return; }
      try {
        await api('/v1/ghii/password/reset', { method: 'POST', body: JSON.stringify({
          username: window.__aimeatResetUser || '',
          code: code,
          newPassword: newPass,
        }) });
        msgEl.textContent = i.resetSuccess || 'Password reset successful! You can now sign in.';
        msgEl.style.display = 'block';
        setTimeout(function () { showView('login'); }, 2000);
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
      }
    });

    // Send username recovery
    document.getElementById('aimeat-fu-send').addEventListener('click', async function () {
      var email = /** @type {any} */ (document.getElementById('aimeat-fu-email')).value.trim();
      var msgEl = document.getElementById('aimeat-fu-msg');
      msgEl.style.display = 'none';
      if (!email) return;
      try {
        await api('/v1/ghii/account/recover', { method: 'POST', body: JSON.stringify({ email: email }) });
      } catch { /* always show success */ }
      msgEl.textContent = i.usernameSent || 'If an account with that email exists, your username was sent.';
      msgEl.style.display = 'block';
    });

    // Enter submits the tab the field belongs to.
    [['aimeat-username', 'aimeat-go-btn'], ['aimeat-password', 'aimeat-go-btn'],
      ['aimeat-reg-username', 'aimeat-reg-btn'], ['aimeat-reg-email', 'aimeat-reg-btn'],
      ['aimeat-reg-password', 'aimeat-reg-btn'], ['aimeat-reg-displayname', 'aimeat-reg-btn'],
    ].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      el.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        var btn = /** @type {any} */ (document.getElementById(pair[1]));
        if (btn && !btn.disabled) btn.click();
      });
    });

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
        const session = await auth.loginWithPassword(isEmail || isFederated ? raw : localName, password);
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(session);
      } catch (e) {
        // Password correct but the account still needs a verified email — finish that here.
        if (e.code === 'EMAIL_NOT_VERIFIED' && !isFederated) {
          releaseBtn('aimeat-go-btn', signInLabel);
          openEmailCompletion(localName, password, !!(e.details && e.details.has_email));
          return;
        }
        errEl.textContent = e.message.includes('Invalid username or password')
          ? (i.errWrongCredentials || 'That username or email and password do not match an account here.')
          : e.message;
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
        const session = await auth.register(username, displayName, { password, locale: currentModalLang() });
        modal.remove();
        renderBtn();
        if (opts.onLogin) opts.onLogin(session);
      } catch (e) {
        // A node that turned its gate on after this page loaded still lands here — same step.
        if (e.code === 'EMAIL_REQUIRED') {
          releaseBtn('aimeat-reg-btn', createLabel);
          openEmailCompletion(username, password, false, 'register', displayName);
          return;
        }
        errEl.textContent = (e.message.includes('already registered') || e.message.includes('NAME_TAKEN'))
          ? (i.errNameTaken || 'That username is taken. If it is yours, sign in instead.')
          : e.message;
        errEl.style.display = 'block';
        releaseBtn('aimeat-reg-btn', createLabel);
      }
    });

  } // end wireModal
}
