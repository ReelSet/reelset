import {
  claimNextDelete,
  claimNextPost,
  failStuckPosts,
  getEncryptedSession,
  getIgAccount,
  listLostPosts,
  listRecentMediaPks,
  markDeleted,
  markLostFound,
  markLostNotFound,
  markPostFailed,
  markPosted,
  releasePostToQueue,
  restoreAfterDeleteFailure,
  setEncryptedSession,
  setIgAccount,
  type ClaimedPost,
  type Database,
  type IgAccount,
  type Logger,
  type LostPost,
} from '@reelset/core'

export type { ClaimedPost, LostPost }

export type IgStore = {
  getSession(): Promise<string | null>
  saveSession(blob: string): Promise<void>
  getAccount(): Promise<IgAccount | null>
  setAccount(account: IgAccount): Promise<void>
  claimPost(): Promise<ClaimedPost | null>
  claimDelete(): Promise<ClaimedPost | null>
  markPosted(id: string, result: { mediaPk: string; permalink: string }): Promise<boolean>
  markFailed(id: string, error: string): Promise<boolean>
  release(id: string, note: string): Promise<boolean>
  markDeleted(id: string): Promise<boolean>
  restoreAfterDeleteFailure(id: string, error: string): Promise<boolean>
  failStuck(): Promise<number>
  nextLost(): Promise<LostPost | null>
  recentMediaPks(): Promise<string[]>
  markLostFound(id: string, result: { mediaPk: string; permalink: string }): Promise<boolean>
  markLostNotFound(id: string): Promise<boolean>
}

export function createIgStore(db: Database, log: Logger): IgStore {
  return {
    getSession: () => getEncryptedSession(db),
    saveSession: (blob) => setEncryptedSession(db, blob),
    getAccount: () => getIgAccount(db),
    setAccount: (account) => setIgAccount(db, account),
    claimPost: () => claimNextPost(db, log),
    claimDelete: () => claimNextDelete(db, log),
    markPosted: (id, result) => markPosted(db, id, result),
    markFailed: (id, error) => markPostFailed(db, id, error),
    release: (id, note) => releasePostToQueue(db, id, note),
    markDeleted: (id) => markDeleted(db, id),
    restoreAfterDeleteFailure: (id, error) => restoreAfterDeleteFailure(db, id, error),
    failStuck: () => failStuckPosts(db, log),
    nextLost: async () => (await listLostPosts(db, 1))[0] ?? null,
    recentMediaPks: () => listRecentMediaPks(db),
    markLostFound: (id, result) => markLostFound(db, id, result),
    markLostNotFound: (id) => markLostNotFound(db, id),
  }
}
