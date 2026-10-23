/**
 * @file src/data/classification-packs.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The classification label packs an operator switches on in one call (plan
 *   doc-mvlftkh9zmc9, C3.1, C3.3): the Finnish security classes (TL IV to TL I) and NATO's
 *   (NATO RESTRICTED to COSMIC TOP SECRET), each with the detection rules that recognise its
 *   markings. services/classification/packs.ts adds them to the node policy; nothing in the node
 *   decides by these ids, only by the label fields, as for every other label.
 *
 *   RANKS (decision 10.4). Above the four business labels (0 to 30): TL IV 40, NATO RESTRICTED 45,
 *   TL III 50, NATO CONFIDENTIAL 55, TL II 60, NATO SECRET 65, TL I 70, COSMIC TOP SECRET 75. A NATO
 *   class sits one step above its TL counterpart, because NATO's own release rules bind it as well.
 *
 *   FIELDS (C3.5). Every label: an AI sees it with a warning, every use is audited, it never leaves
 *   its organism (federation refused), lowering needs a reason, it is shown to at most the
 *   organism's members, and only a model on this machine reads it (externalAi refused). The need to
 *   know is the label's reader list, which the operator fills (a group of cleared people).
 *
 *   MARKINGS (C3.3). Upper case only, as the markings are written on a document: "TL III", "ST II"
 *   (the class names used before 2019), "KÄYTTÖ RAJOITETTU", "NATO SECRET", "COSMIC TOP SECRET". The
 *   bare words LUOTTAMUKSELLINEN and SALAINEN are not recognised, because a business document uses
 *   them too and a rule only raises. "NATO UNCLASSIFIED" is a release marking, not a class: it
 *   raises to nothing above Internal.
 *
 *   TOP LEVELS (decision 10.8). TL II, TL I, NATO SECRET and COSMIC TOP SECRET are `top: true`.
 *   Switching a pack on up to one of them takes the operator's separate acknowledgement that this
 *   node is not an accredited system, and the compliance report says so for as long as they are on.
 * @structure PackLabel · PackRule · ClassificationPack · CLASSIFICATION_PACKS · packById()
 * @usage const tl = packById('tl');
 * @version-history
 *   v1.0.0 — 2026-10-23 — Initial (plan doc-mvlftkh9zmc9, C3.1, C3.3, decisions 10.4 and 10.8).
 */
import type { ClassificationLabel, ClassificationRule } from '../services/classification/defaults.js';

export interface PackLabel extends ClassificationLabel {
  /** One of the two highest classes of its pack: needs the operator's acknowledgement (10.8). */
  top: boolean;
}

export interface ClassificationPack {
  id: 'tl' | 'nato';
  name: { fi: string; en: string; es: string };
  /** Lowest class first. */
  labels: PackLabel[];
  rules: ClassificationRule[];
  laws: string[];
}

const PROTECT = {
  status: 'active' as const, aiVisibility: 'warning' as const, audit: true, mayLeaveOrganism: false,
  lowerNeedsJustification: true, maxAudience: 'organism' as const, externalAi: 'refused' as const,
};

/** A marking not preceded or followed by a letter, so "TL II" is not found inside "TL III". */
const mark = (body: string) => `(?<![A-Za-zÅÄÖåäö])(?:${body})(?![A-Za-zÅÄÖåäö])`;

const rule = (id: string, name: string, pattern: string, minLabel: string): ClassificationRule => ({
  id, name, kind: 'regex', pattern, flags: '', minLabel, enabled: true,
});

export const CLASSIFICATION_PACKS: readonly ClassificationPack[] = [
  {
    id: 'tl',
    name: { fi: 'Turvallisuusluokat (TL)', en: 'Finnish security classes (TL)', es: 'Clases de seguridad finlandesas (TL)' },
    laws: ['Laki julkisen hallinnon tiedonhallinnasta 906/2019 18 §', 'VNA 1101/2019 asiakirjojen turvallisuusluokittelusta valtionhallinnossa'],
    labels: [
      { ...PROTECT, id: 'tl-iv', rank: 40, color: '#7a5c99', top: false,
        name: { fi: 'TL IV Käyttö rajoitettu', en: 'TL IV Restricted', es: 'TL IV Uso restringido' },
        description: 'Security class IV: harm to a public interest if disclosed. Readers need to know; only a model on this machine reads it.' },
      { ...PROTECT, id: 'tl-iii', rank: 50, color: '#6a3f8f', top: false,
        name: { fi: 'TL III Luottamuksellinen', en: 'TL III Confidential', es: 'TL III Confidencial' },
        description: 'Security class III: significant harm if disclosed. Readers need to know; only a model on this machine reads it.' },
      { ...PROTECT, id: 'tl-ii', rank: 60, color: '#552a7d', top: true,
        name: { fi: 'TL II Salainen', en: 'TL II Secret', es: 'TL II Secreto' },
        description: 'Security class II: serious harm if disclosed. This node is not an accredited system for it.' },
      { ...PROTECT, id: 'tl-i', rank: 70, color: '#3f1768', top: true,
        name: { fi: 'TL I Erittäin salainen', en: 'TL I Top secret', es: 'TL I Alto secreto' },
        description: 'Security class I: exceptionally grave harm if disclosed. This node is not an accredited system for it.' },
    ],
    rules: [
      rule('tl-iv-marking', 'TL IV marking', `${mark('(?:TL|ST) ?IV')}|KÄYTTÖ RAJOITETTU`, 'tl-iv'),
      rule('tl-iii-marking', 'TL III marking', mark('(?:TL|ST) ?III'), 'tl-iii'),
      rule('tl-ii-marking', 'TL II marking', mark('(?:TL|ST) ?II'), 'tl-ii'),
      rule('tl-i-marking', 'TL I marking', `${mark('(?:TL|ST) ?I')}|ERITTÄIN SALAINEN`, 'tl-i'),
    ],
  },
  {
    id: 'nato',
    name: { fi: 'NATO-luokat', en: 'NATO classifications', es: 'Clasificaciones de la OTAN' },
    laws: ['NATO Security Policy C-M(2002)49', 'Laki ulkomaisista ja kansainvälisistä tietoturvallisuusvelvoitteista 588/2004'],
    labels: [
      { ...PROTECT, id: 'nato-restricted', rank: 45, color: '#2f5f8f', top: false,
        name: { fi: 'NATO RESTRICTED', en: 'NATO RESTRICTED', es: 'NATO RESTRICTED' },
        description: 'NATO RESTRICTED, at least TL IV. Readers need to know; only a model on this machine reads it.' },
      { ...PROTECT, id: 'nato-confidential', rank: 55, color: '#244c75', top: false,
        name: { fi: 'NATO CONFIDENTIAL', en: 'NATO CONFIDENTIAL', es: 'NATO CONFIDENTIAL' },
        description: 'NATO CONFIDENTIAL, at least TL III. Readers need clearance and a need to know.' },
      { ...PROTECT, id: 'nato-secret', rank: 65, color: '#1a3a5c', top: true,
        name: { fi: 'NATO SECRET', en: 'NATO SECRET', es: 'NATO SECRET' },
        description: 'NATO SECRET, at least TL II. This node is not an accredited system for it.' },
      { ...PROTECT, id: 'cosmic-top-secret', rank: 75, color: '#0f2640', top: true,
        name: { fi: 'COSMIC TOP SECRET', en: 'COSMIC TOP SECRET', es: 'COSMIC TOP SECRET' },
        description: 'COSMIC TOP SECRET, at least TL I. This node is not an accredited system for it.' },
    ],
    rules: [
      rule('nato-unclassified-marking', 'NATO UNCLASSIFIED marking', mark('NATO UNCLASSIFIED'), 'sisainen'),
      rule('nato-restricted-marking', 'NATO RESTRICTED marking', mark('NATO RESTRICTED'), 'nato-restricted'),
      rule('nato-confidential-marking', 'NATO CONFIDENTIAL marking', mark('NATO CONFIDENTIAL'), 'nato-confidential'),
      rule('nato-secret-marking', 'NATO SECRET marking', mark('NATO SECRET'), 'nato-secret'),
      rule('cosmic-top-secret-marking', 'COSMIC TOP SECRET marking', mark('COSMIC TOP SECRET'), 'cosmic-top-secret'),
    ],
  },
];

/** The pack with this id, or undefined. */
export function packById(id: string): ClassificationPack | undefined {
  return CLASSIFICATION_PACKS.find(p => p.id === id);
}
