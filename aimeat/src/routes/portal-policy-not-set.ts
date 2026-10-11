/**
 * @file src/routes/portal-policy-not-set.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The page GET /v1/privacy and GET /v1/terms answer with (503) while the operator
 *   fields those pages need are not filled in. It tells a visitor that the page does not exist yet,
 *   and tells the operator which fields are missing and where to fill them in.
 *
 *   THE FIELDS ARE SET ON THE CONFIG PAGE. They were environment-only once, and this page said "set
 *   the environment variables below and restart the node". Since the operator block became a
 *   Config group (services/config-schema.ts) a save applies on the next request, so the page sends
 *   the operator there and names each field by the label that page shows. The environment variable
 *   stays beside it for an installation configured from a file.
 *
 *   The cookie banner links here when no policy address is set (middleware/cookie-consent-texts.ts),
 *   so this is the page a visitor reaches from a banner on a service that has no policy yet.
 * @structure renderPolicyNotSetPage(missing, locale, page)
 * @usage res.status(503).type('text/html').send(renderPolicyNotSetPage(missing, locale, 'privacy'))
 * @version-history
 *   v1.0.0 — 2026-10-11 — Moved out of portal.ts and rewritten: the Config page and its labels in
 *     place of "set the environment variables and restart", the terms page named as itself, Spanish.
 */
import { createT, type Locale } from '../i18n.js';
import { CONFIG_FIELDS } from '../services/config-schema.js';
import { escapeHtml } from '../utils/html-escape.js';

interface Words {
  title: Record<'privacy' | 'terms', string>;
  why: string;
  /** {config} is the link to the Config page, {group} the name of the group the fields are in. */
  how: string;
  env: string;
}

const WORDS: Record<Locale, Words> = {
  en: {
    title: { privacy: 'This service has no privacy policy yet', terms: 'This service has no terms of service yet' },
    why: 'Whoever runs this service has not yet filled in who is responsible for it, so this page cannot be shown. Do not store personal data here until it can.',
    how: '<strong>If you run this service:</strong> sign in to the admin pages, open {config} and fill in the fields below in the section "{group}". The page shows as soon as you save, with no restart.',
    env: 'The same fields can be set as environment variables. The name of each is beside the field.',
  },
  fi: {
    title: { privacy: 'Tällä palvelulla ei ole vielä tietosuojaselostetta', terms: 'Tällä palvelulla ei ole vielä käyttöehtoja' },
    why: 'Palvelun ylläpitäjä ei ole vielä täyttänyt tietoja siitä, kuka palvelusta vastaa. Siksi tätä sivua ei voi näyttää. Älä tallenna tänne henkilötietoja ennen kuin sivu on paikallaan.',
    how: '<strong>Jos ylläpidät tätä palvelua:</strong> kirjaudu hallintasivuille, avaa {config} ja täytä alla olevat kentät kohdassa ”{group}”. Sivu näkyy heti, kun tallennat. Uudelleenkäynnistystä ei tarvita.',
    env: 'Samat kentät voi antaa myös ympäristömuuttujina. Muuttujan nimi on kentän vieressä.',
  },
  es: {
    title: { privacy: 'Este servicio aún no tiene política de privacidad', terms: 'Este servicio aún no tiene condiciones de uso' },
    why: 'Quien gestiona este servicio aún no ha indicado quién responde de él, así que esta página no se puede mostrar. No guardes datos personales aquí hasta que se pueda.',
    how: '<strong>Si gestionas este servicio:</strong> inicia sesión en las páginas de administración, abre {config} y rellena los campos de abajo en la sección «{group}». La página se muestra en cuanto guardas, sin reiniciar.',
    env: 'Los mismos campos se pueden dar como variables de entorno. El nombre de cada una está junto al campo.',
  },
};

/** The Config row of one operator field: its dot path (the label's key) and its environment variable. */
function rowOf(field: string): { dotPath: string; envVar: string } {
  const row = CONFIG_FIELDS.find((f) => f.key === `operator.${field}`);
  if (row) return { dotPath: row.dotPath, envVar: row.envVar };
  const snake = field.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
  return { dotPath: `operator.${snake}`, envVar: `AIMEAT_OPERATOR_${snake.toUpperCase()}` };
}

/**
 * The page for a privacy policy or terms that cannot be shown yet. `missing` holds the operator
 * field names missingOperatorConfig() answered.
 */
export function renderPolicyNotSetPage(missing: readonly string[], locale: Locale, page: 'privacy' | 'terms'): string {
  const w = WORDS[locale] ?? WORDS.en;
  const t = createT(locale);
  const title = w.title[page];
  const how = w.how
    .replace('{config}', `<a href="/v1/admin?tab=config">${escapeHtml(t('dashboard.config'))}</a>`)
    .replace('{group}', escapeHtml(t('dashboard.cfgGroup_operator')));
  const fields = missing.map((field) => {
    const { dotPath, envVar } = rowOf(field);
    const key = `dashboard.cfg_${dotPath.replace(/\./g, '_')}`;
    const label = t(key);
    // A field with no label of its own shows its name, never the label key.
    return `<li>${escapeHtml(label === key ? field : label)} <code>${escapeHtml(envVar)}</code></li>`;
  }).join('');
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;max-width:680px;margin:60px auto;padding:0 24px;line-height:1.6;color:#1a1a18}
    h1{font-size:24px;margin-bottom:16px}ul{background:#f4f4f0;padding:14px 16px 14px 34px;border-radius:6px;font-size:14px}
    code{font-size:12px;color:#5a5a55;margin-left:6px}
    .warn{background:#fff5f4;border-left:3px solid #E8564A;padding:12px 16px;border-radius:4px;margin:18px 0}</style>
    </head><body><h1>${title}</h1><div class="warn"><p>${w.why}</p><p>${how}</p></div>
    <ul>${fields}</ul><p>${w.env}</p>
    </body></html>`;
}
