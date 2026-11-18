import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { indexFixture } from "../../packages/indexer/src/test-helpers.js";

async function isolatedProject(page: Page) {
  // Integration changes this project's canon; keep the shared preview example
  // untouched for the existing navigation/revision acceptance tests.
  const fixture = await indexFixture("state-model");
  await page.goto("/");
  await page
    .locator(".sidebar")
    .getByRole("button", { name: "프로젝트 열기", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "로컬 프로젝트 열기",
    exact: true,
  });
  await dialog
    .getByRole("textbox", { name: "Git 프로젝트 폴더", exact: true })
    .fill(fixture.root);
  await dialog
    .getByRole("button", { name: "프로젝트 열기", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "프로젝트 대시보드", exact: true }),
  ).toBeVisible();
  // Retain source and generated worktrees with the rest of .tmp E2E artifacts.
}

test("model-free instruction streams into the working document, stays an unselected draft, then passes user review and integration", async ({
  page,
}) => {
  test.setTimeout(240000);
  const suffix = String(Date.now()),
    instruction = "국경 인수 요청 " + suffix,
    title = "검토한 국경 규칙 " + suffix;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await isolatedProject(page);
  await expect(
    page.getByRole("heading", { name: "프로젝트 대시보드", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "세계와 설정 현황 열기", exact: true })
    .click();
  await page
    .locator(".category-items")
    .getByRole("button", { name: /^국경 지역/ })
    .click();
  await page.getByRole("button", { name: "AI 대화 열기", exact: true }).click();
  await page
    .getByRole("combobox", { name: "실행기", exact: true })
    .selectOption("fake");
  await expect(page.getByText("실행기 준비됨", { exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: "이 요소에 대한 작업 요청", exact: true })
    .fill(instruction);
  await page.getByRole("button", { name: "AI 실행", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "추가 질문", exact: true }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Rules", exact: true }).check();
  await page
    .locator(".topbar")
    .getByRole("button", { name: "설정", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "인터페이스 언어", exact: true })
    .selectOption("en");
  await page
    .getByRole("combobox", { name: "Color theme", exact: true })
    .selectOption("dark");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.getByRole("radio", { name: "Rules", exact: true }),
  ).toBeChecked();
  let accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Execution approval", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".tmp/ui-preview/agent-approval-en-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Allow this request", exact: true })
    .click();
  await expect(page.locator(".agent-execution")).toContainText(
    "Complete · review required",
    { timeout: 45000 },
  );
  await page
    .locator(".topbar")
    .getByRole("button", { name: "Settings", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Interface language", exact: true })
    .selectOption("ko");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "닫기", exact: true })
    .click();
  await expect(page.locator(".agent-execution")).toContainText(
    "완료 · 사용자 검토 필요",
    { timeout: 45000 },
  );
  await expect(
    page.getByText("결과와 조회 근거를 체크포인트에 보존했습니다.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "직접 편집", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "초안 본문", exact: true }),
  ).toContainText(instruction);
  await expect(
    page.getByRole("combobox", { name: "새 리비전 상태", exact: true }),
  ).toHaveValue("draft");
  await expect
    .poll(async () => {
      const choices = await page
        .getByRole("combobox", { name: "작성 기준", exact: true })
        .locator("option")
        .evaluateAll((options) =>
          options.map((option) => (option as HTMLOptionElement).value),
        );
      return choices.filter((value) =>
        /^ent_border\/rev_[a-f0-9-]{36}$/.test(value),
      ).length;
    })
    .toBe(1);
  await page.getByRole("textbox", { name: "제목", exact: true }).fill(title);
  await page
    .getByRole("combobox", { name: "새 리비전 상태", exact: true })
    .selectOption("approved");
  await page
    .getByRole("button", { name: "새 리비전 만들기", exact: true })
    .click();
  await expect(
    page.getByText("변경과 체크포인트를 보존했습니다.", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "검토 수락", exact: true }).click();
  await expect(
    page.getByText("검토 유효성: 유효한 사용자 검토", { exact: true }),
  ).toBeVisible({ timeout: 30000 });
  accessibility = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page
    .getByRole("button", { name: "통합 diff 준비", exact: true })
    .click();
  await expect(
    page.getByLabel("실제 통합 diff", { exact: true }),
  ).toContainText(instruction, { timeout: 30000 });
  await page
    .getByRole("button", { name: "diff를 확인했고 통합 승인", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "통합 완료", exact: true }),
  ).toBeDisabled({ timeout: 30000 });
  await page
    .locator(".sidebar")
    .getByRole("button", { name: /^모든 요소/ })
    .click();
  await expect(page.locator(".dashboard-elements")).toContainText(title);
  expect(errors).toEqual([]);
});

test("cancels a pending request, preserves it, and opens a distinct retry workspace without rerunning AI", async ({
  page,
}) => {
  test.setTimeout(120000);
  await isolatedProject(page);
  await page
    .getByRole("button", { name: "세계와 설정 현황 열기", exact: true })
    .click();
  await page
    .locator(".category-items")
    .getByRole("button", { name: /^성문/ })
    .click();
  await page.getByRole("button", { name: "AI 대화 열기", exact: true }).click();
  await page
    .getByRole("combobox", { name: "실행기", exact: true })
    .selectOption("fake");
  await page
    .getByRole("textbox", { name: "이 요소에 대한 작업 요청", exact: true })
    .fill("중단할 테스트 요청");
  const startResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/runs\/[^/]+\/agents$/.test(response.url()),
  );
  await page.getByRole("button", { name: "AI 실행", exact: true }).click();
  const original = (await (await startResponse).json()) as { runId: string };
  await expect(
    page.getByRole("heading", { name: "추가 질문", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "실행 중단", exact: true }).click();
  await expect(page.locator(".agent-state")).toContainText("중단됨", {
    timeout: 30000,
  });
  await expect(
    page.getByText("결과와 조회 근거를 체크포인트에 보존했습니다.", {
      exact: true,
    }),
  ).toBeVisible();
  const forkResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/agent-executions\/[^/]+\/fork$/.test(response.url()),
  );
  await page
    .getByRole("button", {
      name: "보존 지점에서 새 작업 공간 열기",
      exact: true,
    })
    .click();
  const resumed = (await (await forkResponse).json()) as { runId: string };
  expect(resumed.runId).not.toBe(original.runId);
  await expect(page.locator(".agent-execution")).toHaveCount(0);
  await page.getByRole("tab", { name: "직접 편집", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "초안 본문", exact: true }),
  ).not.toHaveValue(/중단할 테스트 요청/);
});
