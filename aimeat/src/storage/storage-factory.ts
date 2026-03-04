import type { Storage } from './interface.js';

export type StorageProvider = 'memory' | 'sqlite' | 'mongodb';

export interface StorageOptions {
  provider: StorageProvider;
  sqlitePath?: string;
  dbUrl?: string;
}

export async function createStorage(opts: StorageOptions): Promise<Storage> {
  switch (opts.provider) {
    case 'sqlite': {
      const { SqliteStorage } = await import('./providers/sqlite/index.js');
      return new SqliteStorage(opts.sqlitePath ?? './data/aimeat.db');
    }
    case 'mongodb': {
      const { MongoStorage } = await import('./providers/mongodb/index.js');
      const mongo = new MongoStorage(opts.dbUrl!);
      await mongo.ready;
      return mongo;
    }
    default: {
      const { InMemoryStorage } = await import('./providers/memory/index.js');
      return new InMemoryStorage();
    }
  }
}
