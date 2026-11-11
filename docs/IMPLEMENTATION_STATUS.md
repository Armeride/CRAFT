# 구현 상태

갱신: 2026-11-11, Asia/Seoul. **단계 0~4 완료**, 단계 5~9 미착수, 단계 10 선택 확장이다. 사용자의 지시대로 단계 4를 완료하고 멈춘다. 단계 5는 다음 지시를 기다린다.

## 기준과 범위 구분

- 목표: PROJECT_SPEC.md v1.2 전체, REVIEW_NOTES.md. [확정 요구·설계 기준·미결정](REQUIREMENTS.md)을 구분한다. FR 22개·AT 60개는 제품 전체 기준이며 아래 테스트 수와 다르다.
- 앱 소스: master. 단계 0·1은 3847002, 2는 6a83094, 3은 906e996, 추가 기획은 2220dc5이며 단계 4를 후속 로컬 commit으로 보존한다. 앱 remote/push 없음.
- 실행 기준: Windows x64, Node 24.21.0/npm 11.19.0과 exact lockfile. 전역 설정·소유권·인증을 변경하지 않는다.
- FR-021: 진단 code/messageKey/params와 fallback 문구를 분리했다. ko/en UI catalog·언어 전환은 단계 5이며 아직 UI가 없다.
- FR-022: state_model@1 파일·호환성·참조·입력 digest/색인까지 구현했다. 평가기·상태 결과·시점/actor 전후 비교는 단계 8이다. 현재 state/state-input은 evaluatorAvailable:false다.
- 공개 core/narrative/game_design v1·core 생성 타입·기존 fixture/semantic model 1은 유지했다. 새 상태 확장과 fixture만 별도로 추가했다. 문서 v1.2는 제품 core v2가 아니다.

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

- 단계 5의 웹 UI/REST/SSE·ko/en catalog·수동 검토/통합, 실제 Codex/Claude·MCP/스킬·provider 교체는 아직 없다. i18n 구현체는 UI 착수 시 선택·고정한다.
- 상태 파일/입력·참조는 검증하지만 trigger 실행·시점/actor 상태 비교·canon/plan·confirmed/working·POV 결과 필터는 단계 8이다. author만 지원하고 character/reader 요청은 거부한다.
- 현재 diff는 metadata/ref 비교와 본문 단일 hunk다. 사용자 diff 승인 token·proposal 중복 방지·target 재검증은 단계 5, B/T/R 의미 통합·전체 장애/규모 시험은 9다.
- 그래프 전체 재분석과 요청마다 원본 hash 확인은 정확성을 위한 현재 비용이다. watcher 힌트/갱신 UI는 5, 영향 부분 최적화와 큰 자료 성능은 9에서 판단한다.
- product migration registry는 core 1만 지원한다. fixture core 2를 제품 업그레이드로 사용하지 않는다. 새 상태 계약은 선택적 추가 확장이며 자동 의미 migration은 없다.
- CLI recover는 task run용이다. import 실패의 일반 운영 복구 UI는 후속이다. 별도 integration 공간 준비는 merge/target 갱신이 아니다.
- OS lock/expected hash는 협력 앱의 경합을 다룬다. worktree는 OS sandbox가 아니다. 네트워크 볼륨/다른 OS·전원/디스크 장애 내구성은 단계 9에서 확대 검증한다.
- native 모듈은 해당 OS/ABI에서 재설치한다. remotePreserved는 local remote-tracking ref 관측이며 실시간 서버 보장이 아니다. local-only 결과는 새 clone에 없다.
- 환경 sandbox setup refresh 제약 때문에 자동화 명령은 일반 권한 실행 경로를 사용했다. safe.directory는 D:/git/CRAFT 한 명령 범위로만 설정했으며 전역 Git/CLI 설정·인증·소유권은 바꾸지 않았다.

## 다음 작업 — 사용자 지시 후 단계 5만

1. 공식 근거/설치 버전을 확인해 React/Vite·Fastify·ko/en i18n·E2E 도구를 고정한다.
2. loopback/session/Origin 검증과 REST/SSE를 기존 task/index application service에 연결한다. author 범위·scope/snapshot/freshness 계약을 유지한다.
3. 프로젝트/요소/검색/진단·working autosave·새 revision/review/baseline 선택의 수동 흐름을 만든다. 상태 파일 편집은 새 revision 규칙을 지킨다.
4. proposal idempotency·diff/HEAD 검토 token·별도 integration 검증을 연결하고 모델 없는 실제 UI 흐름을 검증한다.
5. 모든 앱 소유 문구·접근성/오류/형식화를 ko/en catalog로 제공하고 locale 전환 중 원문·초안·정본 digest 보존을 확인한다.
6. 단계 5 검증/인계 후 다시 멈춘다. 지금은 착수하지 않는다.

## 보존 상태

단계 4 소스·새 schema/fixture·CLI·테스트·문서를 로컬 Git에 commit한다. 앱 저장소 자체에는 추가 worktree/remote가 없고 push하지 않는다. 단계 2 .tmp/stage2 CLI smoke 0CVDZz/, 단계 3 .tmp/stage3 CLI smoke zptFkI/와 최종 단계 4 .tmp/stage4 CLI smoke OrhOfS/를 검토용으로 유지한다. 모두 fixture 복사본이며 Git 제외 로컬 자료이고 원격 백업은 아니다. node_modules/dist/.tmp는 생성물이다. 일회 테스트 디렉터리는 소유 절대 경로·worktree 포함 범위를 확인해 정리한다.
