'use client'

import { DeleteConversation } from './DeleteConversation'

export function ConversationDelete({ id }: { id: string }) {
  return (
    <DeleteConversation
      id={id}
      label="Delete conversation"
      onDeleted={() => window.location.assign('/ask/history')}
    />
  )
}
