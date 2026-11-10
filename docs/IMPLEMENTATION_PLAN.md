# 구현 단계와 각 단계별 목표

기준: [명세 v1.1 18~19절](../PROJECT_SPEC.md). 단계 0~2 완료, 단계 3~9 미착수다. 사용자의 후속 지시에 따라 **한 단계 완료 후 작업을 멈추고 대기**한다. 다음 단계에 자동 착수하지 않는다. 기간 추정은 확정하지 않는다.

## 순서와 통과 원칙

의존 순서는 **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**다. 10은 선택 확장이다. 단계 2는 최소 Git/worktree 어댑터를 선행 구현하고 단계 3에서 수명주기를 완성한다. 소설·게임 스키마는 단계 1부터 포함하며 조회 계산·UI 완성은 단계 8이다. 앞 단계의 검증 실패를 남겨 둔 채 다음 단계로 넘어가지 않는다.

제품 구조는 명세 17절을 따르되 빈 패키지를 미리 늘리지 않는다. 먼저 domain/schema/project-fs/migrations/git 경계를 만들고, 실제 기능이 생길 때 indexer/context/agent/apps를 추가한다. domain은 Node·Bun·SQLite·공급자 API에 직접 의존하지 않는다. UI/REST/MCP는 같은 application service를 호출한다.

## 단계 0 — 환경과 기술 기준

**목표:** 제품 구현을 시작할 수 있는 재현 가능한 개발 기반 확보.

- 산출물: 로컬 Git 초기화, 고정 Node/npm/lockfile, TypeScript strict ESM, Vitest, 환경 probe, 개발 문서, ADR-001~005.
- 통과 기준: 실제 typecheck/build/test 성공, UTF-8/한국어·공백 경로 I/O, SQLite FTS5/rollback, Ajv Draft 2020-12, native spawn 인수 전달 확인.
- 현재 결과: 완료. 제품 코드·실제 모델 호출 없음. OS 잠금·프로세스 트리 종료·`.cmd` shim은 후속 검증 대상이며 현재 probe의 보장 범위가 아니다.

## 단계 1 — 파일 계약·검증·DB 없는 정확 조회

**목표:** 정본 파일의 의미와 참조를 기계적으로 확인하고 DB 없이 읽기.

- 산출물: project/entity/revision/Reference/SnapshotTarget/baseline/review/task/checkpoint/proposal/sequence/스킬·MCP manifest/lock/history/context 입력의 v1 계약과 필수 narrative/game 확장. JSON Schema를 기준으로 타입 생성 또는 계약 테스트.
- 안전 YAML AST 로더: 중복 key/tag/alias/anchor/merge, 비JSON·비유한 수치, 크기/깊이 초과 거부. writer는 결정적 UTF-8/LF, 읽기만으로 저장하지 않음.
- ID/경로·symlink/body_path/anchor/본문 ref 검증, 부모 DAG, 중복 ID/ref ID, 선언된 확장 참조 추출, scope/baseline 구조 검사.
- snapshot/fingerprint/변경 세트와 Git 기준 리비전 불변성 검사, unknown required/optional 확장 보존 및 쓰기 제한. semantic model v1 포함 필드·기본값·배열 순서·digest 계약 고정.
- fixture: valid-minimal, narrative, game-design, invalid-references, 안전 파싱/경로 오류, unsupported extension. 참조·검토를 포함한 실제 실행 가능 프로젝트 작성.
- 통과 기준: DB 없는 exact/baseline 조회, 위치가 있는 오류, 무변경 round-trip diff 없음, 기본값/metadata의 조용한 수정 없음. 미래 포맷을 지원한다고 오표시하지 않음.
- 추적: FR-001/003/004/016 기반. AT-28/31/46/50 기반, AT-29/32/48 구조 계약.
- 현재 결과: 완료. JSON Schema 타입 생성, 안전 YAML·파일 snapshot, exact/baseline, Git 불변성 비교, 메모리 변경 세트, 소설·게임 fixture 구현. 전체 77개 테스트(환경 6개 포함) 통과. AT-31/50 범위를 검증했으며 나머지 관련 AT는 후속 기능과 결합해 검증한다.

## 단계 2 — migration과 최초 복원 수직 흐름

**목표:** 형식이 바뀌어도 정본과 의미를 잃지 않는 변환 기반 완성.

- 산출물: schema read/write/migrate 지원표, registry, preflight/transform/verify, 결정 파일, lock/history/attestation, 실패 보고서.
- 최소 Git fixture 및 전용 migration worktree 어댑터. 다중 파일 staging, 변환 중 활성 프로젝트 노출 금지, 원본 불변·실패 결과 보존.
- fixture 전용 registry에서 v1→v2 이동/enum/수동 필드 분리 시험. 제품 v2를 출시하거나 공개 v1을 재정의하지 않음.
- 통과 기준: 별도 worktree 변환 성공, 원본 hash 동일, 재실행 no-op, 미해결 필수 결정 대기, 미래 schema 쓰기 차단, 과거 Git 원본 읽기. 의미 보존 시 ID/revision/parents 유지, semantic/dependency digest와 mapping 검증.
- 추적: FR-017, AT-14~18/39~40. cross-schema 실제 통합은 단계 9에서 완성.
- 첫 수직 흐름: 예시 Git 프로젝트 → 구조·참조 검증 → exact/baseline 조회 → 전용 worktree 형식 변환 → 의미·참조 검증 → 원본/결과 보존 확인.
- 현재 결과: 완료. production/fixture registry 분리, preflight/transform/verify, 수동 결정 대기·재개, Git worktree/staging/결과 commit, 원본/index 보존, no-op, 미래 버전 차단, history/attestation·의미 mapping을 구현했다. 4파일 101개 테스트 및 빌드 CLI smoke 통과. [구체 계약](MIGRATIONS.md)을 따르며 실제 제품 v2/통합/crash 자동 복구는 포함하지 않는다.

## 단계 3 — Git 프로젝트·작업 격리·보존

**목표:** 두 작업이 원본이나 서로의 결과를 훼손하지 않도록 실행 공간과 복원 경계 확보.

- 로컬 등록, 안전 transport clone, 로컬 bare remote fixture, linked worktree/common-dir, 공백·한국어·이동 경로 지원.
- task/run/branch/worktree/journal, 모델 전 task/brief/초기 checkpoint commit, refs/tree 작업 재발견. 마지막 commit 기준 및 선택된 dirty 스냅샷, 자동 stash 금지.
- repo 단위 metadata 잠금, worktree 단위 쓰기 잠금, OS owner/lease, expected hash와 부분 쓰기 복구. timeout만으로 잠금 탈취 금지.
- fake agent, 중단·실패 checkpoint, 보존 commit/untracked 확인 후 정리, active target과 integration worktree 분리.
- 기존 Markdown/text 비파괴 import를 전용 브랜치에서 제공할 준비 및 명시 import application command. 원본 유지·추출 제안만 허용.
- 통과 기준: 동시 두 작업의 파일 독립, 원래 index/staged/unstaged/untracked 불변, worktree 없이 refs로 복원, 로컬/remote 보존 구분.
- 추적: FR-002/010/015, AT-11/19~20/27~28/30/38/47.

## 단계 4 — 재구축 색인·참조·상태·검색

**목표:** 파일에서만 파생된 정확한 조회·진단·검색 제공.

- SQLite 전체/증분 generation, 파일 집합 고정, 실패 시 이전 정상 색인 보존 및 stale 명시. basis/working snapshot과 scope 권한 토큰 분리.
- 직접·간접 역참조, SCC 유한 전파·원인 경로·직접 status 보존, update_policy/parents/scope에 맞는 새 버전 경고, 자동 pin 교체 금지.
- baseline 적용 의존 폐쇄성, 인용/evidence의 과거 exact 허용, deprecated 채택·분기·release cycle 검사, review와 semantic/dependency 입력 유효성.
- ID/별칭 NFC exact, FTS5 한국어 실제 원고·짧은 이름 경로, diff API 기반. SQLite 동기 작업의 worker 분리 필요성 측정.
- 통과 기준: DB 삭제 전후 지식·참조·진단·작업 결과 동일, clone/worktree 검색 비혼합, SOURCE_CHANGED/INDEX_STALE 정확 표시, 1~2글자 별칭 조회, review 없는 approved의 release 차단.
- 추적: FR-004~007/016/019, AT-01/07~11/24/26/32~33/37/42~44/48.

## 단계 5 — 모델 없이 끝나는 웹 수동 흐름

**목표:** 사용자가 웹에서 초안을 만들고 실제 diff를 검토해 통합.

- React/Vite, Fastify REST·SSE, loopback·session/Origin 검증, 표준 오류, SSE cursor/reconnect.
- 프로젝트 열기/개요/요소·리비전·검색·참조·진단 화면, 명시 import, task working autosave와 충돌, 새 revision·review·baseline 선택.
- proposal idempotency, 검토 토큰(source/target/diff/review), 통합 전 expected fingerprint와 head 재검증, 별도 integration worktree. migration plan/report 화면.
- 통과 기준: 모델 없이 규칙 초안→상태 전파→사용자 review→통합, 새로고침 후 초안 복구, 참조 변경 후 본문 검토 유지, target 변경·중복 proposal 처리. Playwright 등 E2E 도구를 이때 버전 고정.
- 추적: FR-003/012/018/020, AT-12~13/21~22/25/28/44~47.

## 단계 6 — 에이전트와 내부 MCP

**목표:** 두 실행기 각각에서 전용 worktree의 자료로 작업하고 검증 가능한 변경안 생성.

- agent-core fake/capability/events, Codex App Server, Claude structured CLI(필요하면 공식 SDK). 설치·버전·인증 상태를 분리.
- installed protocol schema/help·공식 문서 확인, 민감 정보 제거 raw event fixture. native executable/Windows shim 인수·interrupt→유예→프로세스 트리 종료 실험.
- MCP의 search/entity/reverse/context/checkpoint/propose/validate가 같은 서비스 호출. 서버 측 run scope 바인딩, cwd/index/MCP 일치, 추가 조회 snapshot 기록.
- 통과 기준: UI 지시→전용 worktree→내부 MCP→proposal→검증→사용자 검토, 두 공급자별 명시 동의 smoke. 인증 실패/미설치/잘못된 이벤트/취소·강제 종료 처리. 종료 0이어도 invalid 결과 반영 금지.
- 추적: FR-011/012/014/015/020, AT-11/20/25/28/37/44. 모델 없는 반복 검증은 fake 사용.

## 단계 7 — 재개·스킬·외부 MCP

**목표:** 앱·공급자 세션을 잃거나 공급자를 바꿔도 작업 의미 복원.

- checkpoint/context manifest/재문맥화, 기본 스킬 5종(project-resume/design-document/scene-writing/change-impact/consistency-review), 출처·version/digest·provider overlay.
- 외부 MCP profile/allowlist/credential reference, 정책 선택 후 활성화, 로컬 fixture MCP로 side effect/idempotency/job 상태 시험.
- 앱 재시작·브라우저 재접속·provider 교체. pending 승인 자동 재사용 금지, 외부 결과 불명은 external_state_unknown.
- 통과 기준: DB/공급자 세션/운영 로그 삭제 후 목표·초안·결정·다음 행동 복원, Claude↔Codex 재개, proposal·관리 MCP 부작용 중복 방지. 직접 shell/API의 보장 한계 명시.
- 추적: FR-010/012~014/019, AT-02/22/27/38/49.

## 단계 8 — 소설과 게임 조회·문맥 완성

**목표:** 두 도메인의 시간·관점·scope 규칙이 실제 집필/기획 흐름에서 작동.

- narrative sequence/scene boundary/world_tick/event_order, profile/initial_state, 선택 canon 사건 재생, confirmed/working과 provisional.
- truth/knows/believes/suspects/explicitly_unaware/unrecorded, author/character/reader 필터를 제목·snippet·근거·연결/MCP까지 적용. 미래 초기값 유출 금지.
- 게임 baseline/scope·단위·범위·구조/본문/ref diff·결정/evidence·build observation 분리, 모호한 후보·시점에 추정값 금지.
- 두 도메인 UI·예시 프로젝트·typed query와 자연어/명령 편의 표현. 강한 POV 비밀 격리 프로필은 원본 읽기 제한을 별도 검증하고 일반 모드 한계 표시.
- 통과 기준: 미래 작성 뒤 과거 상태 불변, 회상 world/reader 순서 독립, 계획은 사건 아님, draft는 provisional, 동률 충돌·불완전 timeline·근거 변경 진단, PvP 후속이 PvE에 오전파하지 않음.
- 추적: FR-001/007~009/020, AT-03~06/23/29/34~36/48.

## 단계 9 — 전체 통합·장애·성능·배포 기준

**목표:** 실제 파일 손실·충돌·schema 변경 상황에서도 보존·복구 가능한 초기 제품 검증.

- 공통 조상 B/target T/result R의 동일 schema 정규화 3-way. 미지원은 MIGRATION_MERGE_UNSUPPORTED, 원본/작업 보존·새 기준 재작성 경로.
- semantic model/digest mapping과 review 승계/재검토, head/diff 변경 재승인, 무충돌 Git의 의미 충돌.
- 취소/crash/디스크 쓰기 오류/MCP 연결 단절/외부 결과 불명 주입, immutable 수동 편집 탐지, 잠금 owner 사망/부분 journal 복구.
- 1,000요소/10,000리비전 fixture, 잠정 성능 실측·미달 사유·개선. 설치/업데이트/schema 지원표/백업/복구 절차.
- 통과 기준: **AT-01~50 전체 실제 통과**, 두 실제 공급자 지원 범위와 smoke 결과 명시, 명세 23절 8개 완료 조건 충족. 새 clone에는 push된 refs만 있다는 한계 명시. 기본 자동 push 없음.
- 추적: FR 전체 회귀, 특히 FR-005/017/018. AT-12~22/28/39~46/49 및 전체 회귀.

## 단계 10 — 선택 확장

의미 검색/reranking, Bun·WSL, 원격 UI/로컬 runner pairing, 교차 repo 참조, 고급 그래프·수치 검산, 협업/PR·선택적 자동 통합. 핵심 제품 완료를 대체하지 않는다. 필요·실측 결과·별도 사용자 범위에 따라 선택한다.

## 인수 시험 실행 책임표

번호 누락을 막기 위한 주 완료 단계다. 모든 AT는 단계 9에서 다시 실행한다. **현재 구현 범위에서 AT-14/15/16/18/31/39/40/50의 8개 시나리오를 검증**했다. fixture registry의 검증을 제품 전체 인수 완료로 취급하지 않는다. 환경 probe 6개는 AT가 아니다.

| AT | 주 완료 단계 | 검증 목표 |
|---|---|---|
| AT-01 | 4 | clone 후 DB 없는 재구축 |
| AT-02 | 7 | DB·provider 세션 없는 resume |
| AT-03 | 8 | 과거 시점에 미래 상태 혼입 금지 |
| AT-04 | 8 | 실제 진실과 믿음 분리 |
| AT-05 | 8 | 무지와 unrecorded 분리 |
| AT-06 | 8 | POV 본문·연결·제목 누설 방지 |
| AT-07 | 4 | draft 간접 의존 경로·직접 상태 보존 |
| AT-08 | 4 | 폐기안 비교의 비차단 |
| AT-09 | 4 | 승인 후속 경고·자동 교체 금지 |
| AT-10 | 4 | 형제 리비전 분기 |
| AT-11 | 6 | 파일·색인·MCP 완전 작업 격리 |
| AT-12 | 9 | 통합 의미 충돌 |
| AT-13 | 5 | 참조 변경 뒤 본문 검토 유지 |
| AT-14 | 2 | migration 실패 원본 불변 |
| AT-15 | 2 | migration no-op |
| AT-16 | 2 | 수동 의미 결정 대기 |
| AT-17 | 9 | 구 schema 작업의 신 schema 통합/보류 |
| AT-18 | 2 | 미래 schema 수정 차단 |
| AT-19 | 3 | dirty/index 원본 보존 |
| AT-20 | 6 | 취소 완료 확인·보존 후 정리 |
| AT-21 | 5 | BASE_CHANGED 재검증 |
| AT-22 | 5 | proposal 중복 방지 |
| AT-23 | 8 | 게임 mode/platform 선택 |
| AT-24 | 4 | 한국어 짧은 별칭 |
| AT-25 | 6 | 오프라인 fake UI~통합 |
| AT-26 | 4 | 재구축 중 파일 변경 generation |
| AT-27 | 7 | 보존 브랜치에서 worktree 재개 |
| AT-28 | 6 | 경로 탈출·허용 범위 밖 수정 차단 |
| AT-29 | 8 | 과거 장면 근거 수정/삭제 |
| AT-30 | 3 | 로컬/원격 보존 차이 |
| AT-31 | 1 | 확장 관계의 완전 Reference |
| AT-32 | 4 | 과거 인용과 적용 의존 폐쇄성 분리 |
| AT-33 | 4 | draft 핀 blocker 유지 |
| AT-34 | 8 | 활성 canon/plan·confirmed/working |
| AT-35 | 8 | 동일 시간·순서의 충돌 |
| AT-36 | 8 | 작중 시간·reader 공개 독립 |
| AT-37 | 6 | basis/working와 MCP snapshot |
| AT-38 | 7 | refs/tree의 task 재발견 |
| AT-39 | 2 | source 변경·semantic 동일 review mapping |
| AT-40 | 2 | 의미 동등성 미증명 재검토 |
| AT-41 | 9 | 동일 schema B/T/R 정규화 |
| AT-42 | 4 | 미채택 deprecated의 비전파 |
| AT-43 | 4 | blocking cycle release 차단 |
| AT-44 | 5 | approved만으로 사용자 review 우회 금지 |
| AT-45 | 9 | 변경 diff/commit 승인 재사용 금지 |
| AT-46 | 9 | 수동 수정 불변성·migration 예외 |
| AT-47 | 5 | 기존 Markdown 비파괴 import |
| AT-48 | 8 | scope 모호성·임의 선택 금지 |
| AT-49 | 7 | 외부 결과 불명·재전송 금지 |
| AT-50 | 1 | 안전 YAML 오류와 위치 |

각 단계 완료 시 `IMPLEMENTATION_STATUS.md`에 구현 위치/요구 ID, 실제 명령·결과, 실패·한계, 다음 행동, 미보존 파일·브랜치 상태를 남긴다. 기능 지원 표현은 실제 검증 범위까지만 사용한다.
