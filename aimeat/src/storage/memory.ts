import type {
  Storage, OwnerRecord, AgentRecord, MemoryRecord,
  ActionRecord, WorkRecord, WalletTransaction,
  BoardRecord, BoardPostRecord, OtkRecord,
  DisputeRecord, DisputeAuditEntry, MicroMemoryRecord,
  StorageFileRecord, PeeringRequestRecord, ChunkedUploadRecord,
  GHIIRecord, PersonalNodeRecord, MailboxItemRecord, MaintenanceState,
  SchemaRecord, ConsentRecord, ConsentAuditEntry, CsmRecord, MsmRecord,
  EmailVerificationRecord, FlagRecord, FlagSummary, MatchRecord,
  OrganismRecord, OrganismMembershipRecord, JoinRequestRecord,
  AppealRecord, ListingRecord, PurchaseRecord,
  PushSubscriptionRecord, TrustedIssuerRecord,
  GenesisPeerRecord, OrganismReputationRecord,
  ChatInstanceRecord, RealtimeRoomRecord,
} from './interface.js';

export class InMemoryStorage implements Storage {
  private owners = new Map<string, OwnerRecord>();
  private agents = new Map<string, AgentRecord>();
  private memory = new Map<string, MemoryRecord>();         // key: `${gaii}::${key}`
  private actions = new Map<string, ActionRecord>();         // key: `${providerGaii}::${id}`
  private work = new Map<string, WorkRecord>();              // key: trackingCode
  private transactions = new Map<string, WalletTransaction[]>(); // key: gaii
  private boards = new Map<string, BoardRecord>();
  private posts = new Map<string, BoardPostRecord>();        // key: `${boardId}::${postId}`
  private otks = new Map<string, OtkRecord>();
  private disputes = new Map<string, DisputeRecord>();
  private disputeAuditLogs = new Map<string, DisputeAuditEntry[]>();
  private microMemory = new Map<string, MicroMemoryRecord>();  // key: `${gaii}::${set}`
  private storageFiles = new Map<string, StorageFileRecord>();  // key: `${gaii}::${key}`
  private peeringRequests = new Map<string, PeeringRequestRecord>();
  private chunkedUploads = new Map<string, ChunkedUploadRecord>();
  private nodeKey: { publicKey: string; privateKey: string } | null = null;
  private ghiis = new Map<string, GHIIRecord>();              // key: ghii string
  private personalNodes = new Map<string, PersonalNodeRecord>(); // key: nodeId
  private mailboxItems = new Map<string, MailboxItemRecord>();   // key: id
  private schemas = new Map<string, SchemaRecord>();
  private consents = new Map<string, ConsentRecord>();      // key: id
  private consentAudit: ConsentAuditEntry[] = [];
  private csms = new Map<string, CsmRecord>();              // key: name
  private msms = new Map<string, MsmRecord>();              // key: name
  private emailVerifications = new Map<string, EmailVerificationRecord>(); // key: id
  private flags = new Map<string, FlagRecord>();                          // key: id
  private matches = new Map<string, MatchRecord>();                        // key: id
  private organisms = new Map<string, OrganismRecord>();                    // key: id
  private memberships = new Map<string, OrganismMembershipRecord>();        // key: id
  private joinRequests = new Map<string, JoinRequestRecord>();              // key: id
  private appeals = new Map<string, AppealRecord>();                        // key: id
  private listings = new Map<string, ListingRecord>();                      // key: id
  private purchases = new Map<string, PurchaseRecord>();                    // key: id
  private pushSubscriptions = new Map<string, PushSubscriptionRecord>();    // key: ownerName
  private trustedIssuers = new Map<string, TrustedIssuerRecord>();          // key: id
  private genesisPeers = new Map<string, GenesisPeerRecord>();              // key: id
  private organismReputations = new Map<string, OrganismReputationRecord>(); // key: organismId
  private chatInstances = new Map<string, ChatInstanceRecord>();   // key: id
  private realtimeRooms = new Map<string, RealtimeRoomRecord>();   // key: id

  // ── Owners ──

  async createOwner(owner: OwnerRecord): Promise<OwnerRecord> {
    if (this.owners.has(owner.name)) throw new Error('NAME_TAKEN');
    this.owners.set(owner.name, owner);
    return owner;
  }

  async getOwner(name: string): Promise<OwnerRecord | null> {
    return this.owners.get(name) ?? null;
  }

  async listOwners(): Promise<OwnerRecord[]> {
    return [...this.owners.values()];
  }

  async deleteOwner(name: string): Promise<boolean> {
    return this.owners.delete(name);
  }

  async updateOwner(name: string, updates: Partial<OwnerRecord>): Promise<OwnerRecord | null> {
    const owner = this.owners.get(name);
    if (!owner) return null;
    const updated = { ...owner, ...updates };
    this.owners.set(name, updated);
    return updated;
  }

  // ── Agents ──

  async createAgent(agent: AgentRecord): Promise<AgentRecord> {
    if (this.agents.has(agent.gaii)) throw new Error('NAME_TAKEN');
    this.agents.set(agent.gaii, agent);
    return agent;
  }

  async getAgent(gaii: string): Promise<AgentRecord | null> {
    return this.agents.get(gaii) ?? null;
  }

  async getAgentsByOwner(owner: string): Promise<AgentRecord[]> {
    return [...this.agents.values()].filter(a => a.owner === owner);
  }

  async updateAgent(gaii: string, updates: Partial<AgentRecord>): Promise<AgentRecord | null> {
    const existing = this.agents.get(gaii);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.agents.set(gaii, updated);
    return updated;
  }

  async deleteAgent(gaii: string): Promise<boolean> {
    return this.agents.delete(gaii);
  }

  async listAgents(): Promise<AgentRecord[]> {
    return [...this.agents.values()];
  }

  // ── Memory ──

  private memKey(gaii: string, key: string) { return `${gaii}::${key}`; }

  async setMemory(record: MemoryRecord): Promise<MemoryRecord> {
    const k = this.memKey(record.ownerGaii, record.key);
    const existing = this.memory.get(k);
    if (existing) {
      record.version = existing.version + 1;
    }
    this.memory.set(k, record);
    return record;
  }

  private isMemoryExpired(record: MemoryRecord): boolean {
    if (!record.ttlHours) return false;
    const createdMs = new Date(record.createdAt).getTime();
    return Date.now() > createdMs + record.ttlHours * 3_600_000;
  }

  async getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    const record = this.memory.get(this.memKey(ownerGaii, key)) ?? null;
    if (record && this.isMemoryExpired(record)) {
      this.memory.delete(this.memKey(ownerGaii, key));
      return null;
    }
    return record;
  }

  async listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[] }): Promise<MemoryRecord[]> {
    const prefix = `${ownerGaii}::`;
    const results: MemoryRecord[] = [];
    for (const [k, v] of this.memory) {
      if (!k.startsWith(prefix)) continue;
      if (this.isMemoryExpired(v)) { this.memory.delete(k); continue; }
      if (opts?.prefix && !v.key.startsWith(opts.prefix)) continue;
      if (opts?.visibility && v.visibility !== opts.visibility) continue;
      if (opts?.tags?.length) {
        const hasTags = opts.tags.every(t => v.tags.includes(t));
        if (!hasTags) continue;
      }
      results.push(v);
    }
    return results;
  }

  async deleteMemory(ownerGaii: string, key: string): Promise<boolean> {
    return this.memory.delete(this.memKey(ownerGaii, key));
  }

  async deleteAllMemory(ownerGaii: string): Promise<number> {
    const prefix = `${ownerGaii}::`;
    let count = 0;
    for (const k of this.memory.keys()) {
      if (k.startsWith(prefix)) { this.memory.delete(k); count++; }
    }
    return count;
  }

  // ── Actions ──

  private actionKey(providerGaii: string, id: string) { return `${providerGaii}::${id}`; }

  async createAction(action: ActionRecord): Promise<ActionRecord> {
    const k = this.actionKey(action.providerGaii, action.id);
    if (this.actions.has(k)) throw new Error('ACTION_EXISTS');
    this.actions.set(k, action);
    return action;
  }

  async getAction(id: string, providerGaii: string): Promise<ActionRecord | null> {
    return this.actions.get(this.actionKey(providerGaii, id)) ?? null;
  }

  async listActions(opts?: { search?: string; category?: string }): Promise<ActionRecord[]> {
    let results = [...this.actions.values()];
    if (opts?.category) {
      results = results.filter(a => a.category === opts.category);
    }
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      results = results.filter(a =>
        a.displayName.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.tags.some(t => t.toLowerCase().includes(q))
      );
    }
    return results;
  }

  async deleteAction(id: string, providerGaii: string): Promise<boolean> {
    return this.actions.delete(this.actionKey(providerGaii, id));
  }

  async deleteActionsByProvider(gaii: string): Promise<number> {
    let count = 0;
    for (const [k, a] of this.actions) {
      if (a.providerGaii === gaii) { this.actions.delete(k); count++; }
    }
    return count;
  }

  async listActionsByProvider(gaii: string): Promise<ActionRecord[]> {
    return [...this.actions.values()].filter(a => a.providerGaii === gaii);
  }

  // ── Work ──

  async createWork(work: WorkRecord): Promise<WorkRecord> {
    this.work.set(work.trackingCode, work);
    return work;
  }

  async getWork(trackingCode: string): Promise<WorkRecord | null> {
    return this.work.get(trackingCode) ?? null;
  }

  async updateWork(trackingCode: string, updates: Partial<WorkRecord>): Promise<WorkRecord | null> {
    const existing = this.work.get(trackingCode);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.work.set(trackingCode, updated);
    return updated;
  }

  async listWorkByProvider(gaii: string): Promise<WorkRecord[]> {
    return [...this.work.values()].filter(w => w.providerGaii === gaii);
  }

  async listWorkByRequester(gaii: string): Promise<WorkRecord[]> {
    return [...this.work.values()].filter(w => w.requesterGaii === gaii);
  }

  async listAllWork(): Promise<WorkRecord[]> {
    return [...this.work.values()];
  }

  // ── Transactions ──

  async addTransaction(tx: WalletTransaction): Promise<WalletTransaction> {
    const list = this.transactions.get(tx.gaii) ?? [];
    list.push(tx);
    this.transactions.set(tx.gaii, list);
    return tx;
  }

  async getTransactions(gaii: string, limit = 50): Promise<WalletTransaction[]> {
    const list = this.transactions.get(gaii) ?? [];
    return list.slice(-limit);
  }

  async listAllTransactions(): Promise<WalletTransaction[]> {
    const all: WalletTransaction[] = [];
    for (const list of this.transactions.values()) {
      all.push(...list);
    }
    return all;
  }

  async deleteTransactions(gaii: string): Promise<number> {
    const list = this.transactions.get(gaii) ?? [];
    this.transactions.delete(gaii);
    return list.length;
  }

  // ── Boards ──

  async createBoard(board: BoardRecord): Promise<BoardRecord> {
    this.boards.set(board.id, board);
    return board;
  }

  async getBoard(id: string): Promise<BoardRecord | null> {
    return this.boards.get(id) ?? null;
  }

  async listBoards(opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]> {
    let results = [...this.boards.values()];
    if (opts?.visibility) results = results.filter(b => b.visibility === opts.visibility);
    if (opts?.ownerGaii) results = results.filter(b => b.ownerGaii === opts.ownerGaii);
    return results;
  }

  async deleteBoard(id: string): Promise<boolean> {
    // Delete all posts in the board
    for (const k of this.posts.keys()) {
      if (k.startsWith(`${id}::`)) this.posts.delete(k);
    }
    return this.boards.delete(id);
  }

  async createPost(post: BoardPostRecord): Promise<BoardPostRecord> {
    this.posts.set(`${post.boardId}::${post.id}`, post);
    return post;
  }

  async getPost(boardId: string, postId: string): Promise<BoardPostRecord | null> {
    return this.posts.get(`${boardId}::${postId}`) ?? null;
  }

  async listPosts(boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]> {
    const limit = opts?.limit ?? 20;
    const now = Date.now();
    let results: BoardPostRecord[] = [];
    for (const [k, v] of this.posts) {
      if (!k.startsWith(`${boardId}::`)) continue;
      if (v.ttlExpiresAt && new Date(v.ttlExpiresAt).getTime() < now) { this.posts.delete(k); continue; }
      if (opts?.category && v.category !== opts.category) continue;
      if (!v.replyTo) results.push(v); // Only top-level posts
    }
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    if (opts?.cursor) {
      const idx = results.findIndex(p => p.id === opts.cursor);
      if (idx >= 0) results = results.slice(idx + 1);
    }
    return results.slice(0, limit);
  }

  async deletePost(boardId: string, postId: string): Promise<boolean> {
    const key = `${boardId}::${postId}`;
    if (!this.posts.has(key)) return false;
    this.posts.delete(key);
    return true;
  }

  async addReaction(boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
    const post = this.posts.get(`${boardId}::${postId}`);
    if (!post) return false;
    if (!post.reactions[emoji]) post.reactions[emoji] = [];
    if (!post.reactions[emoji].includes(gaii)) post.reactions[emoji].push(gaii);
    return true;
  }

  // ── Board Subscriptions ──

  private boardSubscriptions = new Map<string, import('./interface.js').BoardSubscriptionRecord>();

  async createBoardSubscription(sub: import('./interface.js').BoardSubscriptionRecord): Promise<import('./interface.js').BoardSubscriptionRecord> {
    this.boardSubscriptions.set(`${sub.boardId}::${sub.gaii}`, sub);
    return sub;
  }

  async getBoardSubscription(boardId: string, gaii: string): Promise<import('./interface.js').BoardSubscriptionRecord | null> {
    return this.boardSubscriptions.get(`${boardId}::${gaii}`) ?? null;
  }

  async listBoardSubscriptions(boardId: string): Promise<import('./interface.js').BoardSubscriptionRecord[]> {
    return [...this.boardSubscriptions.values()].filter(s => s.boardId === boardId);
  }

  async listSubscriptionsByAgent(gaii: string): Promise<import('./interface.js').BoardSubscriptionRecord[]> {
    return [...this.boardSubscriptions.values()].filter(s => s.gaii === gaii);
  }

  async deleteBoardSubscription(boardId: string, gaii: string): Promise<boolean> {
    return this.boardSubscriptions.delete(`${boardId}::${gaii}`);
  }

  // ── OTK ──

  async createOtk(otk: OtkRecord): Promise<OtkRecord> {
    this.otks.set(otk.key, otk);
    return otk;
  }

  async getOtk(key: string): Promise<OtkRecord | null> {
    return this.otks.get(key) ?? null;
  }

  async consumeOtk(key: string, graceMs: number = 60_000): Promise<OtkRecord | null> {
    const otk = this.otks.get(key);
    if (!otk) return null;

    // Initial OTK: timer hasn't started yet — activate on first use
    if (otk.initial && !otk.used) {
      otk.used = true;
      otk.usedAt = new Date().toISOString();
      otk.expiresAt = new Date(Date.now() + graceMs).toISOString();
      return otk;
    }

    if (new Date(otk.expiresAt) < new Date()) {
      this.otks.delete(key);
      return null;
    }
    // Configurable post-use window: allow re-use within graceMs of first use
    if (otk.used && otk.usedAt) {
      const usedAt = new Date(otk.usedAt).getTime();
      if (Date.now() - usedAt > graceMs) {
        this.otks.delete(key);
        return null;
      }
      return otk; // still within grace window
    }
    otk.used = true;
    otk.usedAt = new Date().toISOString();
    return otk;
  }

  async listOtksBySession(sessionId: string): Promise<OtkRecord[]> {
    const results: OtkRecord[] = [];
    for (const otk of this.otks.values()) {
      if (otk.sessionId === sessionId) results.push(otk);
    }
    return results;
  }

  async expireSessionOtks(sessionId: string): Promise<number> {
    let count = 0;
    for (const [key, otk] of this.otks) {
      if (otk.sessionId === sessionId) {
        this.otks.delete(key);
        count++;
      }
    }
    return count;
  }

  // ── Node Key ──

  async setNodeKey(publicKey: string, privateKey: string): Promise<void> {
    this.nodeKey = { publicKey, privateKey };
  }

  async getNodeKey(): Promise<{ publicKey: string; privateKey: string } | null> {
    return this.nodeKey;
  }

  // ── Disputes ──

  async createDispute(dispute: DisputeRecord): Promise<DisputeRecord> {
    this.disputes.set(dispute.id, dispute);
    return dispute;
  }

  async getDispute(id: string): Promise<DisputeRecord | null> {
    return this.disputes.get(id) ?? null;
  }

  async getDisputeByTrackingCode(tc: string): Promise<DisputeRecord | null> {
    for (const d of this.disputes.values()) {
      if (d.trackingCode === tc) return d;
    }
    return null;
  }

  async updateDispute(id: string, updates: Partial<DisputeRecord>): Promise<DisputeRecord | null> {
    const existing = this.disputes.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.disputes.set(id, updated);
    return updated;
  }

  async addDisputeAuditEntry(disputeId: string, entry: DisputeAuditEntry): Promise<DisputeAuditEntry> {
    const log = this.disputeAuditLogs.get(disputeId) ?? [];
    log.push(entry);
    this.disputeAuditLogs.set(disputeId, log);
    return entry;
  }

  async getDisputeAuditLog(disputeId: string): Promise<DisputeAuditEntry[]> {
    return this.disputeAuditLogs.get(disputeId) ?? [];
  }

  async listDisputesByProvider(gaii: string): Promise<DisputeRecord[]> {
    return [...this.disputes.values()].filter(d => {

      const work = this.work.get(d.trackingCode);
      return work?.providerGaii === gaii;
    });
  }

  async listAllDisputes(): Promise<DisputeRecord[]> {
    return [...this.disputes.values()];
  }

  // ── Micro-Memory ──

  private mmKey(gaii: string, set: string) { return `${gaii}::${set}`; }

  async setMicroMemory(record: MicroMemoryRecord): Promise<MicroMemoryRecord> {
    this.microMemory.set(this.mmKey(record.gaii, record.set), record);
    return record;
  }

  async getMicroMemory(gaii: string, set: string): Promise<MicroMemoryRecord | null> {
    return this.microMemory.get(this.mmKey(gaii, set)) ?? null;
  }

  async listMicroMemorySets(gaii: string): Promise<MicroMemoryRecord[]> {
    const prefix = `${gaii}::`;
    const results: MicroMemoryRecord[] = [];
    for (const [k, v] of this.microMemory) {
      if (k.startsWith(prefix)) results.push(v);
    }
    return results;
  }

  async deleteMicroMemory(gaii: string, set: string): Promise<boolean> {
    return this.microMemory.delete(this.mmKey(gaii, set));
  }

  async deleteMicroMemoryEntry(gaii: string, set: string, key: string): Promise<boolean> {
    const record = this.microMemory.get(this.mmKey(gaii, set));
    if (!record || !(key in record.entries)) return false;
    delete record.entries[key];
    return true;
  }

  async findMicroMemoryByAccessCode(set: string, accessCode: string): Promise<MicroMemoryRecord | null> {
    for (const record of this.microMemory.values()) {
      if (record.set === set && record.accessCode === accessCode &&
        (record.visibility === 'shared_read' || record.visibility === 'shared_write')) {
        return record;
      }
    }
    return null;
  }

  // ── Storage (Binary Files) ──

  private fileKey(gaii: string, key: string) { return `${gaii}::${key}`; }

  async createStorageFile(file: StorageFileRecord): Promise<StorageFileRecord> {
    this.storageFiles.set(this.fileKey(file.ownerGaii, file.key), file);
    return file;
  }

  async getStorageFile(ownerGaii: string, key: string): Promise<StorageFileRecord | null> {
    return this.storageFiles.get(this.fileKey(ownerGaii, key)) ?? null;
  }

  async listStorageFiles(ownerGaii: string): Promise<StorageFileRecord[]> {
    const prefix = `${ownerGaii}::`;
    const results: StorageFileRecord[] = [];
    for (const [k, v] of this.storageFiles) {
      if (k.startsWith(prefix)) results.push(v);
    }
    return results;
  }

  async deleteStorageFile(ownerGaii: string, key: string): Promise<boolean> {
    return this.storageFiles.delete(this.fileKey(ownerGaii, key));
  }

  // ── Peering Requests ──

  async createPeeringRequest(req: PeeringRequestRecord): Promise<PeeringRequestRecord> {
    this.peeringRequests.set(req.id, req);
    return req;
  }

  async getPeeringRequest(id: string): Promise<PeeringRequestRecord | null> {
    return this.peeringRequests.get(id) ?? null;
  }

  async listPeeringRequests(status?: string): Promise<PeeringRequestRecord[]> {
    const results = [...this.peeringRequests.values()];
    if (status) return results.filter(r => r.status === status);
    return results;
  }

  async updatePeeringRequest(id: string, updates: Partial<PeeringRequestRecord>): Promise<PeeringRequestRecord | null> {
    const existing = this.peeringRequests.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.peeringRequests.set(id, updated);
    return updated;
  }

  // ── Memory Search ──

  async searchMemory(ownerGaii: string, query: string, opts?: { visibility?: string }): Promise<MemoryRecord[]> {
    const q = query.toLowerCase();
    const results: MemoryRecord[] = [];
    const prefix = `${ownerGaii}::`;
    for (const [k, v] of this.memory) {
      if (!k.startsWith(prefix)) continue;
      if (this.isMemoryExpired(v)) { this.memory.delete(k); continue; }
      if (opts?.visibility && v.visibility !== opts.visibility) continue;
      const valStr = typeof v.value === 'string' ? v.value : JSON.stringify(v.value);
      if (v.key.toLowerCase().includes(q) || valStr.toLowerCase().includes(q) || v.tags.some(t => t.toLowerCase().includes(q))) {
        results.push(v);
      }
    }
    return results;
  }

  // ── Action Update ──

  async updateAction(id: string, providerGaii: string, updates: Partial<ActionRecord>): Promise<ActionRecord | null> {
    const k = this.actionKey(providerGaii, id);
    const existing = this.actions.get(k);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.actions.set(k, updated);
    return updated;
  }

  // ── Chunked Uploads ──

  async createChunkedUpload(record: ChunkedUploadRecord): Promise<ChunkedUploadRecord> {
    this.chunkedUploads.set(record.uploadId, record);
    return record;
  }

  async getChunkedUpload(uploadId: string): Promise<ChunkedUploadRecord | null> {
    const record = this.chunkedUploads.get(uploadId) ?? null;
    if (record && new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return null;
    }
    return record;
  }

  async addChunk(uploadId: string, chunkIndex: number, data: Buffer): Promise<boolean> {
    const record = this.chunkedUploads.get(uploadId);
    if (!record) return false;
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.chunkedUploads.delete(uploadId);
      return false;
    }
    record.receivedChunks.set(chunkIndex, data);
    return true;
  }

  async deleteChunkedUpload(uploadId: string): Promise<boolean> {
    return this.chunkedUploads.delete(uploadId);
  }

  // ── GHII ──

  async createGHII(record: GHIIRecord): Promise<GHIIRecord> {
    if (this.ghiis.has(record.ghii)) throw new Error('GHII_TAKEN');
    this.ghiis.set(record.ghii, record);
    return record;
  }

  async getGHII(ghii: string): Promise<GHIIRecord | null> {
    return this.ghiis.get(ghii) ?? null;
  }

  async getGHIIByOwner(ownerName: string): Promise<GHIIRecord | null> {
    for (const r of this.ghiis.values()) {
      if (r.ownerName === ownerName) return r;
    }
    return null;
  }

  async getGHIIByEmailHash(emailHash: string): Promise<GHIIRecord | null> {
    for (const r of this.ghiis.values()) {
      if (r.emailHash === emailHash) return r;
    }
    return null;
  }

  async updateGHII(ghii: string, updates: Partial<GHIIRecord>): Promise<GHIIRecord | null> {
    const record = this.ghiis.get(ghii);
    if (!record) return null;
    Object.assign(record, updates, { updatedAt: new Date().toISOString() });
    return record;
  }

  async listGHIIs(opts?: { q?: string; level?: number }): Promise<GHIIRecord[]> {
    let results = [...this.ghiis.values()];
    if (opts?.q) {
      const q = opts.q.toLowerCase();
      results = results.filter(r =>
        r.username.toLowerCase().includes(q) ||
        r.displayName.toLowerCase().includes(q) ||
        (r.bio?.toLowerCase().includes(q) ?? false)
      );
    }
    if (opts?.level !== undefined) {
      results = results.filter(r => r.verificationLevel >= opts.level!);
    }
    return results;
  }

  async deleteGHII(ghii: string): Promise<boolean> {
    return this.ghiis.delete(ghii);
  }

  // ── Chat Instances ──

  async createChatInstance(record: ChatInstanceRecord): Promise<ChatInstanceRecord> {
    if (this.chatInstances.has(record.id)) throw new Error('CHAT_INSTANCE_EXISTS');
    this.chatInstances.set(record.id, record);
    return record;
  }

  async getChatInstance(id: string): Promise<ChatInstanceRecord | null> {
    return this.chatInstances.get(id) ?? null;
  }

  async listChatInstances(opts?: { ownerName?: string; platform?: string; ghii?: string }): Promise<ChatInstanceRecord[]> {
    let results = [...this.chatInstances.values()];
    if (opts?.ownerName) results = results.filter(r => r.ownerName === opts.ownerName);
    if (opts?.platform) results = results.filter(r => r.platform === opts.platform);
    if (opts?.ghii) results = results.filter(r => r.ghii === opts.ghii);
    return results;
  }

  async updateChatInstance(id: string, updates: Partial<ChatInstanceRecord>): Promise<ChatInstanceRecord | null> {
    const record = this.chatInstances.get(id);
    if (!record) return null;
    Object.assign(record, updates);
    return record;
  }

  async deleteChatInstance(id: string): Promise<boolean> {
    return this.chatInstances.delete(id);
  }

  // ── Personal Nodes ──

  async createPersonalNode(node: PersonalNodeRecord): Promise<PersonalNodeRecord> {
    this.personalNodes.set(node.nodeId, { ...node });
    return { ...node };
  }

  async getPersonalNode(nodeId: string): Promise<PersonalNodeRecord | null> {
    const node = this.personalNodes.get(nodeId);
    return node ? { ...node } : null;
  }

  async getPersonalNodeByOwner(ownerName: string): Promise<PersonalNodeRecord | null> {
    for (const node of this.personalNodes.values()) {
      if (node.ownerName === ownerName) return { ...node };
    }
    return null;
  }

  async listPersonalNodes(opts?: { status?: string }): Promise<PersonalNodeRecord[]> {
    let results = [...this.personalNodes.values()];
    if (opts?.status) {
      results = results.filter(n => n.status === opts.status);
    }
    return results.map(n => ({ ...n }));
  }

  async updatePersonalNode(nodeId: string, updates: Partial<PersonalNodeRecord>): Promise<PersonalNodeRecord | null> {
    const node = this.personalNodes.get(nodeId);
    if (!node) return null;
    Object.assign(node, updates, { updatedAt: new Date().toISOString() });
    return { ...node };
  }

  async deletePersonalNode(nodeId: string): Promise<boolean> {
    return this.personalNodes.delete(nodeId);
  }

  // ── Mailbox ──

  async createMailboxItem(item: MailboxItemRecord): Promise<MailboxItemRecord> {
    this.mailboxItems.set(item.id, { ...item });
    // Update the personal node's mailbox usage
    const node = this.personalNodes.get(item.personalNodeId);
    if (node) {
      node.mailboxUsedBytes += item.sizeBytes;
    }
    return { ...item };
  }

  async getMailboxItem(id: string): Promise<MailboxItemRecord | null> {
    const item = this.mailboxItems.get(id);
    return item ? { ...item } : null;
  }

  async listMailboxItems(personalNodeId: string, opts?: { type?: string; limit?: number }): Promise<MailboxItemRecord[]> {
    let results = [...this.mailboxItems.values()]
      .filter(i => i.personalNodeId === personalNodeId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (opts?.type) {
      results = results.filter(i => i.type === opts.type);
    }
    if (opts?.limit) {
      results = results.slice(0, opts.limit);
    }
    return results.map(i => ({ ...i }));
  }

  async deleteMailboxItem(id: string): Promise<boolean> {
    const item = this.mailboxItems.get(id);
    if (!item) return false;
    // Update the personal node's mailbox usage
    const node = this.personalNodes.get(item.personalNodeId);
    if (node) {
      node.mailboxUsedBytes = Math.max(0, node.mailboxUsedBytes - item.sizeBytes);
    }
    return this.mailboxItems.delete(id);
  }

  async deleteMailboxItemsByNode(personalNodeId: string): Promise<number> {
    let count = 0;
    for (const [id, item] of this.mailboxItems) {
      if (item.personalNodeId === personalNodeId) {
        this.mailboxItems.delete(id);
        count++;
      }
    }
    const node = this.personalNodes.get(personalNodeId);
    if (node) {
      node.mailboxUsedBytes = 0;
    }
    return count;
  }

  async getMailboxStats(personalNodeId: string): Promise<{ count: number; totalBytes: number }> {
    let count = 0;
    let totalBytes = 0;
    for (const item of this.mailboxItems.values()) {
      if (item.personalNodeId === personalNodeId) {
        count++;
        totalBytes += item.sizeBytes;
      }
    }
    return { count, totalBytes };
  }

  async cleanExpiredMailboxItems(): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, item] of this.mailboxItems) {
      if (new Date(item.expiresAt).getTime() < now) {
        const node = this.personalNodes.get(item.personalNodeId);
        if (node) {
          node.mailboxUsedBytes = Math.max(0, node.mailboxUsedBytes - item.sizeBytes);
        }
        this.mailboxItems.delete(id);
        count++;
      }
    }
    return count;
  }

  // ── Maintenance Mode ──

  private maintenanceState: MaintenanceState = { enabled: false, message: '', enabledAt: null, enabledBy: null };

  async getMaintenanceMode(): Promise<MaintenanceState> {
    return this.maintenanceState;
  }

  async setMaintenanceMode(state: MaintenanceState): Promise<MaintenanceState> {
    this.maintenanceState = state;
    return state;
  }

  // ── Consent Layer ─────────────────────────────────────
  async createConsent(record: ConsentRecord): Promise<ConsentRecord> {
    this.consents.set(record.id, record);
    return record;
  }

  async getConsent(id: string): Promise<ConsentRecord | null> {
    return this.consents.get(id) ?? null;
  }

  async listConsents(ownerGaii: string, opts?: {
    status?: 'active' | 'revoked' | 'expired';
    recipient?: string;
  }): Promise<ConsentRecord[]> {
    const results: ConsentRecord[] = [];
    for (const c of this.consents.values()) {
      if (c.ownerGaii !== ownerGaii) continue;
      if (opts?.status && c.status !== opts.status) continue;
      if (opts?.recipient && c.recipient !== opts.recipient) continue;
      results.push(c);
    }
    return results;
  }

  async updateConsent(id: string, updates: Partial<ConsentRecord>): Promise<ConsentRecord | null> {
    const existing = this.consents.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.consents.set(id, updated);
    return updated;
  }

  async deleteConsent(id: string): Promise<boolean> {
    return this.consents.delete(id);
  }

  async findMatchingConsents(ownerGaii: string, memoryKey: string, accessorGaii: string): Promise<ConsentRecord[]> {
    const now = new Date().toISOString();
    const results: ConsentRecord[] = [];

    for (const consent of this.consents.values()) {
      if (consent.ownerGaii !== ownerGaii) continue;
      if (consent.status !== 'active') continue;

      // Check expiration
      if (consent.expires && consent.expires < now) {
        consent.status = 'expired';
        continue;
      }

      // Check recipient
      if (consent.recipient !== '*' && consent.recipient !== accessorGaii) continue;

      // Check data_pattern (glob match)
      if (!consentMatchPattern(consent.dataPattern, memoryKey)) continue;

      results.push(consent);
    }

    return results;
  }

  // Consent Audit
  async addConsentAuditEntry(entry: ConsentAuditEntry): Promise<ConsentAuditEntry> {
    this.consentAudit.push(entry);
    return entry;
  }

  async listConsentAudit(ownerGaii: string, opts?: {
    days?: number;
    consentId?: string;
    accessorGaii?: string;
  }): Promise<ConsentAuditEntry[]> {
    const cutoff = opts?.days
      ? new Date(Date.now() - opts.days * 86400000).toISOString()
      : null;

    return this.consentAudit.filter(e => {
      if (e.ownerGaii !== ownerGaii) return false;
      if (cutoff && e.timestamp < cutoff) return false;
      if (opts?.consentId && e.consentId !== opts.consentId) return false;
      if (opts?.accessorGaii && e.accessorGaii !== opts.accessorGaii) return false;
      return true;
    });
  }

  // ── Schema Locking ──────────────────────────────────
  async setSchema(record: SchemaRecord): Promise<SchemaRecord> {
    const storageKey = `${record.applyTo}:${record.keyPattern}`;
    this.schemas.set(storageKey, record);
    return record;
  }

  async getSchema(keyPattern: string, applyTo?: 'exact' | 'prefix'): Promise<SchemaRecord | null> {
    if (applyTo) {
      return this.schemas.get(`${applyTo}:${keyPattern}`) ?? null;
    }
    return this.schemas.get(`exact:${keyPattern}`) ?? this.schemas.get(`prefix:${keyPattern}`) ?? null;
  }

  async deleteSchema(keyPattern: string): Promise<boolean> {
    const deleted1 = this.schemas.delete(`exact:${keyPattern}`);
    const deleted2 = this.schemas.delete(`prefix:${keyPattern}`);
    return deleted1 || deleted2;
  }

  async listSchemas(prefix?: string): Promise<SchemaRecord[]> {
    const results: SchemaRecord[] = [];
    for (const record of this.schemas.values()) {
      if (!prefix || record.keyPattern.startsWith(prefix)) {
        results.push(record);
      }
    }
    return results;
  }

  async findApplicableSchema(memoryKey: string): Promise<SchemaRecord | null> {
    // 1. Exact match — highest priority
    const exact = this.schemas.get(`exact:${memoryKey}`);
    if (exact) return exact;

    // 2. Wildcard pattern match — supports profile.*.interests style
    let bestWildcard: SchemaRecord | null = null;
    let bestSegments = 0;
    for (const record of this.schemas.values()) {
      if (record.applyTo !== 'prefix') continue;
      if (!record.keyPattern.includes('*')) continue;
      if (matchWildcardPattern(record.keyPattern, memoryKey)) {
        const segments = record.keyPattern.split('.').length;
        if (segments > bestSegments) {
          bestWildcard = record;
          bestSegments = segments;
        }
      }
    }
    if (bestWildcard) return bestWildcard;

    // 3. Simple prefix match — longest prefix wins
    const parts = memoryKey.split('.');
    for (let i = parts.length - 1; i >= 1; i--) {
      const prefix = parts.slice(0, i).join('.');
      const prefixSchema = this.schemas.get(`prefix:${prefix}`);
      if (prefixSchema) return prefixSchema;
    }

    return null;
  }

  // ── CSM — Community Service Manifest (Phase 0.2) ──────

  async createCsm(record: CsmRecord): Promise<CsmRecord> {
    if (this.csms.has(record.name)) throw new Error('CSM_NAME_TAKEN');
    this.csms.set(record.name, record);
    return record;
  }

  async getCsm(name: string): Promise<CsmRecord | null> {
    return this.csms.get(name) ?? null;
  }

  async listCsms(opts?: { serviceType?: string }): Promise<CsmRecord[]> {
    const results: CsmRecord[] = [];
    for (const csm of this.csms.values()) {
      if (opts?.serviceType && csm.serviceType !== opts.serviceType) continue;
      results.push(csm);
    }
    return results;
  }

  async updateCsm(name: string, updates: Partial<CsmRecord>): Promise<CsmRecord | null> {
    const existing = this.csms.get(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates, name: existing.name };
    this.csms.set(name, updated);
    return updated;
  }

  async deleteCsm(name: string): Promise<boolean> {
    return this.csms.delete(name);
  }

  // ── MSM — Machine Service Manifest ──────────────────────

  async createMsm(record: MsmRecord): Promise<MsmRecord> {
    if (this.msms.has(record.name)) throw new Error('MSM_NAME_TAKEN');
    this.msms.set(record.name, record);
    return record;
  }

  async getMsm(name: string): Promise<MsmRecord | null> {
    return this.msms.get(name) ?? null;
  }

  async listMsms(opts?: { category?: string }): Promise<MsmRecord[]> {
    let results = [...this.msms.values()];
    if (opts?.category) results = results.filter(m => m.category === opts.category);
    return results;
  }

  async updateMsm(name: string, updates: Partial<MsmRecord>): Promise<MsmRecord | null> {
    const existing = this.msms.get(name);
    if (!existing) return null;
    const updated = { ...existing, ...updates, name: existing.name, updatedAt: new Date().toISOString() };
    this.msms.set(name, updated);
    return updated;
  }

  async deleteMsm(name: string): Promise<boolean> {
    return this.msms.delete(name);
  }

  // ── Email Verification (Phase 1.1) ──────────────────────

  async createEmailVerification(record: EmailVerificationRecord): Promise<EmailVerificationRecord> {
    this.emailVerifications.set(record.id, record);
    return record;
  }

  async getEmailVerification(id: string): Promise<EmailVerificationRecord | null> {
    return this.emailVerifications.get(id) ?? null;
  }

  async getActiveEmailVerification(ownerName: string, purpose: string): Promise<EmailVerificationRecord | null> {
    const now = new Date().toISOString();
    for (const record of this.emailVerifications.values()) {
      if (record.ownerName === ownerName && record.purpose === purpose &&
        record.status === 'pending' && record.expiresAt > now) {
        return record;
      }
    }
    return null;
  }

  async updateEmailVerification(id: string, updates: Partial<EmailVerificationRecord>): Promise<EmailVerificationRecord | null> {
    const existing = this.emailVerifications.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.emailVerifications.set(id, updated);
    return updated;
  }

  async getEmailVerificationsByOwner(ownerName: string): Promise<EmailVerificationRecord[]> {
    return Array.from(this.emailVerifications.values()).filter(v => v.ownerName === ownerName);
  }

  async deleteExpiredEmailVerifications(): Promise<number> {
    const now = new Date().toISOString();
    let count = 0;
    for (const [id, record] of this.emailVerifications) {
      if (record.status === 'pending' && record.expiresAt < now) {
        this.emailVerifications.delete(id);
        count++;
      }
    }
    return count;
  }

  // ── Flags (Phase 1.5) ──────────────────────────────────

  async createFlag(record: FlagRecord): Promise<FlagRecord> {
    this.flags.set(record.id, record);
    return record;
  }

  async getFlag(id: string): Promise<FlagRecord | null> {
    return this.flags.get(id) ?? null;
  }

  async getFlagsByTarget(targetType: string, targetId: string): Promise<FlagRecord[]> {
    return [...this.flags.values()].filter(
      f => f.targetType === targetType && f.targetId === targetId,
    );
  }

  async getFlagByUser(targetType: string, targetId: string, flaggedBy: string): Promise<FlagRecord | null> {
    for (const f of this.flags.values()) {
      if (f.targetType === targetType && f.targetId === targetId && f.flaggedBy === flaggedBy) {
        return f;
      }
    }
    return null;
  }

  async getFlagSummary(targetType: string, targetId: string): Promise<FlagSummary | null> {
    const matching = [...this.flags.values()].filter(
      f => f.targetType === targetType && f.targetId === targetId,
    );
    if (matching.length === 0) return null;

    const byReason: Record<string, number> = {};
    let latestFlag = '';
    for (const f of matching) {
      byReason[f.reason] = (byReason[f.reason] ?? 0) + 1;
      if (f.createdAt > latestFlag) latestFlag = f.createdAt;
    }

    return {
      targetType,
      targetId,
      totalFlags: matching.length,
      byReason,
      latestFlag,
    };
  }

  async updateFlag(id: string, updates: Partial<FlagRecord>): Promise<FlagRecord | null> {
    const existing = this.flags.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.flags.set(id, updated);
    return updated;
  }

  async listFlags(opts?: { status?: string; targetType?: string; page?: number; perPage?: number }): Promise<FlagRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let results = [...this.flags.values()];

    if (opts?.status) results = results.filter(f => f.status === opts.status);
    if (opts?.targetType) results = results.filter(f => f.targetType === opts.targetType);

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  }

  // ── Matches (Phase 2.1) ──────────────────────────────────

  async createMatch(record: MatchRecord): Promise<MatchRecord> {
    this.matches.set(record.id, record);
    return record;
  }

  async getMatch(id: string): Promise<MatchRecord | null> {
    return this.matches.get(id) ?? null;
  }

  async getMatchByPair(profileA: string, profileB: string): Promise<MatchRecord | null> {
    for (const m of this.matches.values()) {
      if (
        (m.profileA === profileA && m.profileB === profileB) ||
        (m.profileA === profileB && m.profileB === profileA)
      ) {
        return m;
      }
    }
    return null;
  }

  async listMatchesByProfile(profile: string, opts?: { status?: string; page?: number; perPage?: number }): Promise<MatchRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 10;
    let results = [...this.matches.values()].filter(
      m => m.profileA === profile || m.profileB === profile,
    );

    if (opts?.status) results = results.filter(m => m.status === opts.status);

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  }

  async updateMatch(id: string, updates: Partial<MatchRecord>): Promise<MatchRecord | null> {
    const existing = this.matches.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates };
    this.matches.set(id, updated);
    return updated;
  }

  async deleteExpiredMatches(): Promise<number> {
    const now = Date.now();
    let count = 0;
    for (const [id, match] of this.matches) {
      if (new Date(match.expiresAt).getTime() < now && match.status !== 'accepted') {
        this.matches.delete(id);
        count++;
      }
    }
    return count;
  }

  // ── Organisms (Phase 2.2) ──────────────────────────────────

  async createOrganism(record: OrganismRecord): Promise<OrganismRecord> {
    this.organisms.set(record.id, record);
    return record;
  }

  async getOrganism(id: string): Promise<OrganismRecord | null> {
    return this.organisms.get(id) ?? null;
  }

  async listOrganisms(opts?: { type?: string; city?: string; interest?: string; visibility?: string; page?: number; perPage?: number }): Promise<OrganismRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let results = [...this.organisms.values()];

    if (opts?.type) results = results.filter(o => o.type === opts.type);
    if (opts?.city) results = results.filter(o => o.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.interest) results = results.filter(o => o.interests.some(i => i.toLowerCase() === opts.interest!.toLowerCase()));
    if (opts?.visibility) results = results.filter(o => o.visibility === opts.visibility);

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  }

  async updateOrganism(id: string, updates: Partial<OrganismRecord>): Promise<OrganismRecord | null> {
    const existing = this.organisms.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.organisms.set(id, updated);
    return updated;
  }

  async deleteOrganism(id: string): Promise<boolean> {
    // Cascade: delete memberships and join requests
    for (const [mid, m] of this.memberships) {
      if (m.organismId === id) this.memberships.delete(mid);
    }
    for (const [jid, j] of this.joinRequests) {
      if (j.organismId === id) this.joinRequests.delete(jid);
    }
    return this.organisms.delete(id);
  }

  // ── Memberships (Phase 2.2) ──────────────────────────────────

  async createMembership(record: OrganismMembershipRecord): Promise<OrganismMembershipRecord> {
    this.memberships.set(record.id, record);
    return record;
  }

  async getMembership(organismId: string, ghii: string): Promise<OrganismMembershipRecord | null> {
    for (const m of this.memberships.values()) {
      if (m.organismId === organismId && m.ghii === ghii) return m;
    }
    return null;
  }

  async listMembers(organismId: string, opts?: { role?: string; status?: string }): Promise<OrganismMembershipRecord[]> {
    let results = [...this.memberships.values()].filter(m => m.organismId === organismId);
    if (opts?.role) results = results.filter(m => m.role === opts.role);
    if (opts?.status) results = results.filter(m => m.status === opts.status);
    return results;
  }

  async listMembershipsByGhii(ghii: string): Promise<OrganismMembershipRecord[]> {
    return [...this.memberships.values()].filter(m => m.ghii === ghii);
  }

  async updateMembership(id: string, updates: Partial<OrganismMembershipRecord>): Promise<OrganismMembershipRecord | null> {
    const existing = this.memberships.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.memberships.set(id, updated);
    return updated;
  }

  async deleteMembership(id: string): Promise<boolean> {
    return this.memberships.delete(id);
  }

  // ── Join Requests (Phase 2.2) ──────────────────────────────────

  async createJoinRequest(record: JoinRequestRecord): Promise<JoinRequestRecord> {
    this.joinRequests.set(record.id, record);
    return record;
  }

  async getJoinRequest(id: string): Promise<JoinRequestRecord | null> {
    return this.joinRequests.get(id) ?? null;
  }

  async listJoinRequests(organismId: string, opts?: { status?: string }): Promise<JoinRequestRecord[]> {
    let results = [...this.joinRequests.values()].filter(j => j.organismId === organismId);
    if (opts?.status) results = results.filter(j => j.status === opts.status);
    return results;
  }

  async updateJoinRequest(id: string, updates: Partial<JoinRequestRecord>): Promise<JoinRequestRecord | null> {
    const existing = this.joinRequests.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.joinRequests.set(id, updated);
    return updated;
  }

  // ── Appeals (Phase 2.4) ──────────────────────────────────

  async createAppeal(record: AppealRecord): Promise<AppealRecord> {
    this.appeals.set(record.id, record);
    return record;
  }

  async getAppeal(id: string): Promise<AppealRecord | null> {
    return this.appeals.get(id) ?? null;
  }

  async getAppealByFlagId(flagId: string): Promise<AppealRecord | null> {
    for (const a of this.appeals.values()) {
      if (a.flagId === flagId) return a;
    }
    return null;
  }

  async listAppeals(opts?: { status?: string; page?: number; perPage?: number }): Promise<AppealRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let results = [...this.appeals.values()];

    if (opts?.status) results = results.filter(a => a.status === opts.status);

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  }

  async updateAppeal(id: string, updates: Partial<AppealRecord>): Promise<AppealRecord | null> {
    const existing = this.appeals.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.appeals.set(id, updated);
    return updated;
  }

  // ── Marketplace (Phase 2.6) ──

  async createListing(record: ListingRecord): Promise<ListingRecord> {
    this.listings.set(record.id, record);
    return record;
  }

  async getListing(id: string): Promise<ListingRecord | null> {
    return this.listings.get(id) ?? null;
  }

  async listListings(opts?: { category?: string; city?: string; minPrice?: number; maxPrice?: number; status?: string; sellerOwner?: string; page?: number; perPage?: number }): Promise<ListingRecord[]> {
    const page = opts?.page ?? 1;
    const perPage = opts?.perPage ?? 20;
    let results = [...this.listings.values()];

    if (opts?.category) results = results.filter(l => l.category === opts.category);
    if (opts?.city) results = results.filter(l => l.location?.city?.toLowerCase() === opts.city!.toLowerCase());
    if (opts?.minPrice !== undefined) results = results.filter(l => l.priceMorsels >= opts.minPrice!);
    if (opts?.maxPrice !== undefined) results = results.filter(l => l.priceMorsels <= opts.maxPrice!);
    if (opts?.status) results = results.filter(l => l.status === opts.status);
    if (opts?.sellerOwner) results = results.filter(l => l.ownerName === opts.sellerOwner);

    // Sort newest first
    results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const start = (page - 1) * perPage;
    return results.slice(start, start + perPage);
  }

  async updateListing(id: string, updates: Partial<ListingRecord>): Promise<ListingRecord | null> {
    const existing = this.listings.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.listings.set(id, updated);
    return updated;
  }

  async deleteListing(id: string): Promise<boolean> {
    return this.listings.delete(id);
  }

  async createPurchase(record: PurchaseRecord): Promise<PurchaseRecord> {
    this.purchases.set(record.id, record);
    return record;
  }

  async getPurchase(id: string): Promise<PurchaseRecord | null> {
    return this.purchases.get(id) ?? null;
  }

  async listPurchasesByBuyer(buyerOwner: string): Promise<PurchaseRecord[]> {
    return [...this.purchases.values()]
      .filter(p => p.buyerOwner === buyerOwner)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listPurchasesBySeller(sellerOwner: string): Promise<PurchaseRecord[]> {
    return [...this.purchases.values()]
      .filter(p => p.sellerOwner === sellerOwner)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async updatePurchase(id: string, updates: Partial<PurchaseRecord>): Promise<PurchaseRecord | null> {
    const existing = this.purchases.get(id);
    if (!existing) return null;
    const updated = { ...existing, ...updates, id: existing.id };
    this.purchases.set(id, updated);
    return updated;
  }

  // ── Push Subscriptions (Phase 3.1) ──

  async createPushSubscription(record: PushSubscriptionRecord): Promise<PushSubscriptionRecord> {
    this.pushSubscriptions.set(record.ownerName, record);
    return record;
  }
  async getPushSubscription(ownerName: string): Promise<PushSubscriptionRecord | null> {
    return this.pushSubscriptions.get(ownerName) ?? null;
  }
  async deletePushSubscription(ownerName: string): Promise<boolean> {
    return this.pushSubscriptions.delete(ownerName);
  }
  async listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
    return [...this.pushSubscriptions.values()];
  }

  // ── Trusted Issuers (Phase 3.3) ──

  async createTrustedIssuer(record: TrustedIssuerRecord): Promise<TrustedIssuerRecord> {
    this.trustedIssuers.set(record.id, record);
    return record;
  }
  async getTrustedIssuer(id: string): Promise<TrustedIssuerRecord | null> {
    return this.trustedIssuers.get(id) ?? null;
  }
  async getTrustedIssuerByUrl(url: string): Promise<TrustedIssuerRecord | null> {
    for (const issuer of this.trustedIssuers.values()) {
      if (issuer.url === url) return issuer;
    }
    return null;
  }
  async listTrustedIssuers(opts?: { type?: string }): Promise<TrustedIssuerRecord[]> {
    let issuers = [...this.trustedIssuers.values()];
    if (opts?.type) issuers = issuers.filter(i => i.type === opts.type);
    return issuers;
  }
  async deleteTrustedIssuer(id: string): Promise<boolean> {
    return this.trustedIssuers.delete(id);
  }

  // ── Genesis Peers (Phase 3.4) ──

  async createGenesisPeer(record: GenesisPeerRecord): Promise<GenesisPeerRecord> {
    this.genesisPeers.set(record.id, record);
    return record;
  }
  async getGenesisPeer(id: string): Promise<GenesisPeerRecord | null> {
    return this.genesisPeers.get(id) ?? null;
  }
  async getGenesisPeerByNodeId(nodeId: string): Promise<GenesisPeerRecord | null> {
    for (const peer of this.genesisPeers.values()) {
      if (peer.genesisNodeId === nodeId) return peer;
    }
    return null;
  }
  async listGenesisPeers(opts?: { status?: string }): Promise<GenesisPeerRecord[]> {
    let peers = [...this.genesisPeers.values()];
    if (opts?.status) peers = peers.filter(p => p.status === opts.status);
    return peers;
  }
  async updateGenesisPeer(id: string, updates: Partial<GenesisPeerRecord>): Promise<GenesisPeerRecord | null> {
    const peer = this.genesisPeers.get(id);
    if (!peer) return null;
    const updated = { ...peer, ...updates };
    this.genesisPeers.set(id, updated);
    return updated;
  }
  async deleteGenesisPeer(id: string): Promise<boolean> {
    return this.genesisPeers.delete(id);
  }

  // ── Organism Reputation (Phase 3.4) ──

  async setOrganismReputation(record: OrganismReputationRecord): Promise<OrganismReputationRecord> {
    this.organismReputations.set(record.organismId, record);
    return record;
  }
  async getOrganismReputation(organismId: string): Promise<OrganismReputationRecord | null> {
    return this.organismReputations.get(organismId) ?? null;
  }

  // ── Realtime Rooms (P2P) ──

  async createRealtimeRoom(room: RealtimeRoomRecord): Promise<RealtimeRoomRecord> {
    this.realtimeRooms.set(room.id, room);
    return room;
  }
  async getRealtimeRoom(id: string): Promise<RealtimeRoomRecord | null> {
    return this.realtimeRooms.get(id) ?? null;
  }
  async listRealtimeRooms(filter?: { appType?: string; isPublic?: boolean }): Promise<RealtimeRoomRecord[]> {
    let rooms = [...this.realtimeRooms.values()];
    if (filter?.appType) rooms = rooms.filter(r => r.appType === filter.appType);
    if (filter?.isPublic !== undefined) rooms = rooms.filter(r => r.isPublic === filter.isPublic);
    return rooms;
  }
  async updateRealtimeRoom(id: string, updates: Partial<RealtimeRoomRecord>): Promise<RealtimeRoomRecord | null> {
    const room = this.realtimeRooms.get(id);
    if (!room) return null;
    const updated = { ...room, ...updates };
    this.realtimeRooms.set(id, updated);
    return updated;
  }
  async deleteRealtimeRoom(id: string): Promise<boolean> {
    return this.realtimeRooms.delete(id);
  }
}

/**
 * Wildcard pattern matching: supports '*' (one segment) and '**' (multiple segments)
 * Example: 'profile.*.interests' matches 'profile.alice.interests'
 *          'iot.**' matches 'iot.temperature.living-room'
 */
export function matchWildcardPattern(pattern: string, key: string): boolean {
  const patternParts = pattern.split('.');
  const keyParts = key.split('.');

  let pi = 0, ki = 0;
  while (pi < patternParts.length && ki < keyParts.length) {
    if (patternParts[pi] === '**') {
      return true;
    }
    if (patternParts[pi] === '*') {
      pi++;
      ki++;
      continue;
    }
    if (patternParts[pi] !== keyParts[ki]) {
      return false;
    }
    pi++;
    ki++;
  }
  return pi === patternParts.length && ki === keyParts.length;
}

/**
 * Glob pattern matching for consent data patterns.
 * Supports '*' (one segment) and '**' (multiple segments).
 */
export function consentMatchPattern(pattern: string, key: string): boolean {
  const regex = pattern
    .split('.')
    .map(segment => {
      if (segment === '**') return '.*';
      if (segment === '*') return '[^.]+';
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('\\.');
  return new RegExp(`^${regex}$`).test(key);
}
