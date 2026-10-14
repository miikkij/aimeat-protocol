/**
 * @file src/services/prompt-defaults/home-ideas.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The first text of the managed prompt `home-ideas` (services/home-ideas.ts): the
 *   ideas the home offers, as one JSON document per language. Seeded once; after that the
 *   operator owns the text on the Prompts page and the seeder leaves it alone.
 *
 *   EVERY AGENT IDEA HAS RUN. Each one was made on aimeat.io from its sentence and ran with a real
 *   model in October 2026 (the October agents plan, production runs of 2026-10-13 and 2026-10-14).
 *   An idea that has not run is not offered: "Viestivastaaja" was left out for that reason (Jouni,
 *   2026-10-14). The app ideas say whether an app of that kind is on aimeat.io (`ready_app`) or is
 *   an idea a person's AI builds.
 *
 *   THE THREE LANGUAGES ARE WRITTEN, NOT TRANSLATED: the same facts composed in English, Finnish
 *   and Spanish (es-419, tú). The ids, groups, `when` and `ready_app` are the same in each.
 * @structure HOME_IDEAS_SEEDS: PromptSeedEntry[]
 * @usage Imported and spread by prompt-defaults.ts into PROMPT_SEEDS.
 * @version-history
 *   v1.0.0 — 2026-10-14 — Initial (wish-esimerkit-agenteista-ja-sovelluksista-kotiruudulle-mielikuvi).
 */

/**
 * The shape of PromptSeedEntry (../prompt-defaults.ts), written here rather than imported: the other
 * seed files' import of it is an import cycle the dependency check carries as known, and a new file
 * does not add one.
 */
interface SeedEntry {
  id: string; group: string; name: string; description: string; content: string;
  variables: string[]; usedIn: string[]; locales?: Record<string, string>;
}

type Lang = 'en' | 'fi' | 'es';
type Words = Record<Lang, string>;

/** What does not change between languages. */
/** `area` is the group an idea is filed under; it is written `group` in the document. */
const AGENTS: Array<{ id: string; area: string; when: string; app: string | null; name: Words; gets: Words; say: Words }> = [
  {
    id: 'minutes', area: 'work', when: 'records', app: 'MUISTIO',
    name: { en: 'Meeting scribe', fi: 'Kokouskirjuri', es: 'Secretario de reuniones' },
    gets: {
      en: 'Decisions and agreed actions from every note, each on the note\'s own sentence, and a question to you where the note names no doer or date.',
      fi: 'Jokaisesta muistiosta päätökset ja sovitut tehtävät muistion omalla lauseella, ja kysymys sinulle, jos tekijä tai päivä puuttuu.',
      es: 'Las decisiones y las tareas acordadas de cada acta, cada una con la frase del acta, y una pregunta para ti cuando falta quién o para cuándo.',
    },
    say: {
      en: 'Read every meeting note saved in MUISTIO as soon as it arrives: record its decisions and agreed actions, who does what and by when, each on the note\'s own sentence, and ask me when the note does not say who or by when.',
      fi: 'Lue jokainen MUISTIOon tallennettu kokousmuistio heti kun se tulee: kirjaa siitä päätökset ja sovitut tehtävät, kuka tekee ja mihin mennessä, jokainen muistion omalla lauseella, ja kysy minulta, jos muistio ei kerro tekijää tai päivää.',
      es: 'Lee cada acta de reunión guardada en MUISTIO en cuanto llegue: anota sus decisiones y las tareas acordadas, quién hace qué y para cuándo, cada una con la frase del acta, y pregúntame cuando el acta no diga quién ni para cuándo.',
    },
  },
  {
    id: 'desk', area: 'customers', when: 'records', app: 'LUUKKU',
    name: { en: 'Front desk', fi: 'Asiakaspalvelija', es: 'Recepción' },
    gets: {
      en: 'Visitors on your page get an answer within a minute. A booking, a price or anything odd comes to you with the reason.',
      fi: 'Sivusi vierailija saa vastauksen minuutissa. Varaus, hinta tai outo pyyntö tulee sinulle syyn kanssa.',
      es: 'Quien visita tu página recibe respuesta en un minuto. Una reserva, un precio o algo raro te llega a ti con el motivo.',
    },
    say: {
      en: 'Answer the questions that arrive at LUUKKU from my opening hours and services, and hand every booking, price or unusual request to me with the reason.',
      fi: 'Vastaa LUUKKUun tuleviin kysymyksiin aukioloaikojeni ja palveluideni perusteella, ja siirrä jokainen varaus, hinta ja epätavallinen pyyntö minulle syyn kanssa.',
      es: 'Responde las preguntas que llegan a LUUKKU con mis horarios y servicios, y pásame cada reserva, precio o pedido inusual con el motivo.',
    },
  },
  {
    id: 'quotes', area: 'customers', when: 'clock', app: 'Postinjalostamo',
    name: { en: 'Quote replies', fi: 'Tarjousvastaaja', es: 'Respuestas a cotizaciones' },
    gets: {
      en: 'A reply draft for every request for a quote in your mail. You read it and send it yourself.',
      fi: 'Vastausluonnos jokaiseen postisi tarjouspyyntöön. Sinä luet ja lähetät sen itse.',
      es: 'Un borrador de respuesta para cada solicitud de cotización de tu correo. Tú lo lees y lo envías.',
    },
    say: {
      en: 'Read the new requests for a quote in Postinjalostamo every hour and write a reply draft to each one, which I approve before it is sent.',
      fi: 'Lue Postinjalostamon uudet tarjouspyynnöt tunnin välein ja kirjoita jokaiseen vastausluonnos, jonka hyväksyn ennen lähetystä.',
      es: 'Lee cada hora las nuevas solicitudes de cotización en Postinjalostamo y escribe un borrador de respuesta para cada una, que yo apruebo antes de enviarlo.',
    },
  },
  {
    id: 'due', area: 'money', when: 'clock', app: 'ERÄPÄIVÄ',
    name: { en: 'Due-date watch', fi: 'Eräpäivävahti', es: 'Vigía de vencimientos' },
    gets: {
      en: 'Every Monday: what is late and what falls due this week. It pays nothing.',
      fi: 'Joka maanantai: mikä on myöhässä ja mikä erääntyy tällä viikolla. Se ei maksa mitään.',
      es: 'Cada lunes: qué está atrasado y qué vence esta semana. No paga nada.',
    },
    say: {
      en: 'Every Monday morning, tell me which bills in ERÄPÄIVÄ are late and which fall due this week. Pay nothing.',
      fi: 'Kerro joka maanantaiaamu, mitkä ERÄPÄIVÄn laskut ovat myöhässä ja mitkä erääntyvät tällä viikolla. Älä maksa mitään.',
      es: 'Cada lunes por la mañana, dime qué facturas de ERÄPÄIVÄ están atrasadas y cuáles vencen esta semana. No pagues nada.',
    },
  },
  {
    id: 'reminders', area: 'money', when: 'clock', app: 'SAATAVAT',
    name: { en: 'Reminder writer', fi: 'Muistutusten kirjoittaja', es: 'Redactor de recordatorios' },
    gets: {
      en: 'A polite reminder draft for each invoice more than a week late. No fees, nothing sent.',
      fi: 'Kohtelias muistutusluonnos jokaisesta yli viikon myöhässä olevasta laskusta. Ei maksuja, mitään ei lähetetä.',
      es: 'Un borrador de recordatorio amable para cada factura con más de una semana de atraso. Sin recargos y sin enviar nada.',
    },
    say: {
      en: 'Write a polite reminder draft for every invoice in SAATAVAT that is more than a week late. Add no fees and send nothing.',
      fi: 'Kirjoita kohtelias muistutusluonnos jokaisesta SAATAVAT-laskusta, joka on yli viikon myöhässä. Älä lisää maksuja äläkä lähetä mitään.',
      es: 'Escribe un borrador de recordatorio amable para cada factura de SAATAVAT con más de una semana de atraso. No agregues recargos y no envíes nada.',
    },
  },
  {
    id: 'interviews', area: 'people', when: 'records', app: 'HAASTATTELUT + KALENTERI',
    name: { en: 'Interview scheduler', fi: 'Haastattelujen sopija', es: 'Coordinador de entrevistas' },
    gets: {
      en: 'Two free times from your calendar and an invitation draft for each new applicant. It does not judge anyone.',
      fi: 'Kaksi vapaata aikaa kalenteristasi ja kutsuluonnos jokaiselle uudelle hakijalle. Se ei arvioi ketään.',
      es: 'Dos horarios libres de tu calendario y un borrador de invitación para cada postulante nuevo. No evalúa a nadie.',
    },
    say: {
      en: 'When a new applicant arrives in HAASTATTELUT, offer them two interview times from the free times in KALENTERI and write the invitation draft. Do not assess the applicants.',
      fi: 'Kun HAASTATTELUIHIN tulee uusi hakija, ehdota hänelle kaksi haastatteluaikaa KALENTERIN vapaista ajoista ja kirjoita kutsuluonnos. Älä arvioi hakijoita.',
      es: 'Cuando llegue un postulante nuevo a HAASTATTELUT, ofrécele dos horarios de entrevista entre los libres de KALENTERI y escribe el borrador de invitación. No evalúes a los postulantes.',
    },
  },
  {
    id: 'onboarding', area: 'people', when: 'talk', app: 'PEREHDYTYS',
    name: { en: 'Onboarding guide', fi: 'Perehdyttäjä', es: 'Guía de incorporación' },
    gets: {
      en: 'A new employee asks and gets the approved instruction by name, or the person to ask.',
      fi: 'Uusi työntekijä kysyy ja saa hyväksytyn ohjeen nimeltä, tai sen ihmisen, jolta kysyä.',
      es: 'Una persona nueva en el equipo pregunta y recibe la instrucción aprobada por su nombre, o a quién preguntar.',
    },
    say: {
      en: 'Answer a new employee\'s questions from the approved instructions in PEREHDYTYS, and name the person to ask when the instructions do not answer.',
      fi: 'Vastaa uuden työntekijän kysymyksiin PEREHDYTYKSEN hyväksyttyjen ohjeiden mukaan, ja kerro, keneltä kysyä, jos ohjeissa ei ole vastausta.',
      es: 'Responde las preguntas de una persona nueva en el equipo con las instrucciones aprobadas de PEREHDYTYS, y di a quién preguntar cuando las instrucciones no respondan.',
    },
  },
  {
    id: 'health', area: 'self', when: 'clock', app: 'OMA TERVEYS',
    name: { en: 'Health reminders', fi: 'Terveysmuistuttaja', es: 'Recordatorios de salud' },
    gets: {
      en: 'The day\'s reminders each morning and a weekly summary of what you recorded. No medical advice.',
      fi: 'Päivän muistutukset joka aamu ja viikon tiivistelmä kirjaamistasi mittauksista. Ei lääketieteellisiä neuvoja.',
      es: 'Los recordatorios del día cada mañana y un resumen semanal de lo que anotaste. Sin consejos médicos.',
    },
    say: {
      en: 'Remind me every morning of the day\'s medicines in OMA TERVEYS and summarise the measurements I recorded at the end of each week. Give no medical advice.',
      fi: 'Muistuta minua joka aamu päivän lääkkeistä OMASSA TERVEYDESSÄ ja tee viikon lopuksi tiivistelmä kirjaamistani mittauksista. Älä anna lääketieteellisiä neuvoja.',
      es: 'Recuérdame cada mañana los medicamentos del día en OMA TERVEYS y resume al final de cada semana las mediciones que anoté. No des consejos médicos.',
    },
  },
  {
    id: 'news', area: 'web', when: 'clock', app: null,
    name: { en: 'Morning news', fi: 'Aamun uutiset', es: 'Noticias de la mañana' },
    gets: {
      en: 'Five points of your field\'s news every weekday morning, each with its source.',
      fi: 'Alasi uutiset viitenä kohtana joka arkiaamu, jokainen lähteineen.',
      es: 'Las noticias de tu sector en cinco puntos cada mañana de lunes a viernes, cada una con su fuente.',
    },
    say: {
      en: 'Gather my field\'s news every weekday morning and write a five-point summary with the sources.',
      fi: 'Kerää joka arkiaamu alani uutiset ja kirjoita niistä viiden kohdan tiivistelmä lähteineen.',
      es: 'Reúne cada mañana de lunes a viernes las noticias de mi sector y escribe un resumen de cinco puntos con las fuentes.',
    },
  },
  {
    id: 'form', area: 'web', when: 'ask', app: null,
    name: { en: 'Form filler', fi: 'Lomakkeen täyttäjä', es: 'Llenador de formularios' },
    gets: {
      en: 'A web form filled from your details. It stops before sending, so you check it.',
      fi: 'Verkkolomake täytettynä tiedoistasi. Se pysähtyy ennen lähetystä, jotta tarkistat sen.',
      es: 'Un formulario web llenado con tus datos. Se detiene antes de enviarlo, para que lo revises.',
    },
    say: {
      en: 'Fill in the form on the site I name from my details and stop before sending it, so I can check it.',
      fi: 'Täytä nimeämäni sivuston lomake tiedoistani ja pysähdy ennen lähettämistä, jotta voin tarkistaa sen.',
      es: 'Llena el formulario del sitio que te indique con mis datos y detente antes de enviarlo, para que pueda revisarlo.',
    },
  },
];

const APPS: Array<{ id: string; ready_app: string | null; agent: string | null; name: Words; you: Words; agent_uses: Words; app_shows: Words }> = [
  {
    id: 'meeting-notes', ready_app: 'MUISTIO', agent: 'minutes',
    name: { en: 'Meeting notes', fi: 'Kokousmuistiot', es: 'Actas de reunión' },
    you: { en: 'Save the meeting note.', fi: 'Tallennat kokousmuistion.', es: 'Guardas el acta de la reunión.' },
    agent_uses: {
      en: 'Reads it and saves decisions and actions with the app\'s tool, which takes only the note\'s own sentences.',
      fi: 'Lukee sen ja tallentaa päätökset ja tehtävät sovelluksen työkalulla, joka ottaa vain muistion omat lauseet.',
      es: 'La lee y guarda las decisiones y las tareas con la herramienta de la app, que acepta solo las frases del acta.',
    },
    app_shows: {
      en: 'Lists open actions by person, the late ones first.',
      fi: 'Listaa avoimet tehtävät henkilöittäin, myöhässä olevat ensin.',
      es: 'Lista las tareas abiertas por persona, primero las atrasadas.',
    },
  },
  {
    id: 'customer-window', ready_app: 'LUUKKU', agent: 'desk',
    name: { en: 'Customer window', fi: 'Asiakasluukku', es: 'Ventanilla de clientes' },
    you: { en: 'Visitors write on your public page.', fi: 'Vierailijat kirjoittavat julkiselle sivullesi.', es: 'Las visitas escriben en tu página pública.' },
    agent_uses: {
      en: 'Answers through the app and hands over what it must not promise.',
      fi: 'Vastaa sovelluksen kautta ja siirtää sinulle sen, mitä se ei saa luvata.',
      es: 'Responde a través de la app y te pasa lo que no puede prometer.',
    },
    app_shows: {
      en: 'Shows each conversation and who answered, the agent or you.',
      fi: 'Näyttää jokaisen keskustelun ja sen, kuka vastasi, agentti vai sinä.',
      es: 'Muestra cada conversación y quién respondió, el agente o tú.',
    },
  },
  {
    id: 'receivables', ready_app: 'SAATAVAT', agent: 'reminders',
    name: { en: 'Receivables', fi: 'Saatavat', es: 'Cuentas por cobrar' },
    you: { en: 'Keep your open invoices in the app.', fi: 'Pidät avoimet laskusi sovelluksessa.', es: 'Llevas tus facturas pendientes en la app.' },
    agent_uses: {
      en: 'Writes reminder drafts with the app\'s tool, one per invoice.',
      fi: 'Kirjoittaa muistutusluonnokset sovelluksen työkalulla, yhden laskua kohti.',
      es: 'Escribe borradores de recordatorio con la herramienta de la app, uno por factura.',
    },
    app_shows: {
      en: 'Shows the drafts beside the invoices, and you send them.',
      fi: 'Näyttää luonnokset laskujen vieressä, ja sinä lähetät ne.',
      es: 'Muestra los borradores junto a las facturas, y tú los envías.',
    },
  },
  {
    id: 'reading-list', ready_app: null, agent: 'news',
    name: { en: 'Reading list', fi: 'Lukulista', es: 'Lista de lectura' },
    you: { en: 'Mark what you want to read and what you read.', fi: 'Merkitset, mitä haluat lukea ja mitä luit.', es: 'Marcas lo que quieres leer y lo que ya leíste.' },
    agent_uses: {
      en: 'A news agent adds the day\'s best articles with a three-line summary.',
      fi: 'Uutisagentti lisää päivän parhaat artikkelit kolmen rivin tiivistelmän kanssa.',
      es: 'Un agente de noticias agrega los mejores artículos del día con un resumen de tres líneas.',
    },
    app_shows: {
      en: 'Shows them by topic, and what you did not read yet.',
      fi: 'Näyttää ne aiheittain ja kertoo, mitä et ole vielä lukenut.',
      es: 'Los muestra por tema, y lo que todavía no leíste.',
    },
  },
  {
    id: 'competitor-watch', ready_app: null, agent: null,
    name: { en: 'Competitor watch', fi: 'Kilpailijaseuranta', es: 'Seguimiento de la competencia' },
    you: { en: 'Name the competitors and what matters to you.', fi: 'Nimeät kilpailijat ja sen, mikä sinulle on tärkeää.', es: 'Indicas los competidores y lo que te importa.' },
    agent_uses: {
      en: 'Reads their sites every week and saves only what changed.',
      fi: 'Lukee heidän sivunsa joka viikko ja tallentaa vain sen, mikä muuttui.',
      es: 'Lee sus sitios cada semana y guarda solo lo que cambió.',
    },
    app_shows: {
      en: 'Draws a timeline per competitor: prices, products, people.',
      fi: 'Piirtää aikajanan kilpailijaa kohti: hinnat, tuotteet, ihmiset.',
      es: 'Dibuja una línea de tiempo por competidor: precios, productos, personas.',
    },
  },
  {
    id: 'shopping-list', ready_app: null, agent: null,
    name: { en: 'Shopping list', fi: 'Kauppalista', es: 'Lista de compras' },
    you: { en: 'Say what you will cook this week.', fi: 'Kerrot, mitä aiot laittaa ruoaksi tällä viikolla.', es: 'Dices qué vas a cocinar esta semana.' },
    agent_uses: {
      en: 'Turns the meals into ingredients and adds what is missing to the list.',
      fi: 'Muuttaa ateriat aineksiksi ja lisää listalle sen, mitä puuttuu.',
      es: 'Convierte las comidas en ingredientes y agrega a la lista lo que falta.',
    },
    app_shows: {
      en: 'Shows the list by shop aisle, and the family ticks it off on their phones.',
      fi: 'Näyttää listan kaupan hyllyjen järjestyksessä, ja perhe kuittaa sen puhelimillaan.',
      es: 'Muestra la lista por pasillo de la tienda, y la familia la marca desde el celular.',
    },
  },
];

const GROUPS: Array<{ id: string; name: Words }> = [
  { id: 'work', name: { en: 'Meetings and work', fi: 'Kokoukset ja työ', es: 'Reuniones y trabajo' } },
  { id: 'customers', name: { en: 'Customers and mail', fi: 'Asiakkaat ja posti', es: 'Clientes y correo' } },
  { id: 'money', name: { en: 'Money', fi: 'Raha', es: 'Dinero' } },
  { id: 'people', name: { en: 'People', fi: 'Ihmiset', es: 'Personas' } },
  { id: 'self', name: { en: 'Health and home', fi: 'Terveys ja koti', es: 'Salud y hogar' } },
  { id: 'web', name: { en: 'Web and news', fi: 'Verkko ja uutiset', es: 'Web y noticias' } },
];

/** Written to an AI that reads the list, in English whatever the language of the rest. */
const ABOUT = 'Ideas for a person who does not yet know what to ask for. agents: each was made from its `say` sentence and ran for real; '
  + 'offer the two or three that fit what the person does, in their language, and use the sentence they choose as the purpose of the agent you '
  + 'propose (aimeat_agent_propose). An agent idea with an `app` works through that app: the person opens the app once first. '
  + 'apps: an app and the agent that works through it. `ready_app` names an app already on this node; an idea with none is one you build '
  + 'with the person (aimeat_handbook_get { tier: "build-app-atelier" }), giving the agent a tool that writes into the app.';

function documentIn(lang: Lang): string {
  return JSON.stringify({
    about: ABOUT,
    groups: GROUPS.map((g) => ({ id: g.id, name: g.name[lang] })),
    agents: AGENTS.map((a) => ({ id: a.id, group: a.area, name: a.name[lang], gets: a.gets[lang], say: a.say[lang], when: a.when, app: a.app })),
    apps: APPS.map((p) => ({
      id: p.id, name: p.name[lang], ready_app: p.ready_app, agent: p.agent,
      you: p.you[lang], agent_uses: p.agent_uses[lang], app_shows: p.app_shows[lang],
    })),
  }, null, 2);
}

export const HOME_IDEAS_SEEDS: SeedEntry[] = [
  {
    id: 'home-ideas',
    group: 'portal',
    name: 'Home ideas — agents and apps to start from',
    description: 'The examples the home offers when a person makes an agent or an app, as JSON: groups, agent ideas (each with the sentence it was made from) and app ideas (what the person does, what the agent does with the app\'s tools, what the app shows). One document per language. A missing field leaves that one entry out; the page lists what to fix.',
    content: documentIn('en'),
    variables: [],
    usedIn: ['/v1/prompts/home-ideas', '/v1/home?new-agent=1', '/v1/home'],
    locales: { fi: documentIn('fi'), es: documentIn('es') },
  },
];
