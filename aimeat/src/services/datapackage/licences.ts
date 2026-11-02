/**
 * @file src/services/datapackage/licences.ts
 * @author Jouni Miikki
 * SPDX-License-Identifier: MIT
 * @description The licences a data package names by id, resolved to the addresses each output needs:
 *   the deed a person reads (the Frictionless `licenses[].path`, the schema.org `license`), the EU
 *   licence vocabulary IRI a DCAT-AP harvester expects (`dct:license`), and the licence's name in en,
 *   fi and es for the public dataset page. The ids are the ones the data product wizard offers
 *   (CC-BY-4.0, CC0-1.0, proprietary) and their SPDX spelling; an id outside the map stays as the
 *   package wrote it, with no address invented for it.
 *
 *   THE NAMES are Creative Commons' own translations of the licence titles (Finnish "Nimeä 4.0
 *   Kansainvälinen", Spanish "Atribución 4.0 Internacional"), so a reader meets the name the deed itself
 *   carries.
 * @structure LicenceFacts · licenceFacts · licenceUrlOf · licenceVocabularyIri · LICENCE_IDS
 * @usage const facts = licenceFacts('CC-BY-4.0');   // { id, url, euIri, names, attribution: true }
 * @version-history
 *   v1.0.0 — 2026-11-01 — Initial (WP10e A3: a licence is a link and a name, not a raw id).
 */

export interface LicenceFacts {
    /** The id the package names. */
    id: string;
    /** The deed a person reads; absent for a licence with no public text (proprietary). */
    url?: string;
    /** The EU licence vocabulary IRI (publications.europa.eu authority table "licence"), for DCAT-AP. */
    euIri?: string;
    /** The licence's name per language. */
    names: { en: string; fi: string; es: string };
    /** True when the licence requires the reader to credit the maker (CC BY). */
    attribution: boolean;
    /** True when the licence opens the data to anyone (CC BY, CC0). */
    open: boolean;
}

const EU = 'http://publications.europa.eu/resource/authority/licence/';

const LICENCES: Record<string, LicenceFacts> = {
    'CC-BY-4.0': {
        id: 'CC-BY-4.0', url: 'https://creativecommons.org/licenses/by/4.0/', euIri: `${EU}CC_BY_4_0`,
        names: {
            en: 'Creative Commons Attribution 4.0 International (CC BY 4.0)',
            fi: 'Creative Commons Nimeä 4.0 Kansainvälinen (CC BY 4.0)',
            es: 'Creative Commons Atribución 4.0 Internacional (CC BY 4.0)',
        },
        attribution: true, open: true,
    },
    'CC0-1.0': {
        id: 'CC0-1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', euIri: `${EU}CC0`,
        names: {
            en: 'CC0 1.0 Universal',
            fi: 'CC0 1.0 Yleismaailmallinen',
            es: 'CC0 1.0 Universal',
        },
        attribution: false, open: true,
    },
    proprietary: {
        id: 'proprietary',
        names: {
            en: 'Only on the terms of a contract with the maker',
            fi: 'Vain tekijän kanssa tehdyn sopimuksen ehdoin',
            es: 'Solo con las condiciones de un contrato con el autor',
        },
        attribution: false, open: false,
    },
};

/** The ids this node resolves, in the order the wizard offers them. */
export const LICENCE_IDS = Object.keys(LICENCES);

/** Other spellings of the same licences: SPDX ids in other case, the deed address. */
function canonicalId(id: string): string | undefined {
    const s = id.trim();
    if (LICENCES[s]) return s;
    const lower = s.toLowerCase().replace(/\/+$/, '');
    for (const f of Object.values(LICENCES)) {
        if (f.id.toLowerCase() === lower || (f.url && f.url.replace(/\/+$/, '').replace(/^https?:\/\//, '') === lower.replace(/^https?:\/\//, ''))) return f.id;
    }
    return undefined;
}

/** The facts of a licence id, or null when this node does not know it. */
export function licenceFacts(id: string | undefined | null): LicenceFacts | null {
    if (!id) return null;
    const c = canonicalId(id);
    return c ? LICENCES[c] : null;
}

/** The address a person reads for a licence: the deed, the id itself when it is an address, or nothing. */
export function licenceUrlOf(id: string | undefined | null): string | undefined {
    if (!id) return undefined;
    const f = licenceFacts(id);
    if (f) return f.url;
    return /^https?:\/\/\S+$/.test(id) ? id : undefined;
}

/** The Frictionless `licenses[]` entry of an id: the id as `name`, with the deed and its name when known. */
export function frictionlessLicence(id: string): { name: string; path?: string; title?: string } {
    const f = licenceFacts(id);
    const path = licenceUrlOf(id);
    return { name: id, ...(path ? { path } : {}), ...(f ? { title: f.names.en } : {}) };
}

/** The IRI dct:license names: the EU vocabulary's, else the deed, else nothing. */
export function licenceVocabularyIri(id: string | undefined | null): string | undefined {
    const f = licenceFacts(id);
    return f?.euIri ?? licenceUrlOf(id);
}
