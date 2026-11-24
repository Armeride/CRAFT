import { test, expect } from "@playwright/test";

test("shows one AI panel when switching between saved drafts", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "작업 초안", exact: true }).click();

  const editor = page.locator(".legacy-editor");
  const ai = editor.locator("summary").filter({ hasText: /^AI 실행$/ });
  const goalInput = page.getByRole("textbox", { name: "작업 목표", exact: true });
  const suffix = Date.now().toString();
  const first = `AI 패널 전환 A ${suffix}`;
  const second = `AI 패널 전환 B ${suffix}`;

  async function createDraft(goal: string) {
    await goalInput.fill(goal);
    await page.getByRole("button", { name: "새 수동 작업", exact: true }).click();
    await expect(editor.getByRole("heading", { name: goal, exact: true })).toBeVisible();
  }

  async function openDraftAndType(goal: string) {
    await page.locator(".saved-work-list button").filter({ hasText: goal }).click();
    await expect(editor.getByRole("heading", { name: goal, exact: true })).toBeVisible();
    await expect(ai).toHaveCount(1);
    await ai.click();
    const prompt = editor.getByRole("textbox", { name: "이 요소에 대한 작업 요청", exact: true });
    await expect(prompt).toHaveValue("");
    await prompt.fill(goal);
  }

  await createDraft(first);
  await createDraft(second);
  await openDraftAndType(first);
  await openDraftAndType(second);
  await openDraftAndType(first);
});

test("keeps continuation notes and a PNG visible after reopening the task", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const goal = "재개 검증 " + Date.now();
  const ai = page.locator("summary").filter({ hasText: /^AI 실행$/ });
  const notes = page.locator("summary").filter({ hasText: /^이어갈 작업$/ });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "프로젝트 대시보드", exact: true }),
  ).toBeVisible();
  const tasks = page
    .locator(".sidebar")
    .getByRole("button", { name: "작업 초안", exact: true });
  await tasks.click();
  await page
    .getByRole("textbox", { name: "작업 목표", exact: true })
    .fill(goal);
  await page.getByRole("button", { name: "새 수동 작업", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "수동 편집과 변경안", exact: true }),
  ).toBeVisible();
  await ai.click();
  await notes.click();
  await expect(
    page.getByText("scene-writing · 1.0.0 · 기본", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "결정", exact: true })
    .fill("국경 이름을 유지한다.");
  await page
    .getByRole("button", { name: "재개 메모 보존", exact: true })
    .click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "재개 메모를 체크포인트에 보존했습니다." }),
  ).toBeVisible();

  await page
    .locator("summary")
    .filter({ hasText: /^이미지 첨부$/ })
    .click();
  await page.getByLabel("PNG 파일", { exact: true }).setInputFiles({
    name: "preview.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  const alt = "국경 지도 샘플";
  await page
    .getByRole("textbox", { name: "이미지 대체 텍스트", exact: true })
    .fill(alt);
  await page
    .getByRole("button", { name: "초안에 이미지 첨부", exact: true })
    .click();
  const image = page.getByRole("img", { name: alt, exact: true });
  await expect(image).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(1);

  await page.reload();
  await tasks.click();
  await page
    .locator(".saved-work-list button")
    .filter({ hasText: goal })
    .click();
  await expect(image).toBeVisible({ timeout: 30_000 });
  await ai.click();
  await notes.click();
  await expect(
    page.getByRole("textbox", { name: "결정", exact: true }),
  ).toHaveValue("국경 이름을 유지한다.");
});
