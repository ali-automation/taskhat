import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getAccessToken } from '../api/client'
import type { Issue } from '../api/types'

interface Frame {
  channel: string
  event: string
  data: Issue & { issue?: Issue }
}

// Subscribes to the project's realtime channel; incoming issue events patch
// the query cache so boards and issue views update live (like Jira's boards).
export function useProjectRealtime(projectKey: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!projectKey) return
    let ws: WebSocket | null = null
    let closed = false
    let retryMs = 1000
    let retryTimer: ReturnType<typeof setTimeout>

    const connect = () => {
      const token = getAccessToken()
      if (!token) return
      const proto = location.protocol === 'https:' ? 'wss' : 'ws'
      ws = new WebSocket(`${proto}://${location.host}/ws`)
      ws.onopen = () => {
        retryMs = 1000
        ws?.send(JSON.stringify({ type: 'auth', token }))
        ws?.send(JSON.stringify({ type: 'subscribe', channel: `project:${projectKey}` }))
      }
      ws.onmessage = (e) => {
        try {
          const frame: Frame = JSON.parse(e.data)
          if (frame.event.startsWith('comment.')) {
            const issueKey = frame.data.issue?.key
            if (issueKey) {
              qc.invalidateQueries({ queryKey: ['comments', issueKey] })
              qc.invalidateQueries({ queryKey: ['changelog', issueKey] })
            }
            return
          }
          if (!frame.event.startsWith('issue.')) return
          if (frame.data?.key) qc.setQueryData(['issue', frame.data.key], frame.data)
          qc.invalidateQueries({ queryKey: ['issues', projectKey] })
          qc.invalidateQueries({ queryKey: ['board-issues'] })
          qc.invalidateQueries({ queryKey: ['backlog'] })
          qc.invalidateQueries({ queryKey: ['sprint-issues'] })
          qc.invalidateQueries({ queryKey: ['epics', projectKey] })
          if (frame.data?.key) qc.invalidateQueries({ queryKey: ['changelog', frame.data.key] })
        } catch {
          // ignore malformed frames
        }
      }
      ws.onclose = () => {
        if (closed) return
        retryTimer = setTimeout(connect, retryMs)
        retryMs = Math.min(retryMs * 2, 15000)
      }
    }

    connect()
    return () => {
      closed = true
      clearTimeout(retryTimer)
      ws?.close()
    }
  }, [projectKey, qc])
}
