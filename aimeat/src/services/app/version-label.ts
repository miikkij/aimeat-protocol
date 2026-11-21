/**
 * @file src/services/app/version-label.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Where a publish takes an app's display version from when the call names none, and
 *   the warning when the label stays what it was while the page changed.
 *
 *   The display version (manifest.version, the "1.4.0" a catalogue card shows) is a label the caller
 *   states on the publish (services/app/display-version.ts). A publish that named none carried the
 *   previous label forward, so a page whose own head said 1.2.0 went live labelled 1.1.0, and a
 *   builder found out from the catalogue (appdev pitfalls publish/upload-publish-keeps-old-version-label
 *   and publish/draft-publish-keeps-old-version). Two things change that:
 *
 *     <meta name="aimeat-app-version" content="1.2.0">
 *
 *   in the page's head is read as the version when the call names none (a version the call names
 *   still wins), and a publish that names none, reads none and stores changed bytes under the old
 *   label answers a warning saying so and how to set it.
 * @structure APP_VERSION_META · pageDisplayVersion(html) · versionLabelFindings(state)
 * @usage
 *   const fromPage = requested.version === undefined ? pageDisplayVersion(html) : undefined;
 *   findings.push(...versionLabelFindings({ isUpdate, stated, fromPage, carried: prev?.version, changed }));
 * @version-history
 *   v1.0.0 — 2026-11-21 — Initial (pitfall round A6).
 */
import type { AppArtifactFinding } from './artifact-lint.js';
import { APP_DISPLAY_VERSION_RE } from './display-version.js';
import { metaContentOf, metaTags } from '../../utils/html-tag-scan.js';

/** The meta a page names its display version with. */
export const APP_VERSION_META = 'aimeat-app-version';

/** The curated pitfall the warning names (data/appdev-pitfalls.ts). */
const PITFALL = 'display-version-carried';

/** Only the head is read, as the other declarations are. */
const HEAD_BYTES = 64 * 1024;

/**
 * What the page's `aimeat-app-version` meta says: `{ value }` when it fits the display-version rule,
 * `{ invalid }` with the text when it does not, undefined when the page has no such meta.
 */
export function pageDisplayVersion(html: string): { value: string } | { invalid: string } | undefined {
  const raw = metaContentOf(metaTags(html.slice(0, HEAD_BYTES)), ['name'], APP_VERSION_META);
  if (raw === null) return undefined;
  const value = raw.trim();
  return APP_DISPLAY_VERSION_RE.test(value) ? { value } : { invalid: value };
}

export interface VersionLabelState {
  /** A new version of an app that already had one. */
  isUpdate: boolean;
  /** The call named a version. */
  stated: boolean;
  /** What the page's meta said, as pageDisplayVersion answers it. */
  fromPage: ReturnType<typeof pageDisplayVersion>;
  /** The label the previous version carried. */
  carried: string | undefined;
  /** The stored bytes differ from the previous version's. */
  changed: boolean;
}

/** The warnings this publish's display version earns: an unusable meta, or a label carried over changed bytes. */
export function versionLabelFindings(s: VersionLabelState): AppArtifactFinding[] {
  const url = `/v1/appdev/pitfalls/${PITFALL}`;
  if (s.fromPage && 'invalid' in s.fromPage) {
    return [{
      pitfall: PITFALL, severity: 'warn', url,
      message: `The page's <meta name="${APP_VERSION_META}"> says "${s.fromPage.invalid.slice(0, 60)}", which is not a display version, so it was not used. `
        + 'Give 1 to 40 letters, digits, dots, hyphens, plus signs or underscores that start with a letter or a digit, for example 1.4.0.',
    }];
  }
  if (!s.isUpdate || s.stated || s.fromPage || !s.carried || !s.changed) return [];
  return [{
    pitfall: PITFALL, severity: 'warn', url,
    message: `This version still carries the display version "${s.carried}" from the previous one, while the page changed. `
      + `Name the version on the publish (version on aimeat_app_publish or aimeat_app_draft_publish), or put <meta name="${APP_VERSION_META}" content="…"> in the page's head and every publish reads it.`,
  }];
}
