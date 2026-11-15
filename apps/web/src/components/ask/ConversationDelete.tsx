'use client'

import { useRouter } from 'next/navigation'
import { DeleteConversation } from './DeleteConversation'

export function ConversationDelete({ id }: { id: string }) {
  const router = useRouter()
  return (
    <DeleteConversation
      id={id}
      label="Delete conversation"
      onDeleted={() => router.replace('/ask/history')}
    />
  )
}
