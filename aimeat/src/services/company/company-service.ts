/**
 * @file src/services/company/company-service.ts
 * @description Company lifecycle: create (slug claim), read, update, set the front page,
 *   delete. Every legality rule lives here; routes stay thin.
 *
 *   Rules encoded:
 *   - The slug is claimed by the unique index, not by a read-then-write check: two founders
 *     naming their company the same thing at the same moment cannot both win. A taken name
 *     answers 409 SLUG_TAKEN, and the availability check is advisory only (it can go stale
 *     between the check and the claim — the insert is what decides).
 *   - Reserved labels and the label shape are refused up front (the same set the apps family
 *     uses, so a company can never shadow an infrastructure host).
 *   - A front page of kind 'app' must name an app the SAME owner published: a company must
 *     not be able to point its address at someone else's app and wear it as its own.
 *   - Deleting a company frees its slug. That is deliberate: an address nobody claims should
 *     be claimable again, and the registry is not an archive.
 *
 * @structure CompanyError · slugify · createCompany · updateCompany · setFrontPage ·
 *   requireOwnCompany · companyAddress
 * @usage const company = await createCompany(config, storage, ownerGhii, input);
 * @version-history
 *   v1.0.0 — 2026-08-07 — Company registry + co origin.
 */
import { randomUUID } from 'node:crypto';
import type { AimeatConfig } from '../../config.js';
import type { Storage } from '../../storage/interface.js';
import type { CompanyRecord, NewCompanyInput, CompanyFrontPage } from '../../models/company-schemas.js';
import { RESERVED_SUBDOMAINS, SUBDOMAIN_RE } from '../../routes/subdomains.js';

export class CompanyError extends Error {
  constructor(public readonly code: string, public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'CompanyError';
  }
}

/** Trade name → address label. Same shape rules as an app subdomain. */
export function slugify(name: string): string {
  const base = name.toLowerCase()
    .replace(/[äå]/g, 'a').replace(/ö/g, 'o').replace(/[éè]/g, 'e')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return base;
}

function assertSlug(slug: string): void {
  if (!SUBDOMAIN_RE.test(slug)) {
    throw new CompanyError('INVALID_SLUG', 400,
      'The address must be 2-63 characters: lowercase letters, digits and hyphens, not starting or ending with a hyphen');
  }
  if (RESERVED_SUBDOMAINS.has(slug)) throw new CompanyError('SLUG_RESERVED', 409, `"${slug}" is reserved`);
}

/** The public address a company answers on, or null when the co origin is not configured. */
export function companyAddress(config: AimeatConfig, company: CompanyRecord): string | null {
  if (!config.coHost) return null;
  let scheme = 'https';
  let port = '';
  try {
    const base = new URL(config.baseUrl);
    scheme = base.protocol.replace(':', '');
    port = base.port ? `:${base.port}` : '';
    // eslint-disable-next-line aimeat/no-silent-catch -- an unparseable baseUrl just means the https default
  } catch { /* https, no port */ }
  return `${scheme}://${company.slug}.${config.coHost}${port}`;
}

/** Fetch + assert ownership. Absent and not-yours answer identically (404). */
export async function requireOwnCompany(storage: Storage, ownerGhii: string, id: string): Promise<CompanyRecord> {
  const company = await storage.getCompany(id);
  if (!company || company.ownerGhii !== ownerGhii) throw new CompanyError('NOT_FOUND', 404, 'Company not found');
  return company;
}

/** Advisory availability check — the insert is what actually arbitrates. */
export async function checkSlugAvailable(storage: Storage, slug: string): Promise<{ slug: string; available: boolean; reason?: string }> {
  const clean = slug.trim().toLowerCase();
  if (!SUBDOMAIN_RE.test(clean)) return { slug: clean, available: false, reason: 'INVALID_SLUG' };
  if (RESERVED_SUBDOMAINS.has(clean)) return { slug: clean, available: false, reason: 'SLUG_RESERVED' };
  const existing = await storage.getCompanyBySlug(clean);
  return existing ? { slug: clean, available: false, reason: 'SLUG_TAKEN' } : { slug: clean, available: true };
}

function trimOrNull(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

export async function createCompany(storage: Storage, ownerGhii: string, input: NewCompanyInput): Promise<CompanyRecord> {
  const name = (input.name ?? '').trim();
  if (name.length < 2 || name.length > 140) throw new CompanyError('INVALID_NAME', 400, 'name must be 2-140 characters');
  const slug = (input.slug?.trim().toLowerCase()) || slugify(name);
  assertSlug(slug);

  const now = new Date().toISOString();
  const record: CompanyRecord = {
    id: randomUUID(), slug, ownerGhii, name,
    description: trimOrNull(input.description, 500),
    organismId: trimOrNull(input.organismId, 80),
    frontPage: { kind: 'none', target: '' },
    businessId: trimOrNull(input.businessId, 35),
    vatId: trimOrNull(input.vatId, 35),
    streetAddress: trimOrNull(input.streetAddress, 70),
    postalCode: trimOrNull(input.postalCode, 20),
    city: trimOrNull(input.city, 70),
    country: trimOrNull(input.country, 2),
    email: trimOrNull(input.email, 200),
    phone: trimOrNull(input.phone, 40),
    iban: trimOrNull(input.iban, 34),
    bic: trimOrNull(input.bic, 11),
    einvoiceAddress: trimOrNull(input.einvoiceAddress, 35),
    einvoiceOperator: trimOrNull(input.einvoiceOperator, 35),
    status: 'active',
    createdAt: now, updatedAt: now,
  };
  try {
    await storage.createCompany(record);
  } catch (e) {
    // The unique index is the arbitration; a duplicate surfaces here and only here.
    const taken = await storage.getCompanyBySlug(slug);
    if (taken) throw new CompanyError('SLUG_TAKEN', 409, `The address "${slug}" is already taken`);
    throw e;
  }
  return record;
}

export async function updateCompany(storage: Storage, ownerGhii: string, id: string, input: Partial<NewCompanyInput>): Promise<CompanyRecord> {
  const company = await requireOwnCompany(storage, ownerGhii, id);
  const next: CompanyRecord = {
    ...company,
    name: input.name !== undefined ? (input.name ?? '').trim() : company.name,
    description: input.description !== undefined ? trimOrNull(input.description, 500) : company.description,
    organismId: input.organismId !== undefined ? trimOrNull(input.organismId, 80) : company.organismId,
    businessId: input.businessId !== undefined ? trimOrNull(input.businessId, 35) : company.businessId,
    vatId: input.vatId !== undefined ? trimOrNull(input.vatId, 35) : company.vatId,
    streetAddress: input.streetAddress !== undefined ? trimOrNull(input.streetAddress, 70) : company.streetAddress,
    postalCode: input.postalCode !== undefined ? trimOrNull(input.postalCode, 20) : company.postalCode,
    city: input.city !== undefined ? trimOrNull(input.city, 70) : company.city,
    country: input.country !== undefined ? trimOrNull(input.country, 2) : company.country,
    email: input.email !== undefined ? trimOrNull(input.email, 200) : company.email,
    phone: input.phone !== undefined ? trimOrNull(input.phone, 40) : company.phone,
    iban: input.iban !== undefined ? trimOrNull(input.iban, 34) : company.iban,
    bic: input.bic !== undefined ? trimOrNull(input.bic, 11) : company.bic,
    einvoiceAddress: input.einvoiceAddress !== undefined ? trimOrNull(input.einvoiceAddress, 35) : company.einvoiceAddress,
    einvoiceOperator: input.einvoiceOperator !== undefined ? trimOrNull(input.einvoiceOperator, 35) : company.einvoiceOperator,
    updatedAt: new Date().toISOString(),
  };
  if (next.name.length < 2 || next.name.length > 140) throw new CompanyError('INVALID_NAME', 400, 'name must be 2-140 characters');
  // The slug is the published address: renaming the company never silently moves it.
  await storage.updateCompany(next);
  return next;
}

/**
 * Sets what the company address serves. An 'app' front page must be an app THIS owner
 * published — pointing a company address at someone else's app would let it wear that
 * app as its own.
 */
export async function setFrontPage(storage: Storage, ownerGhii: string, id: string, front: CompanyFrontPage): Promise<CompanyRecord> {
  const company = await requireOwnCompany(storage, ownerGhii, id);
  const ownerBare = ownerGhii.split('@')[0];

  if (front.kind === 'app') {
    const target = (front.target ?? '').trim();
    const slash = target.indexOf('/');
    if (slash <= 0 || slash === target.length - 1) {
      throw new CompanyError('INVALID_FRONT_PAGE', 400, 'An app front page is "owner/file.html"');
    }
    const targetOwner = target.slice(0, slash).split('@')[0];
    const filename = target.slice(slash + 1);
    if (targetOwner !== ownerBare) {
      throw new CompanyError('FRONT_PAGE_NOT_YOURS', 403, 'The front page must be an app you published');
    }
    const app = await storage.getAppByOwnerName(ownerBare, filename);
    if (!app) throw new CompanyError('APP_NOT_FOUND', 404, `No published app "${filename}"`);
    front = { kind: 'app', target: `${ownerBare}/${filename}` };
  } else if (front.kind === 'redirect') {
    const target = (front.target ?? '').trim();
    let url: URL;
    try {
      url = new URL(target);
    } catch {
      throw new CompanyError('INVALID_FRONT_PAGE', 400, 'A redirect front page must be an absolute URL');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new CompanyError('INVALID_FRONT_PAGE', 400, 'A redirect front page must be http(s)');
    }
    front = { kind: 'redirect', target: url.toString() };
  } else {
    front = { kind: 'none', target: '' };
  }

  const next: CompanyRecord = { ...company, frontPage: front, updatedAt: new Date().toISOString() };
  await storage.updateCompany(next);
  return next;
}

export async function deleteCompany(storage: Storage, ownerGhii: string, id: string): Promise<void> {
  const company = await requireOwnCompany(storage, ownerGhii, id);
  await storage.deleteCompany(company.id);
}
