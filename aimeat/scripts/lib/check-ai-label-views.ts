/**
 * @file scripts/lib/check-ai-label-views.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Assertion 8 of check:ai-disclosure: every page that shows a person content a record
 *   describes DRAWS the label, and the share decides it as public. In its own module so the gate
 *   stays below its file-size ceiling, the way the connector and AI SDK checks do.
 *
 *   WHY IT EXISTS. On 2026-10-16 the node served a provenance record on almost every public read and
 *   drew the label on few of them: the public workspace viewer took each page's `ai_provenance` and
 *   showed nothing, an HTML page's frame had no place for it, the front page dropped a passage's
 *   record, and every item a workspace share served was decided as private, so the label said
 *   "nothing owed" even where it was drawn (Jouni: "AI merkintä jos sivuilla on AI generoitua
 *   sisältöä ja se täytyy kertoa"). Each line below is a view or a route that was fixed then; removing
 *   the label from one of them fails this check.
 *
 *   A VIEW passes when its source, comments stripped, imports AiLabel from components/ai-label.js and
 *   renders it. A ROUTE passes when it calls what decides or carries the label.
 * @structure LABEL_VIEWS · LABEL_ROUTES · createAiLabelViewsCheck(deps).check()
 * @version-history
 *   v1.0.0 — 2026-10-16 — Initial (the AI label on every public page).
 */
import { join } from 'node:path';

/** The views that show content a record describes, and what each one shows. */
export const LABEL_VIEWS: Array<{ file: string; shows: string }> = [
    { file: 'public/views/public-workspace-viewer.js', shows: 'the pages a workspace shares outside its organism' },
    { file: 'public/components/HtmlPageFrame.js', shows: 'an HTML page, in the strip around its frame' },
    { file: 'public/views/profile/organisms/document.js', shows: 'a Markdown page in the member view' },
    { file: 'public/views/profile/organisms/workspace/record-space.js', shows: 'a workspace record in the member view' },
    { file: 'public/views/public-knowledge-viewer.js', shows: 'a knowledge package and each of its entries' },
    { file: 'public/views/portfolio.js', shows: 'a portfolio on the node\'s own address' },
    { file: 'public/views/surface/blocks-portal.js', shows: 'the front page\'s text passages and board posts' },
    { file: 'public/views/surface/freeform.js', shows: 'a free-form passage on the front page or the home' },
];

/** The server code that decides the label for what it serves, and the call that does it. */
export const LABEL_ROUTES: Array<{ file: string; literal: string; why: string }> = [
    { file: 'src/routes/organisms/workspace-ops.ts', literal: 'shareServedVisibility(', why: 'the share routes decide each item\'s label for the reader the share serves' },
    { file: 'src/routes/page-host.ts', literal: 'setProvenanceHeaders(', why: 'an HTML page and its files carry their record on the page host' },
    { file: 'src/routes/site-layout.ts', literal: 'freeform_provenance', why: 'the layout read carries each passage\'s record' },
    { file: 'src/routes/designbook.ts', literal: 'partProvenanceIds(', why: 'a Design Book part carries its record' },
    { file: 'src/routes/knowledge/sharing.ts', literal: 'entry_provenance', why: 'a package export carries each entry\'s record' },
    { file: 'src/services/ai-transparency-report.ts', literal: 'sharePublicInScope', why: 'the compliance counts see what an open share serves' },
];

export function createAiLabelViewsCheck(deps: {
    root: string;
    stripped: (file: string) => string;
    fail: (assertion: string, what: string, fix: string) => void;
}) {
    return {
        check(): void {
            for (const v of LABEL_VIEWS) {
                const src = deps.stripped(join(deps.root, v.file));
                const imports = /import\s*\{[^}]*\bAiLabel\b[^}]*\}\s*from\s*['"]\/components\/(?:ai-label|index)\.js['"]/.test(src);
                const renders = /<\$\{AiLabel\}/.test(src);
                if (!imports || !renders) {
                    deps.fail('label-views', `${v.file} no longer draws the AI label (${v.shows})`,
                        'import AiLabel from /components/ai-label.js and render it with the record the read hands '
                        + 'out (`record`, `recordUrl`). It draws nothing when no label is owed, so it belongs on '
                        + 'every view that shows content a record describes.');
                }
            }
            for (const r of LABEL_ROUTES) {
                if (!deps.stripped(join(deps.root, r.file)).includes(r.literal)) {
                    deps.fail('label-views', `${r.file} no longer contains "${r.literal}" (${r.why})`,
                        'put it back: without it the content is served with no record, or with a label '
                        + 'decided for the wrong reader.');
                }
            }
        },
    };
}
