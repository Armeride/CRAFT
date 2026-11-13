# 구현 상태

갱신: 2026-11-13, Asia/Seoul. **단계 0~5 완료, 단계 6 착수 전 대기**. 사용자가 UI 초안 03을 승인하고 단계 5 잔여 기능까지 이번에 구현하도록 확정했다. [작업 005](tasks/005-manual-workflow.md)를 완료했다. 이후 새 UI 요구는 [별도 작업](tasks/README.md)으로 관리한다. 단계 6~9는 미착수, 10은 선택 확장이다.

## 기준과 범위 구분

- 목표: PROJECT_SPEC.md v1.4 전체, REVIEW_NOTES.md. [확정 요구·설계 기준·미결정](REQUIREMENTS.md)을 구분한다. FR 26개·AT 68개는 제품 전체 기준이며 아래 테스트 수와 다르다.
- 앱 소스: main(이전 master). 단계 0·1은 3847002, 2는 6a83094, 3은 906e996, 추가 기획은 2220dc5이며 단계 4는 1fe44d2이며 UI 초안 01은 2bbd8cf, 초안 02는 6391781이며 초안 03도 로컬 commit으로 보존한다. 현재 origin=https://github.com/Armeride/CRAFT.git. 사용자가 main으로 push했고 2026-11-13 원격 HEAD/main과 로컬 6391781 일치를 확인했다. 이번 그래프 변경은 별도 로컬 commit으로 보존한다.
- 실행 기준: Windows x64, Node 24.21.0/npm 11.19.0과 exact lockfile. 전역 설정·소유권·인증을 변경하지 않는다.
- FR-021: 진단 code/messageKey/params와 fallback 문구를 분리했다. 단계 5 초안 01에서 ko/en catalog·언어 전환/선호·폼 상태 보존을 연결했다. 현재 구현한 웹 화면 인수는 작업 005에서 검증했으며 후속 화면도 같은 gate를 유지한다.
- FR-022: state_model@1 파일·호환성·참조·입력 digest/색인까지 구현했다. 평가기·상태 결과·시점/actor 전후 비교는 단계 8이다. 현재 state/state-input은 evaluatorAvailable:false다.
- 공개 core/narrative/game_design v1·core 생성 타입·기존 fixture/semantic model 1은 유지했다. 새 상태 확장과 fixture만 별도로 추가했다. 문서 v1.4도 제품 core v2가 아니다.

## 단계 5 — 수동 작업 흐름 완료

2026-11-13 작업 005 완료. [사용법·복구·API 한도](MANUAL_WORKFLOW.md), [ADR-015](adr/015-manual-review-integration-and-events.md)를 따른다. UI 초안 03의 구조를 유지하고 실제 남은 기능을 연결했다. 외부 그래프 후보는 문서 기록만 유지하며 의존성/lockfile을 변경하지 않았다.

- ManualService/TaskService.edit: 불변 새 요소/revision, scope/reference/state 확장 편집, 사용자 review·baseline 생성/채택, 예상 snapshot·UUID receipt와 checkpoint 동시 보존. 참조만 바뀐 새 revision은 기존 본문/검토를 보존하고 재검토한다.
- 본문/속성 자동 저장·digest CAS·화면 전환 뒤 속성 저장 지속, locale/배치/재접속 복원, 충돌 시 양쪽 원문/백업·별도 run 분기와 백업 열람. 새 작업은 HEAD 또는 명시 선택 dirty snapshot이며 원래 index/파일은 보존한다.
- IntegrationService: 별도 candidate worktree·전체 실제 diff·source/target/diff/review token, 입력/HEAD/index/branch 재검증·원자 ref 검증/갱신, approved/release 사용자 검토 gate, 결과와 consumed_proposals 같은 commit. 적용 전/후 중단 guard·완료/원복, 외부 편집 보존, 중복/불명 결과의 자동 재실행 차단.
- 관리 REST/UI: 로컬/안전 transport clone·명시 문서 import와 별도 기준, Git exact checkpoint 새 run 복원, 제품 v1 migration 지원표/계획/no-op·committed attestation 보고서. 실제 제품 v2나 자동 migration 통합을 만들지 않았다.
- SSE: 인증된 프로젝트 scope, durable 단조 cursor/200개 replay·범위 초과 동기화, writer/실제 파일 watcher·재접속·heartbeat·느린 client 종료. query 검증을 대체하지 않는다. working/basis/source scope 비혼합과 stale 차단을 유지한다.

최종 검증: **npm run check — 18파일 192개 Vitest 통과(301.47초)**, 생성 타입·core/web typecheck·서버/worker/Vite build 통과. 이후 UI의 기준 복원/SSE/viewport 보강은 typecheck·graph/locale 7개 단위 검사와 최종 전체 E2E로 재검증했다. **npm run test:ui — 12개 Chrome E2E 통과(약 4분)**. 모델 없이 본문 자동 저장→새 approved revision→전파/사용자 review→실제 diff 승인·정본 통합→reload, 즉시 화면 이동/미완성 JSON 복원·언어 전환·작업별 baseline 복원/외부 변경 SSE 반영, CAS 충돌/두 원문 보존·새 run, 관리/migration/no-op·명시 checkpoint 복원, 기존 탐색/graph/settings·ko/en/라이트/다크/390px·WCAG A/AA 자동 검사 회귀를 검증했다. 서비스 검증은 참조만 변경 후 재검토, stale snapshot/target/source 변경·중복 UUID/token, 통합 파일 적용/commit 후 중단·복원·외부 편집 보존, HTTP 범위·선택 dirty 원본 보존, 실제 HTTP SSE·fs.watch/프로젝트 비혼합·cursor 재시작·다중 publisher를 포함한다.

추가 실행 검증: 빌드한 서버의 중단 상태 재시작→인증된 pending/restore API→정본 조회 회복 smoke 통과. native 환경 CLI는 Node v24.21.0/win32/x64. 공개 core/extension schema·생성 타입·기존 fixture·package/lockfile은 50b5b6c와 동일하다. 명세 FR 26/AT 68·기존 불변 조건/예시 의미는 유지한다.

첫 전체 회귀에서는 192개 중 migration 기존 파일 교체 1개가 Windows EPERM으로 실패했다. 실제 실패 경로의 단발 rename을 기존 제한된 renameWithRetry로 바꿨다. 대상 파일 삭제 없이 같은 atomic rename만 재시도하며 최종 전체 회귀에서 검증했다. 기존 UI의 명시 Save 전제 시험은 자동 저장 완료와 요청 보관의 session 갱신으로 갱신했다. 충돌 시험은 빈 초안의 실제 digest를 사용한다.

실시간 초기 동기화/재조회에서 동일한 graph model 객체가 다시 만들어져 이동·확대 상태가 초기화되는 문제도 발견했다. 실제 배치 기하가 바뀔 때만 자동 fit하도록 수정하고 drag 후 조회 갱신에도 viewport가 유지되는 Chrome 회귀를 추가했다. 관리 화면 복원 시험은 실행 불가능한 옛 fixture가 아니라 방금 보존한 runnable checkpoint를 명시 선택한다.

현재 main의 로컬 commit으로 보존하며 자동 push하지 않는다. 검토 서버는 http://127.0.0.1:4174, 기존 .tmp/ui-preview를 보존해 최신 빌드로 재시작했고 HTTP/인증된 새 복구 API를 확인했다. 격리된 인수 프로젝트에서 복원된 수동 속성 화면도 시각 확인했다. E2E/smoke는 별도 임시 프로젝트만 사용한다. 단계 5 종료 후 대기한다.

실제 AI/내부 MCP는 6, 공급자 재개는 7, 상태 조건 평가/시점·actor 비교는 8이다. 다른 schema/일반 텍스트 자동 3-way merge, 운영 상태 전체 손실·전원/디스크 장애/규모·타 OS/브라우저와 전체 AT 인수는 9에서 검증한다. 자동 접근성 검사는 수동 스크린리더/모든 환경 인수를 뜻하지 않는다. 새 UI 요청·그래프 외부 도입은 별도 작업이다.

## 단계 5 — UI 초안 03 승인 기준선

아래는 50b5b6c 당시의 검증 이력이다. 현재 단계 5 완료 범위는 위 작업 005를 따른다.

2026-11-13 사용자 그래프 요청을 FR-026/AT-67~68로 기록했다. [후보 비교/확장 계약](GRAPH_ENGINES.md), [ADR-014](adr/014-pluggable-relationship-graph.md)을 따른다. 외부 후보 Cytoscape/fCoSE, Sigma/Graphology/ForceAtlas2/Louvain, react-force-graph-2d는 공식 자료 검토만 했고 설치·실행 비교·채택은 하지 않았다. 의존성과 lockfile은 유지한다.

- 공통 pinned GraphModel·엔진 registry/View·순수 layout·viewport를 분리했다. 설정에 관계 그래프 분류/엔진을 추가하고 구현된 관계 중심/열 배치만 전환·보존한다. 기존 preferences v1·알 수 없는 ID는 기본 내장 엔진으로 복구한다.
- 관계 중심 배치는 표시 범위/필터의 고유 이웃 수·유한 force 휴리스틱과 양의 modularity 병합으로 중심/주변·시각 군집을 배치한다. self/parallel edge는 배치 계산에서만 단순화하고 원래 방향/pin/propagation은 보존한다. 고립 노드는 외곽에 정리해 fit 시 불필요한 축소를 줄였다.
- SVG/HTML 캔버스 viewport에서 drag/방향키 이동, 버튼·Ctrl/Cmd+wheel·+/− 확대/축소, fit/100% 보기, 포커스 노드의 화면 복귀를 제공한다. 관계 목록·한도/과거 pin/외부 분류·ko/en·라이트/다크를 유지한다. 일반 wheel은 페이지 scroll이다.
- core/extension schema v1·생성 타입·fixture·기존 불변 조건·예시는 바꾸지 않았다. 원격/DB/정본에 엔진·좌표·자동 군집을 기록하지 않는다.

검증 완료: npm run check의 생성 타입·전체 typecheck·서버/UI build와 **13파일 178개 Vitest**가 통과했다(206.02초). 시각 검토 후 고립 노드/포커스 수정은 typecheck·웹 14개 단위 테스트로 재검증했다. npm run test:ui의 **8개 Chrome E2E**도 모두 통과했다(44.6초). 중심 star·두 밀집군/bridge·순환/self/parallel/고립/빈 그래프의 유한·결정적 배치, 설정 복구·보존, zoom/pan/fit/정확 선택과 기존 UI/접근성 회귀를 검증한다. 1,000요소/10,000리비전 성능 인수는 아니며 표시 한도는 48노드/120관계다.

UI 검토 중 고립 노드가 전체 fit을 과도하게 축소하는 문제를 발견해 외곽에 정리했다. 포인터 노드 클릭은 키보드용 화면 보정과 분리했고 drag 테스트는 실제 빈 공간을 확인한다. 브라우저 테스트의 초기화 버튼 label 오기도 현재 UI 문구로 수정했다. 검토 서버는 http://127.0.0.1:4174, .tmp/ui-preview 재사용이며 사용자 working 파일을 지우지 않는다. draft-03-graph-light/dark/mobile.png를 로컬 시각 검토용으로 보존한다. 여기서 사용자 UI 피드백을 기다리며 단계 5 전체 완료나 단계 6 착수로 처리하지 않는다.

후순위는 외부 실제 도입/정확 버전·성능/OS·GPU/worker/접근성 실측, 노드 고정/수동 배치·위치 저장/export·pinch·대규모 최적화다. 기존 AI 실행은 6, 상태 평가/시점·actor 비교는 8 경계를 유지한다.

## 단계 5 — UI 초안 02 검증 이력

아래는 6391781 당시 기록이며 현재 실행/지원 범위는 초안 03을 따른다.

사용자 피드백 8개와 추가 답변을 FR-023~025/AT-61~66으로 기록했다. 확정 요구는 설정/시스템 테마/글꼴, 통합 탐색·대시보드/graph, resize·정보 제어, 요소별 대화/문서·직접 편집이다. 기본 왼쪽 대화/오른쪽 문서와 좌우 전환을 적용했다. [실행/검토](UI_PREVIEW.md), [ADR-013](adr/013-workspace-navigation-and-preferences.md)을 따른다. 단계 6은 시작하지 않았다.

- versioned 로컬 preferences/typed registry·전체/분류/검색, 설정 내 언어·system/light/dark, live OS theme 반영. Noto Sans KR Variable 5.3.1/Inter Variable 5.3.0 self-host·OFL 포함, 언어별 font·크기/행간·UI 크기/목록 간격 등 14개 설정.
- 한 왼쪽 탐색의 독립 scroll·높이 공유, 전체/분류 dashboard, 실제 고정 Reference의 bounded graph·과거 pin/외부 분류, pointer/keyboard 너비 조절·보존, 오른쪽 정보 toggle/작은 화면 drawer.
- Document/Chat/useWorkspace/useDrafts로 UI 책임 분리, 독립 working 문서의 직접 편집/실시간 preview·명시 저장, 대화/문서 반전. 사용자 요청은 ui-requests.json, source 문맥은 ui-context.json에 보존한다. 미연결 AI 응답/수정은 생성하지 않는다.
- task/run별 파일·원본 digest·요소/기준/리비전 binding·expectedDigest/요청 ID, legacy unbound 보존. 초기 목록 지연 때 서버 목록을 기다리고, 여러 후보/불완전 목록에는 임의 새 작업이나 latest 선택을 하지 않는다. Session 401만 실행 전 거부를 확인해 한 번 갱신/재시도한다.
- backend API는 WorkingSource/요청 보관/목록을 추가했다. working 문서는 core schema 변경이 아니다. 공개 core/extension v1·생성 타입·기존 fixture/semantic model 1은 유지했다.

검증 완료: npm run check의 생성 타입·core/web typecheck·서버/worker/Vite build와 **12파일 174개 Vitest**가 모두 통과했다(204.33초). npm run test:ui의 **7개 Chrome E2E**도 최종 변경 후 모두 통과했다(40.4초). 폰트 설치 시 npm audit는 149 packages/보고된 취약점 0건이었다. API 6개, locale 4개, preferences 3개, graph 3개와 기존 전체 회귀다. 브라우저에서는 system/명시 theme·선호 reload, category dashboard/정확 pin·search/diff, 설치 font의 사용자 동작/미지원 모의 분기, 큰 모의 목록의 내부 scroll/다른 메뉴 유지·resize/toggle, 요소 A/B 요청 비혼합·저장/언어/배치/세션 갱신·지연된 초기 복원을 검증한다. 라이트/다크/ko/en dashboard·문서·설정·편집/대화의 자동 WCAG A/AA 검사도 포함한다. 실제 OS 폰트 허용·타 브라우저/스크린리더 전체 검증은 아니다.

검증 중 키보드 탭의 비동기 활성화 초점 유실과 초기 작업 목록이 늦을 때의 중복 생성 경계를 발견해 수동 tab 활성화·복원 선행으로 수정했다. 후자는 응답을 지연시키고 새 작업 POST가 0회인지 검사했다. 모의 catalog의 테스트 종료 시 pending route도 정리했다.

현재 서버: http://127.0.0.1:4174, .tmp/ui-preview 재사용. 이전 예시·사용자 working 파일은 덮어쓰거나 제거하지 않는다. E2E는 매번 별도 .tmp/ui-e2e-<식별값>에서 수행한다. screenshot은 draft-02-dashboard/dark/work/mobile.png다. 문서·코드는 로컬 commit으로 보존하고 사용자 확인을 기다린다.

후순위: 고급 graph 배치/위치 저장·내보내기, OS 전반의 font 감지·추가 세부 설정. 실제 AI 실행은 6, 상태 평가/시점·actor 비교는 8이다. 단계 5 나머지 metadata/revision/review/baseline 편집·autosave·통합/승인/SSE 등은 계속 미완료다.

## 단계 5 — UI 초안 01 검증 이력

아래는 2bbd8cf 당시 기록이다. 현재 실행/지원 범위는 위 초안 02를 따른다.

사용자는 단계를 진행하되 UI부터 초안을 제시하고 직접 확인/추가 요구를 전달하는 방식을 요청했다. 현재 초안 범위에서 멈추고 피드백을 기다린다. 실행/검토는 [UI_PREVIEW.md](UI_PREVIEW.md), 결정은 [ADR-012](adr/012-web-draft-and-local-session.md)를 따른다.

- apps/web: 밝은 문서 영역·왼쪽 탐색/목록·오른쪽 참조/영향, 실제 요소/검색·리비전/diff·진단, ko/en 전환, 별도 working 초안 편집/명시 저장·최근 run 복원. 390px/1440px와 키보드 탭·native modal을 확인했다.
- apps/server: Fastify loopback 정적 UI/API, Host/Origin/Sec-Fetch-Site·HttpOnly/SameSite session/CSRF, 서버 project scope와 표준 오류, 기존 ProjectIndex/TaskService 연결. 초기 작업/체크포인트와 lease/journal/expectedDigest를 재사용한다.
- indexer: 같은 generation의 project/baseline/요소 catalog와 exact의 모든 선언된 확장 참조를 추가했다. Node hash 구현과 브라우저가 공유하는 타입을 분리했다. 공개 디스크 schema/semantic model은 유지한다.
- tools/ui-preview.ts: 별도 예시 Git 프로젝트·미채택 검토안 생성, --home/--port, 원본 fixture 보존·재실행 시 기존 자료 유지. default .tmp/ui-preview, http://127.0.0.1:4173.
- React/React DOM 19.3.1, Vite 8.3.8, Fastify 5.12.8/static 10.1.10, i18next 27.1.1/react-i18next 18.0.1과 Playwright 1.65.0/axe 4.14.0 exact pin. 설치 시 npm audit 보고 147 packages/취약점 0건. 런타임 Node/npm pin은 유지했다.

검증: npm run check의 4개 생성 타입·core/web typecheck·서버/worker/Vite build·**10파일 166개 Vitest**, npm run test:ui의 **4개 Chrome E2E**를 실행했다. UI API 4개와 locale/catalog 4개를 기존 158개에 추가했다. 세션/Origin/Host·다른 project 거부, 원본 guard 보존·초안 저장/충돌/복원·stale snapshot 차단을 확인했다. E2E는 검색/리비전/diff·ko/en·목표/미저장 초안 유지·저장 후 재로드·390px/키보드와 보이는 ko/en 화면/모달의 WCAG A/AA axe 자동 검사를 포함한다. 최종 전체 166개 Vitest와 4개 E2E가 모두 통과했다(각 약 169.5초/21.9초). schema/core/web typecheck·서버/worker/Vite build도 통과했다.

첫 전체 회귀에서 기존 stage1 test의 정리 단계가 Windows EBUSY로 실패했다(제품 assert 165개 통과). 소유 경로 검증을 유지한 채 recursive rm에 다른 helper와 같은 제한 재시도(maxRetries 10/retryDelay 100ms)를 추가해 재검증했다. 또 다른 병렬 실행에서 기존 migration 준비가 failed로 반환되었으나 원본 오류가 당시 assert에 표시되지 않았다. 오류를 assertion에 포함했고 해당 단독 시나리오와 migration 전체 24개는 통과했다. native Git/파일 I/O의 파일별 동시 실행을 maxWorkers 2로 제한한 뒤 최종 전체 166개가 통과했다. migration의 간헐 실패 원인을 단정하지 않으며 단계 9에서 Windows 부하/장애 검증을 확대한다. 제품 검증을 생략하거나 테스트를 건너뛰지 않았다.

CUA 브라우저 연결은 sandbox setup/kernel 환경 오류로 초기화되지 않았다. 설치된 Chrome의 격리된 headless context로 실제 렌더링/스크린샷/E2E를 확인했고 외부 배포는 하지 않았다. .tmp/ui-preview/draft-01-ko.png, draft-01-en.png, draft-01-mobile.png는 로컬 검토용이다. 사용자 브라우저의 기존 profile은 사용하지 않았다. preview는 사용자 확인을 위해 실행 중으로 유지한다.

남은 단계 5: 사용자 UI 피드백, 새 revision/review/baseline 편집·autosave/여러 작업 복원, proposal 영속 idempotency·사용자 diff/HEAD 승인·정본 통합, clone/import/migration/scope 화면, SSE cursor/reconnect·watcher 힌트·전체 인수. AT-51~53의 첫 UI 기반을 검증했으며 전체 앱 인수 완료가 아니다. 상태 평가/시점·actor 비교는 단계 8이다.

## 단계 4 완료 범위

| 위치 | 실제 구현/요구 |
|---|---|
| packages/schema/extensions/state_model/v1, packages/state-model | versioned definition/transition/occurrence/scenario, 유한 조건 AST·효과/반복 한도, 완전 Reference 추출, 타입/단위·누락/순환·actor 검증, legacy 단일 출처 읽기 adapter. FR-022/AT-60 기반 |
| packages/project-fs/src/state-support.ts, state-input.ts | 내장 의미 reader pin·지원 차단, portable 가정 입력 manifest/digest와 로컬 scopeCacheKey 분리. 기존 revision에 초기값을 추정 추가하지 않음 |
| packages/indexer | SQLite/WAL worker, raw source 검증·full/incremental 게시 transaction, read transaction·다중 writer OS lock, 손상 cache quarantine·DB 삭제 재구축. FR-016 |
| indexer service/types | registration/run/worktree/basis scope·권한 token·자료 snapshot 분리, 원본 전후 fingerprint·freshness·pending journal 차단. FR-019/AT-11·37 기반 |
| packages/domain/src/analysis.ts | 순수 역참조·SCC·blocking/advisory/none 전파·유한 원인 경로, 적용 baseline 폐쇄성·deprecated 선택·부모 후속/형제·scope 경고·user review/digest 준비도. FR-004~006 |
| packages/domain/src/diff.ts, indexer worker | metadata/reference/body diff, NFC exact/짧은 별칭·FTS5 trigram 한국어 원고·bounded snippet, task/working·상태 원자료 조회. FR-007 기반 |
| git-workspace generation/locks/git, project-fs writer | source epoch, scoped Git metadata 조회 최적화, hooks/filter 비실행 유지, 쓰기 후 동일 worktree 색인 무효화 |
| domain Diagnostic/schema validator, tools/index-cli.ts | code/messageKey/params·위치, support/status/rebuild/각 조회의 JSON CLI. FR-021 기반 |

설계는 [ADR-010](adr/010-versioned-state-model.md)/[상태 모델](STATE_MODEL_V1.md), [ADR-011](adr/011-worker-index-and-generations.md)/[색인 API·오류](INDEXING.md)를 따른다. 상태 입력은 근거 manifest이며 실제 시뮬레이션 결과가 아니다. releaseEligible은 준비도 검사이며 사용자 통합 승인을 대체하지 않는다.

## 단계 4 실제 검증 — 2026-11-11

- npm ci: 67 packages 설치, 68 audit, 보고된 취약점 0건. SQLite를 정확히 고정한 runtime dependency로 이동했다.
- npm run check: core/audit/runtime/state_model 4개 생성 타입 drift 검사, strict typecheck, build, **8파일 158개 테스트 전부 통과**. 이전 123개 + 단계 4의 35개(domain 8/state-model 14/indexer 13)다. 테스트 전체 소요 약 171초.
- 새 schema의 정확한 pin·지원표, 공개 v1 Reference/SnapshotTarget 동등성, 조건 참조 추출·입력 변경 semantic digest, 미래/위조 계약 차단, 기존 narrative 초기값 단일 출처·누락 unknown 보존을 확인했다.
- **실제 이전 commit 2220dc5의 packages를 Git archive→별도 빌드**해 새 상태 fixture를 읽혔다. 옛 reader는 UNSUPPORTED_REQUIRED_EXTENSION·writable:false를 반환했고 source Git diff는 없었다. pin 누락/미지원 값은 현재 reader도 쓰기를 차단한다.
- DB 삭제 전후 exact·진단·task 결과 동일, 증분 revision 추가/삭제·baseline pin 유지, cache 손상 격리/재구축, 불변 revision 수동 편집 차단·오래된 뷰 명시를 확인했다.
- 후보 준비 뒤 파일 변경·query 중 변경·expectedSnapshot 불일치·SQL transaction 실패를 주입했다. 게시 전 실패/rollback은 이전 generation을 보존하고 최신 조회를 거부했다.
- 별도 run A/B의 working 검색, 고정 basis·역사 commit 읽기, 별도 실제 offline bare clone에서 cache/원문 비혼합을 확인했다. 잘못된 token과 pending journal은 allowStale로 우회되지 않는다.
- 두 인스턴스의 writer 경합과 이전 일관 generation 읽기, configured Git filter 미실행, worker thread ID, 한국어·공백 경로를 검증했다.
- draft 간접 2-hop 전파·직접 상태 보존, advisory/compare 비차단, draft pin 유지·approved 후속/형제와 PvP/PvE 공통 scope, 선택 deprecated·blocking SCC, user review 누락/변경 입력 차단을 확인했다.
- NFC 1~2글자 이름·별칭, 3글자 이상 실제 한국어 원고 FTS5, literal 검색 입력, NFD/emoji 원문 snippet·전체 body 미노출·빈 working file을 검증했다.
- 같은 commit의 clone은 같은 portable inputDigest, 서로 다른 scopeCacheKey를 얻는다. player/NPC 선택·가정 변경은 입력 digest를 바꾸며 source는 쓰지 않는다. 상태 결과는 계산하지 않았다.
- 공개 v1/core 생성 타입과 이전 fixture의 Git diff 없음, FR-001~022/AT-01~60 및 명세 불변 조건 9개·기존 예시 보존, 문서 링크를 확인했다.

AT-01/07~10/24/26/32~33/42~43은 현재 application/파일·색인 시나리오를 검증했다. AT-11/37은 색인/basis 격리 기반이며 MCP는 단계 6, AT-44/48은 검토/조회 기반이며 전체 UI·도메인은 5/8이다. AT-58은 입력 digest/격리 기반, AT-60은 새 계약/옛 reader 호환을 검증했고 단계 9에서 전체 회귀한다. AT-51~57/59와 전체 상태 평가·UI는 미완료다. 이전 인수 기록은 아래 역사로 유지한다.

## 단계 4 실제 CLI와 소규모 실측

~~~powershell
npm ci
npm run check
npm run index -- support
npm run project:validate -- fixtures/state-model
npm run workspace -- open --app-data D:/craft-local --root D:/my-project
npm run index -- rebuild --app-data D:/craft-local --registration <등록-ID>
npm run index -- search --app-data D:/craft-local --registration <등록-ID> --text "국경"
~~~

빌드한 CLI를 별도 프로세스로 open→status→rebuild→selected/search/reverse/analyze→player/NPC state-input→DB 삭제→자동 재구축→외부 변경 stale/refresh로 실행했다. analyze는 draft fixture이므로 예상 exit 2였다. source HEAD/index/파일 guard가 동일함을 확인했다. 등록/run별 실행법은 [INDEXING.md](INDEXING.md)를 따른다.

최종 보존 샘플: .tmp/stage4 CLI smoke OrhOfS/의 smoke-results.json에 등록/경로·정확한 manifest/digest와 실측을 남겼다. 실행 프로세스는 종료했다.

| 지표 | 최종 관측 |
|---|---|
| 자료 | 11요소/11리비전/48파일, state-model fixture 복사 Git |
| 같은 인스턴스 selected 연속 조회 | 8회, p50 146.02ms / p95 155.24ms |
| 전체 후보 prepare / SQL 게시 | 176.88ms / 2.59ms |
| worker thread ID | 1 |
| 조회·재구축 동안 메인 5ms timer 최대 간격 | 20.14ms |

이 표는 작은 fixture의 국소 실측이다. 8표본으로 전체 성능을 보장하지 않는다. **1,000요소/10,000리비전의 exact p95 200ms·증분 1초·전체 30초 목표는 단계 9에서 실측**한다. source/revision/FTS 행은 증분이지만 그래프/진단은 전체 재분석한다. 독립 background watcher는 없고 요청 시 hash 감사/자동 refresh와 앱 writer epoch를 사용한다.

## 단계 3 완료 범위

| 위치 | 실제 구현 |
|---|---|
| packages/tasks/src/projects.ts | 로컬 등록, committed tree의 상태 분류, 제한 transport clone, 이동 후 registration·worktree repair |
| packages/tasks/src/service.ts | task/run/worktree ID, 실행 전 brief/초기 checkpoint commit, working save, 선택 dirty snapshot, fake 새 draft/proposal, 중단·실패·checkpoint 보존, 복구·안전 정리, 별도 integration 공간 |
| packages/tasks/src/discovery.ts | HEAD/local/remote-tracking task refs/tree 재발견, checkpoint·schema·불변성 확인, 명시 commit의 새 run 재개 기반 |
| packages/tasks/src/import.ts | 선택한 committed Markdown/text의 전용 branch import, 원문 유지, draft document·출처 확장·별도 working baseline |
| packages/git-workspace/src/locks.ts | native OS lock, owner/heartbeat/lease, repo metadata·worktree 쓰기·실행 잠금 분리, timeout 탈취 금지 |
| packages/git-workspace/src/branches.ts 및 fs.ts | app namespace worktree와 raw Git commit 재사용, Windows atomic rename 일시 오류 재시도 |
| packages/project-fs/src/writer.ts | 후보 전체 검증, expected hash/snapshot, scope·lease, before/after journal, 부분 쓰기 forward 복구·외부 충돌 보존 |
| packages/workspace-runtime | 별도 runtime v1 schema·생성 타입·검증·원자적 운영 JSON. 제품 정본 schema와 분리 |
| tools/workspace-cli.ts | open/clone/tasks/start/status/fake/save/checkpoint/cancel/recover/clean/resume/import/integration/relocate |

단계 1의 DB 없는 exact/baseline/안전 YAML/불변성, 단계 2의 production·fixture registry와 migration 계약은 유지했다. migration 어댑터도 공통 metadata OS lock에 참여하며 legacy sentinel 정책은 보존한다.

## 단계 3 실제 검증 — 2026-11-10

- npm ci: lockfile 재설치 성공, 67 packages 설치·68 packages audit, 보고된 취약점 0건.
- npm run check: core/audit/runtime 타입 drift 검사, strict 타입 검사, build, **5파일 123개 테스트**. 이전 101개 + 단계 3의 22개다.
- 두 작업을 실제 Git worktree에서 병행 실행해 같은 요소의 서로 다른 draft revision·proposal을 보존했다. 부모 pin과 기존 baseline은 유지했다.
- fake의 started 시점에 초기 task/brief/checkpoint가 이미 Git에 있는지 확인했다. 완료 run 중복 실행도 거부했다.
- source의 staged/unstaged/untracked 및 index hash를 보존했다. HEAD 기본값과 선택 경로 snapshot을 비교하고 CRLF·선택하지 않은 파일·stash 부재를 확인했다.
- 실행 중 cancel은 cancelling→확인 후 cancelled로 구분하고 autosaved 결과·실패한 참조 원문을 checkpoint에 보존했다. 실행 중 cleanup과 dirty/untracked/ignored cleanup을 거부했다.
- worktree 정리 뒤 운영 로그와 registration을 지우고 refs/tree에서 목표·출력·checkpoint를 다시 찾아 새 run으로 복원했다.
- offline bare remote clone에서 remote-tracking task를 찾고, 그 뒤 원본에서만 만든 local-only task가 clone에 없음을 확인했다. 실제 서버 접속·인증·push는 하지 않았다.
- Windows 별도 Node 프로세스의 live OS lock을 stale heartbeat/PID로 빼앗지 못함을 확인했다. 프로세스 강제 종료 뒤 커널 release를 통해 새 owner가 획득했다.
- prepared/첫 파일 게시 후 중단을 주입하고 읽기 차단→forward 복구→새 checkpoint를 확인했다. **2 MiB보다 큰 journal**을 만드는 한국어 초안도 복구했다. 제3의 외부 편집은 덮어쓰지 않았다.
- commit 직후 run journal 업데이트 유실을 재현하고 같은 run의 Git checkpoint를 검증해 복구했다. expected hash·다른 task 범위·대소문자 경로 충돌·불변 revision 쓰기를 거부했다.
- 저장된 revision의 수동 변경을 감지하고 폴더 정리를 차단했다. 원본·다른 작업은 유지했다.
- 한국어·공백 경로의 저장소 이동 후 linked .git repair와 같은 project_id 재연결을 확인했다. 이동 fixture는 환경의 directory rename EPERM 때문에 소유 경로 내 복사→이전 경로 제거로 구성했다.
- dirty active target과 별도 integration worktree가 섞이지 않음을 확인했다. merge/target 갱신은 수행하지 않았다.
- manifest 없는 repository를 열기만 할 때 원본을 변경하지 않고, 명시 import만 새 branch에서 수행했다. 원문의 BOM/CRLF와 source hash, draft 상태·출처, 기존 baseline/revision/review 유지와 unborn 무변경을 확인했다.
- 단계 3 당시 원본 3개 SHA-256, 제품 core v1 및 기존 fixture 무변경, 당시 FR 20개·AT 50개 추적과 문서 링크를 대조했다. 이번 v1.2 기획 개정 전 기록이다.

현재 범위의 AT-14/15/16/18/19/30/31/39/40/50 시나리오를 검증했다. AT-11/20/27/28/38/47은 파일·fake·application command 기반이 있으며 전체 색인/MCP/provider/UI 인수는 해당 후속 단계에 남긴다. 모든 AT가 끝났다는 선언은 아니다.

## 실제 실행과 검토 산출물

~~~powershell
npm ci
npm run check
npm run workspace -- open --app-data <관리-경로> --root <독립-Git-root>
npm run workspace -- start --app-data <관리-경로> --registration <등록-ID> --goal "초안 작성"
~~~

빌드된 CLI를 별도 프로세스로 실행해 open→start→fake→tasks→integration→clean→**이전 초기 checkpoint로 resume**, bare clone/remote task discovery, 기존 문서 import까지 통과했다. 원본 HEAD/index/정본 guard와 import 원본 bytes를 비교했다.

- 단계 3 샘플: .tmp/stage3 CLI smoke zptFkI/의 smoke-results.json에 경로·등록·task/run·commit을 남겼다.
- fake 결과 commit: 36a384b6c90527d6161982ea3dff3b1f14bac5fe.
- import 결과 commit: 281216f044d6cfff208d3238462377dcf6f0b2a2.
- source, 앱 데이터, queued 상태로 새로 만든 resumed worktree, ready integration 공간, import 결과, offline bare remote와 clone을 검토용으로 유지했다. 실행 프로세스가 남았다는 뜻은 아니다.
- 기존 단계 2 .tmp/stage2 CLI smoke 0CVDZz/와 두 migration 결과는 그대로 보존했다.
- 이들은 사용자 실제 자료가 아닌 fixture 복사본이며 Git 제외 임시 데이터다. 결과 branch/commit도 각 독립 샘플 repo에만 있다. 원격 백업이 아니다.

사용법·오류·한계는 [WORKSPACES.md](WORKSPACES.md), migration은 [MIGRATIONS.md](MIGRATIONS.md)를 따른다.

## 현재 한계와 미결정

- 단계 5 초안의 UI/REST/ko/en·명시 working 저장은 있다. SSE·전체 수동 검토/통합과 실제 Codex/Claude·MCP/스킬·provider 교체는 아직 없다. i18n 구현체는 ADR-012로 고정했다.
- 상태 파일/입력·참조는 검증하지만 trigger 실행·시점/actor 상태 비교·canon/plan·confirmed/working·POV 결과 필터는 단계 8이다. author만 지원하고 character/reader 요청은 거부한다.
- 현재 diff는 metadata/ref 비교와 본문 단일 hunk다. 사용자 diff 승인 token·proposal 중복 방지·target 재검증은 단계 5, B/T/R 의미 통합·전체 장애/규모 시험은 9다.
- 그래프 전체 재분석과 요청마다 원본 hash 확인은 정확성을 위한 현재 비용이다. watcher 힌트/갱신 UI는 5, 영향 부분 최적화와 큰 자료 성능은 9에서 판단한다.
- product migration registry는 core 1만 지원한다. fixture core 2를 제품 업그레이드로 사용하지 않는다. 새 상태 계약은 선택적 추가 확장이며 자동 의미 migration은 없다.
- CLI recover는 task run용이다. import 실패의 일반 운영 복구 UI는 후속이다. 별도 integration 공간 준비는 merge/target 갱신이 아니다.
- OS lock/expected hash는 협력 앱의 경합을 다룬다. worktree는 OS sandbox가 아니다. 네트워크 볼륨/다른 OS·전원/디스크 장애 내구성은 단계 9에서 확대 검증한다.
- native 모듈은 해당 OS/ABI에서 재설치한다. remotePreserved는 local remote-tracking ref 관측이며 실시간 서버 보장이 아니다. local-only 결과는 새 clone에 없다.
- 환경 sandbox setup refresh 제약 때문에 자동화 명령은 일반 권한 실행 경로를 사용했다. safe.directory는 D:/git/CRAFT 한 명령 범위로만 설정했으며 전역 Git/CLI 설정·인증·소유권은 바꾸지 않았다.

## 다음 작업 — UI 피드백 후 단계 5 계속

1. UI 초안 01에 대한 사용자 피드백을 먼저 반영한다. 스택/i18n/E2E 버전은 ADR-012로 고정했으므로 초기화/중복 구현하지 않는다.
2. 구현한 loopback/session/Origin·REST 경계를 유지하며 SSE cursor/reconnect·watcher 힌트를 기존 task/index application service에 연결한다. author 범위·scope/snapshot/freshness 계약을 유지한다.
3. 프로젝트/요소/검색/진단·working autosave·새 revision/review/baseline 선택의 수동 흐름을 만든다. 상태 파일 편집은 새 revision 규칙을 지킨다.
4. proposal idempotency·diff/HEAD 검토 token·별도 integration 검증을 연결하고 모델 없는 실제 UI 흐름을 검증한다.
5. 모든 앱 소유 문구·접근성/오류/형식화를 ko/en catalog로 제공하고 locale 전환 중 원문·초안·정본 digest 보존을 확인한다.
6. 초안 확인 → 추가 요구 → 수정 방식을 유지한다. 현재는 UI 초안 03 검토 대기다. 단계 5 전체 검증/인계 뒤에도 멈추며 단계 6에 자동 착수하지 않는다.

## 보존 상태

단계 4 소스는 1fe44d2에 보존했다. 이번 UI 초안 소스·CLI·테스트·문서는 후속 로컬 Git commit으로 보존한다. 앱 저장소 자체에는 추가 worktree/remote가 없고 push하지 않는다. 단계 2 .tmp/stage2 CLI smoke 0CVDZz/, 단계 3 .tmp/stage3 CLI smoke zptFkI/와 최종 단계 4 .tmp/stage4 CLI smoke OrhOfS/를 검토용으로 유지한다. 모두 fixture 복사본이며 Git 제외 로컬 자료이고 원격 백업은 아니다. node_modules/dist/.tmp는 생성물이다. 일회 테스트 디렉터리는 소유 절대 경로·worktree 포함 범위를 확인해 정리한다.

UI 초안 보존: .tmp/ui-preview의 예시/앱 데이터와 .tmp/ui-e2e의 검증 예시는 Git 제외 로컬 자료다. 사용자가 저장한 초안이 생길 수 있으므로 전체 .tmp 자동 삭제를 하지 않는다. 화면 확인을 위한 preview 서버를 유지하며 종료해도 파일은 남는다.
