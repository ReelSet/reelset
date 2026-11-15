import { Avatar } from '@/components/ui/Avatar'
import { userAvatarUrl, userDisplay, type UserAvatarInput } from '@/lib/admin/user-display'
import type { UserRow } from '@/server/admin/users'

type IdentityUser = UserAvatarInput &
  Pick<UserRow, 'display_name' | 'provider_name' | 'handle' | 'email' | 'role'>

/** Avatar, name, handle and email of one user; the email is shown in full (admin only). */
export function UserIdentity({ user, avatarClass }: { user: IdentityUser; avatarClass?: string }) {
  const display = userDisplay({
    displayName: user.display_name,
    providerName: user.provider_name,
    handle: user.handle,
    email: user.email,
  })
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar
        url={userAvatarUrl(user)}
        initial={display.initial}
        className={avatarClass ?? 'h-9 w-9 text-sm'}
      />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 truncate font-medium">
          <span className="truncate">{display.name}</span>
          {user.role === 'admin' && <RoleBadge />}
        </p>
        <p className="truncate text-xs text-faint">
          {user.email ?? 'no email'}
          {display.handle ? ` · ${display.handle}` : ''}
        </p>
      </div>
    </div>
  )
}

export function RoleBadge() {
  return (
    <span className="shrink-0 rounded border border-accent/40 px-1 py-px text-[10px] uppercase tracking-wider text-accent">
      admin
    </span>
  )
}
