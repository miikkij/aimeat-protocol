/**
 * @file door.js
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The door of /v1/profile for a visitor without a session: what a shared link, a
 *   notification or a bookmark into the account shows before sign-in. It says where the address
 *   leads (Settings & Controls → the tab the URL names), that the page opens only for its owner,
 *   and offers the sign-in dialog, an account, and the story of what this is. Showroom face, since
 *   the visitor is outside; the shell (spa.html SiteFooter) renders the site footer under it.
 * @structure openSignIn(); default SignedOutDoor({ navigate, tabLabel })
 * @usage Rendered by views/profile.js when there is no session; tabLabel is the asked tab's
 *   translated name, or null when the URL names no tab the registry knows.
 * @version-history
 *   v1.5.0 -- 2026-09-26 -- The door is the SignedOutDoor component (components/SignedOutDoor.js, same markup and sheet): this file passes the words and what each way on does, and writes no class (page group G8).
 *   v1.4.0 -- 2026-09-26 -- A way on is the action link's small tone, a soft one its lower-case tone, one at the end of a row its row cut (a unification: Jouni's decision "Action link in Settings").
 *   v1.3.0 -- 2026-09-25 -- Sign in is the dark block (.poster-slab); its coral showroom slab goes, on a phone it keeps the full width (Jouni's decision "Loud action", a unification).
 *   v1.2.0 -- 2026-09-25 -- The last quiet ways on with a look of their own are the action link (.poster-action; the danger tone for detach, the small link for a link inside a part, the quiet cut in the account dialogs): pn-detach-btn, pn-setup-link, pf-aitr-row-link, pf-edit-link, pf-pw-eye and the door's underlined words; a place keeps only its layout (Jouni's decision "Action link", a unification).
 *   v1.1.0 -- 2026-09-25 -- Every tag is the Tag (.poster-chip and its tones, .poster-chips for a row), a unification: Jouni's decision Tag.
 *   2026-09-13 -- Compose the canonical aside for the signed-out explanation.
 *   v1.0.0 — 2026-09-06 — Initial. Replaces the "Your AIMEAT Profile / Sign in to see your agents,
 *     wallet…" wall: the classic shell's words under an aurora theme.css had already turned off, so a
 *     visitor got a title on a blank page, no footer, and no word on where the address led.
 */
import { h } from 'preact';
import { useCallback } from 'preact/hooks';
import htm from 'htm';
const html = htm.bind(h);
import { t } from '/js/i18n.js';
import { showLoginModal } from '/js/services/auth.js';
import { SignedOutDoor as Door } from '/components/SignedOutDoor.js';

/**
 * Open the sign-in dialog the header's pill opens, through the session service so the sign-in
 * reaches every subscriber the same way (the profile view itself listens with onAuthChange).
 * `tab: 'register'` opens it on the account step. Without the auth lib, the front page is the door.
 */
function openSignIn(navigate, tab) {
  if (!showLoginModal(tab ? { tab } : {})) navigate('/v1/portal');
}

export default function SignedOutDoor({ navigate, tabLabel }) {
  const address = `${window.location.host}${window.location.pathname}${window.location.search}`;
  const profile = t('nav.profile');
  const signIn = useCallback(() => openSignIn(navigate), [navigate]);
  const createAccount = useCallback(() => openSignIn(navigate, 'register'), [navigate]);
  const goHowItWorks = useCallback((e) => { e.preventDefault(); navigate('/v1/how-it-works'); }, [navigate]);

  return html`<${Door}
    address=${address}
    kicker=${t('profile.door.kicker')}
    title=${t('profile.door.title')}
    titleAccent=${t('profile.door.titleAccent')}
    targetLabel=${t('profile.door.targetLabel')}
    path=${tabLabel ? [profile, tabLabel] : [profile]}
    tag=${t('profile.door.ownerOnly')}
    lead=${t('profile.door.lead', { profile })}
    action=${{ label: t('profile.door.signIn'), onClick: signIn }}
    second=${{ label: t('profile.door.createAccount'), onClick: createAccount }}
    after=${t('profile.door.after')}
    aside=${{
      label: t('profile.door.whatLabel'),
      title: t('profile.door.whatTitle'),
      text: t('profile.door.whatText'),
      link: { label: t('profile.door.howItWorks'), href: '/v1/how-it-works', onClick: goHowItWorks },
    }} />`;
}
