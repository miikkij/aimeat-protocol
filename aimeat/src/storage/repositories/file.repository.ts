import type { StorageFileRecord, ChunkedUploadRecord } from '../interface.js';

export interface FileRepository {
  createStorageFile(file: StorageFileRecord): Promise<StorageFileRecord>;
  getStorageFile(ownerGaii: string, key: string): Promise<StorageFileRecord | null>;
  listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]>;
  deleteStorageFile(ownerGaii: string, key: string): Promise<boolean>;
  updateFileTagsByKey(ownerGaii: string, key: string, tags: string[]): Promise<StorageFileRecord | null>;
  createChunkedUpload(record: ChunkedUploadRecord): Promise<ChunkedUploadRecord>;
  getChunkedUpload(uploadId: string): Promise<ChunkedUploadRecord | null>;
  addChunk(uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean>;
  deleteChunkedUpload(uploadId: string): Promise<boolean>;
}
