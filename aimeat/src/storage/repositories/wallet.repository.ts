import type { WalletTransaction } from '../interface.js';

export interface WalletRepository {
  addTransaction(tx: WalletTransaction): Promise<WalletTransaction>;
  getTransactions(gaii: string, limit?: number): Promise<WalletTransaction[]>;
  listAllTransactions(): Promise<WalletTransaction[]>;
  deleteTransactions(gaii: string): Promise<number>;
}
