# 구현 상태

갱신: 2026-11-10, Asia/Seoul.

## 현재 단계와 진행 규칙

- 단계 0~2 완료, 단계 3~9 미착수, 단계 10 선택 확장.
- 사용자 지시: 순서대로 한 단계씩 진행하고 완료 후 반드시 멈춰 대기한다.
- 이번 요청인 단계 2를 완료했다. 단계 3에 자동 착수하지 않는다.
- 기준은 PROJECT_SPEC.md v1.1 전체와 REVIEW_NOTES.md다. 원본 문서 3개와 제품 core v1 schema/생성 타입은 변경하지 않았다.
- 앱 소스 Git: master. 단계 0·1 기준 commit 38470023888cff5d98dc1ab9d03bf73998b9f817을 로컬에 보존했다. 단계 2 소스·문서는 이 기준의 후속 로컬 commit에 보존한다. remote/push 없음.

## 단계 2 완료 범위

| 위치 | 실제 구현 |
|---|---|
| packages/migrations/src/registry.ts | source/target 지원표·명시 단계 경로·preflight, production/fixture 분리 |
| packages/migrations/src/fixture-codecs.ts 및 fixture-registry | 시험 core 1/2 reader, v1 의미 모델로 동등성 비교. 제품 v2 미출시 |
| packages/migrations/src/steps | fixture title/status 이동, 명시 결정이 필요한 이름 필드 분리 |
| packages/migrations/src/engine.ts | 결정 대기·재개, staging, 필수 검증, 감사 파일·결과 commit, 실패 candidate 보존 |
| packages/migrations/src/verify.ts | ID/revision/kind/의미/의존 입력/역사 기록, review/context 연속성·재검토 mapping |
| packages/migrations/schemas 및 generated-audit.ts | plan/report/decision/attestation/journal 버전 계약과 생성 타입·drift 검사 |
| packages/git-workspace | 최소 local Git runner·common-dir/worktree·exclusive metadata lock·source guard·보존 결과 정리 |
| fixtures/migrations | 독립 v1-input/v2-expected 및 manual-v1-input/manual-v2-expected |
| tools/migration-cli.ts | support/plan/run/resume, opt-in fixture registry, 종료 코드 |

단계 1의 JSON Schema/안전 YAML/DB 없는 exact·baseline·메모리 후보·불변성 기반은 유지했다. Git 파일 읽기와 캡처를 최소한 확장했고 일반 prepareChanges에 불변성 우회 권한을 추가하지 않았다.

## 실제 검증

- 최종 npm run check 통과: core/audit 생성 타입 일치, strict 타입 검사(skipLibCheck=false), 빌드, 4파일 101개 테스트.
- 테스트 구성: 단계 2 24개 + 이전 단계 77개(환경 probe 6개 포함).
- 별도 branch/worktree의 완전한 변환 commit, source HEAD/index/파일 지문 불변, 과거 commit의 v1 읽기 검증.
- 실패 주입: staging·파일 게시 중간·commit 직전. 원본 보존, 실패/의미 오류 candidate 실제 파일과 report 보존, 정리 거부.
- no-op 재실행: 추가 revision/history/commit/worktree 없음.
- 수동 결정: 미해결 대기, stale/잘못된 답 차단, 저장된 run으로 재개, 원문 의미를 바꾸는 split 거부.
- semantic/dependency mapping, review 원본 byte 보존, invalid review의 비승계, 모델 동등성 미증명 재검토.
- Git scope 환경 오염·journal guard 변조·미지원 미래 core·ignored canonical 데이터·기존 metadata lock·미보존 결과 정리 차단.
- Windows 테스트 정리의 일시 잠금은 전용 테스트 저장소 전체 소유 경로를 검증하고 재시도하도록 수정했다. 제품 cleanup은 completed/clean/보존 commit 조건을 유지한다.
- 빌드된 CLI: support 두 registry, plan/run 자동 변환, exit 3 결정 대기 → JSON 답변 → resume 완료, 두 결과의 재실행 no-op 확인.
- 최종 문서 대조: 원본 3개 SHA-256 및 제품 v1 schema/타입 무변경, 로컬 링크 30개 유효, FR 20개·AT 50개 추적표 유지 확인.

AT 추적은 현재 구현 범위에서 AT-14/15/16/18/31/39/40/50의 8개 시나리오다. fixture 변환 시험을 실제 제품 전체 인수 완료로 표시하지 않는다. AT-17/41의 cross-schema 통합과 전체 AT 회귀는 후속 단계다.

## 실제 명령

~~~powershell
npm ci
npm run check
npm run project:validate -- fixtures/migrations/v1-input
npm run migration -- support
npm run migration -- support --registry fixture
~~~

독립 Git 프로젝트의 clean commit에서:

~~~powershell
npm run migration -- plan --registry fixture --root <source> --target-core 2
npm run migration -- run --registry fixture --root <source> --target-core 2 --managed-root <managed>
npm run migration -- resume --registry fixture --root <source> --managed-root <managed> --run-id <id> --answers <answers.json>
~~~

source는 앱 저장소나 fixture 하위 폴더 자체가 아닌 독립 Git root다. 실행법·지원표·복구 절차는 MIGRATIONS.md를 따른다. 실제 사용자 데이터의 제품 v2 업그레이드에 fixture registry를 사용하지 않는다.

## 검토용 CLI 산출물

이번 실제 CLI smoke의 샘플 저장소와 성공 worktree를 .tmp/stage2 CLI smoke 0CVDZz/에 보존했다. 사용자 실제 자료가 아닌 fixture 복사본이며 Git 제외·임시 데이터다.

- 자동 변환 result: 1c5e3077c4ae36c4e234112bcbe04294333a7938.
- 수동 결정 result: 44ac39df25573e4b7767bfd0055cd43840424836.
- 각 automatic/manual 아래 source, managed/runs, managed/worktrees와 최상위 smoke-results.json에서 경로·commit을 확인한다.
- 원본 저장소는 불변이며 소스/결과 모두 각 독립 샘플 repo의 로컬 commit에 있다. 원격 백업은 아니다.
- 실패한 테스트의 잔여 폴더와 초기 probe는 명시된 소유 경로·Git 포인터를 확인해 정리했다. 현재 테스트 프로세스·모델·서버는 실행 중이지 않다.

## 현재 한계

- production registry는 core 1만 지원하고 실제 product migration 경로는 아직 없다. 시험 core 2는 별도 reader/registry에서만 읽는다.
- 의미 연속성 mapping은 통합 승인 권한이 아니다. full blocker/갱신 경고/사용자 review gate/통합 diff 승인 토큰은 후속 단계다.
- 실패·review_required·중간 crash의 자동 복구는 없다. 결정 대기만 재개하며, 나머지는 결과를 보존하고 clean source에서 새 run을 만든다.
- 현재 metadata lock은 run 전체를 직렬화한다. 일반 writer 잠금/lease, 프로세스 사망 확인·stale lock 처리, 광범위한 journal 복구는 단계 3 과제다.
- Windows 네이티브 정규 파일 중심이다. 다른 OS/.cmd/WSL/모든 Git attributes·submodule·symlink 조합을 지원 완료라고 표시하지 않는다.
- 일반 편집·프로젝트 등록/clone/task/run, SQLite 재구축·검색, REST/UI/SSE, 실제 provider/MCP/스킬/재개, 소설 시간/POV·게임 query는 후속 단계다.
- cross-schema B/T/R 정규화 통합은 단계 9. 결과 branch를 source에 자동 merge하거나 원격 push하지 않는다.
- 자동화 샌드박스 setup refresh 제약 때문에 명령은 일반 권한 경로로 실행했다. safe.directory는 명령별로 지정하며 전역 Git/CLI 설정·소유권·인증은 바꾸지 않았다.

## 다음 작업: 사용자 지시 후 단계 3만

1. Git 로컬 프로젝트 등록·안전 transport clone과 로컬 bare remote fixture.
2. task/run branch·journal·worktree, 실행 전 task/brief/초기 checkpoint commit.
3. 보존 refs/tree 기반 task 재발견과 선택된 dirty snapshot, 자동 stash 금지.
4. repo/worktree 쓰기 잠금과 owner/lease, expected digest·부분 쓰기 복구를 일반 작업 수명주기로 확장.
5. fake agent·안전한 중단/보존/정리·active target/integration 공간 분리와 비파괴 import 기반.
6. 단계 3 gate를 검증하고 상태를 남긴 뒤 다시 멈춘다. 단계 4 자동 착수 금지.

## 보존 상태

앱 코드 기준과 이번 결과는 로컬 Git commit에 남긴다. 제품 core v1·기존 fixture 및 원본 설계 3개를 보존했다. 전역 설정·remote·push·실제 사용자 프로젝트 변경은 없다. 앱 저장소의 추가 worktree는 없으며 CLI 샘플의 worktree는 각 독립 .tmp repo 소속이다.

node_modules/dist/.tmp는 Git 제외 산출물이다. 새 schema/codec/step/fixture·audit 계약과 docs/ADR은 보존해야 한다. 상세 변경 이유는 ADR-007을 따른다.
