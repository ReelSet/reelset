'use client'

import { ItemDrawer } from '@/components/admin/pipeline/ItemDrawer'
import { UserDrawer } from '@/components/admin/users/UserDrawer'
import type { DrawerTarget } from './drawer-context'
import { itemStore, userStore } from './stores'
import { useDrawerDetail } from './useDrawerDetail'

type Props = { target: DrawerTarget; returnTo: string; refreshKey: number }

function ItemPanel({ target, returnTo, refreshKey }: Props & { target: { kind: 'item' } }) {
  const { data, error, retry } = useDrawerDetail(itemStore, target.id, refreshKey)
  return (
    <ItemDrawer
      preview={target.preview}
      data={data}
      error={error}
      returnTo={returnTo}
      onRetry={retry}
    />
  )
}

function UserPanel({ target, returnTo, refreshKey }: Props & { target: { kind: 'user' } }) {
  const { data, error, retry } = useDrawerDetail(userStore, target.id, refreshKey)
  return (
    <UserDrawer
      preview={target.preview}
      data={data}
      error={error}
      returnTo={returnTo}
      onRetry={retry}
    />
  )
}

export function DrawerPanel(props: Props) {
  const { target } = props
  return target.kind === 'item' ? (
    <ItemPanel {...props} target={target} />
  ) : (
    <UserPanel {...props} target={target} />
  )
}

export const drawerLabel = (kind: DrawerTarget['kind']) =>
  kind === 'item' ? 'Item details' : 'User details'
