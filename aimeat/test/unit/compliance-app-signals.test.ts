/**
 * @file compliance-app-signals.test.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description What an app's own statements say about its place in the compliance documents.
 *
 *   THE FIXTURES ARE THE REAL MAPS, ABRIDGED. TalentGrid and CV Parser on innokas.aimeat.io
 *   (2026-10-28) kept colleagues' and candidates' CV data, sent it to a model, and said so; the
 *   register showed neither. The rows below keep the words those maps actually use, so a change to
 *   the vocabulary that loses them fails here and not on the operator's page.
 *
 *   AND THE OTHER HALF: what must NOT fire. A medtech company's app says "medical device" on every
 *   page, and that is not health data; an app that never touches a model is not an AI use, however
 *   much personal data it keeps.
 * @usage cd aimeat && pnpm exec vitest run test/unit/compliance-app-signals.test.ts
 * @version-history
 *   v1.0.0 — 2026-10-28 — Initial.
 */
import { describe, it, expect } from 'vitest';
import { appAiSignals } from '../../src/services/compliance-app-signals.js';
import type { DataMap, DataMapRow } from '../../src/services/data-map/data-map-types.js';

const row = (over: Partial<DataMapRow>): DataMapRow => ({
  what: 'x', holds: '', kind: 'register', usedFor: 'user-returns-to-read', where: 'owner-memory-private',
  owner: 'person', readers: 'owner-only', writers: ['the-app-for-the-person'], shape: 'collection-under-one-key',
  keptFor: 'until-deleted', lossRisk: 'only-copy', personalData: 'no', why: 'because', ...over,
});

const mapOf = (over: Partial<DataMap>): DataMap => ({
  spec: 'aimeat.datamap/2', what: '', usedFor: '', form: 'one-person', arrangement: 'one key',
  machinery: [], leaves: [], held: [], elsewhere: [], source: 'declared', at: '2026-10-28T00:00:00.000Z', ...over,
});

/** TalentGrid's map as published on innokas.aimeat.io, abridged. */
const TALENTGRID = mapOf({
  what: 'TalentGrid is a competence and resourcing tool for a software organisation. It holds a register of people with their skills rated 1-5.',
  usedFor: "Answering 'who could we put on this' with evidence instead of memory, and producing the CV or team proposal that goes to the client.",
  machinery: ['ai-generation', 'login'],
  held: [
    row({ what: 'talentgrid.people', personalData: 'yes', holds: "each person's name, title, location, years of experience, availability and allocation, their skill entries (level 1-5)" }),
    row({ what: 'talentgrid.cvs', personalData: 'yes', kind: 'ai-generated', holds: 'Generated CV drafts: the model-written summary for one named person' }),
    row({ what: 'talentgrid.settings', personalData: 'no', kind: 'settings', holds: "This person's own view of the app" }),
  ],
  leaves: [{ what: "one named person's full CV facts", to: "the node's AI service, to write the CV copy", recallable: false }],
});

/** CV Parser's map, abridged. Its AI use is stated only in machinery. */
const CV_PARSER = mapOf({
  what: 'Takes a CV that arrived from the partner network and re-presents it on the Innokas template, anonymised.',
  usedFor: "Offering a partner consultant to an Innokas customer without handing the customer the consultant's identity.",
  machinery: ['ai-generation'],
  held: [row({ what: 'cvparser.library', isA: 'schema:Person', personalData: 'yes', holds: 'parsed partner CVs: work history, education, skills, plus the extracted name and contact details' })],
  leaves: [{ what: 'the anonymised CV', to: 'wherever they paste it', recallable: false }],
});

describe('an app that uses AI on employment data', () => {
  it('TalentGrid: uses AI, sends personal data to it, and its words read as employment data', () => {
    const s = appAiSignals(TALENTGRID, null);
    expect(s.usesAi).toBe(true);
    expect(s.personal).toBe(true);
    expect(s.personalToAi).toBe(true);
    const employment = s.domains.find(d => d.domain === 'employment');
    expect(employment?.source).toBe('proposed');
    expect(employment?.rows).toEqual(['talentgrid.people', 'talentgrid.cvs']);
    expect(employment?.words).toEqual(expect.arrayContaining(['competence', 'resourcing', 'allocation']));
  });

  it('TalentGrid: the Annex III area is employment, with a reason a person can check', () => {
    const s = appAiSignals(TALENTGRID, null);
    expect(s.annex3?.area).toBe('employment');
    expect(s.annex3?.reason).toContain('talentgrid.people');
    expect(s.annex3?.reason).toContain('ai-generation');
  });

  it('CV Parser: "CVs" and "work history" are employment data, and machinery alone says AI', () => {
    const s = appAiSignals(CV_PARSER, null);
    expect(s.aiEvidence).toEqual(['the data map lists ai-generation in its machinery']);
    expect(s.personalToAi).toBe(false);
    expect(s.annex3?.area).toBe('employment');
    expect(s.domains.map(d => d.domain)).toEqual(['employment']);
  });

  it('a domain a row states is evidence, and wins over the same domain proposed from another row', () => {
    const m = mapOf({
      ...TALENTGRID,
      held: [
        row({ what: 'people', personalData: 'yes', domains: ['employment'], holds: 'names' }),
        row({ what: 'cvs', personalData: 'yes', holds: 'CV drafts' }),
      ],
    });
    const s = appAiSignals(m, null);
    expect(s.domains).toEqual([{ domain: 'employment', source: 'evidence', rows: ['people'], words: [] }]);
    expect(s.annex3?.reason).toContain('states employment data in people');
  });

  it('`domains: []` is a considered "none": no proposal, no row left unplaced', () => {
    const m = mapOf({ ...TALENTGRID, held: [row({ what: 'people', personalData: 'yes', domains: [], holds: 'CVs and skills' })] });
    const s = appAiSignals(m, null);
    expect(s.domains).toEqual([]);
    expect(s.annex3).toBeNull();
    expect(s.personalRowsWithoutDomain).toEqual([]);
  });

  it('Finnish words reach the domain through their inflections, ä and ö included', () => {
    const m = mapOf({ machinery: ['ai-generation'], held: [row({ what: 'tiimi', personalData: 'yes', holds: 'henkilöstön osaamisprofiilit ja työhistoria' })] });
    const s = appAiSignals(m, null);
    expect(s.domains[0]?.domain).toBe('employment');
    expect(s.domains[0]?.words).toEqual(expect.arrayContaining(['henkilöstön', 'osaamisprofiilit', 'työhistoria']));
  });
});

describe('what does not fire', () => {
  it('a medtech app saying "medical device" keeps no health data by that alone', () => {
    const m = mapOf({
      what: 'Gate readiness for medical device development projects.', machinery: ['ai-generation'],
      held: [row({ what: 'pm.projects', personalData: 'yes', holds: 'project managers and their medical device projects' })],
    });
    const s = appAiSignals(m, null);
    expect(s.domains.find(d => d.domain === 'health')).toBeUndefined();
    expect(s.personalRowsWithoutDomain).toEqual(['pm.projects']);
  });

  it('an app that keeps CVs and never uses a model is not an AI use, and gets no Annex III area', () => {
    const m = mapOf({ held: [row({ what: 'cvs', personalData: 'yes', holds: 'CVs' })] });
    const s = appAiSignals(m, null);
    expect(s.usesAi).toBe(false);
    expect(s.annex3).toBeNull();
    expect(s.domains[0]?.domain).toBe('employment');
  });

  it('a row without personal data is never placed in a domain, whatever it says', () => {
    const m = mapOf({ machinery: ['ai-generation'], held: [row({ what: 'catalogue', personalData: 'no', holds: 'skill matrix template, CV layout' })] });
    expect(appAiSignals(m, null).domains).toEqual([]);
  });

  it('no map: the posture alone says AI, and nothing about people', () => {
    const s = appAiSignals(null, { usesAi: true, generates: ['text'] });
    expect(s.usesAi).toBe(true);
    expect(s.aiEvidence).toEqual(['the app asks for permission to use AI (ai:use)', 'the app declares it generates text']);
    expect(s.personal).toBe(false);
    expect(s.annex3).toBeNull();
  });
});
