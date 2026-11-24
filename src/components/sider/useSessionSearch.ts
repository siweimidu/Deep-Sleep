import { useEffect, useState } from 'react'
import { loadSession } from '../../services/chat/db.js'
import { useChatStore } from '../../services/chat/store.js'
import type { SessionSummary } from '../../services/chat/types.js'

export const useSessionSearch = (query: string, sessions: SessionSummary[]) => {
  const term = query.trim().toLocaleLowerCase()
  const [result, setResult] = useState<{ term: string; sessions: SessionSummary[] } | null>(null)

  useEffect(() => {
    if (!term) {
      return
    }
    let active = true
    const timer = setTimeout(() => {
      const search = async () => {
        const matches: SessionSummary[] = []
        for (const summary of sessions) {
          if (!active) {
            return
          }
          if (summary.title.toLocaleLowerCase().includes(term)) {
            matches.push(summary)
            continue
          }
          const session =
            useChatStore.getState().sessionCache[summary.id] ??
            (await loadSession(summary.id).catch(() => undefined))
          const hasMatch = session?.messages.some((message) =>
            message.role === 'user'
              ? message.content.toLocaleLowerCase().includes(term)
              : message.blocks.some(
                  (block) => block.type === 'text' && block.text.toLocaleLowerCase().includes(term)
                )
          )
          if (hasMatch) {
            matches.push(summary)
          }
        }
        if (active) {
          setResult({ term, sessions: matches })
        }
      }
      void search()
    }, 200)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [term, sessions])

  if (!term) {
    return sessions
  }
  return result?.term === term
    ? result.sessions
    : sessions.filter((session) => session.title.toLocaleLowerCase().includes(term))
}
