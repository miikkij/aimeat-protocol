/**
 * @file src/services/compliance/lia-draft.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The node's part of a balancing test: the facts it reads from the app, and the draft a
 *   person starts from. Stored nowhere by this file; a draft becomes a document when a person, or
 *   their AI, writes it back (lia-ops.ts).
 *
 *   WHAT IS READ, AND FROM WHERE.
 *     purpose, legal basis, the people      the register (GDPR art. 30), which a person approved
 *     the data, the regulated data, AI use  the app's data map and what its publish check recorded
 *     who can see the data                  the data map's location and readers columns (app-reach.ts)
 *     the privacy notice                    the app's own legal page
 *     the safeguards of the server          the configuration, as the data processing agreement's
 *                                           Annex III reads it (agreements-generate.ts)
 *   A minimisation proposal names the personal key families the data map itself says the app does not
 *   work from: a copy, a cache, a family kept only for an older version. It is a proposal a person
 *   checks, never a finding.
 *
 *   NO ANSWER OF JUDGEMENT IS PREFILLED. Three questions are facts the node can see; each is answered
 *   "yes" only on positive evidence and marked `evidence`. Every other answer is left out.
 * @structure liaFacts() · liaDraftItem() · liaIdFor()
 * @usage const item = liaDraftItem(config, reading, register, 'fi');
 * @version-history
 *   v1.0.0 — 2026-11-13 — Initial.
 */
import type { AimeatConfig } from '../../config.js';
import type { LiaLang } from '../../data/compliance-lia.js';
import { LIA_SECTIONS } from '../../data/compliance-lia.js';
import type { DataMapRow } from '../data-map/data-map-types.js';
import { measuresFromConfig } from './agreements-generate.js';
import type { ComplianceRegister } from './docs-schemas.js';
import type { ComplianceLia, ComplianceLiaFacts } from './lia-schemas.js';
import type { AppLiaReading } from './lia-need.js';

/** The id a register's test gets when the caller names none. */
export const liaIdFor = (registerId: string): string => `lia-${registerId}`.slice(0, 120);

const rowName = (r: DataMapRow): string => r.what || (r as DataMapRow & { key?: string }).key || '(unnamed)';
const isPersonal = (r: DataMapRow): boolean => r.personalData === 'yes' || (r.personalData === undefined && r.isA === 'schema:Person');

/** Why a personal key family may not be needed, by what its own row says. */
const MINIMISATION: Record<LiaLang, { compat: string; speed: string; copy: string; cache: string }> = {
  en: {
    compat: 'the data map says it is kept for an older version only', speed: 'the data map says it is kept for speed only',
    copy: 'the data map says it is a copy of data kept elsewhere', cache: 'the data map says it can be computed again',
  },
  fi: {
    compat: 'datakartan mukaan sitä säilytetään vain vanhaa versiota varten', speed: 'datakartan mukaan sitä säilytetään vain nopeuden vuoksi',
    copy: 'datakartan mukaan se on kopio muualla säilytettävästä tiedosta', cache: 'datakartan mukaan sen voi laskea uudelleen',
  },
  es: {
    compat: 'el mapa de datos dice que solo se guarda para una versión anterior', speed: 'el mapa de datos dice que solo se guarda por velocidad',
    copy: 'el mapa de datos dice que es una copia de datos guardados en otro lugar', cache: 'el mapa de datos dice que se puede calcular de nuevo',
  },
};

/** The people a register's purpose names, when the register lists none. */
const SUBJECTS_BY_PURPOSE: Readonly<Record<string, Record<LiaLang, string>>> = {
  customer: { en: 'customers', fi: 'asiakkaat', es: 'clientes' },
  member: { en: 'members', fi: 'jäsenet', es: 'miembros' },
  employee: { en: 'employees', fi: 'työntekijät', es: 'empleados' },
  patient: { en: 'patients', fi: 'potilaat', es: 'pacientes' },
};
const SUBJECTS_BY_DOMAIN: Readonly<Record<string, Record<LiaLang, string>>> = {
  employment: { en: 'employees', fi: 'työntekijät', es: 'empleados' },
  children: { en: 'children', fi: 'lapset', es: 'menores' },
};

const REMINDERS: Readonly<Record<string, Record<LiaLang, string>>> = {
  employment: {
    en: 'The data is about employees. Employment privacy law can ask more than this test: in Finland an employer may process only data that is directly necessary for the employment relationship (Act 759/2004, section 3), and consent does not change that.',
    fi: 'Tiedot koskevat työntekijöitä. Työelämän tietosuojalaki voi vaatia enemmän kuin tämä testi: työnantaja saa käsitellä vain työsuhteen kannalta välittömästi tarpeellisia tietoja (laki 759/2004, 3 §), eikä suostumus muuta tätä.',
    es: 'Los datos son de empleados. La legislación laboral de privacidad puede exigir más que esta prueba: en Finlandia el empleador solo puede tratar los datos directamente necesarios para la relación laboral (ley 759/2004, artículo 3), y el consentimiento no lo cambia.',
  },
  children: {
    en: 'The data is about children. Article 6(1)(f) gives their interests more weight, so the balancing needs a stronger reason.',
    fi: 'Tiedot koskevat lapsia. 6 artiklan 1 kohdan f alakohta antaa lapsen eduille suuremman painon, joten punninta tarvitsee vahvemman perusteen.',
    es: 'Los datos son de menores. El artículo 6.1.f da más peso a sus intereses, así que la ponderación necesita una razón más fuerte.',
  },
};

/** The facts of one register's test, as the app stands now. */
export function liaFacts(config: AimeatConfig, reading: AppLiaReading, reg: ComplianceRegister, lang: LiaLang): ComplianceLiaFacts {
  const held = Array.isArray(reading.map?.held) ? reading.map!.held : [];
  const personal = held.filter(isPersonal);
  const need = reading.needs.find(n => n.register.id === reg.id);
  const domains = need?.domains ?? [...new Set([...(reg.domains ?? []), ...reading.mapDomains])];
  const words = MINIMISATION[lang];
  const minimisation = personal.flatMap((r) => {
    const why = r.usedFor === 'backwards-compatibility' ? words.compat
      : r.usedFor === 'speed-only' ? words.speed
        : r.kind === 'fetched-copy' ? words.copy
          : r.kind === 'computed-or-cache' ? words.cache : null;
    return why ? [{ what: `${rowName(r)}: ${r.holds ?? ''}`.slice(0, 300), why }] : [];
  });
  const subjects = reg.subjects?.length ? reg.subjects : [...new Set([
    ...(reg.purpose && SUBJECTS_BY_PURPOSE[reg.purpose] ? [SUBJECTS_BY_PURPOSE[reg.purpose]![lang]] : []),
    ...domains.flatMap(d => (SUBJECTS_BY_DOMAIN[d] ? [SUBJECTS_BY_DOMAIN[d]![lang]] : [])),
  ])];
  return {
    ...(reg.purposeText || reading.map?.usedFor ? { purposeText: (reg.purposeText || reading.map!.usedFor).slice(0, 2000) } : {}),
    legalBasis: reg.legalBasis ?? [],
    dataCategories: (reg.dataCategories?.length ? reg.dataCategories : personal.map(r => `${rowName(r)}: ${r.holds ?? ''}`.slice(0, 300))).slice(0, 50),
    minimisation: minimisation.slice(0, 50),
    domains: domains.slice(0, 20),
    subjects: subjects.slice(0, 50),
    usesAi: reading.signals.usesAi,
    aiEvidence: reading.signals.aiEvidence.map(s => s.slice(0, 300)).slice(0, 20),
    reach: reading.reach.reach,
    privacyNotice: !!reading.app?.manifest?.legal?.privacy,
    // The Annex III sentences exist in Finnish and English; a Spanish test prints the English ones.
    nodeSafeguards: measuresFromConfig(config, lang === 'fi' ? 'fi' : 'en').map(m => ({ area: m.area, text: m.text.slice(0, 1000) })).slice(0, 40),
    reminders: domains.flatMap(d => (REMINDERS[d] ? [REMINDERS[d]![lang]] : [])),
    readAt: new Date().toISOString(),
  };
}

/** The answers the node can give from the facts: "yes" on positive evidence, nothing otherwise. */
export function factAnswers(facts: ComplianceLiaFacts): Record<string, 'yes'> {
  const out: Record<string, 'yes'> = {};
  for (const s of LIA_SECTIONS) {
    for (const q of s.questions) {
      const yes = q.fact === 'privacy-notice' ? facts.privacyNotice
        : q.fact === 'dependent-subjects' ? facts.domains.some(d => d === 'employment' || d === 'children')
          : q.fact === 'uses-ai' ? facts.usesAi : false;
      if (yes) out[q.id] = 'yes';
    }
  }
  return out;
}

/** The draft of one register's test: the facts, the fact answers, and nothing a person has to decide. */
export function liaDraftItem(config: AimeatConfig, reading: AppLiaReading, reg: ComplianceRegister, lang: LiaLang): ComplianceLia {
  const facts = liaFacts(config, reading, reg, lang);
  const answers = factAnswers(facts);
  return {
    id: liaIdFor(reg.id), registerId: reg.id, status: 'draft', language: lang, facts, answers,
    answerSources: { facts: 'evidence', ...Object.fromEntries(Object.keys(answers).map(q => [`answers.${q}`, 'evidence' as const])) },
  };
}
