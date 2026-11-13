import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('manual task autosaves, seals a revision, records user review and integrates the actual diff without a model', async ({ page }) => {
  test.setTimeout(180000); const title = '수동 인수 규칙 ' + Date.now(), body = '# ' + title + '\n\n모델 없이 작성한 새 규칙입니다.';
  await page.goto('/'); await expect(page.getByRole('heading', { name: '프로젝트 대시보드', exact: true })).toBeVisible(); await page.locator('.sidebar').getByRole('button', { name: '작업 초안', exact: true }).click();
  await page.getByRole('textbox', { name: '작업 목표', exact: true }).fill('모델 없는 수동 인수'); await page.getByRole('button', { name: '새 수동 작업', exact: true }).click(); await expect(page.getByRole('heading', { name: '수동 편집과 변경안', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '초안 본문', exact: true }).fill(body); await page.getByRole('textbox', { name: '제목', exact: true }).fill(title); await page.getByRole('combobox', { name: '새 리비전 상태', exact: true }).selectOption('approved');
  await expect(page.getByText('속성 초안 저장됨', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: '초안 저장', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '새 리비전 만들기', exact: true }).click(); await expect(page.getByText('변경과 체크포인트를 보존했습니다.', { exact: true })).toBeVisible({ timeout: 30000 }); await expect(page.getByRole('button', { name: '검토 수락', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '검토 수락', exact: true }).click(); await expect(page.getByText('검토 유효성: 유효한 사용자 검토', { exact: true })).toBeVisible({ timeout: 30000 });
  const a11y = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(a11y.violations).toEqual([]);
  await page.getByRole('button', { name: '통합 diff 준비', exact: true }).click(); await expect(page.getByRole('heading', { name: '실제 통합 diff', exact: true })).toBeVisible({ timeout: 30000 }); await expect(page.getByLabel('실제 통합 diff', { exact: true })).toContainText(body.split('\n').at(-1)!);
  await page.getByRole('button', { name: 'diff를 확인했고 통합 승인', exact: true }).click(); await expect(page.getByRole('button', { name: '통합 완료', exact: true })).toBeDisabled({ timeout: 30000 });
  await page.locator('.sidebar').getByRole('button', { name: /^모든 요소/ }).click(); await expect(page.locator('.dashboard-elements')).toContainText(title); await page.reload(); await expect(page.locator('.dashboard-elements')).toContainText(title);
});
