/**
 * @file src/services/privacy-ai-region.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The privacy policy's paragraph about where the node's AI provider processes a
 *   person's request: the OpenRouter region of the node's key, what happens to a model the region
 *   does not offer, whether a person may choose, and the transfer that happens whatever is chosen.
 *   Jouni, 2026-10-31: "tärkeintä että ollaan läpinäkyviä ja kaikki on tietoisia ja pystyvät
 *   tekemään valintoja".
 *
 *   It is written from the node's settings (services/ai/openrouter-region.ts), so the page states
 *   what this node does and changes when the operator changes it. A node without its own OpenRouter
 *   key gets no paragraph: nothing of the kind happens there.
 *
 *   Plain HTML for the policy page's template ({{aiRegionNotice}} in public/privacy*.html,
 *   routes/portal.ts templateVars), as services/visibility/privacy-notice.ts is.
 * @structure aiRegionNotice(config, locale)
 * @usage vars.aiRegionNotice = aiRegionNotice(config, locale)
 * @version-history
 *   v1.2.1 — 2026-11-01 — The paragraph also names the model that reads pictures, when it is another one.
 *   v1.2.0 — 2026-11-01 — The paragraph names the node's default model for the chat and the agents (Jouni, 2026-11-01 02.54).
 *   v1.1.0 — 2026-11-01 — The buyer's AI region choice (ai.region_mode): the settings in effect come
 *     from regionSettingsOf, eu-only names what is off, and own says each person brings their own key.
 *   v1.0.0 — 2026-10-31 — Initial (Jouni, 2026-10-31).
 */
import type { AimeatConfig } from '../config.js';
import { typeAllowed } from './ai/providers.js';
import { allowedRegions, nodePictureModel, nodeTextModel, regionModeOf, regionSettingsOf, REGION_HOSTS, type OpenRouterRegion, type RegionFallback } from './ai/openrouter-region.js';
import { nodeOpenRouterKey } from './ai/node-openrouter-key.js';

type Lang = 'en' | 'fi' | 'es';

interface Words {
  title: string;
  key: string;
  region: Record<OpenRouterRegion, string>;
  /** What happens to a model the region does not offer: refused, to the US, to the US and then any
   *  country, or straight to any country. */
  fallback: { off: string; us: string; any: string; toAny: string };
  /** {hosts} is filled in. */
  choose: string;
  nodeChooses: string;
  tail: string;
  or: string;
  /** ai.region_mode eu-only: what is off because the EU does not offer it. */
  euOnly: string;
  /** ai.region_mode own: the node has no key of its own, and each person brings theirs. */
  own: string;
  /** The node's default model for the chat and the agents; {model} is filled in. */
  model: string;
  /** The model that reads pictures when it is another one; {model} is filled in. */
  picture: string;
}

const WORDS: Record<Lang, Words> = {
  en: {
    title: 'Where this node\'s AI provider processes your request.',
    key: 'This node\'s own AI key is with OpenRouter, Inc., a company in the United States.',
    region: {
      eu: 'Your requests are processed at eu.openrouter.ai, by model servers in the EU or the EEA, the United Kingdom or Switzerland. The EU has an adequacy decision for the United Kingdom and for Switzerland.',
      us: 'Your requests are processed at us.openrouter.ai, by model servers in the United States.',
      any: 'Your requests are processed at openrouter.ai, which can send them to the model\'s provider in any country.',
    },
    fallback: {
      off: 'A model that is not offered in that region is refused. The request is not sent anywhere else.',
      us: 'A model that is not offered in the EU goes to us.openrouter.ai in the United States, and the answer says so.',
      any: 'A model that is not offered in that region goes to us.openrouter.ai, and when the United States does not offer it either, to openrouter.ai and any country. The answer says where it went.',
      toAny: 'A model that is not offered in that region goes to openrouter.ai and can be processed in any country, and the answer says so.',
    },
    choose: 'You can choose the region, and what happens to a model it does not offer, in your AI settings. The choices on this node are {hosts}.',
    nodeChooses: 'The operator chooses this for everyone on this node.',
    tail: 'Whatever the region, OpenRouter keeps account, billing and security records in the United States. That transfer, and every request processed outside the EEA, relies on the EU Standard Contractual Clauses in OpenRouter\'s data processing agreement. Each answer records where it was processed.',
    or: 'or',
    euOnly: 'This node was set up to use AI in the EU only. Speech-to-text, read-aloud, image generation, embeddings and the free models are therefore off here, because the EU region offers none of them.',
    own: 'This node has no shared AI key. Each person adds their own OpenRouter key in their AI settings and uses it under their own agreement with OpenRouter, Inc., a company in the United States. Where your requests are processed is your own choice in your AI settings.',
    model: 'The chat and the agents use the model {model} unless you choose another one in your AI settings.',
    picture: 'Pictures are read by the model {model}.',
  },
  fi: {
    title: 'Missä tämän solmun tekoälyn tarjoaja käsittelee pyyntösi.',
    key: 'Tämän solmun oma tekoälyavain on OpenRouter, Inc:llä, joka on yhdysvaltalainen yritys.',
    region: {
      eu: 'Pyyntösi käsitellään osoitteessa eu.openrouter.ai mallipalvelimilla, jotka ovat EU:ssa tai ETA-alueella, Isossa-Britanniassa tai Sveitsissä. EU on tehnyt Isosta-Britanniasta ja Sveitsistä tietosuojan riittävyyspäätöksen.',
      us: 'Pyyntösi käsitellään osoitteessa us.openrouter.ai mallipalvelimilla Yhdysvalloissa.',
      any: 'Pyyntösi käsitellään osoitteessa openrouter.ai, joka voi lähettää ne mallin tarjoajalle missä tahansa maassa.',
    },
    fallback: {
      off: 'Jos mallia ei ole tällä alueella, solmu hylkää pyynnön. Pyyntöä ei lähetetä muualle.',
      us: 'Jos mallia ei ole EU:ssa, pyyntö menee osoitteeseen us.openrouter.ai Yhdysvaltoihin, ja vastaus kertoo sen.',
      any: 'Jos mallia ei ole tällä alueella, pyyntö menee osoitteeseen us.openrouter.ai. Jos mallia ei ole Yhdysvalloissakaan, pyyntö menee osoitteeseen openrouter.ai, ja se voi päätyä mihin tahansa maahan. Vastaus kertoo, minne pyyntö meni.',
      toAny: 'Jos mallia ei ole tällä alueella, pyyntö menee osoitteeseen openrouter.ai, ja se voi päätyä mihin tahansa maahan. Vastaus kertoo sen.',
    },
    choose: 'Voit valita alueen tekoälyasetuksistasi. Valitset samalla, mitä tapahtuu mallille, jota alueella ei ole. Tämän solmun vaihtoehdot ovat {hosts}.',
    nodeChooses: 'Ylläpitäjä valitsee tämän kaikille tämän solmun käyttäjille.',
    tail: 'Alueesta riippumatta OpenRouter säilyttää tili-, laskutus- ja tietoturvatiedot Yhdysvalloissa. Tämä siirto ja jokainen ETA-alueen ulkopuolella käsitelty pyyntö perustuvat EU:n vakiosopimuslausekkeisiin, jotka ovat osa OpenRouterin tietojenkäsittelysopimusta. Jokaiseen vastaukseen tallentuu, missä se käsiteltiin.',
    or: 'tai',
    euOnly: 'Tämä solmu on otettu käyttöön niin, että tekoäly toimii vain EU:ssa. Siksi puheentunnistus, ääneen luku, kuvien luonti, upotukset ja ilmaiset mallit eivät ole käytössä. EU-alueella ei ole niistä yhtäkään.',
    own: 'Tällä solmulla ei ole yhteistä tekoälyavainta. Jokainen lisää oman OpenRouter-avaimensa tekoälyasetuksiinsa ja käyttää sitä oman sopimuksensa mukaan. OpenRouter, Inc. on yhdysvaltalainen yritys. Sinä valitset tekoälyasetuksissasi, missä pyyntösi käsitellään.',
    model: 'Keskustelu ja agentit käyttävät mallia {model}, ellet valitse tekoälyasetuksissasi toista mallia.',
    picture: 'Kuvat lukee malli {model}.',
  },
  es: {
    title: 'Dónde procesa tu solicitud el proveedor de IA de este nodo.',
    key: 'La clave de IA propia de este nodo está con OpenRouter, Inc., una empresa de Estados Unidos.',
    region: {
      eu: 'Tus solicitudes se procesan en eu.openrouter.ai, en servidores de modelos de la UE o del EEE, el Reino Unido o Suiza. La UE tiene una decisión de adecuación para el Reino Unido y para Suiza.',
      us: 'Tus solicitudes se procesan en us.openrouter.ai, en servidores de modelos de Estados Unidos.',
      any: 'Tus solicitudes se procesan en openrouter.ai, que puede enviarlas al proveedor del modelo en cualquier país.',
    },
    fallback: {
      off: 'Un modelo que no se ofrece en esa región se rechaza. La solicitud no se envía a ningún otro lugar.',
      us: 'Un modelo que no se ofrece en la UE va a us.openrouter.ai, en Estados Unidos, y la respuesta lo dice.',
      any: 'Un modelo que no se ofrece en esa región va a us.openrouter.ai y, si Estados Unidos tampoco lo ofrece, a openrouter.ai y a cualquier país. La respuesta dice adónde fue.',
      toAny: 'Un modelo que no se ofrece en esa región va a openrouter.ai y puede procesarse en cualquier país, y la respuesta lo dice.',
    },
    choose: 'Puedes elegir la región, y qué ocurre con un modelo que no ofrece, en tus ajustes de IA. Las opciones de este nodo son {hosts}.',
    nodeChooses: 'El operador elige esto para todos en este nodo.',
    tail: 'Sea cual sea la región, OpenRouter guarda los registros de cuenta, facturación y seguridad en Estados Unidos. Esa transferencia, y toda solicitud procesada fuera del EEE, se basa en las cláusulas contractuales tipo de la UE del acuerdo de tratamiento de datos de OpenRouter. Cada respuesta registra dónde se procesó.',
    or: 'o',
    euOnly: 'Este nodo se configuró para usar la IA solo en la UE. Por eso aquí no funcionan el dictado por voz, la lectura en voz alta, la generación de imágenes, las incrustaciones ni los modelos gratuitos: la región de la UE no ofrece ninguno de ellos.',
    own: 'Este nodo no tiene una clave de IA compartida. Cada persona añade su propia clave de OpenRouter en sus ajustes de IA y la usa según su propio acuerdo con OpenRouter, Inc., una empresa de Estados Unidos. Tú eliges en tus ajustes de IA dónde se procesan tus solicitudes.',
    model: 'El chat y los agentes usan el modelo {model}, salvo que elijas otro en tus ajustes de IA.',
    picture: 'Las imágenes las lee el modelo {model}.',
  },
};

/** What happens to a model the region does not offer, as the node's settings make it (openrouter-region.ts regionOrder). */
function fallbackOf(region: OpenRouterRegion, fallback: RegionFallback, allowed: OpenRouterRegion[]): keyof Words['fallback'] | null {
  if (region === 'any') return null;
  const toUs = region === 'eu' && fallback !== 'off' && allowed.includes('us');
  const toAny = fallback === 'any' && allowed.includes('any');
  if (toUs && toAny) return 'any';
  if (toUs) return 'us';
  if (toAny) return 'toAny';
  return 'off';
}

/**
 * The paragraph for this node, or '' when the node has no OpenRouter key of its own. A node set up
 * with the own-key choice (ai.region_mode own) says that each person brings their own key.
 */
export function aiRegionNotice(config: AimeatConfig, locale: string): string {
  const w = WORDS[(locale === 'fi' || locale === 'es' ? locale : 'en') as Lang];
  const mode = regionModeOf(config);
  if (mode === 'own') return typeAllowed(config, 'openrouter') ? `<p><strong>${w.title}</strong> ${w.own}</p>` : '';
  if (!nodeOpenRouterKey(config) || !typeAllowed(config, 'openrouter')) return '';
  const settings = regionSettingsOf(config);
  const allowed = allowedRegions(config);
  const region = allowed.includes(settings.region) ? settings.region : allowed[0];
  const fb = fallbackOf(region, settings.fallback, allowed);
  const hosts = allowed.map(r => REGION_HOSTS[r]);
  const hostList = hosts.length > 1 ? `${hosts.slice(0, -1).join(', ')} ${w.or} ${hosts[hosts.length - 1]}` : hosts[0];
  const choose = settings.personChoice && allowed.length > 1
    ? w.choose.replace('{hosts}', hostList) : w.nodeChooses;
  // The model is named when the node sets one (the transparency statement also names eu-only's stand-in).
  const model = nodeTextModel(config);
  const named = model ? w.model.replace('{model}', model) : '';
  const pictureModel = nodePictureModel(config);
  const picture = pictureModel ? w.picture.replace('{model}', pictureModel) : '';
  const sentences = [w.key, w.region[region], fb ? w.fallback[fb] : '', mode === 'eu-only' ? w.euOnly : '', named, picture, choose, w.tail].filter(Boolean);
  return `<p><strong>${w.title}</strong> ${sentences.join(' ')}</p>`;
}
