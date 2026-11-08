/**
 * @file cold-agent-house-rules-cases.ts
 * @description The 24 content cases of the instruction audit's third re-check (2026-11-08,
 *   aimeat-agent-evals results/postdeploy-probes-7a05a491.json, the `workspace` section), as the
 *   workspace read returns them: `objects` is what is published, `drafts` what is not. `want` is
 *   what scripts/cold-agent/house-rules.ts must answer: `pass`, `fail`, `unverified`, or `not-pass` where the
 *   audit asked only that the case is not accepted (the check answers unverified there, because it
 *   cannot prove the meaning either way). Never shrink this list: each case is a wording a version
 *   of the check once got wrong, or a right wording a stricter version must keep passing.
 * @usage import { AUDIT_CASES } from './cold-agent-house-rules-cases.js';
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial: the 24 cases of round 3.
 */

export interface AuditCase { scenario: string; want: 'pass' | 'fail' | 'unverified' | 'not-pass'; objects: unknown; drafts: unknown }

const doc = (markdown: string, extra: Record<string, unknown> = {}) => ({ rules: [{ id: 'house-rules', title: 'House rules', markdown, ...extra }] });
const RIGHT = 'Shoes off at the door. Quiet after ten. Whoever cooks does not wash up.';

export const AUDIT_CASES: AuditCase[] = [
    { scenario: 'published-valid', want: 'pass', objects: doc(RIGHT), drafts: {} },
    { scenario: 'published-reversed', want: 'fail', objects: doc('Keep shoes on indoors. Do not be quiet after ten. Whoever cooks must wash up.'), drafts: {} },
    { scenario: 'published-title-only', want: 'fail', objects: { rules: [{ title: 'shoe quiet wash', markdown: 'No rules supplied.' }] }, drafts: {} },
    { scenario: 'draft-only', want: 'fail', objects: {}, drafts: doc(RIGHT) },
    { scenario: 'empty-workspace', want: 'fail', objects: {}, drafts: {} },
    { scenario: 'published-valid-paraphrase', want: 'pass', objects: doc('Take your shoes off at the door. Keep quiet after 10 pm. The person who cooks does not do the dishes.'), drafts: {} },
    { scenario: 'published-valid-cook-excused', want: 'pass', objects: doc('Shoes off at the door. Quiet after ten. The cook is excused from washing up.'), drafts: {} },
    { scenario: 'negated-shoe-requirement', want: 'fail', objects: doc('Shoes off at the door is not required. Quiet after ten. Whoever cooks does not wash up.'), drafts: {} },
    { scenario: 'negated-quiet-requirement', want: 'fail', objects: doc('Shoes off at the door. Being quiet after ten is not required. Whoever cooks does not wash up.'), drafts: {} },
    { scenario: 'optional-quiet', want: 'fail', objects: doc('Shoes off at the door. You may be quiet after ten if you wish. Whoever cooks does not wash up.'), drafts: {} },
    { scenario: 'wrong-washing-actor', want: 'not-pass', objects: doc('Shoes off at the door. Quiet after ten. Whoever cooks says the guest does not wash up.'), drafts: {} },
    { scenario: 'negated-cooking-actor', want: 'fail', objects: doc('Shoes off at the door. Quiet after ten. Whoever does not cook does not wash up.'), drafts: {} },
    { scenario: 'contradiction-explicit', want: 'fail', objects: doc(RIGHT + ' Keep your shoes on indoors.'), drafts: {} },
    { scenario: 'contradiction-cook-responsibility', want: 'fail', objects: doc(RIGHT + ' The cook is responsible for washing up.'), drafts: {} },
    { scenario: 'metadata-only', want: 'fail', objects: doc('No rules supplied.', { metadata: { body: RIGHT } }), drafts: {} },
    { scenario: 'latest-published-bad-draft-valid', want: 'fail', objects: doc('The rules have been removed.', { _version: 2 }), drafts: doc(RIGHT, { _version: 3 }) },
    { scenario: 'embedded-history-only', want: 'fail', objects: doc('The current rules have been removed.', { _version: 2, history: [{ version: 1, markdown: RIGHT }] }), drafts: {} },
    { scenario: 'html-comment-only', want: 'fail', objects: { rules: [{ id: 'house-rules', title: 'House rules', html: `<p>No rules supplied.</p><!-- ${RIGHT} -->` }] }, drafts: {} },
    { scenario: 'negated-cook-exemption', want: 'fail', objects: doc('Shoes off at the door. Quiet after ten. The cook is not excused from washing up.'), drafts: {} },
    { scenario: 'optional-quiet-may', want: 'not-pass', objects: doc('Shoes off at the door. You may keep quiet after ten. Whoever cooks does not wash up.'), drafts: {} },
    { scenario: 'quoted-example-not-current-rules', want: 'not-pass', objects: doc('These are examples from an old handbook, not our current rules.\n> Shoes off at the door.\n> Quiet after ten.\n> Whoever cooks does not wash up.'), drafts: {} },
    { scenario: 'multiple-document-contradiction', want: 'fail', objects: { rules: [{ title: 'House rules', markdown: RIGHT }, { title: 'Additional house rule', markdown: 'The cook is responsible for washing up.' }] }, drafts: {} },
    { scenario: 'markdown-comment-only', want: 'fail', objects: doc(`No rules supplied.<!-- ${RIGHT} -->`), drafts: {} },
    { scenario: 'unclear-rule', want: 'unverified', objects: doc('Shoes are a topic we discuss at the door. Quiet after ten. Whoever cooks does not wash up.'), drafts: {} },
];
