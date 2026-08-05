import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getAccessToken } from '../api/client'

// Subscribes to the signed-in user's channel: new notifications refresh the
// bell instantly.
export function useUserRealtime(userId: string | undefined) {
  const qc = useQueryClient()

  useEffect(() => {
    if (!userId) return
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
        ws?.send(JSON.stringify({ type: 'subscribe', channel: `user:${userId}` }))
      }
      ws.onmessage = () => {
        qc.invalidateQueries({ queryKey: ['notifications'] })
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
  }, [userId, qc])
}
