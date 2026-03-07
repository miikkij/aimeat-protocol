/**
 * Config persistence repository — stores admin-editable config values.
 * Keys are prefixed with "config:" in the underlying store.
 */
export interface ConfigRepository {
  /** Returns true if this storage supports config persistence (false for in-memory) */
  supportsConfigPersistence(): boolean;
  /** Get a single config value by dot-path key */
  getConfigValue(key: string): Promise<string | null>;
  /** Set (upsert) a config value by dot-path key */
  setConfigValue(key: string, value: string): Promise<void>;
  /** Delete a config value by dot-path key */
  deleteConfigValue(key: string): Promise<void>;
  /** Get all stored config values as a key-value record */
  getAllConfigValues(): Promise<Record<string, string>>;
}
