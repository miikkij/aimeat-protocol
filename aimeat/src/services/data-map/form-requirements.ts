/**
 * @file src/services/data-map/form-requirements.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What each SHAPE of program owes its data map. A one-person app claiming organism rows
 *   is describing something it cannot do; a group app that never names its other readers has not
 *   finished. Same document, different obligations.
 *
 *   A DECLARED TABLE, not a chain of ifs, following the `rollup-cuts.ts` pattern: adding a rule is
 *   one entry here and no code change anywhere else. Each entry carries the QUESTION that form's map
 *   has to answer, in the same words a person would ask it — a requirement list nobody can read is a
 *   requirement list nobody applies.
 * @structure FormRequirement · FORM_REQUIREMENTS · checkFormRequirements(map)
 * @usage import { checkFormRequirements } from './form-requirements.js';
 * @version-history
 *   v1.0.0 — 2026-08-24 — Initial creation for TARGET-073 step 2.
 */
import type { DataMap, DataMapForm, DataMapRow, ElsewhereRow } from './data-map-types.js';

/** One violation, written for whoever has to fix it. */
export interface FormViolation {
  /** The row it is about, by pattern; empty when the whole map is at fault. */
  pattern: string;
  says: string;
}

export interface FormRequirement {
  /** What a reader is asking when they open this form's map. */
  answers: string;
  /** Checks every held row must pass. */
  eachHeldRow: ((row: DataMapRow) => string | null)[];
  /** Checks the map as a whole must pass. */
  whole: ((map: DataMap) => string | null)[];
}

const statesPersonalData = (row: DataMapRow): string | null =>
  row.personalData === 'unstated'
    ? 'Say whether this holds personal data. Leaving it open is not the same as saying no.'
    : null;

const answersDeletion = (row: DataMapRow | ElsewhereRow): string | null =>
  row.deletion.effect === 'unknown'
    ? 'Say what deleting this does. This is the question a deletion request arrives asking.'
    : null;

const keptToOneReader = (row: DataMapRow): string | null =>
  row.readers.visibility === 'private' || row.readers.visibility === 'owner'
    ? null
    : `This is a one-person program, but this row is readable as "${row.readers.visibility}". Either name the other readers or change the shape.`;

const namesOtherReaders = (row: DataMapRow): string | null => {
  if (row.readers.visibility === 'private' || row.readers.visibility === 'owner') return null;
  return (row.readers.alsoNamed ?? []).length > 0
    ? null
    : 'Name who else reads this. "Shared" without a who is the gap this map exists to close.';
};

const noOrganismRows = (map: DataMap): string | null => {
  const claim = map.held.find(r => r.grant.area === 'organisms' || r.ownership === 'organism');
  return claim
    ? `This is a one-person program and it claims an organism area (${claim.grant.pattern}). One of the two is wrong.`
    : null;
};

const hasOrganismRow = (map: DataMap): string | null =>
  map.held.some(r => r.grant.area === 'organisms' || r.ownership === 'organism')
    ? null
    : 'This says it works in an organism workspace and names no organism area. Say where the shared work lives.';

const versionsAnswered = (map: DataMap): string | null => {
  const missing = map.held.find(
    r => (r.grant.area === 'organisms' || r.ownership === 'organism')
      && !(r.deletion.survives ?? []).some(s => /version/i.test(s))
      && !(r.deletion.alsoRemoves ?? []).includes('versions'),
  );
  return missing
    ? `Say what happens to the earlier versions of ${missing.grant.pattern}. A workspace record keeps its history, and a map that skips that describes a deletion that does not happen.`
    : null;
};

/**
 * The table. `mixed` is the union of everything, because a program that is more than one shape owes
 * the obligations of each — the lint names the row that forced it so the answer is actionable.
 */
export const FORM_REQUIREMENTS: Record<DataMapForm, FormRequirement> = {
  'single-person': {
    answers: 'Is any of this readable by anyone but me?',
    eachHeldRow: [statesPersonalData, keptToOneReader],
    whole: [noOrganismRows],
  },
  private: {
    answers: 'If I delete this, is it gone?',
    eachHeldRow: [statesPersonalData, answersDeletion],
    whole: [noOrganismRows],
  },
  shared: {
    answers: 'Who else can read this, and what happens to their copy when I remove mine?',
    eachHeldRow: [statesPersonalData, answersDeletion, namesOtherReaders],
    whole: [],
  },
  group: {
    answers: 'What happens to this when someone leaves the group?',
    eachHeldRow: [statesPersonalData, answersDeletion, namesOtherReaders],
    whole: [],
  },
  'organism-workspace': {
    answers: 'This outlives whoever wrote it — who owns it then, and what does deleting reach?',
    eachHeldRow: [statesPersonalData, answersDeletion],
    whole: [hasOrganismRow, versionsAnswered],
  },
  mixed: {
    answers: 'Which part of this is mine alone, and which part is not?',
    eachHeldRow: [statesPersonalData, answersDeletion, namesOtherReaders],
    whole: [versionsAnswered],
  },
};

/**
 * Check a map against its declared form.
 *
 * Returns every violation rather than the first, because a builder fixing one at a time round-trips
 * a publish per violation, and this check runs on the publish path.
 */
export function checkFormRequirements(map: DataMap): FormViolation[] {
  const req = FORM_REQUIREMENTS[map.form];
  if (!req) return [{ pattern: '', says: `Unknown form "${map.form}".` }];

  const out: FormViolation[] = [];
  for (const row of map.held) {
    for (const check of req.eachHeldRow) {
      const says = check(row);
      if (says) out.push({ pattern: row.grant.pattern, says });
    }
  }
  // Every elsewhere row owes a deletion answer whatever the form: it is the only column that table
  // has which the held table does not already carry, and the reason that table exists at all.
  for (const row of map.elsewhere) {
    const says = answersDeletion(row);
    if (says) out.push({ pattern: row.grant.pattern, says });
  }
  for (const check of req.whole) {
    const says = check(map);
    if (says) out.push({ pattern: '', says });
  }
  return out;
}
