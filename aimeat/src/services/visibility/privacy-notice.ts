/**
 * @file src/services/visibility/privacy-notice.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The paragraph of the privacy policy about account holders' own analytics, shown only
 *   while at least one account holder on this node uses Microsoft Clarity or Google Analytics on
 *   the pages they publish (Jouni, 2026-10-11: "show it only when a user takes a Clarity id into
 *   use, because it goes to their apps").
 *
 *   WHY IT IS CONDITIONAL. The policy says the service's own pages use no third-party analytics, and
 *   that stays true. What can change is whether an app or a page somebody published here carries
 *   its owner's analytics. A paragraph about that on a node where nobody does it would describe
 *   processing that does not happen; left out on a node where somebody does, the policy would be
 *   silent about a third party a visitor can meet. So the node writes it when it applies.
 *
 *   It names only the services in use, and it is plain HTML for the policy page's template
 *   ({{ownerAnalyticsNotice}} in public/privacy*.html, routes/portal.ts templateVars).
 * @structure ownerAnalyticsNotice(locale, nodeName, inUse)
 * @usage vars.ownerAnalyticsNotice = ownerAnalyticsNotice(locale, nodeName, tagsInUseOnNode())
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial.
 */
import { escapeHtml } from '../../utils/html-escape.js';
import type { TagsInUse } from './visibility-settings.js';

type Lang = 'en' | 'fi' | 'es';

const TEXT: Record<Lang, {
  title: string; and: string;
  /** {node}, {services}, {where} are filled in. */
  body: string;
  clarity: string;
  where: [string, string];
  end: string;
}> = {
  en: {
    title: 'Apps and pages that account holders publish.',
    and: 'and',
    body: 'An account holder can add their own analytics to the apps, the portfolio and the company page they publish on {node}. At least one account holder uses {services} now. Such a page shows a cookie banner that names the service, and the service loads only after you accept analytics on that page.',
    clarity: 'Microsoft Clarity records how you use the page: your clicks, your scrolling and a replay of your visit.',
    where: ['Microsoft', 'Google'],
    end: 'The data goes to that account holder\'s own account at {where}, and that account holder is responsible for it. The service\'s cookies stay on that page\'s own address. You can change your choice at any time with the cookie mark at the bottom of the page. A browser that sends Global Privacy Control gets none of these services.',
  },
  fi: {
    title: 'Tilinhaltijoiden julkaisemat sovellukset ja sivut.',
    and: 'ja',
    body: 'Tilinhaltija voi lisätä oman analytiikkansa sovelluksiin, portfolioon ja yrityssivuun, jotka hän julkaisee palvelussa {node}. Ainakin yksi tilinhaltija käyttää nyt näitä palveluja: {services}. Tällainen sivu näyttää evästebannerin, joka nimeää palvelun, ja palvelu latautuu vasta, kun hyväksyt analytiikan sillä sivulla.',
    clarity: 'Microsoft Clarity tallentaa, miten käytät sivua: klikkauksesi, vierityksesi ja käyntisi toiston.',
    where: ['Microsoftille', 'Googlelle'],
    end: 'Tiedot menevät {where} kyseisen tilinhaltijan omalle tilille, ja tilinhaltija vastaa niistä. Palvelun evästeet pysyvät kyseisen sivun omassa osoitteessa. Voit muuttaa valintaasi milloin tahansa sivun alareunan evästemerkistä. Selain, joka lähettää Global Privacy Control -signaalin, ei saa näistä palveluista yhtäkään.',
  },
  es: {
    title: 'Aplicaciones y páginas que publican los titulares de cuentas.',
    and: 'y',
    body: 'El titular de una cuenta puede agregar su propia analítica a las aplicaciones, el portafolio y la página de empresa que publica en {node}. Al menos un titular usa ahora {services}. Una página así muestra un aviso de cookies que nombra el servicio, y el servicio se carga solo después de que aceptes la analítica en esa página.',
    clarity: 'Microsoft Clarity registra cómo usas la página: tus clics, tu desplazamiento y una repetición de tu visita.',
    where: ['Microsoft', 'Google'],
    end: 'Los datos van a la cuenta propia de ese titular en {where}, y ese titular es responsable de ellos. Las cookies del servicio se quedan en la dirección propia de esa página. Puedes cambiar tu elección cuando quieras con la marca de cookies al pie de la página. Un navegador que envía Global Privacy Control no recibe ninguno de estos servicios.',
  },
};

const joined = (parts: string[], and: string): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}` : parts[0] ?? '');

/** The paragraph, or '' when no account holder on this node uses an analytics service. */
export function ownerAnalyticsNotice(locale: string, nodeName: string, inUse: TagsInUse): string {
  if (!inUse.clarity && !inUse.ga4) return '';
  const t = TEXT[(locale in TEXT ? locale : 'en') as Lang];
  const services = joined([inUse.clarity ? 'Microsoft Clarity' : '', inUse.ga4 ? 'Google Analytics' : ''].filter(Boolean), t.and);
  const where = joined([inUse.clarity ? t.where[0] : '', inUse.ga4 ? t.where[1] : ''].filter(Boolean), t.and);
  const body = t.body.replace('{node}', escapeHtml(nodeName)).replace('{services}', services);
  return `<p><strong>${t.title}</strong> ${body}${inUse.clarity ? ` ${t.clarity}` : ''} ${t.end.replace('{where}', where)}</p>`;
}
