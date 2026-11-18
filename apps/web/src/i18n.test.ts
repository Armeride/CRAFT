import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { ko, en, initialLocale, setupI18n, i18n } from './i18n.js';
const vars = (text: string) => [...text.matchAll(/{{\s*([^}, ]+)/g)].map(match => match[1]).sort();
describe('UI locale contract', () => {
  it('keeps every catalog key and interpolation variable in both supported locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
    for (const key of Object.keys(ko) as (keyof typeof ko)[]) { expect(vars(en[key]), key).toEqual(vars(ko[key])); expect(en[key].trim(), key).not.toBe(''); }
  });
  it('resolves explicit preference before supported browser languages and uses Korean fallback', () => {
    expect(initialLocale('ko', ['en-US'])).toBe('ko'); expect(initialLocale('en', ['ko-KR'])).toBe('en'); expect(initialLocale(null, ['ja', 'en-US'])).toBe('en'); expect(initialLocale('fr', ['ja'])).toBe('ko');
  });
  it('renders counts correctly without modifying inserted user text', async () => {
    await setupI18n('en'); expect(i18n.t('items', { count: 1 })).toBe('1 element'); expect(i18n.t('items', { count: 2 })).toBe('2 elements');
    const title = '국경 <원문> {{입력}}'; expect(i18n.t('draft.goalDefault', { title })).toContain(title);
    await i18n.changeLanguage('ko'); expect(i18n.t('items', { count: 2 })).toBe('2개 요소'); expect(i18n.t('draft.goalDefault', { title })).toContain(title);
  });
  it('has translations for every literal UI key used in components', async () => {
    const text = (await Promise.all((await readdir('apps/web/src')).filter(path => path.endsWith('.tsx')).map(path => readFile('apps/web/src/' + path, 'utf8')))).join('\n');
    for (const match of text.matchAll(/\bt\((['"])([a-zA-Z.]+)\1\s*[,)]/g)) expect(Object.hasOwn(ko, match[2]!) || Object.hasOwn(ko, match[2]! + '_other'), match[2]).toBe(true);
  });
});
