import type Database from 'better-sqlite3';
import type { StorageFileRecord, ChunkedUploadRecord, MicroMemoryRecord } from '../../../interface.js';

// ── Storage Files ──

export function createStorageFile(db: Database.Database, file: StorageFileRecord): StorageFileRecord {
  db.prepare(
    `INSERT OR REPLACE INTO storage_files (ownerGaii, key, visibility, groupId, mimeType, size, data, accessCode, tags, createdAt, federate)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    file.ownerGaii, file.key, file.visibility, file.groupId ?? null,
    file.mimeType, file.size, file.data,
    file.accessCode ?? null, JSON.stringify(file.tags || []), file.createdAt,
    file.federate ? 1 : 0,
  );
  return file;
}

export function getStorageFile(db: Database.Database, ownerGaii: string, key: string): StorageFileRecord | null {
  const row = db.prepare('SELECT * FROM storage_files WHERE ownerGaii = ? AND key = ?').get(ownerGaii, key) as Record<string, unknown> | undefined;
  if (!row) return null;
  const record: StorageFileRecord = {
    key: row.key as string,
    ownerGaii: row.ownerGaii as string,
    visibility: row.visibility as StorageFileRecord['visibility'],
    mimeType: row.mimeType as string,
    size: row.size as number,
    data: row.data as Buffer,
    tags: row.tags ? JSON.parse(row.tags as string) : [],
    createdAt: row.createdAt as string,
  };
  if (row.accessCode) record.accessCode = row.accessCode as string;
  if (row.groupId) record.groupId = row.groupId as string;
  record.federate = (row as any).federate === 1;
  return record;
}

export function listStorageFiles(db: Database.Database, ownerGaii: string): StorageFileRecord[] {
  const rows = db.prepare('SELECT * FROM storage_files WHERE ownerGaii = ?').all(ownerGaii) as Record<string, unknown>[];
  return rows.map(r => {
    const record: StorageFileRecord = {
      key: r.key as string,
      ownerGaii: r.ownerGaii as string,
      visibility: r.visibility as StorageFileRecord['visibility'],
      mimeType: r.mimeType as string,
      size: r.size as number,
      data: r.data as Buffer,
      tags: r.tags ? JSON.parse(r.tags as string) : [],
      createdAt: r.createdAt as string,
    };
    if (r.accessCode) record.accessCode = r.accessCode as string;
    if (r.groupId) record.groupId = r.groupId as string;
    record.federate = (r as any).federate === 1;
    return record;
  });
}

export function deleteStorageFile(db: Database.Database, ownerGaii: string, key: string): boolean {
  const result = db.prepare('DELETE FROM storage_files WHERE ownerGaii = ? AND key = ?').run(ownerGaii, key);
  return result.changes > 0;
}

export function updateFileTagsByKey(db: Database.Database, ownerGaii: string, key: string, tags: string[]): StorageFileRecord | null {
  const result = db.prepare(
    'UPDATE storage_files SET tags = ? WHERE ownerGaii = ? AND key = ?'
  ).run(JSON.stringify(tags), ownerGaii, key);
  if (result.changes === 0) return null;
  return getStorageFile(db, ownerGaii, key);
}

export function updateFileVisibility(db: Database.Database, ownerGaii: string, key: string, visibility: StorageFileRecord['visibility']): StorageFileRecord | null {
  const result = db.prepare(
    'UPDATE storage_files SET visibility = ? WHERE ownerGaii = ? AND key = ?'
  ).run(visibility, ownerGaii, key);
  if (result.changes === 0) return null;
  return getStorageFile(db, ownerGaii, key);
}

// ── Chunked Uploads (in-memory) ──

export function createChunkedUpload(chunkedUploads: Map<string, ChunkedUploadRecord>, record: ChunkedUploadRecord): ChunkedUploadRecord {
  chunkedUploads.set(record.uploadId, record);
  return record;
}

export function getChunkedUpload(chunkedUploads: Map<string, ChunkedUploadRecord>, uploadId: string): ChunkedUploadRecord | null {
  const record = chunkedUploads.get(uploadId) ?? null;
  if (record && new Date(record.expiresAt).getTime() < Date.now()) {
    chunkedUploads.delete(uploadId);
    return null;
  }
  return record;
}

export function addChunk(chunkedUploads: Map<string, ChunkedUploadRecord>, uploadId: string, chunkIndex: number, data: Buffer): boolean {
  const record = chunkedUploads.get(uploadId);
  if (!record) return false;
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    chunkedUploads.delete(uploadId);
    return false;
  }
  record.receivedChunks.set(chunkIndex, data);
  return true;
}

export function deleteChunkedUpload(chunkedUploads: Map<string, ChunkedUploadRecord>, uploadId: string): boolean {
  return chunkedUploads.delete(uploadId);
}

// ── Micro-Memory ──

function deserializeMicroMemory(row: Record<string, unknown>): MicroMemoryRecord {
  const record: MicroMemoryRecord = {
    gaii: row.gaii as string,
    set: row.setName as string,
    entries: JSON.parse(row.entries as string),
    visibility: row.visibility as MicroMemoryRecord['visibility'],
    updatedAt: row.updatedAt as string,
  };
  if (row.accessCode) record.accessCode = row.accessCode as string;
  return record;
}

export function setMicroMemory(db: Database.Database, record: MicroMemoryRecord): MicroMemoryRecord {
  db.prepare(
    `INSERT OR REPLACE INTO micro_memory (gaii, setName, entries, visibility, accessCode, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    record.gaii, record.set,
    JSON.stringify(record.entries), record.visibility,
    record.accessCode ?? null, record.updatedAt,
  );
  return record;
}

export function getMicroMemory(db: Database.Database, gaii: string, set: string): MicroMemoryRecord | null {
  const row = db.prepare('SELECT * FROM micro_memory WHERE gaii = ? AND setName = ?').get(gaii, set) as Record<string, unknown> | undefined;
  return row ? deserializeMicroMemory(row) : null;
}

export function listMicroMemorySets(db: Database.Database, gaii: string): MicroMemoryRecord[] {
  const rows = db.prepare('SELECT * FROM micro_memory WHERE gaii = ?').all(gaii) as Record<string, unknown>[];
  return rows.map(r => deserializeMicroMemory(r));
}

export function deleteMicroMemory(db: Database.Database, gaii: string, set: string): boolean {
  const result = db.prepare('DELETE FROM micro_memory WHERE gaii = ? AND setName = ?').run(gaii, set);
  return result.changes > 0;
}

export function deleteMicroMemoryEntry(db: Database.Database, gaii: string, set: string, key: string): boolean {
  const record = getMicroMemory(db, gaii, set);
  if (!record || !(key in record.entries)) return false;
  delete record.entries[key];
  db.prepare('UPDATE micro_memory SET entries = ? WHERE gaii = ? AND setName = ?').run(
    JSON.stringify(record.entries), gaii, set,
  );
  return true;
}

export function findMicroMemoryByAccessCode(db: Database.Database, set: string, accessCode: string): MicroMemoryRecord | null {
  const row = db.prepare(
    `SELECT * FROM micro_memory WHERE setName = ? AND accessCode = ? AND (visibility = 'shared_read' OR visibility = 'shared_write')`
  ).get(set, accessCode) as Record<string, unknown> | undefined;
  return row ? deserializeMicroMemory(row) : null;
}
