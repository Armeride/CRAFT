import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('browse exact revisions, references, search and both UI languages', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error)));
  await page.goto('/'); await expect(page.getByRole('heading', { name: '국경 지역', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /^참조와 영향/ }).click(); await expect(page.getByRole('heading', { name: '이 문서가 참조하는 요소' })).toBeVisible();
  await page.getByRole('tab', { name: /^리비전/ }).click(); await page.getByRole('button', { name: '채택본과 비교' }).click(); await expect(page.getByRole('heading', { name: '채택본과의 차이' })).toBeVisible(); await expect(page.locator('.diff-added')).toContainText('검토 중인 변경');
  await page.getByRole('combobox', { name: '리비전', exact: true }).selectOption('rev_border_proposal'); await expect(page.getByRole('heading', { name: '국경 지역 · 조약 이후 검토안', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '리비전', exact: true })).toHaveValue('rev_border_proposal');
  await page.getByRole('combobox', { name: 'UI 언어' }).selectOption('en'); await expect(page.locator('html')).toHaveAttribute('lang', 'en'); await expect(page.getByRole('tab', { name: 'Content', exact: true })).toBeVisible(); await expect(page.getByRole('heading', { name: '국경 지역 · 조약 이후 검토안', exact: true })).toBeVisible(); await expect(page.getByRole('combobox', { name: 'Revisions', exact: true })).toHaveValue('rev_border_proposal');
  await page.getByRole('textbox', { name: 'Search project' }).fill('조약에'); await page.getByRole('textbox', { name: 'Search project' }).press('Enter'); await expect(page.getByRole('heading', { name: 'Search results' })).toBeVisible(); await expect(page.locator('.element-row')).toHaveCount(2); await page.locator('.element-row').filter({ hasText: '조약에 의한 국경 변화' }).click(); await expect(page.getByRole('heading', { name: '조약에 의한 국경 변화', exact: true })).toBeVisible();
  await page.screenshot({ path: '.tmp/ui-preview/draft-01-en.png', fullPage: true }); expect(errors).toEqual([]);
});
test('locale switching preserves goal and unsaved draft; saved text survives reload', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: '국경 지역', exact: true })).toBeVisible(); await page.getByRole('button', { name: '초안 만들기', exact: true }).click();
  const goal = '국경 변화의 주민 영향 — UI 검증'; await page.getByRole('textbox', { name: '이번 작업의 목표' }).fill(goal);
  await page.getByRole('dialog').getByRole('combobox', { name: 'UI 언어' }).selectOption('en'); await expect(page.getByRole('textbox', { name: 'Goal for this task' })).toHaveValue(goal);
  await page.getByRole('button', { name: 'Create workspace', exact: true }).click(); const editor = page.getByRole('textbox', { name: 'Draft content' }); await expect(editor).toBeVisible();
  const text = '초안 — locale 변경으로 원문을 바꾸지 않는다.\n<script>사용자가 작성한 원문</script>\n'; await editor.fill(text);
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('ko'); await expect(page.getByRole('textbox', { name: '초안 본문' })).toHaveValue(text); await expect(page.getByText('저장하지 않은 변경 있음', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '초안 저장', exact: true }).click(); await expect(page.getByText('로컬 작업 파일에 저장됨', { exact: true })).toBeVisible(); await page.reload(); await page.getByRole('button', { name: '작업 초안', exact: true }).click(); await page.getByRole('button', { name: '이전 작업 초안 열기', exact: true }).click(); await expect(page.getByRole('textbox', { name: '초안 본문' })).toHaveValue(text);
  await expect(page.getByRole('alert')).toHaveCount(0);
});
test('narrow layouts stay within the viewport and expose navigation by keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await expect(page.getByRole('heading', { name: '국경 지역', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByRole('button', { name: '탐색 메뉴', exact: true }).click(); await page.getByRole('button', { name: /^세계와 설정/ }).click(); await expect(page.locator('.element-row').filter({ hasText: '국경 지역' })).toBeVisible();
  await page.getByRole('tab', { name: '본문', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await expect(page.getByRole('tab', { name: /^참조와 영향/ })).toBeFocused(); await expect(page.getByRole('heading', { name: '이 문서가 참조하는 요소' })).toBeVisible(); await page.screenshot({ path: '.tmp/ui-preview/draft-01-mobile.png', fullPage: true });
});
test('visible Korean and English screens have no detected WCAG A/AA violations', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: '국경 지역', exact: true })).toBeVisible();
  const check = async () => { const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(result.violations).toEqual([]); };
  await check(); await page.getByRole('tab', { name: /^참조와 영향/ }).click(); await check(); await page.getByRole('tab', { name: /^리비전/ }).click(); await check();
  await page.getByRole('combobox', { name: 'UI 언어' }).selectOption('en'); await check(); await page.getByRole('tab', { name: 'Content', exact: true }).click(); await check();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click(); await check(); await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: /^Needs attention/ }).click(); await expect(page.getByRole('heading', { name: 'Needs attention', exact: true })).toBeVisible(); await check();
});
