import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { IntegrationRecord } from '../../../packages/tasks/src/manual-contracts.js';
import { api } from './api.js';

export function IntegrationRecovery({ projectId, report, changed }: { projectId: string; report: (error: unknown) => void; changed: () => void }) {
  const { t } = useTranslation(), [record, setRecord] = useState<IntegrationRecord | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; if (projectId) void api<{ integration: IntegrationRecord | null }>(`/api/projects/${projectId}/pending-integration`).then(value => { if (active) setRecord(value.integration); }).catch(report); return () => { active = false; }; }, [projectId]);
  async function resolve(action: 'apply' | 'restore') { if (!record) return; setBusy(true); try { const result = await api<IntegrationRecord>(`/api/integrations/${record.id}/${action}`, { token: record.token }); setRecord(result); changed(); } catch (error) { report(error); } finally { setBusy(false); } }
  if (!record) return null;
  return <section className="dashboard-card integration-review"><h2>{t('recovery.title')}</h2><p>{t('recovery.hint')}</p><p><code>{record.target.commit} → {record.candidateCommit}</code></p><pre tabIndex={0} aria-label={t('manual.integrationDiff')}>{record.diff}</pre>{record.state === 'applying' ? <div className="modal-controls"><button disabled={busy} className="primary-button" onClick={() => { void resolve('apply'); }}>{t('recovery.finish')}</button><button disabled={busy} className="secondary-button" onClick={() => { void resolve('restore'); }}>{t('recovery.restore')}</button></div> : <p role="status">{t(record.state === 'applied' ? 'manual.integrated' : 'recovery.restored')}</p>}</section>;
}

export function ConflictArtifacts({ runId, report }: { runId: string; report: (error: unknown) => void }) {
  const { t } = useTranslation(), [paths, setPaths] = useState<string[]>([]), [artifact, setArtifact] = useState<{ path: string; text: string } | null>(null);
  return <details onToggle={event => { if (event.currentTarget.open) void api<{ paths: string[] }>(`/api/runs/${runId}/artifacts`).then(value => setPaths(value.paths)).catch(report); }}><summary>{t('conflict.artifacts')}</summary>{!paths.length && <p>{t('conflict.noArtifacts')}</p>}{paths.map(path => <p key={path}><button className="text-button" onClick={() => { void api<{ path: string; text: string }>(`/api/runs/${runId}/artifact?path=${encodeURIComponent(path)}`).then(setArtifact).catch(report); }}>{path.split('/').at(-1)}</button></p>)}{artifact && <><p><code>{artifact.path}</code></p><pre tabIndex={0} aria-label={t('conflict.artifacts')}>{artifact.text}</pre></>}</details>;
}
