/**
 * @file src/services/app/install-readiness.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who can install an app on a phone or a computer, and with which home-screen icon, in a
 *   form an AI can repeat to the app's owner without reading the serving code.
 *
 *   WHY. An app's owner asked their AI why Chrome's "Install app" was greyed out. Nothing the AI
 *   could read said that the app's access setting decides it, or that the app had no PNG icon of its
 *   own, so it guessed and asked the node's operators. Three facts decide it, and this answers all
 *   three with one sentence: the owner's install-offer switch (marks.install), whether the app is
 *   restricted (a sign-in, an access code or a pacing amount: then only the people it opens for get
 *   the manifest, routes/subdomain-origin-docs.ts), and whether the app has its own PNG icon
 *   (services/app/icon-store.ts).
 * @structure AppInstallReadiness · appInstallReadiness
 * @usage const install = await appInstallReadiness(storage, config, app);
 * @version-history
 *   v1.0.0 — 2026-11-15 — Initial (wish-kirjautumista-vaativa-sovellus-asentuu-puhelimeen-ja-agentti).
 */
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { AppRecord } from '../../storage/types/apps.js';
import { appIsRestricted } from './access.js';
import { appHasIconImage } from './seo.js';

export interface AppInstallReadiness {
  /** The owner's switch: whether a visitor is offered to install the app (marks.install). */
  offered: boolean;
  /** Who gets the files a browser installs from: anyone, or only the people the app opens for. */
  installable_by: 'anyone' | 'people-it-opens-for';
  /** Whether the app has a PNG icon of its own; without one a phone shows the server's icon. */
  own_icon: boolean;
  /** The three facts as sentences, to repeat to the owner. */
  note: string;
}

/**
 * `offered` is appInstallChipOn(app.manifest) from services/app/marks.ts, passed in because marks.ts
 * calls this and an import back would be a cycle.
 */
export async function appInstallReadiness(
  storage: Pick<Storage, 'listStorageFiles'>, config: AimeatConfig, app: AppRecord, offered: boolean,
): Promise<AppInstallReadiness> {
  const restricted = appIsRestricted(config, app);
  const ownIcon = await appHasIconImage(storage, app);
  const notes = [
    offered
      ? 'Visitors are offered to install the app.'
      : 'Visitors are not offered to install the app (marks install: true offers it again); a browser can still install it from its own menu.',
    restricted
      ? 'The app opens only for some people (a sign-in, an access code or a payment), so only they can install it. A person it does not open for gets no install option, and that is expected.'
      : 'Anyone who opens the app can install it.',
    ownIcon
      ? 'An installed app shows its own PNG icon.'
      : 'The app has no PNG icon of its own, so an installed app shows this server\'s icon. icon_upload sets one (a square PNG, 512 x 512 is best).',
  ];
  return { offered, installable_by: restricted ? 'people-it-opens-for' : 'anyone', own_icon: ownIcon, note: notes.join(' ') };
}
