/**
 * @file src/middleware/cookie-consent-texts.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The words of the cookie banner in English, Finnish and Spanish, and the function
 *   that builds one language's texts for vanilla-cookieconsent from the categories a page asks for.
 *
 *   A BANNER ASKS FOR CONSENT, SO IT SAYS WHAT FOR. "This site uses cookies to give you the best
 *   experience" names nothing a person can agree to. Each category says what it does, and when the
 *   page carries its owner's analytics (services/visibility/analytics-tags.ts) the analytics
 *   category names the services, says that Microsoft Clarity records the visit, and says where the
 *   data goes.
 *
 *   The strings are plain text: the library writes them as HTML, so every value that is not a
 *   constant of this file (a category the operator named, the policy address) is escaped here.
 * @structure CONSENT_LANGS · ConsentServices · consentTexts(lang, categories, opts)
 * @usage translations[lang] = consentTexts(lang, ['necessary', 'analytics'], { services: { clarity: true, ga4: false } })
 * @version-history
 *   v1.0.0 — 2026-10-11 — Initial: the banner in en, fi and es, with the analytics services named.
 */
import { escapeHtml } from '../utils/html-escape.js';

export const CONSENT_LANGS = ['en', 'fi', 'es'] as const;
export type ConsentLang = (typeof CONSENT_LANGS)[number];

/** The page owner's analytics the banner asks about. Absent on the service's own pages. */
export interface ConsentServices { clarity: boolean; ga4: boolean }

interface Words {
  title: string;
  /** The banner's sentence when no analytics service is named. */
  lead: string;
  /** The banner's sentence when the owner's analytics are named; {services} is filled in. */
  leadWithAnalytics: string;
  acceptAll: string;
  onlyNecessary: string;
  choose: string;
  prefsTitle: string;
  save: string;
  whatFor: string;
  necessary: [string, string];
  analytics: [string, string];
  marketing: [string, string];
  /** Analytics named: {services} and {where} are filled in. */
  analyticsNamed: string;
  /** Who receives the data, in the form the sentence needs: [for Clarity, for Google Analytics]. */
  where: [string, string];
  /** Added after analyticsNamed when Clarity is one of the services. */
  clarityRecords: string;
  and: string;
  policy: string;
}

const WORDS: Record<ConsentLang, Words> = {
  en: {
    title: 'Cookies on this page',
    lead: 'This page uses the cookies it needs to work, such as the one that keeps you signed in. It asks before it uses any other.',
    leadWithAnalytics: 'This page uses the cookies it needs to work. With your permission it also uses analytics: {services}.',
    acceptAll: 'Accept all',
    onlyNecessary: 'Only necessary',
    choose: 'Choose',
    prefsTitle: 'Your cookie choices',
    save: 'Save my choices',
    whatFor: 'What cookies are used for',
    necessary: ['Necessary', 'The page needs these to work: signing in, your language and this choice. Always on.'],
    analytics: ['Analytics', 'These let the people who run this page see how it is used.'],
    marketing: ['Marketing', 'These are used to show and measure advertising.'],
    analyticsNamed: 'The owner of this page uses {services} to see how the page is used. The data goes to {where}.',
    where: ['Microsoft', 'Google'],
    clarityRecords: 'Microsoft Clarity records how you use the page: your clicks, your scrolling and a replay of your visit.',
    and: 'and',
    policy: 'Privacy policy',
  },
  fi: {
    title: 'Evästeet tällä sivulla',
    lead: 'Tämä sivu käyttää evästeitä, joita se tarvitsee toimiakseen, esimerkiksi pitääkseen sinut kirjautuneena. Muita se käyttää vain luvallasi.',
    leadWithAnalytics: 'Tämä sivu käyttää evästeitä, joita se tarvitsee toimiakseen. Luvallasi se käyttää myös analytiikkaa: {services}.',
    acceptAll: 'Hyväksy kaikki',
    onlyNecessary: 'Vain välttämättömät',
    choose: 'Valitse itse',
    prefsTitle: 'Evästevalintasi',
    save: 'Tallenna valintani',
    whatFor: 'Mihin evästeitä käytetään',
    necessary: ['Välttämättömät', 'Sivu tarvitsee nämä toimiakseen: kirjautuminen, kielesi ja tämä valinta. Aina päällä.'],
    analytics: ['Analytiikka', 'Näiden avulla sivun ylläpitäjät näkevät, miten sivua käytetään.'],
    marketing: ['Markkinointi', 'Näillä näytetään ja mitataan mainontaa.'],
    analyticsNamed: 'Tämän sivun omistaja käyttää näitä palveluja nähdäkseen, miten sivua käytetään: {services}. Tiedot menevät {where}.',
    where: ['Microsoftille', 'Googlelle'],
    clarityRecords: 'Microsoft Clarity tallentaa, miten käytät sivua: klikkauksesi, vierityksesi ja käyntisi toiston.',
    and: 'ja',
    policy: 'Tietosuojaseloste',
  },
  es: {
    title: 'Cookies en esta página',
    lead: 'Esta página usa las cookies que necesita para funcionar, como la que mantiene tu sesión. Para cualquier otra te pide permiso.',
    leadWithAnalytics: 'Esta página usa las cookies que necesita para funcionar. Con tu permiso también usa analítica: {services}.',
    acceptAll: 'Aceptar todas',
    onlyNecessary: 'Solo las necesarias',
    choose: 'Elegir',
    prefsTitle: 'Tus opciones de cookies',
    save: 'Guardar mi elección',
    whatFor: 'Para qué se usan las cookies',
    necessary: ['Necesarias', 'La página las necesita para funcionar: tu sesión, tu idioma y esta elección. Siempre activas.'],
    analytics: ['Analítica', 'Permiten a quienes gestionan esta página ver cómo se usa.'],
    marketing: ['Marketing', 'Sirven para mostrar y medir publicidad.'],
    analyticsNamed: 'El dueño de esta página usa {services} para ver cómo se usa la página. Los datos van a {where}.',
    where: ['Microsoft', 'Google'],
    clarityRecords: 'Microsoft Clarity registra cómo usas la página: tus clics, tu desplazamiento y una repetición de tu visita.',
    and: 'y',
    policy: 'Política de privacidad',
  },
};

const joined = (parts: string[], and: string): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${and} ${parts[parts.length - 1]}` : parts[0] ?? '');

/** One language's texts, in the shape vanilla-cookieconsent's `language.translations[lang]` takes. */
export function consentTexts(
  lang: ConsentLang, categories: readonly string[], opts: { services?: ConsentServices; policyUrl?: string | null } = {},
): Record<string, unknown> {
  const w = WORDS[lang];
  const names = [opts.services?.clarity ? 'Microsoft Clarity' : '', opts.services?.ga4 ? 'Google Analytics' : ''].filter(Boolean);
  const where = [opts.services?.clarity ? w.where[0] : '', opts.services?.ga4 ? w.where[1] : ''].filter(Boolean);
  const named = names.length > 0 && categories.includes('analytics');
  const lead = named ? w.leadWithAnalytics.replace('{services}', joined(names, w.and)) : w.lead;
  const analyticsText = named
    ? `${w.analyticsNamed.replace('{services}', joined(names, w.and)).replace('{where}', joined(where, w.and))}${opts.services?.clarity ? ` ${w.clarityRecords}` : ''}`
    : w.analytics[1];

  const sections: Array<{ title: string; description?: string; linkedCategory?: string }> = [{ title: w.whatFor, description: lead }];
  for (const cat of categories) {
    if (cat === 'necessary') sections.push({ title: w.necessary[0], description: w.necessary[1], linkedCategory: cat });
    else if (cat === 'analytics') sections.push({ title: w.analytics[0], description: analyticsText, linkedCategory: cat });
    else if (cat === 'marketing') sections.push({ title: w.marketing[0], description: w.marketing[1], linkedCategory: cat });
    // A category the operator named: its own word, with nothing claimed about what it does.
    else sections.push({ title: escapeHtml(cat.charAt(0).toUpperCase() + cat.slice(1)), linkedCategory: cat });
  }

  const policy = opts.policyUrl && /^https?:\/\//i.test(opts.policyUrl)
    ? `<a href="${escapeHtml(opts.policyUrl)}" target="_blank" rel="noopener noreferrer">${w.policy}</a>`
    : undefined;

  return {
    consentModal: {
      title: w.title,
      description: lead,
      acceptAllBtn: w.acceptAll,
      acceptNecessaryBtn: w.onlyNecessary,
      showPreferencesBtn: w.choose,
      ...(policy ? { footer: policy } : {}),
    },
    preferencesModal: {
      title: w.prefsTitle,
      acceptAllBtn: w.acceptAll,
      acceptNecessaryBtn: w.onlyNecessary,
      savePreferencesBtn: w.save,
      sections,
    },
  };
}
