/**
 * @file package-zip.ts
 * @description Package ZIP helpers for the packages E2E suite: build a ZIP from a manifest and its
 *   component files, and upload a ZIP to an import route as multipart/form-data.
 * @structure
 *   - buildTestZip(manifest, components) — a ZIP buffer with manifest.yaml and the given files
 *   - uploadZipTo(base, path, zipBuf, token) — POST the buffer as the form field `file`
 * @usage
 *   import { buildTestZip, uploadZipTo } from './helpers/package-zip.js';
 *   const zip = await buildTestZip({ name: 'x', version: '1.0.0', components: [] }, []);
 *   const { status, body } = await uploadZipTo(BASE, '/v1/packages/import', zip, token);
 * @version-history
 *   v1.0.0 — 2026-11-15 — Moved unchanged out of e2e-packages.ts (uploadZip takes the base URL as
 *     its first argument), so the suite could take the export round-trip check without growing.
 */
import { ZipArchive } from 'archiver';
import YAML from 'yaml';

/** Helper: build a valid ZIP buffer from a manifest and component files */
export async function buildTestZip(manifest: Record<string, unknown>, components: { name: string; content: string }[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.append(YAML.stringify(manifest), { name: 'manifest.yaml' });
    for (const c of components) {
      archive.append(c.content, { name: c.name });
    }
    archive.finalize();
  });
}

/** Helper: upload a ZIP buffer via multipart/form-data */
export async function uploadZipTo(base: string, path: string, zipBuf: Buffer, token: string): Promise<{ status: number; body: any }> {
  const boundary = '----FormBoundary' + Date.now();
  const parts: Buffer[] = [];
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="package.zip"\r\nContent-Type: application/zip\r\n\r\n`));
  parts.push(zipBuf);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  const body = Buffer.concat(parts);
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Authorization': `Bearer ${token}`,
    },
    body,
  });
  const ct = res.headers.get('content-type') ?? '';
  const parsed = ct.includes('json') ? await res.json() as any : { _raw: await res.text() };
  return { status: res.status, body: parsed };
}
