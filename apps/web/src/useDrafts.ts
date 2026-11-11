import { useEffect, useRef, useState } from 'react';
import type { Draft, DraftSummary, EntityDetail } from '../../server/contracts.js';
import type { QueryEnvelope } from '../../../packages/indexer/src/types.js';
import { api, ApiError, remember, stored } from './api.js';
import { workingKey } from './workspace-model.js';
export interface WorkingDraft { data: Draft; savedText: string }
export function useDrafts(projectId: string, baselineId: string | undefined, report: (error: unknown) => void) {
  const [sessions, setSessions] = useState<Record<string, WorkingDraft>>({}), [summaries, setSummaries] = useState<DraftSummary[]>([]), [busy, setBusy] = useState(false), [notice, setNotice] = useState(false);
  const [selectedRuns, setSelectedRuns] = useState<Record<string, string>>({});
  const preparing = useRef(new Map<string, Promise<Draft | null>>());
  function activate(value: Draft) { if (!value.source) return; const key = workingKey(value.registrationId, value.source.baselineId, value.source.entityId, value.source.revisionId); setSelectedRuns(previous => ({ ...previous, [key]: value.runId })); remember('craft.work:' + key, value.runId); }
  function accept(value: Draft, preserveInput = false, select = true) { setSessions(previous => ({ ...previous, [value.runId]: { data: preserveInput && previous[value.runId] ? { ...value, text: previous[value.runId]!.data.text } : value, savedText: preserveInput && previous[value.runId] ? previous[value.runId]!.savedText : value.text } })); setSummaries(previous => [...previous.filter(summary => summary.runId !== value.runId), value]); if (select) activate(value); remember('craft.lastRun', value.runId); return value; }
  useEffect(() => { if (!projectId) return; let active = true; void api<{ drafts: DraftSummary[]; truncated: boolean; unavailable: number }>(`/api/projects/${projectId}/drafts`).then(result => { if (active) { setSummaries(result.drafts); setNotice(result.truncated || result.unavailable > 0); } }).catch(error => { if (active) report(error); }); return () => { active = false; }; }, [projectId]);
  function forSource(entityId: string, revisionId: string) { const key = workingKey(projectId, baselineId ?? '', entityId, revisionId), id = selectedRuns[key]; return id ? sessions[id] : undefined; }
  async function open(runId: string) { const existing = sessions[runId]; if (existing) { activate(existing.data); return existing.data; } setBusy(true); try { return accept(await api<Draft>(`/api/runs/${runId}/draft`)); } catch (error) { report(error); return null; } finally { setBusy(false); } }
  async function ensure(detail: QueryEnvelope<EntityDetail>, goal: string): Promise<Draft | null> {
    const current = forSource(detail.data.entityId, detail.data.revisionId); if (current) return current.data;
    const key = workingKey(projectId, baselineId ?? '', detail.data.entityId, detail.data.revisionId), pending = preparing.current.get(key); if (pending) return pending;
    const operation = (async () => {
      setBusy(true);
      try {
        // Refresh before deciding to create: the initial list may still be in flight.
        const listed = await api<{ drafts: DraftSummary[]; truncated: boolean; unavailable: number }>(`/api/projects/${projectId}/drafts`); setSummaries(listed.drafts); setNotice(listed.truncated || listed.unavailable > 0);
        const candidates = listed.drafts.filter(value => value.registrationId === projectId && value.source?.entityId === detail.data.entityId && value.source.revisionId === detail.data.revisionId && value.source.baselineId === baselineId);
        const remembered = stored('craft.work:' + key), existing = candidates.find(value => value.runId === remembered) ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (candidates.length > 1 && !existing) throw new ApiError('WORKING_CHOICE_REQUIRED', {});
        if (existing) { const value = await open(existing.runId); if (value && (!value.source || workingKey(value.registrationId, value.source.baselineId, value.source.entityId, value.source.revisionId) !== key)) throw new ApiError('WORKING_CONTEXT_INVALID', {}); return value; }
        if (listed.unavailable || listed.truncated) throw new ApiError('WORKING_CHOICE_REQUIRED', {});
        return accept(await api<Draft>(`/api/projects/${projectId}/drafts`, { entityId: detail.data.entityId, revisionId: detail.data.revisionId, goal, expectedSnapshot: detail.snapshotToken, baselineId }));
      } catch (error) { report(error); return null; } finally { setBusy(false); preparing.current.delete(key); }
    })();
    preparing.current.set(key, operation); return operation;
  }
  function edit(runId: string, text: string) { setSessions(previous => { const value = previous[runId]; return value ? { ...previous, [runId]: { ...value, data: { ...value.data, text } } } : previous; }); }
  async function save(runId: string) { const current = sessions[runId]; if (!current) return; setBusy(true); try { const text = current.data.text, result = await api<Draft>(`/api/runs/${runId}/draft`, { text, expectedDigest: current.data.digest }, 'PUT'); setSessions(previous => ({ ...previous, [runId]: { data: { ...result, text: previous[runId]?.data.text ?? text }, savedText: text } })); } catch (error) { report(error); } finally { setBusy(false); } }
  async function request(runId: string, text: string, requestId: string) { const current = sessions[runId]; if (!current) return false; setBusy(true); try { accept(await api<Draft>(`/api/runs/${runId}/requests`, { text, requestId, expectedDigest: current.data.requestsDigest }), true, false); return true; } catch (error) { report(error); return false; } finally { setBusy(false); } }
  return { sessions, summaries: summaries.filter(value => value.registrationId === projectId), busy, notice, forSource, open, ensure, edit, save, request, lastRun: stored('craft.lastRun'), dirty: Object.values(sessions).some(value => value.data.text !== value.savedText) };
}
