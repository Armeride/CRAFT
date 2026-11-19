import { expect, test, type Page } from "@playwright/test";
import {
  commitFixture,
  indexFixture,
} from "../../packages/indexer/src/test-helpers.js";
import { seedDomainExample } from "../../tools/domain-example.js";

async function openExample(
  page: Page,
  example: "border-story" | "narrative" | "game-design",
) {
  const f = await indexFixture(
    example === "border-story" ? "state-model" : example,
  );
  await seedDomainExample(f.root, example);
  await commitFixture(f.root);
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
    .fill(f.root);
  await dialog
    .getByRole("button", { name: "프로젝트 열기", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await page
    .locator(".subbar")
    .getByRole("button", { name: "시점과 상태", exact: true })
    .click();
}

test("compares a border and independently evaluates player and NPC inputs with localized controls", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "프로젝트 대시보드", exact: true }),
  ).toBeVisible();
  await page
    .locator(".subbar")
    .getByRole("button", { name: "시점과 상태", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "내용 기준", exact: true })
    .selectOption("working");
  await page
    .getByRole("combobox", { name: "상태를 볼 요소", exact: true })
    .selectOption("ent_border");
  await page
    .getByRole("button", { name: "상태 비교 실행", exact: true })
    .click();
  await expect(
    page.getByRole("row").filter({ hasText: "ent_border · owner" }),
  ).toContainText("ent_faction_b");
  await expect(
    page.getByRole("row").filter({ hasText: "ent_border · border" }),
  ).toContainText("남쪽 강변");

  await page
    .getByRole("combobox", { name: "상태를 볼 요소", exact: true })
    .selectOption("ent_gate");
  await page
    .getByRole("combobox", { name: "가정 시나리오", exact: true })
    .selectOption("ent_gate_scenario/rev_gate_scenario");
  const before = page.getByRole("group", { name: "비교 A", exact: true });
  const after = page.getByRole("group", { name: "비교 B", exact: true });
  await before
    .getByRole("combobox", { name: "가정에 넣을 사건", exact: true })
    .selectOption("enter_player");
  await after
    .getByRole("combobox", { name: "가정에 넣을 사건", exact: true })
    .selectOption("enter_npc");
  await page
    .getByRole("button", { name: "상태 비교 실행", exact: true })
    .click();
  const door = page.getByRole("row").filter({ hasText: "actor:door · open" });
  await expect(door).toContainText("참");
  await expect(door).toContainText("거짓");

  await page
    .locator(".topbar")
    .getByRole("button", { name: "설정", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "인터페이스 언어", exact: true })
    .selectOption("en");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Time and state", exact: true }),
  ).toBeVisible();
  await expect(door).toContainText("True");
  await expect(door).toContainText("False");
  await expect(
    page
      .getByRole("group", { name: "Comparison A", exact: true })
      .getByRole("combobox", { name: "Hypothetical event input", exact: true }),
  ).toHaveValue("enter_player");
});

test("compares reviewed canon from chapter 1 and chapter 5 using scene boundaries", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openExample(page, "border-story");
  await page
    .getByRole("combobox", { name: "상태를 볼 요소", exact: true })
    .selectOption("ent_border");
  const before = page.getByRole("group", { name: "비교 A", exact: true });
  const after = page.getByRole("group", { name: "비교 B", exact: true });
  await before
    .getByRole("combobox", { name: "장면", exact: true })
    .selectOption("seq_border/ent_border_chapter_one");
  await after
    .getByRole("combobox", { name: "장면", exact: true })
    .selectOption("seq_border/ent_border_chapter_five");
  await page
    .getByRole("button", { name: "상태 비교 실행", exact: true })
    .click();
  const owner = page.getByRole("row").filter({ hasText: "ent_border · owner" });
  await expect(owner).toContainText("ent_faction_a");
  await expect(owner).toContainText("ent_faction_b");
  await expect(owner).not.toContainText("잠정");
});

test("keeps reader disclosure after the flashback and shows scoped game observation separately", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openExample(page, "narrative");
  await page.getByRole("button", { name: "장면과 관점", exact: true }).click();
  let release!: () => void, began!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    began = resolve;
  });
  const queryPath = "**/api/projects/*/query";
  await page.route(queryPath, async (route) => {
    const request = route.request().postDataJSON();
    if (request.operation === "story" && !request.perspective) {
      began();
      await released;
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "장면 문맥 조회", exact: true })
    .click();
  await requested;
  await page
    .getByRole("combobox", { name: "관점", exact: true })
    .selectOption("reader");
  release();
  await expect(
    page.getByRole("button", { name: "장면 문맥 조회", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "장면 문맥", exact: true }),
  ).toHaveCount(0);
  await page.unroute(queryPath);
  await page
    .getByRole("combobox", { name: "관점", exact: true })
    .selectOption("reader");
  await page
    .getByRole("combobox", { name: "경계", exact: true })
    .selectOption("before");
  await page
    .getByRole("button", { name: "장면 문맥 조회", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "공개된 표현", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("왕궁에 비밀 통로가 있다.", { exact: false }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "장면", exact: true })
    .selectOption("ent_early_flashback");
  await page
    .getByRole("combobox", { name: "경계", exact: true })
    .selectOption("after");
  await page
    .getByRole("button", { name: "장면 문맥 조회", exact: true })
    .click();
  await expect(
    page.getByText("왕궁에 비밀 통로가 있다.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("작중 시간 눈금 5 · 독자 순서 2", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "이 관점에서 공개된 표현 검색", exact: true })
    .fill("비밀");
  await page
    .getByRole("button", { name: /검색/ })
    .filter({ visible: true })
    .last()
    .click();
  await expect(
    page.getByText("왕궁에 비밀 통로가 있다.", { exact: true }),
  ).toBeVisible();

  await openExample(page, "game-design");
  await page
    .getByRole("button", { name: "게임 규칙과 관찰", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "빌드 관찰", exact: true }),
  ).toBeVisible();
  const measurement = page
    .getByRole("row")
    .filter({ hasText: "invulnerability" });
  await expect(measurement).toContainText("0.2 seconds");
  await expect(measurement).toContainText("0.25 seconds");
});
