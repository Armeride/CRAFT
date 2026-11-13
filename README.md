# CRAFT

소설과 게임 기획에 공통으로 사용하는 로컬 우선 웹 앱의 소스 저장소다. 현재 **단계 0~4(환경·파일 계약·migration·Git 작업 격리·재구축 색인/진단/검색)**를 완료했다. 단계 5는 **사용자 피드백을 반영한 UI 초안 03의 검토를 기다리는 중**이다. 실제 에이전트 연동은 아직 없다. migration의 v2는 fixture 전용이며 제품 v1은 유지한다.

현재 목표 기준은 [PROJECT_SPEC.md v1.4](PROJECT_SPEC.md), 보완 배경은 [REVIEW_NOTES.md](REVIEW_NOTES.md)다. 설계 문서 세 개는 루트에서 관리한다. 현재 진행 규칙은 **한 단계 완료 후 멈추고 대기**다.

2026-11-11 기획 추가: 모든 앱 UI의 한국어·영어 i18n과 일반 요소의 시간·trigger·조건부 상태 정의/조회/비교를 FR-021/022로 추가했다. 게임은 기획 가정 평가 범위다. 단계 4에서 번역 가능한 진단과 state_model@1 계약·참조·입력 digest를 구현했다. 단계 5의 첫 ko/en UI와 별도 작업 초안 저장을 연결했다. 전체 검토/통합 UI는 진행 중이며 상태 평가·시점/actor 비교는 단계 8에 남아 있다. 단계별 반영은 [계획](docs/IMPLEMENTATION_PLAN.md)과 [ADR-009](docs/adr/009-ui-locales-and-state-planning.md)를 따른다. 문서 v1.2는 공개 제품 schema v1을 변경하거나 제품 v2를 출시한 것이 아니다.

## 개발 환경

Windows x64, Node.js **24.21.0**, npm **11.19.0**, Git. Node는 `.node-version`, npm은 `packageManager`, 의존성은 `package-lock.json`에 고정했다. 다른 버전으로 변경할 때는 환경 테스트와 ADR-005를 함께 갱신한다.

```powershell
npm ci
npm run check
node dist/tools/environment.js
```

개별 명령은 `npm run schema:check`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:watch`다. build는 packages·tools·로컬 서버를 dist에 컴파일하고 ui:build는 브라우저 UI를 빌드한다. UI는 npm run ui:preview, 브라우저 E2E는 npm run test:ui로 실행한다.

## UI 초안 확인

~~~powershell
npm run ui:preview
~~~

**기본 http://127.0.0.1:4173, 이번 세션 새 초안은 http://127.0.0.1:4174**에서 확인한다. 한 열 탐색/분류 대시보드·참조 graph, 시스템 다크 모드·설정/ko/en·언어별 로컬 글꼴, 패널 조절과 요소별 대화/문서 분할·직접 편집/실시간 미리보기를 제공한다. AI 대화는 실행기 미연결을 표시하고 요청 메모만 보관한다. 설정의 관계 그래프 분류에서 내장 관계 중심/열 배치를 전환하고 확대·이동·전체 맞춤을 사용한다. 외부 후보는 [검토 문서](docs/GRAPH_ENGINES.md)에만 기록했다. [실행·검토 흐름·현재 제한](docs/UI_PREVIEW.md)을 따른다. UI 초안 확인 → 사용자 추가 요구 → 수정 방식으로 진행하며 단계 5 전체 완료는 아니다.

## 단계 1 실행

빌드 후 다음 명령으로 fixture를 읽는다. SQLite나 공급자 세션을 사용하지 않으며 원본 파일을 수정하지 않는다.

```powershell
npm run project:validate -- fixtures/valid-minimal
npm run project:validate -- fixtures/narrative
npm run project:validate -- fixtures/game-design
npm run project:baseline -- fixtures/game-design baseline_main ent_stamina
npm run project:get -- fixtures/game-design ent_stamina rev_stamina_b
```

baseline은 rev_stamina_a를 유지하며 exact 조회로 미채택 rev_stamina_b도 읽는다. 검증은 파일·참조 정합성 검사이며 release 승인이나 정본 통합은 수행하지 않는다.

## 단계 2 실행

```powershell
npm run migration -- support
npm run migration -- support --registry fixture
```

별도 Git 프로젝트에서 plan/run/resume을 제공한다. source를 수정하지 않고 전용 worktree의 결과 branch에 commit하며 같은 target 재실행은 no-op이다. [실행·복구 절차](docs/MIGRATIONS.md)를 따른다. 실제 제품 v2 업그레이드 기능은 아니다.

## 단계 3 실행

~~~powershell
npm run workspace -- open --app-data D:/craft-local --root D:/my-project
npm run workspace -- start --app-data D:/craft-local --registration <등록-ID> --goal "다른 개요 초안 작성"
~~~

독립 Git 프로젝트의 각 run에 별도 branch/worktree와 실행 전 초기 checkpoint를 만든다. fake 초안, 선택 dirty snapshot, 중단·복구·정리, refs/tree 재발견·새 run 재개, 비파괴 문서 import를 제공한다. [사용법과 보장 범위](docs/WORKSPACES.md)를 따른다. 원본에 자동 통합하거나 원격에 push하지 않는다.

## 단계 4 실행

~~~powershell
npm run index -- support
npm run project:validate -- fixtures/state-model
npm run index -- rebuild --app-data D:/craft-local --registration <등록-ID>
npm run index -- search --app-data D:/craft-local --registration <등록-ID> --text "국경"
~~~

등록한 독립 Git 프로젝트 또는 run/basis를 바인딩해 exact·선택·검색·역참조·진단·diff·task·상태 입력을 조회한다. DB 삭제 시 자동 재구축하며 원본은 바꾸지 않는다. [범위·명령·오류](docs/INDEXING.md)와 [상태 계약/지원표](docs/STATE_MODEL_V1.md)를 따른다. 조건 평가기는 아직 없다.

## 개발 문서

- [UI 초안 실행·검토](docs/UI_PREVIEW.md)
- [요구사항 분류와 불변 조건](docs/REQUIREMENTS.md)
- [구현 단계·목표·완료 기준·AT 추적표](docs/IMPLEMENTATION_PLAN.md)
- [환경 설치·검증·제약](docs/DEVELOPMENT.md)
- [실제 완료 범위와 다음 작업](docs/IMPLEMENTATION_STATUS.md)
- [단계 1 파일 형식과 API 계약](docs/FILE_FORMAT_V1.md)
- [단계 2 마이그레이션 계약과 실행법](docs/MIGRATIONS.md)
- [단계 3 프로젝트·작업·잠금·복구·import](docs/WORKSPACES.md)
- [단계 4 색인·검색·진단](docs/INDEXING.md)
- [상태 모델 v1·호환성·입력 근거](docs/STATE_MODEL_V1.md)
- [기술 결정 ADR](docs/adr/005-development-toolchain.md)

packages/domain, schema, project-fs, git-workspace, migrations, tasks, workspace-runtime, state-model, indexer에 제품 기반 코드를 둔다. apps/web와 apps/server는 UI·로컬 API다. tools는 로컬 실행·검증·타입 생성 도구다. fixtures는 시험용 사용자 프로젝트다. 실제 사용자 프로젝트 정본 파일을 앱 저장소 루트에 만들지 않는다.
