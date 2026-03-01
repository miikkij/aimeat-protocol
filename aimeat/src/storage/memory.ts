import type {
  Storage, OwnerRecord, AgentRecord, MemoryRecord,
  ActionRecord, WorkRecord, WalletTransaction,
  BoardRecord, BoardPostRecord, OtkRecord,
  DisputeRecord, DisputeAuditEntry, MicroMemoryRecord,
  StorageFileRecord, PeeringRequestRecord, ChunkedUploadRecord,
  GHIIRecord, PersonalNodeRecord, MailboxItemRecord, MaintenanceState,
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
}
