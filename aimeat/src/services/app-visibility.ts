/**
 * @file src/services/app-visibility.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description Who may see one app's detail: the rule a surface that describes an app (not one that
 *   serves its bytes behind a code) applies before it answers.
 *
 *   A listed app is everyone's. An app listed to the community is also every signed-in member's of
 *   this node (not the anonymous credential, not a session from another node). An app an operator
 *   hid, an app behind an access code and an unlisted app are the owner's account's and an
 *   operator's; the operator's read of another person's app writes the operator trail, as the app
 *   read route does (routes/apps/read.ts). Everyone else is answered as if the app did not exist.
 *   The same rule readProgramMap applies to an app's data map (services/data-map/data-map-access.ts).
 * @structure AppViewer · mayViewApp()
 * @usage
 *   if (!(await mayViewApp(storage, config, viewer, app, 'detail'))) return notFound();
 * @version-history
 *   2026-10-16 — Initial: aimeat_app_get answered a hidden, access-coded, unlisted or
 *     community-listed app to any caller (QA audit W15, coordinator addition).
 */
import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { appListingOf, type AppRecord } from '../storage/types/apps.js';
import { operatorOverride, type OperatorAuth } from './operator-override.js';

/** The caller asking, in the terms the rule needs. */
export interface AppViewer {
    /** The account the caller acts in. Compared with the app's owner only when `member` is true. */
    ownerName: string;
    /** A signed-in person of this node or a principal acting for one; false for anonymous and visitors. */
    member: boolean;
    /** The session for the operator question (operator-override.ts). Absent: never an operator. */
    auth?: OperatorAuth;
}

/** Whether `viewer` may see `app`. `what` names the read in the operator trail. */
export async function mayViewApp(
    storage: Storage, config: AimeatConfig, viewer: AppViewer | null, app: AppRecord, what: string,
): Promise<boolean> {
    if (viewer?.member && viewer.ownerName === app.ownerName) return true;
    const listing = appListingOf(app);
    const open = !app.operatorHidden && !app.accessCode;
    if (open && listing === 'listed') return true;
    if (open && listing === 'community' && viewer?.member === true) return true;
    return operatorOverride(storage, config, viewer?.auth ?? null, {
        ownerOf: app.ownerName, area: 'app', action: 'read', subject: `${app.filename} ${what}`,
    });
}
