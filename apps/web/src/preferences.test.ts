import { describe, expect, it } from 'vitest';
import { defaults, fontName, normalizePreferences, settingsRegistry } from './preferences.js';
import { ko, en } from './i18n.js';
describe('local preference contract', () => {
  it('follows system by default and rejects unsafe or future stored settings without touching content', () => {
    expect(normalizePreferences(null, 'en')).toMatchObject({ theme: 'system', locale: 'en', documentSize: 16 });
    expect(normalizePreferences({ version: 9, theme: 'dark', locale: 'en' }, 'ko')).toEqual(defaults);
    expect(fontName('Arial";color:red')).toBe('recommended'); expect(fontName('맑은 고딕')).toBe('맑은 고딕');
  });
  it('bounds sizes and preserves independent language font choices', () => {
    expect(normalizePreferences({ sidebarWidth: 9000, uiSize: -100, documentSize: NaN, lineHeight: Infinity, fontKo: '맑은 고딕', fontEn: 'Arial', theme: 'dark', chatSide: 'right' })).toMatchObject({ sidebarWidth: 440, uiSize: 13, documentSize: 16, lineHeight: 1.85, fontKo: '맑은 고딕', fontEn: 'Arial', theme: 'dark', chatSide: 'right' });
  });
  it('exposes each editable field once with complete bilingual labels, help and options', () => {
    expect(new Set(settingsRegistry.map(field => field.key)).size).toBe(settingsRegistry.length);
    expect(settingsRegistry.map(field => field.key).sort()).toEqual(Object.keys(defaults).filter(key => key !== 'version').sort());
    for (const field of settingsRegistry) for (const catalog of [ko, en]) { expect(Object.hasOwn(catalog, 'setting.' + field.key)).toBe(true); expect(Object.hasOwn(catalog, 'setting.' + field.key + '.help')).toBe(true); for (const option of field.options ?? []) expect(Object.hasOwn(catalog, 'option.' + option)).toBe(true); }
  });
});
