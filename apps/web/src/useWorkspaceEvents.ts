import { useEffect, useRef, useState } from 'react';
import { eventResponse, remember, stored } from './api.js';
export function useWorkspaceEvents(projectId: string, refresh: () => void) {
  const [state, setState] = useState<'connecting' | 'connected' | 'retrying'>('connecting'), latest = useRef(refresh); latest.current = refresh;
  useEffect(() => {
    if (!projectId) return; const abort = new AbortController(), key = 'craft.events:' + projectId; let cursor = Number(stored(key) ?? 0), refreshTimer: ReturnType<typeof setTimeout> | undefined;
    if (!Number.isSafeInteger(cursor) || cursor < 0) cursor = 0;
    const synchronize = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => latest.current(), 150); };
    async function connect() {
      while (!abort.signal.aborted) {
        try {
          setState('connecting'); const response = await eventResponse(projectId, cursor, abort.signal); setState('connected'); const reader = response.body!.getReader(), decoder = new TextDecoder(); let buffer = '';
          while (!abort.signal.aborted) {
            const { value, done } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); if (buffer.length > 256000) throw Error('EVENT_FRAME_LIMIT');
            let boundary: number;
            while ((boundary = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); const data = frame.split('\n').find(line => line.startsWith('data: ')); if (!data) continue; const event = JSON.parse(data.slice(6)) as { sequence: number; projectId: string; type: string; runId?: string }; if (event.projectId !== projectId || !Number.isSafeInteger(event.sequence) || event.sequence < 0 || event.sequence <= cursor && event.type !== 'sync.required') continue; cursor = event.sequence; remember(key, String(cursor)); if (event.type === 'project.changed' || event.type === 'sync.required') synchronize(); if (event.type === 'task.changed' || event.type === 'sync.required') window.dispatchEvent(new CustomEvent('craft:task-change', { detail: event.runId ?? '' })); }
          }
        } catch { if (abort.signal.aborted) break; }
        if (abort.signal.aborted) break; setState('retrying'); await new Promise<void>(resolve => { const timer = setTimeout(done, 2000); function done() { clearTimeout(timer); abort.signal.removeEventListener('abort', done); resolve(); } abort.signal.addEventListener('abort', done, { once: true }); });
      }
    }
    void connect(); return () => { abort.abort(); clearTimeout(refreshTimer); };
  }, [projectId]);
  return state;
}
