/**
 * @file src/services/secret-shares/notices.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The notifications a secret share sends: to the people named on it ("a secret waits for
 *   you"), to the people asked to fill a request, and to the maker when a request is filled or a
 *   share is picked up. Each names the secret and the person, never the content, and links to the
 *   page where it is picked up or filled. The words are under notiftext.<type>.* in the locales.
 * @structure tellRecipients · tellDepositors · tellMaker
 * @version-history
 *   v1.0.0 — 2026-11-14 — Initial (wish-holvi-salaisuuksien-talletus-jako-ja-nouto-ihmisille-ja-agen).
 */
import type { SecretShareRecord } from '../../storage/types/secret-shares.js';
import type { ShareDeps } from './rules.js';
import { notify } from '../notify.js';
import { localAccountName } from '../../utils/gaii.js';

const nameOf = (ghii: string): string => localAccountName(ghii);

export async function tellRecipients(deps: ShareDeps, share: SecretShareRecord, ghiis: string[], url: string): Promise<void> {
  const from = nameOf(share.ownerGhii);
  for (const to of ghiis) {
    if (to === share.ownerGhii && share.kind === 'share') continue;
    await notify(deps.storage, to, {
      type: 'secret_share_waiting',
      title: `${from} gave you permission to pick up ${share.name}`,
      body: `The secret ${share.name} waits for you in ${from}'s vault. Open the link to pick it up, or ask your AI to.`,
      link: url,
      ref: `secret-share:${share.id}`,
      i18n: { key: 'secret_share_waiting', vars: { from, name: share.name } },
    });
  }
}

export async function tellDepositors(deps: ShareDeps, share: SecretShareRecord, ghiis: string[], url: string): Promise<void> {
  const from = nameOf(share.ownerGhii);
  for (const to of ghiis) {
    await notify(deps.storage, to, {
      type: 'secret_share_request',
      title: `${from} asks you for ${share.name}`,
      body: `${from} asks you to deposit the secret ${share.name}. Open the link to deposit it. ${from} decided who may pick it up and for how long.`,
      link: url,
      ref: `secret-share:${share.id}`,
      i18n: { key: 'secret_share_request', vars: { from, name: share.name } },
    });
  }
}

export async function tellMaker(deps: ShareDeps, share: SecretShareRecord, what: 'deposited' | 'picked_up', who: string, url: string): Promise<void> {
  const whoName = who === 'link' || who === 'code' ? (who === 'link' ? 'Someone with the deposit link' : 'Someone with the code') : who;
  const type = what === 'deposited' ? 'secret_share_deposited' : 'secret_share_picked_up';
  await notify(deps.storage, share.ownerGhii, {
    type,
    title: what === 'deposited' ? `${whoName} deposited ${share.name}` : `${whoName} picked up ${share.name}`,
    body: what === 'deposited'
      ? `The secret ${share.name} you asked for can be picked up now.`
      : `${whoName} picked up the secret ${share.name}. Its events show where it went.`,
    link: url,
    ref: `secret-share:${share.id}`,
    i18n: { key: type, vars: { who: whoName, name: share.name } },
  });
}
