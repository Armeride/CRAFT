# ADR-015 — 수동 변경·검토 통합·실시간 갱신

상태: 채택. 2026-11-13. 단계 5/작업 005. UI 초안 03 승인 후 남은 단계 5 기능까지 구현한다는 사용자 확정을 따른다. 새 UI 디자인 요구, 실제 모델 실행, 상태 평가기는 이 결정에 포함하지 않는다.

## 확정 요구

Git 파일을 정본으로 유지하며 독립 작업에서 새 리비전·사용자 review·baseline 선택을 작성한다. 모델 없이 실제 diff를 승인하고 통합하며, 초안 자동 저장/충돌·재접속·프로젝트/작업 격리를 제공한다. FR-003/012/018/020/021, FR-022 편집 기반과 AT-13/21/22/44/47/51~53을 구현한다. 기존 core/extension v1·semantic model 1을 바꾸지 않는다.

## 설계 결정

- `ManualService`는 기존 `TaskService.edit`의 worktree lease/journal/예상 snapshot을 사용한다. 기존 revision/review를 덮어쓰지 않고 새 파일을 만든다. baseline 채택은 명시 명령이며 참조를 자동 교체하지 않는다. 구조화 JSON의 미완성 입력도 별도 속성 초안에 보존하고 새 revision 작성 시 검증한다.
- 수동 명령의 UUID·내용 digest·결과 receipt를 변경/체크포인트와 같은 transaction/commit에 넣는다. 같은 UUID/내용은 결과를 재사용하고 내용이 다르면 거부한다. clone/import/새 작업/재개/충돌 처리의 HTTP 명령은 별도 운영 receipt를 사용한다. 결과 불명은 자동 실행하지 않고 `COMMAND_OUTCOME_UNKNOWN`으로 보존 결과 확인을 요구한다.
- 본문과 속성은 파일 digest CAS로 자동 저장한다. 클라이언트는 run별 요청을 직렬화하며 새 revision/검토/통합 준비의 flush와 snapshot 검사를 같은 그룹으로 처리한다. 브라우저 metadata store는 화면이 바뀌어도 저장을 완료한다. 충돌은 로컬 입력/서버본을 보존하고 명시 선택한다. 브라우저 저장소는 선호·식별자/요청 UUID만 저장한다.
- `IntegrationService`는 task의 B, 현재 target T, 보존된 result R을 같은 schema에서 비교한다. 다른 파일의 변경은 합치고, 같은 파일을 양쪽이 다르게 바꾸면 보존 후 거부한다. 삭제/다른 schema 통합은 거부한다. 일반 텍스트의 자동 3-way merge를 약속하지 않는다.
- 별도 integration branch/worktree에서 candidate를 검증한다. 실제 전체 binary Git diff, source/target/candidate commit, review ID, diff digest를 승인 token에 결합한다. 새로 채택하는 approved는 유효한 사용자 review와 해결된 의존 조건을 요구하며 release는 전체 검증한다. `consumed_proposals`와 실제 결과는 candidate의 같은 commit이다.
- 적용 시 source snapshot/branch와 target HEAD/index/파일·candidate/diff를 재검증한다. source branch 검증과 target ref 갱신은 Git `update-ref --stdin`의 한 ref transaction으로 수행한다. [Git 공식 transaction 문법](https://git-scm.com/docs/git-update-ref)을 따른다. 자동 push는 없다.
- 적용 전 운영 guard를 기록한다. 파일 적용 후 ref 갱신 전 중단이면 일반 target 조회/새 작업을 차단한다. 같은 승인 candidate가 index/파일과 일치할 때만 이어서 완료하거나 이전 상태로 복원한다. ref 갱신 후 중단은 candidate commit을 확인해 완료를 회복한다. 다른 외부 편집이 있으면 덮어쓰지 않는다. 이 guard는 정본 지식이 아닌 중단 작업의 운영 상태다.
- SSE는 인증된 registration에 바인딩한다. journal의 단조 sequence/최근 200개, cursor 재접속/범위 초과 `sync.required`, 느린 client 종료와 heartbeat를 제공한다. writer·파일 watcher는 갱신 힌트이며 query의 snapshot/불변성 검증을 대체하지 않는다. run의 basis/working과 정본 조회는 독립 scope다.
- 관리 UI는 안전 transport clone·명시 문서 import·Git 체크포인트 복원·제품 registry migration 계획/보고서만 연결한다. 제품 v1 no-op을 실제 v2 변환으로 표현하지 않는다. 복원 작업의 통합 대상은 현재 프로젝트의 checkout branch이며 원래 checkpoint ref는 출처로 보존한다.

## 후속 경계

실제 Codex/Claude·MCP는 6, 공급자 간 재개는 7, 상태 조건 평가/시점·actor 비교는 8이다. 다른 schema B/T/R, 전체 AT, 실제 전원 차단/디스크 오류·운영 상태 전체 손실·규모/타 OS 인수는 9다. 그래프 외부 후보는 기록만 유지한다. 새로운 UI 요구는 [별도 작업](../tasks/README.md)으로 관리한다.
