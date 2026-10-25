/**
 * @file src/services/internet-opening/opening-mark.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words of the line an app opened to the internet carries (utils/app-internet-open-badge.ts),
 *   in the visitor's language, or nothing for an app that is not open. The organisation is the one the
 *   node names as standing behind it (`seo.organization_name`, else the site name), then its host.
 * @structure internetOpenMarkFor
 * @usage applyServeMarks(bytes, { ..., internetOpen: internetOpenMarkFor(config, app, locale) })
 * @version-history
 *   v1.0.0 — 2026-10-25 — Initial (wish-corp-moodissa-julkaistu-app-ulosp-in-vahdittuna-ja-listattun).
 */
import type { AimeatConfig } from '../../config.js';
import type { AppRecord } from '../../storage/interface.js';
import { signedInOnly } from '../../config-visibility.js';
import { createT, type Locale } from '../../i18n.js';
import type { InternetOpenBadgeSpec } from '../../utils/app-internet-open-badge.js';
import { isAppOpenToInternet } from './opening-registry.js';

export function internetOpenMarkFor(
  config: Pick<AimeatConfig, 'contentAccess' | 'baseUrl' | 'seoOrganizationName' | 'seoSiteName'>,
  app: Pick<AppRecord, 'ownerName' | 'filename'>,
  locale: Locale = 'en',
): InternetOpenBadgeSpec | undefined {
  if (!signedInOnly(config) || !isAppOpenToInternet(app.ownerName, app.filename)) return undefined;
  const t = createT(locale);
  // A base URL that does not parse is shown as written.
  const host = URL.canParse(config.baseUrl) ? new URL(config.baseUrl).host : config.baseUrl;
  const org = (config.seoOrganizationName || config.seoSiteName || '').trim();
  return {
    text: t('internetOpenBadge.text'),
    who: org && org !== host ? t('internetOpenBadge.who', { org, host }) : host,
  };
}
