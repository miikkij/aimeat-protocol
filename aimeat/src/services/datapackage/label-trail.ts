/**
 * @file src/services/datapackage/label-trail.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The label addresses of what one extension run read, so a data package the run
 *   publishes keeps the labels of what it was copied from (secaudit2026nov08b round 15,
 *   datapackage/ext-capability:publish-drops-label-source-of-run-reads).
 *
 *   WHY. An extension reads organism records, rows, files and other packages through ctx, and
 *   publishes rows with ctx.datapackage.publish. The rows arrive by value, so the node cannot tell
 *   which read they came from; a data product records the label address of every item it copied
 *   (./source-labels.ts), and the extension path recorded none, so a reader the source's label keeps
 *   out read the copy. On a schedule or a workflow step the row calls read with the system reader,
 *   which shows every row, so the package could hold rows labelled for fewer readers than its audience.
 *
 *   HOW. One trail per run. Every classification reader the run's ctx reads content through is
 *   wrapped (tracedReader): what show() returns is what the script got, and its label addresses go
 *   into the trail. A read of another package's rows adds that version's label source
 *   (packageCopyTargets). publish() hands the trail to publishPackage as the version's label source,
 *   and a run that read nothing labelled records nothing. The trail is the run's reads, not the rows
 *   the script chose to publish: a package an extension builds from what it read keeps every label
 *   of what it read.
 *
 *   BOUNDED. Above COMPACT_AT distinct items the trail keeps one item per effective label
 *   (./source-labels.ts onePerLabel), so a run that pages through a large row space holds a bounded
 *   list; a label set later on an item that was folded away does not reach that version.
 * @structure LabelTrail · makeLabelTrail · tracedReader
 * @usage
 *   const trail = makeLabelTrail({ storage, config });
 *   const reader = tracedReader(readerForCaller(deps, caller), trail);
 * @version-history
 *   v1.0.0 — 2026-11-08 — Initial (secaudit2026nov08b round 15).
 */
import type { Storage, ContentLabelTarget } from '../../storage/interface.js';
import type { AimeatConfig } from '../../config.js';
import type { ContentReader } from '../classification/reader.js';
import { targetId } from '../classification/labels.js';
import { onePerLabel } from './source-labels.js';

/** Distinct items a trail holds before it folds them to one item per label. */
export const COMPACT_AT = 10_000;

export interface LabelTrail {
    /** Add the label addresses of what the run read. */
    add(targets: Iterable<ContentLabelTarget | null | undefined>): Promise<void>;
    /** Every label address the run read, distinct. */
    targets(): ContentLabelTarget[];
}

export function makeLabelTrail(deps: { storage: Storage; config: Pick<AimeatConfig, 'classificationMode' | 'nodeId'> }): LabelTrail {
    let seen = new Map<string, ContentLabelTarget>();
    return {
        async add(targets) {
            // With classification off no label applies, and nothing is kept.
            if (deps.config.classificationMode === 'off') return;
            for (const t of targets) if (t) seen.set(targetId(t), { kind: t.kind, scope: t.scope, key: t.key });
            if (seen.size <= COMPACT_AT) return;
            seen = new Map((await onePerLabel(deps, [...seen.values()])).map(t => [targetId(t), t]));
        },
        targets: () => [...seen.values()],
    };
}

/**
 * The reader, recording into `trail` the label address of every item its show() returns. Without a
 * trail the reader itself. Only show() is traced: what leave() and useForAi() pass on is not handed
 * to the script as content it can publish.
 */
export function tracedReader<R extends Pick<ContentReader, 'show'>>(reader: R, trail?: LabelTrail): R {
    if (!trail) return reader;
    return {
        ...reader,
        show: async <T>(items: readonly T[], targetOf: (item: T) => ContentLabelTarget | null): Promise<T[]> => {
            const shown = await reader.show(items, targetOf);
            await trail.add(shown.map(targetOf));
            return shown;
        },
    };
}
