import type { ExtensionInstanceRecord } from '../interface.js';

export interface ExtensionInstanceRepository {
  createExtensionInstance(record: ExtensionInstanceRecord): Promise<ExtensionInstanceRecord>;
  getExtensionInstance(extensionName: string, instanceId: string): Promise<ExtensionInstanceRecord | null>;
  listExtensionInstances(extensionName: string): Promise<ExtensionInstanceRecord[]>;
  updateExtensionInstance(extensionName: string, instanceId: string, updates: Partial<ExtensionInstanceRecord>): Promise<ExtensionInstanceRecord | null>;
  deleteExtensionInstance(extensionName: string, instanceId: string): Promise<boolean>;
}
