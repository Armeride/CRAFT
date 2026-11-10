# 구현 상태

갱신: 2026-11-10, Asia/Seoul.

## 현재 단계와 진행 규칙

- **단계 0~3 완료**, 단계 4~9 미착수, 단계 10 선택 확장.
- 사용자 지시: 순서대로 한 단계씩 진행하고 완료 후 반드시 멈춰 대기한다.
- 이번 요청인 단계 3을 완료했다. 단계 4에 자동 착수하지 않는다.
- 기준은 PROJECT_SPEC.md v1.1 전체와 REVIEW_NOTES.md다. 확정 요구·설계 기준·미결정 구분은 [REQUIREMENTS.md](REQUIREMENTS.md)를 유지한다.
- 원본 문서 3개와 제품 core v1 schema/생성 타입, 기존 fixture는 변경하지 않았다.
- 앱 소스 Git: master. 단계 0·1 기준 3847002, 단계 2 결과 6a83094의 후속 로컬 commit에 이번 소스·문서를 보존한다. 앱 remote/push 없음.

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

## 실제 검증

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
- 원본 3개 SHA-256, 제품 core v1 및 기존 fixture 무변경, FR 20개·AT 50개 추적과 문서 링크를 대조했다.

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

- SQLite/증분 색인·검색·상태 전파, REST/UI/SSE, 실제 Codex/Claude·MCP/스킬·provider 교체는 미구현이다. fake 결과를 실제 에이전트 지원으로 표시하지 않는다.
- integration은 별도 공간 준비까지만 한다. 검토 승인·proposal 적용·target 갱신·B/T/R 정규화는 단계 5/9다.
- product registry는 core 1만 지원한다. fixture core 2를 실제 제품 업그레이드로 사용하지 않는다. migration failed/review_required 자동 복구 정책은 변경하지 않았다.
- CLI recover는 task run용이다. import 실패는 operation/worktree/journal을 보존하며 자동 재실행·정리하지 않는다. 일반 import 운영 복구 UI는 후속 단계다.
- OS lock/expected hash는 협력하는 앱의 경합을 다룬다. worktree는 악의적인 로컬 프로세스를 차단하는 OS sandbox가 아니다. 네트워크 볼륨·다른 OS·전원 장애/디스크 오류의 전체 내구성은 단계 9에서 확대 검증한다.
- native 모듈은 해당 OS/ABI에서 재설치한다. Windows 파일 교체는 일시 오류만 제한 재시도하며 target 선삭제 fallback은 없다.
- remotePreserved는 local remote-tracking refs가 가리키는 정확 commit의 관측이다. 현재 서버 상태의 실시간 보증이 아니며 local-only 작업은 새 clone에 없다.
- 이 환경은 populated .git 부모 폴더의 직접 rename을 거부했다. 앱은 폴더 이동을 실행하지 않고, 외부 이동 뒤 경로 재등록·repair를 제공한다.
- 샌드박스 setup refresh 제약으로 자동화 명령을 일반 권한 경로에서 실행했다. safe.directory는 명령별로 제한하며 전역 Git/CLI 설정·소유권·인증은 바꾸지 않았다.

## 다음 작업: 사용자 지시 후 단계 4만

1. 파일에서 재구축 가능한 SQLite 색인과 generation/snapshot 경계를 만든다.
2. 전체/증분 갱신·외부 변경·INDEX_STALE/SOURCE_CHANGED 및 실패 시 이전 정상 색인을 보존한다.
3. 역참조/SCC 상태 전파·원인 경로·갱신 경고와 baseline 의존 폐쇄성 검사를 구현한다.
4. NFC exact/짧은 한국어 별칭·FTS5 실원고 검색·diff API를 검증한다.
5. DB 삭제 전후 결과 동일·clone/worktree 비혼합 gate를 통과한 뒤 다시 멈춘다.

이번 작업은 여기서 멈춘다. 단계 4를 먼저 시작하지 않는다.

## 보존 상태

이번 소스·runtime 계약·CLI·tests·문서는 로컬 Git에 commit한다. 앱 저장소 자체에는 추가 worktree가 없고 remote/push도 없다. 테스트 전용 저장소와 일회 probe는 소유 경로를 확인해 정리하며 CLI 샘플만 검토용으로 남긴다. node_modules/dist/.tmp는 Git 제외 산출물이다. 상세 결정은 [ADR-008](adr/008-task-workspaces-and-write-leases.md)을 따른다.
