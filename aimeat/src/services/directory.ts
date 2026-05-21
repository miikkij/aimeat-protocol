import type { AimeatConfig } from '../config.js';
import type { Storage } from '../storage/interface.js';
import { logger } from '../utils/logger.js';

export interface DirectoryEntry {
  entryType?: 'person' | 'organism';  // defaults to 'person' for backward compat
  ghii: string;
  displayName: string;
  bio?: string;
  avatar?: string;
  interests: string[];
  city?: string;
  area?: string;
  country?: string;
  lat?: number;
  lon?: number;
  semantic?: Record<string, unknown>;
  organismId?: string;     // only set for organism entries
  memberCount?: number;    // only set for organism entries
  joinPolicy?: string;     // only set for organism entries
}

export interface DirectorySearchOpts {
  type?: 'people' | 'organisms';
  city?: string;
  area?: string;
  country?: string;
  interest?: string;
  interests?: string[];
  radiusKm?: number;
  lat?: number;
  lon?: number;
  page?: number;
  perPage?: number;
}

export interface DirectorySearchResult {
  entries: DirectoryEntry[];
  total: number;
  facets: {
    cities: Array<{ name: string; count: number }>;
    interests: Array<{ name: string; count: number }>;
  };
}

export interface DirectoryStats {
  totalPeople: number;
  totalOrganisms?: number;
  topInterests: Array<{ name: string; count: number }>;
  topCities: Array<{ name: string; count: number }>;
  updatedAt: string;
}

/**
 * Build schema.org semantic annotation for a directory entry.
 * Enriches the entry with structured Person + Place data per Phase 1.7.
 */
function buildDirectorySemantic(entry: {
  interests: string[];
  city?: string;
  area?: string;
  country?: string;
  existingSemantic?: Record<string, unknown>;
}): Record<string, unknown> {
  const semantic: Record<string, unknown> = {
    '@context': { schema: 'https://schema.org/' },
    '@type': 'schema:Person',
  };

  // Map interests → schema:knowsAbout
  if (entry.interests.length > 0) {
    semantic['schema:knowsAbout'] = entry.interests;
  }

  // Map location → schema:homeLocation
  if (entry.city || entry.area || entry.country) {
    const address: Record<string, unknown> = { '@type': 'schema:PostalAddress' };
    if (entry.city) address['schema:addressLocality'] = entry.city;
    if (entry.area) address['schema:addressRegion'] = entry.area;
    if (entry.country) address['schema:addressCountry'] = entry.country;

    semantic['schema:homeLocation'] = {
      '@type': 'schema:Place',
      'schema:address': address,
    };
  }

  // Merge with any existing semantic annotations from GHII record
  if (entry.existingSemantic) {
    return { ...semantic, ...entry.existingSemantic };
  }

  return semantic;
}

/** Haversine formula — distance between two lat/lon points in km */
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export class DirectoryService {
  private index = new Map<string, DirectoryEntry>();
  private lastUpdated = new Date().toISOString();
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly DEBOUNCE_MS = 2000;  // 2s debounce for batch changes

  constructor(private config: AimeatConfig, private storage: Storage) {}

  /**
   * Notify the directory that data relevant to its index has changed.
   * Triggers a debounced rebuild so rapid consecutive writes don't
   * cause an index rebuild storm.
   *
   * Call this when:
   * - A GHII profile is created, updated, or deleted
   * - A profile.*.interests or profile.*.location memory key is written
   * - A federation consent is granted or revoked
   */
  notifyChange(): void {
    if (this.rebuildTimer) {
      clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuildIndex().catch(err =>
        logger.error('Directory index rebuild failed after change notification', { error: String(err) }),
      );
    }, DirectoryService.DEBOUNCE_MS);
  }

  /** Rebuild the entire directory index from storage */
  async rebuildIndex(): Promise<void> {
    const newIndex = new Map<string, DirectoryEntry>();

    const ghiis = await this.storage.listGHIIs();

    for (const ghii of ghiis) {
      try {
        // Check that this GHII has an owner with an agent that has federation consent
        const agents = await this.storage.getAgentsByOwner(ghii.ownerName);
        if (agents.length === 0) continue;

        // Check for federation consent on any of the owner's agents
        let hasFederationConsent = false;
        let consentAgentGaii = '';
        for (const agent of agents) {
          const consents = await this.storage.listConsents(agent.gaii, { status: 'active' });
          const federationConsent = consents.find(
            c => c.scope === 'federation' && c.status === 'active',
          );
          if (federationConsent) {
            hasFederationConsent = true;
            consentAgentGaii = agent.gaii;
            break;
          }
        }

        if (!hasFederationConsent) continue;

        // Load profile data from memory
        const username = ghii.username;
        let interests: string[] = [];
        let city: string | undefined;
        let area: string | undefined;
        let country: string | undefined;
        let lat: number | undefined;
        let lon: number | undefined;

        // Try loading interests from memory -- check GHII first, then agent GAII
        let interestsMemory = await this.storage.getMemory(ghii.ghii, `profile.${username}.interests`);
        if (!interestsMemory?.value) {
          interestsMemory = await this.storage.getMemory(consentAgentGaii, `profile.${username}.interests`);
        }
        if (interestsMemory?.value) {
          if (Array.isArray(interestsMemory.value)) {
            interests = interestsMemory.value as string[];
          } else if (typeof interestsMemory.value === 'object' && interestsMemory.value !== null) {
            const val = interestsMemory.value as Record<string, unknown>;
            if (Array.isArray(val.items)) {
              interests = val.items as string[];
            } else if (Array.isArray(val.interests)) {
              interests = val.interests as string[];
            }
          }
        }

        // Try loading location from memory -- check GHII first, then agent GAII
        let locationMemory = await this.storage.getMemory(ghii.ghii, `profile.${username}.location`);
        if (!locationMemory?.value) {
          locationMemory = await this.storage.getMemory(consentAgentGaii, `profile.${username}.location`);
        }
        if (locationMemory?.value && typeof locationMemory.value === 'object' && locationMemory.value !== null) {
          const loc = locationMemory.value as Record<string, unknown>;
          if (typeof loc.city === 'string') city = loc.city;
          if (typeof loc.area === 'string') area = loc.area;
          if (typeof loc.country === 'string') country = loc.country;
          if (typeof loc.lat === 'number') lat = loc.lat;
          if (typeof loc.lon === 'number') lon = loc.lon;
        }

        const entry: DirectoryEntry = {
          ghii: ghii.ghii,
          displayName: ghii.displayName,
          bio: ghii.bio,
          avatar: ghii.avatar,
          interests,
          city,
          area,
          country,
          lat,
          lon,
          semantic: buildDirectorySemantic({
            interests,
            city,
            area,
            country,
            existingSemantic: ghii.semantic as Record<string, unknown> | undefined,
          }),
        };

        newIndex.set(ghii.ghii, entry);
      } catch (err) {
        logger.warn('Failed to index GHII for directory', { ghii: ghii.ghii, error: String(err) });
      }
    }

    // Index organisms (Phase 2.2 — directory unification)
    const organisms = await this.storage.listOrganisms();
    for (const org of organisms) {
      // Only index public and listed organisms
      if (org.visibility === 'private') continue;

      const entry: DirectoryEntry = {
        entryType: 'organism',
        ghii: `organism:${org.id}`,  // synthetic GHII for organisms
        displayName: org.name,
        bio: org.description,
        interests: org.interests,
        city: org.location?.city,
        area: org.location?.area,
        country: org.location?.country,
        lat: org.location?.geo?.[0],
        lon: org.location?.geo?.[1],
        organismId: org.id,
        memberCount: org.members.length,
        joinPolicy: org.joinPolicy,
        semantic: {
          '@context': { schema: 'https://schema.org/' },
          '@type': 'schema:Organization',
          'schema:name': org.name,
          'schema:description': org.description,
          ...(org.interests.length > 0 ? { 'schema:knowsAbout': org.interests } : {}),
        },
      };

      newIndex.set(`organism:${org.id}`, entry);
    }

    this.index = newIndex;
    this.lastUpdated = new Date().toISOString();
    logger.info('Directory index rebuilt', { entries: newIndex.size });
  }

  /** Search the directory */
  async search(opts: DirectorySearchOpts): Promise<DirectorySearchResult> {
    const page = Math.max(1, opts.page ?? 1);
    const perPage = Math.min(100, Math.max(1, opts.perPage ?? 50));

    // Collect all entries that match filters
    const matched: DirectoryEntry[] = [];

    for (const entry of this.index.values()) {
      // Filter by type (people vs organisms)
      if (opts.type === 'people' && entry.entryType === 'organism') continue;
      if (opts.type === 'organisms' && entry.entryType !== 'organism') continue;

      // Filter by city (case-insensitive)
      if (opts.city && (!entry.city || entry.city.toLowerCase() !== opts.city.toLowerCase())) {
        continue;
      }

      // Filter by area (case-insensitive)
      if (opts.area && (!entry.area || entry.area.toLowerCase() !== opts.area.toLowerCase())) {
        continue;
      }

      // Filter by country (case-insensitive)
      if (opts.country && (!entry.country || entry.country.toLowerCase() !== opts.country.toLowerCase())) {
        continue;
      }

      // Filter by single interest (case-insensitive)
      if (opts.interest) {
        const lower = opts.interest.toLowerCase();
        if (!entry.interests.some(i => i.toLowerCase() === lower)) {
          continue;
        }
      }

      // Filter by multiple interests (match ANY, case-insensitive)
      if (opts.interests && opts.interests.length > 0) {
        const lowerInterests = opts.interests.map(i => i.toLowerCase());
        const hasMatch = entry.interests.some(i => lowerInterests.includes(i.toLowerCase()));
        if (!hasMatch) {
          continue;
        }
      }

      // Geo filter — only if lat, lon, and radiusKm are all provided
      if (opts.lat !== undefined && opts.lon !== undefined && opts.radiusKm !== undefined) {
        if (entry.lat === undefined || entry.lon === undefined) {
          continue;
        }
        const dist = haversineKm(opts.lat, opts.lon, entry.lat, entry.lon);
        if (dist > opts.radiusKm) {
          continue;
        }
      }

      matched.push(entry);
    }

    // Build facets from matched results
    const cityCounts = new Map<string, number>();
    const interestCounts = new Map<string, number>();

    for (const entry of matched) {
      if (entry.city) {
        cityCounts.set(entry.city, (cityCounts.get(entry.city) ?? 0) + 1);
      }
      for (const interest of entry.interests) {
        interestCounts.set(interest, (interestCounts.get(interest) ?? 0) + 1);
      }
    }

    const cities = [...cityCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const interests = [...interestCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    // Paginate
    const start = (page - 1) * perPage;
    const entries = matched.slice(start, start + perPage);

    return {
      entries,
      total: matched.length,
      facets: { cities, interests },
    };
  }

  /** Get directory statistics */
  getStats(): DirectoryStats {
    const interestCounts = new Map<string, number>();
    const cityCounts = new Map<string, number>();
    let totalOrganisms = 0;

    for (const entry of this.index.values()) {
      if (entry.entryType === 'organism') totalOrganisms++;
      for (const interest of entry.interests) {
        interestCounts.set(interest, (interestCounts.get(interest) ?? 0) + 1);
      }
      if (entry.city) {
        cityCounts.set(entry.city, (cityCounts.get(entry.city) ?? 0) + 1);
      }
    }

    const topInterests = [...interestCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    const topCities = [...cityCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return {
      totalPeople: this.index.size - totalOrganisms,
      totalOrganisms,
      topInterests,
      topCities,
      updatedAt: this.lastUpdated,
    };
  }
}
