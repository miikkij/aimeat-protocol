import type { BoardRecord, BoardPostRecord, BoardSubscriptionRecord } from '../interface.js';

export interface BoardRepository {
  createBoard(board: BoardRecord): Promise<BoardRecord>;
  getBoard(id: string): Promise<BoardRecord | null>;
  listBoards(opts?: { visibility?: string; ownerGaii?: string }): Promise<BoardRecord[]>;
  updateBoardVisibility(id: string, visibility: string, federate?: boolean): Promise<BoardRecord | null>;
  updateBoardMembers(id: string, allowedGaiis: string[]): Promise<BoardRecord | null>;
  deleteBoard(id: string): Promise<boolean>;
  createPost(post: BoardPostRecord): Promise<BoardPostRecord>;
  getPost(boardId: string, postId: string): Promise<BoardPostRecord | null>;
  listPosts(boardId: string, opts?: { category?: string; cursor?: string; limit?: number }): Promise<BoardPostRecord[]>;
  deletePost(boardId: string, postId: string): Promise<boolean>;
  addReaction(boardId: string, postId: string, emoji: string, gaii: string): Promise<boolean>;
  createBoardSubscription(sub: BoardSubscriptionRecord): Promise<BoardSubscriptionRecord>;
  getBoardSubscription(boardId: string, gaii: string): Promise<BoardSubscriptionRecord | null>;
  listBoardSubscriptions(boardId: string): Promise<BoardSubscriptionRecord[]>;
  listSubscriptionsByAgent(gaii: string): Promise<BoardSubscriptionRecord[]>;
  deleteBoardSubscription(boardId: string, gaii: string): Promise<boolean>;
}
