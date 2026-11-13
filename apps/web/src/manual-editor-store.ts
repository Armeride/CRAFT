import { useSyncExternalStore } from 'react';
import { ApiError, runCommand } from './api.js';
export interface ManualForm { entityId: string; parentRevision: string; kind: string; title: string; status: string; scope: string; references: string; extensions: string; tags: string }
type Phase = 'loading' | 'saved' | 'saving' | 'conflict';
interface Snapshot { form: ManualForm; state: Phase; initialized: boolean; digest: string | null; saved: string }
interface Entry { runId: string; snapshot: Snapshot; listeners: Set<() => void>; report: (error: unknown) => void; timer: ReturnType<typeof setTimeout> | undefined; saving: Promise<unknown> | undefined; digest: { current: string | null }; saved: { current: string }; initialized: { current: boolean } }
const entries = new Map<string, Entry>();
const serialized = (form: ManualForm) => JSON.stringify({ version: 1, form }, null, 2);
let warningInstalled = false;
const warn = (event: BeforeUnloadEvent) => { if ([...entries.values()].some(entry => entry.snapshot.initialized && serialized(entry.snapshot.form) !== entry.snapshot.saved)) event.preventDefault(); };
function warnings() { if (typeof window === 'undefined') return; const dirty = [...entries.values()].some(entry => entry.snapshot.initialized && serialized(entry.snapshot.form) !== entry.snapshot.saved); if (dirty && !warningInstalled) { window.addEventListener('beforeunload', warn); warningInstalled = true; } else if (!dirty && warningInstalled) { window.removeEventListener('beforeunload', warn); warningInstalled = false; } }
function patch(entry: Entry, value: Partial<Snapshot>) { entry.snapshot = { ...entry.snapshot, ...value }; warnings(); for (const listener of entry.listeners) listener(); }
function schedule(entry: Entry) {
  clearTimeout(entry.timer); if (!entry.snapshot.initialized || entry.snapshot.state === 'conflict' || entry.saving || serialized(entry.snapshot.form) === entry.snapshot.saved) return;
  entry.timer = setTimeout(() => {
    if (entry.saving || entry.snapshot.state === 'conflict') return; const text = serialized(entry.snapshot.form); if (text === entry.snapshot.saved) return;
    const expectedDigest = entry.snapshot.digest; patch(entry, { state: 'saving' });
    entry.saving = runCommand(entry.runId, async send => { const current = await send<{ editor: { text: string; digest: string | null } }>(`/api/runs/${entry.runId}/manual`); if (current.editor.text === text) return current.editor; if (current.editor.digest !== expectedDigest) throw new ApiError('FILE_CHANGED_EXTERNALLY', {}); return send<{ text: string; digest: string | null }>(`/api/runs/${entry.runId}/editor`, { text, expectedDigest }, 'PUT'); }).then(value => patch(entry, { digest: value.digest, saved: text, state: 'saved' })).catch(error => { patch(entry, { state: 'conflict' }); entry.report(error); }).finally(() => { entry.saving = undefined; schedule(entry); });
  }, 800);
}
function create(runId: string, initial: () => ManualForm, report: (error: unknown) => void): Entry {
  const entry = { runId, snapshot: { form: initial(), state: 'loading', initialized: false, digest: null, saved: '' }, listeners: new Set(), report, timer: undefined, saving: undefined } as unknown as Entry;
  entry.digest = { get current() { return entry.snapshot.digest; }, set current(digest) { patch(entry, { digest }); } };
  entry.saved = { get current() { return entry.snapshot.saved; }, set current(saved) { patch(entry, { saved }); } };
  entry.initialized = { get current() { return entry.snapshot.initialized; }, set current(initialized) { patch(entry, { initialized }); } };
  return entry;
}
export function useManualEditor(runId: string, initial: () => ManualForm, report: (error: unknown) => void) {
  let entry = entries.get(runId); if (!entry) { entry = create(runId, initial, report); entries.set(runId, entry); if (entries.size > 40) for (const [key, other] of entries) { if (key !== runId && !other.listeners.size && !other.saving && serialized(other.snapshot.form) === other.snapshot.saved) { clearTimeout(other.timer); entries.delete(key); break; } } }
  const current = entry; current.report = report;
  const snapshot = useSyncExternalStore(listener => { current.listeners.add(listener); return () => current.listeners.delete(listener); }, () => current.snapshot);
  return { form: snapshot.form, editorState: snapshot.state, editorDigest: current.digest, savedEditor: current.saved, initialized: current.initialized, setEditorState: (state: Phase) => { patch(current, { state }); if (state === 'saved') schedule(current); }, setForm: (value: ManualForm | ((previous: ManualForm) => ManualForm)) => { const form = typeof value === 'function' ? value(current.snapshot.form) : value; patch(current, { form }); schedule(current); } };
}
