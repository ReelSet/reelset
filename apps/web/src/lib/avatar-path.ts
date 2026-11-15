export function avatarPath(profileId: string, updatedAt: Date | string): string {
  return `/api/avatar/${profileId}?v=${new Date(updatedAt).getTime()}`
}
