/**
 * @file src/data/compliance-questionnaire.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The risk-classification question set a fresh node starts with — the SEED, never the
 *   authority.
 *
 *   THE SEED LOSES TO THE RECORD, ALWAYS. This is written into `compliance.questionnaire` once, on
 *   a node that has no such record yet, and is never written again. Regulatory reading moves, and a
 *   question set that lives in source would need a release to follow it — which means it would not
 *   follow it. The operator edits the record; this file is only what they start from.
 *
 *   THE CLASSIFIER DOES NOT KNOW ANY OF THESE IDS. `implies` carries the whole rule: an answer maps
 *   to a class, the most severe hit wins, and an unanswered question leaves the use case
 *   `unclassified` rather than quietly minimal. That is the only reason a question can be added
 *   without touching code.
 *
 *   IT IS AN ENGINEERING AID AND SAYS SO. Every class carries a `note` that a reader sees, and
 *   `NOT_LEGAL_ADVICE` is served with the set. A tool that answered "high risk" with the confidence
 *   of a determination would be worse than no tool, because somebody would act on it.
 *
 *   WHY THESE QUESTIONS. Article 5 (prohibited practices) and Annex III (high risk) are the two
 *   lists that decide a classification; Article 50 decides whether a transparency duty attaches on
 *   top. The wording is deliberately about what a system DOES rather than what it is called — an
 *   operator can answer "does this score people for a job" without knowing which annex says so.
 *   Research behind the wording: docs/internal/EUAct/ (01-research-article-50.md,
 *   04-aimeat-role-analysis.md, 16-timeline-and-omnibus.md).
 * @structure
 *   - QUESTIONNAIRE_SEED_VERSION — bumped when this file changes; the record keeps its own version
 *   - NOT_LEGAL_ADVICE — the sentence served with every classification
 *   - COMPLIANCE_QUESTIONNAIRE_SEED — the set itself
 * @usage
 *   import { COMPLIANCE_QUESTIONNAIRE_SEED } from '../data/compliance-questionnaire.js';
 *   await seedComplianceQuestionnaire(storage, config.nodeId);   // writes only when absent
 * @version-history
 *   v1.0.0 — 2026-08-23 — BR-02. Structured on the Act's own lists because no first customer has
 *     been named; the set is data precisely so the first real one can reshape it without a release.
 */
import type { ComplianceQuestionnaire } from '../services/compliance-register.js';

/** Bumped when the questions below change. The stored record carries its own, which may differ. */
export const QUESTIONNAIRE_SEED_VERSION = '2026-08-23';

/**
 * Served with every classification, and shown beside the class in the report and the tab.
 *
 * It is not a disclaimer in the legal sense and is not trying to be. It states what the number
 * actually is — answers, run through a question set the reader can open and edit — so that nobody
 * mistakes an arithmetic result for a determination somebody qualified made.
 */
export const NOT_LEGAL_ADVICE =
  'This class is your own answers run through your own question set. It is an engineering aid for '
  + 'finding what needs a closer look, not a legal determination and not advice. The question set '
  + 'is editable data on this node: if a reading is wrong for you, change the question.';

export const COMPLIANCE_QUESTIONNAIRE_SEED: ComplianceQuestionnaire = {
  version: QUESTIONNAIRE_SEED_VERSION,
  updatedAt: '2026-08-23T00:00:00.000Z',
  note: NOT_LEGAL_ADVICE,
  // Severity orders the classes so the classifier can pick the worst hit without knowing their
  // names. Add a class with a severity between two others and it slots in; nothing else changes.
  classes: [
    {
      id: 'prohibited', label: 'Prohibited', severity: 40,
      note: 'The Act forbids this outright. If a use case lands here, the question is whether to '
        + 'stop it, not how to document it.',
    },
    {
      id: 'high', label: 'High risk', severity: 30,
      note: 'Annex III territory. It carries duties well beyond transparency — risk management, '
        + 'record-keeping, human oversight, conformity assessment — and none of them are things '
        + 'this node does for you.',
    },
    {
      id: 'limited', label: 'Transparency duty', severity: 20,
      note: 'Article 50 attaches: people have to be told. This node does the marking and the '
        + 'labelling for what is published through it; what you publish elsewhere is yours.',
    },
    {
      id: 'minimal', label: 'Minimal', severity: 10,
      note: 'No specific duty found by these questions. That is the answer to these questions, not '
        + 'a clean bill of health.',
    },
  ],
  defaultClass: 'minimal',
  questions: [
    // ── Article 5: the practices that are forbidden regardless of how well they are documented ──
    {
      id: 'q-manipulative-technique',
      text: 'Does it use techniques a person cannot perceive, or exploit an age, disability or '
        + 'financial vulnerability, in a way that could lead someone to a decision harmful to them?',
      help: 'Aimed at the substance rather than the intent: a nudging system nobody meant as '
        + 'manipulative still counts if that is what it does.',
      type: 'boolean',
      implies: { true: 'prohibited' },
    },
    {
      id: 'q-social-scoring',
      text: 'Does it score people by their social behaviour or personal traits, and is that score '
        + 'then used against them in a situation unrelated to where it was collected?',
      help: 'The unrelated-context part is what makes it social scoring rather than ordinary '
        + 'assessment.',
      type: 'boolean',
      implies: { true: 'prohibited' },
    },
    {
      id: 'q-emotion-workplace-education',
      text: 'Does it infer emotions of people at work or in education?',
      help: 'Medical and safety purposes are carved out. Agent trust scores are not this: they '
        + 'score credentials, not natural persons.',
      type: 'boolean',
      implies: { true: 'prohibited' },
    },
    {
      id: 'q-biometric-categorisation-sensitive',
      text: 'Does it sort people by biometric data to infer race, political opinion, trade union '
        + 'membership, religion, sex life or sexual orientation?',
      type: 'boolean',
      implies: { true: 'prohibited' },
    },
    {
      id: 'q-untargeted-face-scraping',
      text: 'Does it build or expand a face-recognition database by scraping images from the '
        + 'internet or CCTV without a target?',
      type: 'boolean',
      implies: { true: 'prohibited' },
    },

    // ── Annex III: the areas where a system is high risk by where it is used ──
    {
      id: 'q-annex3-area',
      text: 'Is it used in one of these areas?',
      help: 'Pick the closest. These are the Annex III areas, in the words an operator would use '
        + 'rather than the Act\'s. "None of these" is a normal answer.',
      type: 'choice',
      options: [
        { value: 'none', label: 'None of these' },
        { value: 'biometrics', label: 'Identifying people by biometrics' },
        { value: 'critical-infrastructure', label: 'Running or protecting critical infrastructure' },
        { value: 'education', label: 'Deciding admission, assessment or progress in education' },
        { value: 'employment', label: 'Hiring, task allocation, promotion, or ending employment' },
        { value: 'essential-services', label: 'Access to essential services, credit, or insurance pricing' },
        { value: 'law-enforcement', label: 'Law enforcement' },
        { value: 'migration', label: 'Migration, asylum or border control' },
        { value: 'justice-democracy', label: 'Administration of justice, or influencing an election' },
      ],
      implies: {
        biometrics: 'high',
        'critical-infrastructure': 'high',
        education: 'high',
        employment: 'high',
        'essential-services': 'high',
        'law-enforcement': 'high',
        migration: 'high',
        'justice-democracy': 'high',
      },
    },
    {
      id: 'q-decides-about-a-person',
      text: 'Does its output decide something about an identified person, or materially shape a '
        + 'decision somebody makes about them?',
      help: 'A system that only drafts, summarises or suggests to its own user is not this. A '
        + 'system whose score is copied into a decision is, whoever pastes it.',
      type: 'boolean',
      implies: { true: 'high' },
    },

    // ── Article 50: the transparency duties, which attach on top of any class above ──
    {
      id: 'q-interacts-with-people',
      text: 'Does a person talk to it directly, or read something it wrote?',
      help: 'Agent-to-node traffic, tool calls, federation sync and the scheduler are not this — '
        + 'that is machine to machine and 50(1) says so explicitly.',
      type: 'boolean',
      implies: { true: 'limited' },
    },
    {
      id: 'q-publishes-publicly',
      text: 'Does it publish generated text, image, audio or video where anyone can read it?',
      help: 'This is the Article 50(4) axis, and the one this node can measure for you: the report '
        + 'counts what was published without a label under "unlabelled".',
      type: 'boolean',
      implies: { true: 'limited' },
    },
    {
      id: 'q-publishes-public-interest',
      text: 'Is any of that about politics, public administration, health, science or another '
        + 'matter of public interest?',
      help: 'Subject matter is what moves 50(4) from theoretical to real, because the editorial '
        + 'carve-out only helps where a person actually reviewed the substance.',
      type: 'boolean',
      implies: { true: 'limited' },
    },
    {
      id: 'q-resembles-real-people',
      text: 'Does it generate media that could be taken for real people, places or events?',
      help: 'Illustrations and icons are not this. A depiction someone could mistake for a '
        + 'photograph of an identifiable person is.',
      type: 'boolean',
      implies: { true: 'limited' },
    },
    {
      id: 'q-human-reviews-before-publish',
      text: 'Does a person read the substance before it goes out, and can they change or stop it?',
      help: 'Answer no for anything a schedule publishes on its own. This does not lower the class '
        + 'by itself — it is recorded because it is the fact the editorial carve-out turns on, and '
        + 'because a "no" beside public-interest publishing is the pair worth looking at.',
      type: 'boolean',
      implies: {},
    },
  ],
};
