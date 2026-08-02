/**
 * @file connect/notes.js
 * @description What a user has to be told BEFORE they try to connect a provider (TARGET-057).
 *
 *   Every note here exists because the failure it prevents is unreadable when it happens. An
 *   Instagram personal account authorises perfectly and then cannot publish, with an error that
 *   names neither the account type nor the fix. A Bluesky user hunting for a password that is not
 *   their password finds their password. A Telegram bot that was never added to the channel fails
 *   at the last step of the flow rather than the first.
 *
 *   These are strings and not logic on purpose: they are the copy the panel shows, and an app that
 *   builds its own surface should be able to show the same words rather than invent worse ones.
 * @structure PROVIDER_NOTES — keyed by provider id
 * @usage import { PROVIDER_NOTES } from './notes.js';  PROVIDER_NOTES.bluesky.before
 * @version-history
 *   v1.0.0 — 2026-08-02 — Initial (TARGET-057 phase 3).
 *   v1.1.0 — 2026-08-02 — LinkedIn: says up front that the connection expires, because a token
 *     that silently dies in two months is the least readable failure in the set.
 */

/**
 * @typedef {Object} ProviderNote
 * @property {string} [needs]   What the user must supply, if anything beyond pressing the button.
 * @property {string} [before]  Shown BEFORE the attempt. The failure it prevents is unreadable.
 * @property {string} [where]   Where in the provider's own UI to find what they need.
 */

/** @type {Record<string, ProviderNote>} */
export const PROVIDER_NOTES = {
  mastodon: {
    needs: 'The address of your instance, for example mastodon.social.',
    before: 'Your account lives at one instance, and the same name at another instance is a different account.',
  },
  youtube: {
    before: 'Sign in with the Google account that owns the channel. A Google account with no YouTube channel will connect and then have nowhere to publish.',
  },
  x: {
    before: 'Posting to X costs the node operator a small amount per post, charged against prepaid credits at X. When those credits run out, publishing stops until they are topped up.',
  },
  linkedin: {
    before: 'A LinkedIn connection stops working after about two months and asks to be reconnected. That is LinkedIn: renewing a token in the background is a partner-only feature, so this is the one provider you will have to come back to a few times a year.',
  },
  bluesky: {
    needs: 'An app password. This is NOT your Bluesky password.',
    where: 'Bluesky → Settings → Privacy and security → App passwords.',
    before: 'This is the one provider that asks you to copy a secret to us instead of approving on their site. You can revoke it from Bluesky at any time, and it cannot be used to sign in as you.',
  },
  instagram: {
    before: 'Instagram publishing needs a Business or Creator account linked to a Facebook Page. A personal account will connect and then refuse to publish, with an error that does not say why.',
  },
  telegram: {
    needs: 'A bot token from @BotFather, and the bot added to your channel with permission to post.',
    before: 'Adding the bot to the channel is a step only you can do; without it the connection works and publishing does not.',
  },
};
