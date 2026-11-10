# 단계 3 — Git 프로젝트와 작업 보존

기준: 명세 10~11·16·18절, REVIEW_NOTES R-08/09/18/19. 웹 UI·실제 모델·SQLite가 없는 application command 단계다. [ADR-008](adr/008-task-workspaces-and-write-leases.md)에 설계 이유를 기록한다.

## 요구와 설계의 구분

- 확정 요구: 실행별 branch/worktree, 실행 전 목표·brief·초기 checkpoint commit, 원본 dirty/index 보존, Git에서 작업 재발견, 비파괴 import, 보존 확인 후 정리.
- 채택한 설계: Node 네이티브 파일 잠금, repo metadata와 worktree 쓰기 잠금 분리, 파일 digest 검사와 forward journal 복구, 원본 HEAD 기본값 및 명시 경로 snapshot, fake 실행기와 별도 integration 공간.
- 후속 결정: 실제 provider interrupt/process-tree 종료, UI 검토·승인·통합 토큰, 전체 문맥 재구성과 provider 교체, SQLite 색인, 전원 장애·네트워크 파일시스템·다른 OS의 내구성. 단계 4~9에서 검증하며 현재 지원으로 표시하지 않는다.

## 식별자와 저장 위치

`project_id`는 Git 정본에 있고 경로가 바뀌어도 유지된다. `reg_*`는 앱이 등록한 로컬 checkout, `task_*`는 목표, `run_*`는 실행, `wt_*`는 그 실행 공간이다. 같은 프로젝트를 다른 경로로 clone하면 별도 registration을 만든다. 등록은 Git worktree root를 요구하며 linked worktree의 `.git` 파일과 common-dir를 Git 명령으로 해석한다.

로컬 데이터는 명시한 `--app-data`에 둔다. 사용자 프로젝트 안에 worktree를 중첩하지 않는다.

~~~text
<app-data>/
  registrations/reg_*.json
  runs/run_*/run.json
  runs/run_*/execution.lock[.owner.json]
  runs/run_*/transactions/tx_*.json
  worktrees/run_*/
  operations/<operation-id>.json
  operations/<import-id>/transactions/tx_*.json
  snapshots/snap_*/
  imports/op_*/
  integrations/op_*/
  managed-repositories/repo_*/
~~~

운영 JSON은 별도 runtime v1 schema에서 생성한 타입과 검증을 사용한다. 제품 core v1과 migration audit 계약은 바꾸지 않았다. 운영 경로·PID·잠금 heartbeat는 프로젝트 정본의 일부가 아니다.

영구 작업은 `workbench/task/<task-id>/<run-id>` branch의 `tasks/<task-id>/`에 있다. `task.yaml`, `brief.md`, `working/`, `checkpoints/`, 입력 manifest 및 proposals를 Git에 보존한다. 앱 DB·registration·운영 로그·공급자 세션은 Git에 보존된 목표와 초안의 복원에 필수가 아니다. commit 전 dirty 파일은 해당 worktree를 유지해야 한다.

## 열기와 clone

빌드 후 CLI를 사용한다. 아래의 경로와 ID는 실제 반환값으로 대체한다.

~~~powershell
npm run workspace -- open --app-data D:/craft-local --root D:/my-project
npm run workspace -- clone --app-data D:/craft-local --url https://example.org/project.git
npm run workspace -- tasks --app-data D:/craft-local --registration reg_...
~~~

등록은 커밋된 tree를 검사한다. manifest가 없으면 `import_required`, 초기 commit이 없으면 `unborn`, 해석 불가능하면 `invalid`/`unsupported`다. 열기만으로 manifest·commit·스키마를 생성하거나 덮어쓰지 않는다. 지원하는 커밋 기준의 프로젝트만 task를 시작한다.

clone은 HTTPS/SSH 및 제한된 SCP 표기를 허용한다. option/remote-helper/file/git/http URL과 URL 내 비밀번호 등을 거부한다. hooks/template/filter/submodule checkout을 피하고 `--no-checkout` 뒤 검증한 raw Git bytes를 materialize한다. 기본 push/fetch 재시도·외부 credential 설정 변경은 없다. HTTPS/SSH 실제 네트워크·인증 smoke는 이번 단계에서 수행하지 않았다.

오프라인 시험에 한해서 `file:` URL과 `--fixture-bare true`를 함께 주며 대상이 실제 bare 저장소인지 확인한다. 임의 로컬 폴더 transport를 기본으로 열지 않는다.

## 시작·작성·중단·재개

~~~powershell
npm run workspace -- start --app-data D:/craft-local --registration reg_... --goal "개요의 다른 초안 작성"
npm run workspace -- fake --app-data D:/craft-local --run run_... --entity ent_overview --body-file D:/inputs/draft.md
npm run workspace -- save --app-data D:/craft-local --run run_... --file memo.md --body-file D:/inputs/memo.md --expected-digest null
npm run workspace -- checkpoint --app-data D:/craft-local --run run_...
npm run workspace -- cancel --app-data D:/craft-local --run run_...
npm run workspace -- status --app-data D:/craft-local --run run_...
~~~

`start`는 task/run journal과 별도 worktree를 만들고 task·brief·초기 checkpoint를 commit한 뒤 `queued`를 반환한다. 초기 commit이 없는 실행은 fake를 시작할 수 없다. fake는 먼저 작업 초안을 저장하고, 기존 baseline이 가리키는 revision을 부모로 하는 **새 draft revision**과 add_revision proposal을 만든다. 기존 revision/status/review/baseline pin은 바꾸지 않는다. 최종 검증 후 결과 checkpoint와 파일을 commit한다. 실제 agent의 능력이나 OS sandbox를 제공하지 않는다.

같은 저장소의 두 run은 서로 다른 worktree·branch·working 파일을 쓴다. 짧은 Git metadata 변경만 repo 잠금으로 직렬화한다. fake가 실행 중이면 같은 run의 중복 실행·복구·정리를 execution OS lock으로 차단한다. 완료한 run의 fake 재실행도 거부한다.

`save`의 경로는 해당 task의 `working/` 아래 상대 경로다. 처음 만들 때 `null`, 수정할 때 이전 SHA-256을 요구한다. 현재 파일 hash가 다르면 `FILE_CHANGED_EXTERNALLY`로 중단한다. `cancel`은 먼저 `cancelling`을 기록하며 실행기가 중단을 확인하고 checkpoint를 보존한 뒤 `cancelled`가 된다. CLI의 fake는 테스트 실행기이고 실제 provider 강제 종료는 단계 6이다. 대기 중 취소된 run도 실행기 또는 recover가 보존 상태를 확정한다.

~~~powershell
npm run workspace -- recover --app-data D:/craft-local --run run_...
npm run workspace -- resume --app-data D:/craft-local --registration reg_... --task task_... --ref refs/heads/workbench/task/task_.../run_... --commit <보존된-commit>
~~~

`recover`는 살아 있는 execution 잠금을 빼앗지 않는다. journal을 복구한 후 `interrupted` checkpoint를 남기고 모델을 자동 재실행하지 않는다. Git commit 직후 로컬 run.json 갱신만 끊겼다면 같은 run의 checkpoint·공통 조상·파일 hash를 확인해 보존 commit을 재연결한다. 안전성을 입증할 수 없으면 폴더를 유지하고 명시적인 Git checkpoint 선택을 요구한다. 초기 준비가 정본 task/checkpoint를 쓰기 전에 중단되었다면 실행을 시작하지 않고 원본에서 새 task를 만든다.

`resume`는 refs/tree에서 찾은 task와 사용자가 고른 조상 commit을 읽어 **새 run/worktree**를 만든다. 목표·출력·과거 base와 checkpoint는 유지하고 새 초기 checkpoint를 추가한다. 오래된 run/provider session을 자동 부활시키지 않는다. 이 단계의 기본 Git 복원은 단계 7의 공급자 교체·스킬/전체 문맥 재구성을 대체하지 않는다.

## dirty와 잠금·복구

기본 시작점은 선택한 target ref의 마지막 commit이다. source의 staged/unstaged/untracked를 옮기거나 stash하지 않는다. 포함하지 않은 변경은 `omittedWorkingChanges`에 표시한다. 명시적으로 포함하려면 JSON 배열 파일에 정확한 상대 경로를 적는다.

~~~json
["README.md", "참고/선택 메모.txt"]
~~~

~~~powershell
npm run workspace -- start --app-data D:/craft-local --registration reg_... --goal "선택한 원고 포함" --selection D:/inputs/selected.json
~~~

선택된 현재 바이트/삭제만 별도 `workbench/snapshot/snap_*`에 commit한다. 그 snapshot을 새 run의 기준으로 쓴다. 기존 저장 리비전·review·checkpoint 변경은 snapshot에서도 허용하지 않는다. 원본 index와 선택하지 않은 파일은 그대로 남긴다.

잠금은 common-dir의 `craft/locks/metadata.lock`과 worktree별 lock에 둔다. stable lock 파일을 삭제하지 않고 **커널의 배타 잠금 획득**을 소유권 근거로 삼는다. sidecar에는 token/PID/host/획득·heartbeat·release 시각을 남긴다. heartbeat 만료나 PID만으로 강탈하지 않으며 프로세스 사망 뒤 커널이 잠금을 풀어 준 경우에만 새 owner가 획득한다. metadata contention은 최대 30초 동안 release를 기다리고, worktree contention은 `WORKTREE_BUSY`로 반환한다. 실패·경로 링크·위조 lease는 쓰기를 차단한다.

일반 쓰기는 전체 후보의 구조·참조·불변성을 먼저 검증하고, expected snapshot/파일 hash, scope/branch와 before/after bytes를 journal에 기록한다. 파일별 임시 파일·sync·close·rename으로 교체한다. 미완료 journal이 있으면 읽기와 새 쓰기를 `RECOVERY_REQUIRED`로 막는다. 복구는 현재 bytes가 before/after 중 하나임을 확인한 파일만 앞으로 적용한다. 제3의 외부 편집이나 무관한 파일 변경은 덮어쓰지 않고 충돌로 남긴다. 새로 저장한 아직 미커밋 리비전도 applied journal의 hash로 보호한다.

운영 transaction JSON은 before/after 바이트를 포함하므로 일반 정본 YAML의 2 MiB 제한과 분리해 64 MiB/100만 노드로 제한한다. 상한 초과는 파일 게시 전에 거부한다. 2 MiB를 넘는 journal을 만드는 한국어 초안의 중단·재개도 시험한다.

Windows의 `EPERM`/`EACCES`/`EBUSY`에 한해 같은 rename을 약 2초 이내로 재시도한다. 기존 파일을 먼저 삭제하는 fallback은 없다. 다중 파일 게시를 파일시스템 transaction으로 오인하지 않으며, 프로세스 중단 복구와 전원 장애의 완전 내구성을 구분한다.

migration도 같은 metadata OS lock을 사용한다. 단계 2의 legacy `craft-migration.lock` sentinel이 남아 있으면 자동 탈취하지 않는다. migration 자체의 failed/review_required 복구 정책은 [MIGRATIONS.md](MIGRATIONS.md)를 유지한다.

## 정리·이동·통합 공간

~~~powershell
npm run workspace -- clean --app-data D:/craft-local --run run_...
npm run workspace -- relocate --app-data D:/craft-local --registration reg_... --root D:/moved-project
npm run workspace -- integration --app-data D:/craft-local --registration reg_... --result-commit <결과-commit>
~~~

`clean`은 app 소유 경로/branch/common-dir, 중단 확인 상태, 보존된 head/checkpoint, 미완료 journal 부재, working bytes와 commit의 일치를 확인한다. untracked/ignored 파일도 검사한다. Git의 일반 worktree remove를 사용하며 force/prune/branch 삭제는 하지 않는다. dirty·실행 중·보존 불명은 유지한다. 운영 로그를 지워도 branch가 있으면 작업 재발견과 새 run 복원이 가능하다.

등록 경로 이동은 모든 실행을 멈춘 뒤 사용자가 외부에서 수행한다. `relocate`는 이전 경로 부재와 동일 project_id를 확인하고 `git worktree repair` 후 registration 경로를 갱신한다. 이동 자체를 실행하는 명령은 아니다. 이번 Windows 환경에서 populated `.git` 부모 폴더 rename이 거부되어 테스트는 fixture 소유 경로를 확인한 **복사→이전 경로 제거**로 이동을 만들었다. 한국어·공백 새 경로와 기존 linked worktree의 재연결은 검증했다.

`integration`은 target의 현재 commit으로 **별도 integration worktree**를 준비한다. active target이 dirty여도 그 파일/index를 건드리지 않는다. 아직 merge·승인·target ref 갱신은 하지 않는다. 실제 검토와 B/T/R 통합은 단계 5/9다.

## 비파괴 import

~~~powershell
npm run workspace -- import --app-data D:/craft-local --registration reg_... --selection D:/inputs/import.json --name "소설 기획"
~~~

선택 파일은 해당 저장소의 **커밋된** Markdown/text여야 한다. `workbench/import/op_*`의 별도 worktree에서 기존 문서 바이트를 유지하고 `document` 요소와 draft revision을 추가한다. manifest가 없는 경우 core v1 프로젝트·lock·working baseline을 추가한다. 기존 프로젝트는 기존 기본 baseline/revision/review를 유지하며 별도 import working baseline을 만든다. 기존 경로 충돌·미지원 형식·unborn은 자동 덮어쓰기하지 않고 거부한다.

`craft.import@1` 선언형 확장에 source_path/source_commit/source_digest와 body_transform을 기록하고 스키마 bytes를 lock으로 고정한다. 원본 frontmatter를 메타데이터로 추출하지 않으며 본문에는 출처 머리말을 붙인다. 본문 복사본은 LF로 정규화하고 `[[ref:`/HTML 시작 문자를 literal로 escape해 임의의 정본 참조/anchor로 해석하지 않는다. **원본 파일은 BOM/CRLF까지 그대로 남긴다.** 사실·인물·관계를 자동 확정하거나 approved/review를 만들지 않는다. 결과 branch/worktree를 검토하고 필요하면 그 worktree를 별도로 등록할 수 있다. 원본 branch로 자동 통합하지 않는다.

import의 다중 파일 후보도 공통 journal writer를 통과한다. 실패한 operation/worktree/journal은 보존하고 자동 재실행·자동 정리하지 않는다. CLI `recover`는 task run용이며, import 실패의 일반 UI/운영 복구 흐름은 후속 단계에서 확장한다.

## 로컬과 원격 보존

`discoverTasks`는 local task branch와 remote-tracking task refs, HEAD의 task/checkpoint tree를 검사한다. 같은 task의 여러 run을 나열하며 timestamp로 하나를 임의 선택하지 않는다. 잘못된 한 branch tip이 다른 작업을 숨기지 않으며 필수 schema/불변성을 입증하지 못하면 실행 가능하다고 표시하지 않는다.

`localPreserved`는 현재 clone의 HEAD/local ref에, `remotePreserved`/remoteRefs는 현재 clone에 기록된 **remote-tracking ref와 정확히 같은 commit**에 대한 표시다. 마지막 fetch/clone 때의 관측이며 현재 서버 상태를 실시간 보증하지 않는다. 이 앱은 자동 push하지 않는다. 새 clone에는 원격에 보낸 refs의 작업만 있으며 로컬 전용 task는 나타나지 않는다. 오프라인 bare fixture로 두 경우를 실제 비교한다.

이 단계는 정규 파일 중심의 로컬 Windows Git에서 검증했다. worktree/잠금은 협력하는 앱의 격리 장치이고 악의적인 로컬 프로세스·직접 shell·외부 API의 OS 보안 경계가 아니다.
