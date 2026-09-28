/**
 * @file desktop-app-offer.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The desktop app, offered where a person is trying to attach an AI tool the hard way.
 *
 *   The setup guide tells a person to run a command in a terminal or save a configuration file,
 *   and the desktop app (aimeat-desktop/) does both for them: it finds the AI tools on the
 *   computer and attaches them to their AIMEAT with one click. Until 2026-09-29 nothing on the
 *   node said so, so the easy way in was invisible exactly where someone was struggling with the
 *   hard one. This offer rides on the tool rows the app writes itself (Claude Code, Cursor,
 *   VS Code), in the `install` object the setup guide already reads.
 *
 *   THE ADDRESSES CARRY NO VERSION. The release workflow copies every new installer to a fixed
 *   name on the `desktop-latest` release, so these links outlive every release. They point at
 *   this project's releases whichever node serves the table: the app attaches a tool to any
 *   AIMEAT address, a self-hosted one included.
 *
 *   UNSIGNED, SAID OUT LOUD. The installers are not code-signed until the app has been judged good
 *   (ruled 2026-09-18), so the operating system asks the person to allow it the first time. The
 *   note says that before the download rather than leaving the warning to surprise them after.
 * @structure desktopAppOffer(lang) -> DesktopAppOffer
 * @usage import { desktopAppOffer } from './desktop-app-offer.js';
 * @version-history
 *   v1.0.0 — 2026-09-29 — Initial: Windows, Apple-silicon Mac and Linux downloads.
 */

export interface DesktopAppDownload {
    os: 'windows' | 'mac' | 'linux';
    /** The platform, as a person names it. */
    label: string;
    /** A fixed download address on the desktop-latest release. */
    url: string;
}

export interface DesktopAppOffer {
    /** What the app does for this tool, in a few words. */
    label: string;
    /** Why it is the easier way, and the one thing to know before downloading. */
    note: string;
    downloads: DesktopAppDownload[];
    /** The release page listing every file, for anyone the three downloads do not fit. */
    page: string;
}

const RELEASE = 'https://github.com/miikkij/aimeat-protocol/releases';
const FIXED = `${RELEASE}/download/desktop-latest`;

export function desktopAppOffer(lang: 'en' | 'fi'): DesktopAppOffer {
    const fi = lang === 'fi';
    return {
        label: fi ? 'Anna AIMEAT-sovelluksen tehdä se' : 'Let the AIMEAT app do it',
        note: fi
            ? 'Työpöytäsovellus löytää koneesi tekoälyohjelmat ja kytkee ne yhdellä napsautuksella, ilman terminaalia ja ilman asetustiedostoa. Sitä ei ole vielä allekirjoitettu, joten järjestelmäsi pyytää sinua sallimaan sen ensimmäisellä kerralla.'
            : 'The desktop app finds the AI tools on your computer and connects them with one click, with no terminal and no settings file. It is not code-signed yet, so your system asks you to allow it the first time.',
        downloads: [
            { os: 'windows', label: 'Windows', url: `${FIXED}/AIMEAT-Personal-Node-setup.exe` },
            { os: 'mac', label: fi ? 'Mac (Apple-siru)' : 'Mac (Apple silicon)', url: `${FIXED}/AIMEAT-Personal-Node.dmg` },
            { os: 'linux', label: 'Linux (AppImage)', url: `${FIXED}/AIMEAT-Personal-Node.AppImage` },
        ],
        page: `${RELEASE}/tag/desktop-latest`,
    };
}
