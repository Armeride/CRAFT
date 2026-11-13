import { useEffect, useState } from 'react';
import { remember, stored } from './api.js';
import { defaultGraphEngine, graphEngines, resolveGraphEngine } from './graph-engines.js';
import type { GraphEngineId } from './graph-engines.js';
export type Theme = 'light' | 'dark' | 'system';
export type SettingsCategory = 'appearance' | 'language' | 'fonts' | 'workspace' | 'graphs' | 'editing';
export interface Preferences { version: 1; theme: Theme; locale: 'ko' | 'en'; fontKo: string; fontEn: string; uiSize: number; documentSize: number; lineHeight: number; sidebarWidth: number; inspectorVisible: boolean; chatSide: 'left' | 'right'; density: 'comfortable' | 'compact'; treeMaxHeight: number; showGraph: boolean; graphEngine: GraphEngineId; editorPreview: boolean }
export const preferenceKey = 'craft.preferences.v1';
export const defaults: Preferences = { version: 1, theme: 'system', locale: 'ko', fontKo: 'recommended', fontEn: 'recommended', uiSize: 14, documentSize: 16, lineHeight: 1.85, sidebarWidth: 290, inspectorVisible: true, chatSide: 'left', density: 'comfortable', treeMaxHeight: 240, showGraph: true, graphEngine: defaultGraphEngine, editorPreview: true };
export function fontName(value: unknown): string { return typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f\u007f;{}\\"']/u.test(value) && value.trim() ? value.trim() : 'recommended'; }
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
export function normalizePreferences(raw: unknown, fallbackLocale: 'ko' | 'en' = 'ko'): Preferences {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const value = record['version'] === undefined || record['version'] === 1 ? record : {};
  const number = (key: keyof Preferences, min: number, max: number) => typeof value[key] === 'number' && Number.isFinite(value[key]) ? clamp(value[key], min, max) : defaults[key] as number;
  return { version: 1, graphEngine: resolveGraphEngine(value['graphEngine']).id, locale: value['locale'] === 'ko' || value['locale'] === 'en' ? value['locale'] : fallbackLocale, theme: ['light', 'dark', 'system'].includes(String(value['theme'])) ? value['theme'] as Theme : 'system', fontKo: fontName(value['fontKo']), fontEn: fontName(value['fontEn']), uiSize: number('uiSize', 13, 18), documentSize: number('documentSize', 14, 24), lineHeight: number('lineHeight', 1.5, 2.3), sidebarWidth: number('sidebarWidth', 240, 440), inspectorVisible: typeof value['inspectorVisible'] === 'boolean' ? value['inspectorVisible'] : true, chatSide: value['chatSide'] === 'right' ? 'right' : 'left', density: value['density'] === 'compact' ? 'compact' : 'comfortable', treeMaxHeight: number('treeMaxHeight', 100, 360), showGraph: typeof value['showGraph'] === 'boolean' ? value['showGraph'] : true, editorPreview: typeof value['editorPreview'] === 'boolean' ? value['editorPreview'] : true };
}
export function readPreferences(locale: 'ko' | 'en'): Preferences { try { return normalizePreferences(JSON.parse(stored(preferenceKey) ?? '{}'), locale); } catch { return normalizePreferences(null, locale); } }
export function applyPreferences(value: Preferences, systemDark = matchMedia('(prefers-color-scheme: dark)').matches) {
  const root = document.documentElement;
  root.dataset['theme'] = value.theme === 'system' ? systemDark ? 'dark' : 'light' : value.theme;
  root.dataset['density'] = value.density;
  root.style.setProperty('--sidebar-width', `${value.sidebarWidth}px`);
  root.style.setProperty('--tree-max-height', `${value.treeMaxHeight}px`);
  root.style.setProperty('--ui-size', `${value.uiSize}px`);
  root.style.setProperty('--document-size', `${value.documentSize}px`);
  root.style.setProperty('--document-leading', String(value.lineHeight));
  root.style.setProperty('--font-ko', value.fontKo === 'recommended' ? '"Noto Sans KR Variable", "Malgun Gothic", sans-serif' : value.fontKo === 'system' ? '"Malgun Gothic", "Apple SD Gothic Neo", sans-serif' : `${JSON.stringify(value.fontKo)}, "Noto Sans KR Variable", sans-serif`);
  root.style.setProperty('--font-en', value.fontEn === 'recommended' ? '"Inter Variable", "Noto Sans KR Variable", sans-serif' : value.fontEn === 'system' ? 'system-ui, "Noto Sans KR Variable", sans-serif' : `${JSON.stringify(value.fontEn)}, "Inter Variable", sans-serif`);
}
export function usePreferences(initial: Preferences) {
  const [preferences, set] = useState(initial);
  useEffect(() => { applyPreferences(preferences); remember(preferenceKey, JSON.stringify(preferences)); const media = matchMedia('(prefers-color-scheme: dark)'); const change = () => applyPreferences(preferences, media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, [preferences]);
  function update<K extends keyof Preferences>(key: K, value: Preferences[K]) { set(previous => normalizePreferences({ ...previous, [key]: value }, previous.locale)); }
  return { preferences, update, reset: (category?: SettingsCategory) => set(previous => { const next = { ...previous }; for (const field of settingsRegistry) if (!category || field.category === category) Object.assign(next, { [field.key]: defaults[field.key] }); return next; }) };
}
export interface Setting { key: Exclude<keyof Preferences, 'version'>; category: SettingsCategory; control: 'select' | 'range' | 'toggle' | 'font'; options?: readonly string[]; min?: number; max?: number; step?: number }
export const settingsRegistry: readonly Setting[] = [
  { key: 'theme', category: 'appearance', control: 'select', options: ['light', 'dark', 'system'] },
  { key: 'uiSize', category: 'appearance', control: 'range', min: 13, max: 18, step: 1 },
  { key: 'locale', category: 'language', control: 'select', options: ['ko', 'en'] },
  { key: 'fontKo', category: 'fonts', control: 'font' }, { key: 'fontEn', category: 'fonts', control: 'font' },
  { key: 'documentSize', category: 'fonts', control: 'range', min: 14, max: 24, step: 1 },
  { key: 'lineHeight', category: 'fonts', control: 'range', min: 1.5, max: 2.3, step: .05 },
  { key: 'sidebarWidth', category: 'workspace', control: 'range', min: 240, max: 440, step: 1 },
  { key: 'treeMaxHeight', category: 'workspace', control: 'range', min: 100, max: 360, step: 10 },
  { key: 'density', category: 'workspace', control: 'select', options: ['comfortable', 'compact'] },
  { key: 'inspectorVisible', category: 'workspace', control: 'toggle' },
  { key: 'chatSide', category: 'workspace', control: 'select', options: ['left', 'right'] },
  { key: 'showGraph', category: 'graphs', control: 'toggle' },
  { key: 'graphEngine', category: 'graphs', control: 'select', options: graphEngines.map(engine => engine.id) },
  { key: 'editorPreview', category: 'editing', control: 'toggle' },
];
