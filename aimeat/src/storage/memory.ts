import type {
  Storage, OwnerRecord, AgentRecord, MemoryRecord,
  ActionRecord, WorkRecord, WalletTransaction,
  BoardRecord, BoardPostRecord, OtkRecord,
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
  private nodeKey: { publicKey: string; privateKey: string } | null = null;

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

  async getMemory(ownerGaii: string, key: string): Promise<MemoryRecord | null> {
    return this.memory.get(this.memKey(ownerGaii, key)) ?? null;
  }

  async listMemory(ownerGaii: string, opts?: { prefix?: string; visibility?: string; tags?: string[] }): Promise<MemoryRecord[]> {
    const prefix = `${ownerGaii}::`;
    const results: MemoryRecord[] = [];
    for (const [k, v] of this.memory) {
      if (!k.startsWith(prefix)) continue;
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
    let results: BoardPostRecord[] = [];
    for (const [k, v] of this.posts) {
      if (!k.startsWith(`${boardId}::`)) continue;
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

  async addReaction(boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean> {
    const post = this.posts.get(`${boardId}::${postId}`);
    if (!post) return false;
    if (!post.reactions[emoji]) post.reactions[emoji] = [];
    if (!post.reactions[emoji].includes(gaii)) post.reactions[emoji].push(gaii);
    return true;
  }

  // ── OTK ──

  async createOtk(otk: OtkRecord): Promise<OtkRecord> {
    this.otks.set(otk.key, otk);
    return otk;
  }

  async getOtk(key: string): Promise<OtkRecord | null> {
    return this.otks.get(key) ?? null;
  }

  async consumeOtk(key: string): Promise<OtkRecord | null> {
    const otk = this.otks.get(key);
    if (!otk || otk.used) return null;
    if (new Date(otk.expiresAt) < new Date()) {
      this.otks.delete(key);
      return null;
    }
    otk.used = true;
    return otk;
  }

  // ── Node Key ──

  async setNodeKey(publicKey: string, privateKey: string): Promise<void> {
    this.nodeKey = { publicKey, privateKey };
  }

  async getNodeKey(): Promise<{ publicKey: string; privateKey: string } | null> {
    return this.nodeKey;
  }
}
