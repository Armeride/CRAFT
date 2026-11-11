import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BaselineAnalysis, Catalog, EntityDetail, ProjectChoice, ReverseResults, SearchResults, Session } from '../../server/contracts.js';
import type { QueryEnvelope } from '../../../packages/indexer/src/types.js';
import type { Preferences } from './preferences.js';
import { usePreferences } from './preferences.js';
import { api, ApiError, query, remember, session, stored } from './api.js';
import { useDrafts } from './useDrafts.js';
import { categoryOf, workingKey } from './workspace-model.js';
import type { Category, Collection } from './workspace-model.js';
import type { DocumentTab } from './Document.js';
export type Page = 'dashboard' | 'entity' | 'search' | 'tasks' | 'diagnostics';
export function useWorkspace(initialPreferences: Preferences) {
  const { t, i18n } = useTranslation(), preferences = usePreferences(initialPreferences), prefs = preferences.preferences;
  const [boot, setBoot] = useState<Session | null>(null), [projectId, setProjectId] = useState(''), [baselineId, setBaselineId] = useState('');
  const [snapshot, setSnapshot] = useState<QueryEnvelope<Catalog> | null>(null), [analysis, setAnalysis] = useState<BaselineAnalysis | null>(null);
  const [selection, setSelection] = useState<{ entity: string; revision: string } | null>(null), [detail, setDetail] = useState<QueryEnvelope<EntityDetail> | null>(null), [reverse, setReverse] = useState<ReverseResults | null>(null);
  const [page, setPage] = useState<Page>('dashboard'), [collection, setCollection] = useState<Collection>('all'), [expanded, setExpanded] = useState<Record<Category, boolean>>({ world: false, changes: false, scenarios: false, documents: false });
  const [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(false), [error, setError] = useState<unknown>(null), [menu, setMenu] = useState(false);
  const [compact, setCompact] = useState(() => matchMedia('(max-width: 1100px)').matches), [mobileInfo, setMobileInfo] = useState(false);
  const [searchText, setSearchText] = useState(''), [searchTerm, setSearchTerm] = useState(''), [results, setResults] = useState<SearchResults | null>(null), [searching, setSearching] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false), [projectOpen, setProjectOpen] = useState(false), [projectPath, setProjectPath] = useState(''), [opening, setOpening] = useState(false);
  const [tab, setTab] = useState<DocumentTab>('content'), [showWorking, setShowWorking] = useState(false), [chatVisible, setChatVisible] = useState(false), [prompts, setPrompts] = useState<Record<string, string>>({}), [activeRun, setActiveRun] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null), catalog = snapshot?.data ?? null, activeBaseline = baselineId || catalog?.project.default_baseline_id;
  const drafts = useDrafts(projectId, activeBaseline, setError), work = selection ? drafts.forSource(selection.entity, selection.revision) : undefined;
  const promptKey = selection ? workingKey(projectId, activeBaseline ?? '', selection.entity, selection.revision) : '';
  useEffect(() => { let active = true; void session().then(value => { if (active) { setBoot(value); const saved = stored('craft.project'); setProjectId(value.projects.find(project => project.id === saved)?.id ?? value.projects[0]?.id ?? ''); } }).catch(setError); return () => { active = false; }; }, []);
  useEffect(() => { void i18n.changeLanguage(prefs.locale); document.documentElement.lang = prefs.locale; remember('craft.locale', prefs.locale); }, [prefs.locale, i18n]);
  useEffect(() => { document.title = catalog ? `${catalog.project.name} · CRAFT` : 'CRAFT'; }, [catalog]);
  useEffect(() => { const media = matchMedia('(max-width: 1100px)'); const change = () => setCompact(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchInput.current?.focus(); } }; window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut); }, []);
  useEffect(() => { if (!drafts.dirty) return; const warn = (event: BeforeUnloadEvent) => event.preventDefault(); window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn); }, [drafts.dirty]);
  useEffect(() => {
    if (!projectId) return; let active = true; setLoading(true); setError(null); setAnalysis(null); remember('craft.project', projectId);
    void (async () => { const value = await query<Catalog>(projectId, 'catalog', {}, baselineId || undefined), checked = await query<BaselineAnalysis>(projectId, 'analyze', {}, baselineId || value.data.project.default_baseline_id); if (value.snapshotToken !== checked.snapshotToken) throw new ApiError('SOURCE_CHANGED', {}); if (!active) return; setSnapshot(value); setAnalysis(checked.data); setSelection(previous => previous && value.data.entities.some(entity => entity.entityId === previous.entity && entity.revisions.some(revision => revision.revisionId === previous.revision)) ? previous : null); })().catch(reason => { if (active) setError(reason); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; };
  }, [projectId, baselineId, refresh]);
  useEffect(() => {
    setDetail(null); setReverse(null); if (!projectId || !selection || !activeBaseline) return; let active = true;
    void query<EntityDetail>(projectId, 'exact', { entityId: selection.entity, revisionId: selection.revision }, activeBaseline).then(async value => { const incoming = await query<ReverseResults>(projectId, 'reverse', { entityId: selection.entity, revisionId: selection.revision, maxDepth: 8, maxResults: 100 }, activeBaseline); if (value.snapshotToken !== incoming.snapshotToken) throw new ApiError('SOURCE_CHANGED', {}); if (active) { setDetail(value); setReverse(incoming.data); } }).catch(reason => { if (active) setError(reason); }); return () => { active = false; };
  }, [projectId, selection, activeBaseline, refresh]);
  useEffect(() => {
    if (!projectId || !searchTerm) { setResults(null); return; } let active = true; setSearching(true);
    void query<SearchResults>(projectId, 'search', { text: searchTerm, limit: 100 }, activeBaseline).then(value => { if (active) setResults(value.data); }).catch(reason => { if (active) setError(reason); }).finally(() => { if (active) setSearching(false); }); return () => { active = false; };
  }, [projectId, searchTerm, activeBaseline]);
  function openCategory(category: Collection) { setCollection(category); setPage('dashboard'); setSelection(null); setMenu(false); setChatVisible(false); if (category !== 'all') setExpanded(previous => ({ ...previous, [category]: true })); }
  function choose(entityId: string, revisionId?: string) { const entity = catalog?.entities.find(value => value.entityId === entityId), revision = revisionId ?? entity?.selectedRevision ?? entity?.revisions[0]?.revisionId; if (!entity || !revision) return; const category = categoryOf(entity.kind); setCollection(category); setExpanded(previous => ({ ...previous, [category]: true })); setSelection({ entity: entityId, revision }); setPage('entity'); setMenu(false); setTab('content'); setShowWorking(false); setChatVisible(false); setError(null); }
  async function startWorking(chat: boolean) { if (!detail || drafts.busy) return; if (chat) { setChatVisible(true); setTab('content'); } else setTab('edit'); const value = await drafts.ensure(detail, t('draft.goalDefault', { title: detail.data.meta.title })); if (value) { setShowWorking(true); setActiveRun(value.runId); } else if (!chat) setTab('content'); }
  async function openRun(runId: string) { const value = await drafts.open(runId); if (!value) return; setActiveRun(runId); if (value.source && value.registrationId === projectId && value.source.baselineId === activeBaseline && catalog?.entities.some(entity => entity.entityId === value.source?.entityId && entity.revisions.some(revision => revision.revisionId === value.source?.revisionId))) { choose(value.source.entityId, value.source.revisionId); setTab('edit'); setShowWorking(true); } else setPage('tasks'); }
  function switchProject(id: string) { setProjectId(id); setSnapshot(null); setAnalysis(null); setBaselineId(''); setSelection(null); setSearchText(''); setSearchTerm(''); setPage('dashboard'); setCollection('all'); setChatVisible(false); }
  async function openProject() { if (!projectPath.trim()) return; setOpening(true); setError(null); try { const value = await api<ProjectChoice>('/api/projects/open', { root: projectPath.trim() }); setBoot(previous => previous ? { ...previous, projects: [...previous.projects.filter(project => project.id !== value.id), value] } : previous); switchProject(value.id); setProjectOpen(false); setProjectPath(''); } catch (reason) { setError(reason); } finally { setOpening(false); } }
  function goTo(value: Page) { setPage(value); setSelection(null); setMenu(false); }
  function search() { if (searchText.trim()) { setSearchTerm(searchText.trim()); goTo('search'); } }
  function clearSearch() { setSearchText(''); setSearchTerm(''); if (page === 'search') openCategory('all'); }
  const inspectorVisible = prefs.inspectorVisible && (!compact || mobileInfo);
  function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) { preferences.update(key, value); if (key === 'inspectorVisible') setMobileInfo(value as boolean); }
  function toggleInspector() { updatePreference('inspectorVisible', !inspectorVisible); }
  return { boot, projectId, baselineId, setBaselineId, catalog, snapshot, analysis, selection, detail, reverse, page, collection, expanded, setExpanded, loading, reload: () => setRefresh(value => value + 1), error, setError, menu, setMenu, searchText, setSearchText, searchTerm, results, searching, searchInput, search, clearSearch, settingsOpen, setSettingsOpen, projectOpen, setProjectOpen, projectPath, setProjectPath, opening, openProject, tab, setTab, showWorking, setShowWorking, chatVisible, setChatVisible, prompt: prompts[promptKey] ?? '', setPrompt: (text: string) => setPrompts(previous => ({ ...previous, [promptKey]: text })), promptKey, activeRun, preferences, prefs, activeBaseline, drafts, work, openCategory, choose, startWorking, openRun, switchProject, goTo, inspectorVisible, updatePreference, toggleInspector };
}
