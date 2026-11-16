import {
  claimNextDelete,
  clearIgConnection,
  clearOfficialIgToken,
  getEncryptedOfficialToken,
  getOfficialIgAccount,
  getStatsSyncedAt,
  listPostsForStats,
  setPostInsights,
  setPostStats,
  setStatsSyncedAt,
  getPostContainerId,
  setEncryptedOfficialToken,
  setOfficialIgAccount,
  setPostContainerId,
  claimNextPost,
  failStuckPosts,
  getEncryptedCredentials,
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
  setEncryptedCredentials,
  setEncryptedSession,
  setIgAccount,
  type ClaimedPost,
  type Database,
  type IgAccount,
  type Logger,
  type LostPost,
  type PostForStats,
  type PostInsights,
} from '@reelset/core'

export type { ClaimedPost, LostPost }

export type IgStore = {
  getSession(): Promise<string | null>
  saveSession(blob: string): Promise<void>
  getCredentials(): Promise<string | null>
  saveCredentials(blob: string): Promise<void>
  /** Drops the session, its device ids and admin-entered credentials. */
  clearConnection(): Promise<void>
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
  /** Official API: the encrypted access token, its own account record, and each post's container. */
  getOfficialToken(): Promise<string | null>
  saveOfficialToken(blob: string): Promise<void>
  clearOfficialToken(): Promise<void>
  getOfficialAccount(): Promise<IgAccount | null>
  setOfficialAccount(account: IgAccount): Promise<void>
  getContainerId(postId: string): Promise<string | null>
  setContainerId(postId: string, containerId: string | null): Promise<void>
  /** Instagram numbers per post, synced from the official API. */
  getStatsSyncedAt(): Promise<Date | null>
  setStatsSyncedAt(at: Date): Promise<void>
  listPostsForStats(): Promise<PostForStats[]>
  setPostStats(id: string, stats: { likes: number | null; comments: number | null }): Promise<void>
  setPostInsights(id: string, insights: PostInsights | null): Promise<void>
}

export function createIgStore(db: Database, log: Logger): IgStore {
  return {
    getSession: () => getEncryptedSession(db),
    saveSession: (blob) => setEncryptedSession(db, blob),
    getCredentials: () => getEncryptedCredentials(db),
    saveCredentials: (blob) => setEncryptedCredentials(db, blob),
    clearConnection: () => clearIgConnection(db),
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
    getOfficialToken: () => getEncryptedOfficialToken(db),
    saveOfficialToken: (blob) => setEncryptedOfficialToken(db, blob),
    clearOfficialToken: () => clearOfficialIgToken(db),
    getOfficialAccount: () => getOfficialIgAccount(db),
    setOfficialAccount: (account) => setOfficialIgAccount(db, account),
    getContainerId: (postId) => getPostContainerId(db, postId),
    setContainerId: (postId, containerId) => setPostContainerId(db, postId, containerId),
    getStatsSyncedAt: () => getStatsSyncedAt(db),
    setStatsSyncedAt: (at) => setStatsSyncedAt(db, at),
    listPostsForStats: () => listPostsForStats(db),
    setPostStats: (id, stats) => setPostStats(db, id, stats),
    setPostInsights: (id, insights) => setPostInsights(db, id, insights),
  }
}
