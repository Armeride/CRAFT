# 단계 5 수동 작업 사용과 복구

실행은 [UI 실행](UI_PREVIEW.md), 설계와 보장 경계는 [ADR-015](adr/015-manual-review-integration-and-events.md), 실제 검증은 [구현 상태](IMPLEMENTATION_STATUS.md)를 따른다.

## 모델 없는 작성과 통합

1. 프로젝트를 열고 **작업 초안 → 새 수동 작업**에서 목표를 입력한다. 기본 기준은 현재 HEAD commit이다. **포함할 로컬 변경 선택**을 새로고침해 선택한 파일만 별도 snapshot에 포함할 수 있다. 원래 staged/unstaged/untracked를 자동 stash하지 않는다. 목록 확인 뒤 원본이 바뀌면 다시 선택한다. 요소의 **직접 편집**은 exact 원문을 독립 작업으로 복사하며 HEAD와 다른 원문은 이 명시 선택 흐름으로 안내한다.
2. 본문은 입력 후 약 700ms, 속성은 약 800ms에 working 파일로 자동 저장한다. 화면을 바꾸거나 언어/배치를 바꿔도 입력을 유지한다. 브라우저를 닫기 전 저장 상태를 확인한다. 자동 저장은 작업 파일 보존이며 **체크포인트 보존**은 Git commit이다.
3. 제목/상태/태그와 scope·고정 reference·상태 확장 JSON을 입력하고 **새 리비전 만들기**를 누른다. 기존 리비전/검토를 유지하고 새 ID의 revision/proposal과 checkpoint commit을 만든다. 부모 선택은 속성의 작성 기준이며 본문 편집창의 현재 입력을 새 본문으로 사용한다. 상태 정의 편집은 가능하지만 실제 조건 평가/시점 비교는 단계 8이다.
4. 작업 결과/작업 시작 기준을 분리해서 조회한다. 수동 속성 영역의 기준 보기는 읽기 전용이며 위 본문 편집창은 항상 working 초안이다. 작업별 채택 기준 선택은 재접속 후 복원하며 선택한 기준의 진단을 다시 조회한다. 기존 revision 채택, working/release 기준 생성, 직접·간접 의존 진단과 검토 유효성을 확인한다. 새 기준은 현재 선택 map을 복사한다. 비어 있는 새 기준만으로는 core proposal을 만들 수 없으며 revision 작성/채택 후 통합한다.
5. 고정된 revision에 **검토 수락/수정 요청/거절** 기록을 추가한다. 검토 기록은 불변 추가 파일이다. 새 revision은 본문이 같더라도 참조/적용 입력 변경을 자동 검토 완료로 취급하지 않는다. 과거의 수락 기록 삭제/취소 정책을 새로 도입하지 않으며 기존 semantic model 1의 유효성 규칙을 따른다.
6. **통합 diff 준비**는 현재 편집을 저장/체크포인트로 보존한 뒤 별도 candidate를 만든다. 실제 diff(체크포인트 입력 manifest는 끝에 Git object ID·크기로 요약)와 source/target commit·diff 검증 값을 확인하고 **diff를 확인했고 통합 승인**을 누른다. 다른 작성/외부 대상 변경이 있으면 새 diff로 검토한다. 검토만으로 원본을 쓰지 않는다. 이미 통합한 task는 새 변경용으로 재사용하지 않고 새 작업을 만든다.

## 충돌과 중단

- 본문 충돌 시 내 입력과 서버 원문을 함께 표시한다. **내 입력을 보존하고 서버본 사용**, 또는 **내 입력으로 새 작업 공간 만들기**를 선택한다. 양쪽 파일을 보존한다. 속성 충돌은 서버 속성을 백업한 뒤 내 속성으로 저장하는 명시 선택을 제공한다. **보존한 충돌 버전 보기**에서 원문을 열 수 있다.
- 파일 저장 journal이 중단됐으면 해당 작업의 **중단된 저장 복구**를 사용한다. Git에 보존된 작업은 프로젝트 관리의 **Git에 보존된 체크포인트**에서 exact checkpoint를 골라 새 run으로 복원한다. source ref/commit은 출처, 현재 프로젝트 checkout branch는 통합 대상이다.
- 통합 중단 시 **프로젝트 관리 → 중단된 통합 복구**에서 승인했던 diff를 확인한다. 이미 candidate commit으로 반영됐으면 완료를 확인한다. 아직 ref 갱신 전이고 index/파일이 승인 candidate와 일치하면 완료 또는 원복한다. 외부 파일·ref가 달라졌으면 덮어쓰지 않고 오류를 유지한다. 원본/작업/candidate branch를 보존하고 상태를 먼저 확인한다. 임의 `reset --hard`나 worktree 삭제를 복구 절차로 사용하지 않는다.
- 동일 요청을 다시 전달해도 receipt가 확인된 결과를 중복 생성/통합하지 않는다. `COMMAND_OUTCOME_UNKNOWN`은 요청 처리 중 결과가 확정 기록되지 않았다는 뜻이다. 목록/체크포인트/운영 receipt·보존 branch를 먼저 확인하며 자동 재시도하지 않는다. 앱 운영 데이터 전체 손실과 전원 차단의 종합 인수는 단계 9다.

## 프로젝트 관리와 실시간 갱신

로컬 Git 프로젝트 확인, HTTPS/SSH 원격 clone, 선택한 committed Markdown/text의 비파괴 import를 제공한다. 가져온 결과는 별도 worktree/branch와 별도 등록·채택 기준으로 연다. 원본 문서가 바뀌지 않는다. 파일 형식 변환은 제품 registry 지원표/계획/결과·committed attestation 보고서를 표시한다. 현재 제품 경로는 v1/no-op이며 fixture v2를 실행하지 않는다.

하단의 실시간 갱신 상태를 확인한다. 연결이 끊기면 약 2초 후 cursor로 재접속한다. 최근 200개 범위를 벗어나면 정본을 다시 조회한다. canonical 파일/HEAD/index/선택 ref watcher와 writer 이벤트를 사용하며, run 이벤트는 다른 요소 초안을 덮어쓰지 않는다. 이벤트는 변경 힌트이고 실제 읽기는 scope/snapshot 검증을 다시 수행한다.

## API와 한도

모든 API는 loopback Host/Origin·HttpOnly session/CSRF를 검사한다. query는 서버가 바인딩한 registration/run만 읽으며 클라이언트가 경로·권한 scope를 고를 수 없다. 오류 code/진단은 ko/en UI에서 번역하고 원문 JSON/문서/사용자 경로는 번역하지 않는다.

| 경로 | 역할 |
|---|---|
| `/api/projects/:id/tasks`, `/working-changes`, `/checkpoints`, `/resume` | 명시 작업 시작/선택 변경/보존 checkpoint 복원 |
| `/api/runs/:id/draft`, `/editor`, `/manual` | 본문·속성 CAS와 멱등 수동 변경 |
| `/api/runs/:id/query`, `/preserve` | basis/working 조회와 checkpoint/저장 복구 |
| `/api/runs/:id/conflict-resolution`, `/artifacts`, `/artifact` | 양쪽 버전 보존·명시 충돌 처리·자기 task의 백업 열람 |
| `/api/runs/:id/integrations`, `/api/integrations/:id` | 전체 proposal의 candidate·실제 diff 준비/복원 |
| `/api/integrations/:id/apply`, `/restore`, `/api/projects/:id/pending-integration` | 승인 적용·중단 상태 확인/복구 |
| `/api/library/inspect`, `/clone`, `/import`, `/api/projects/:id/migration` | 프로젝트 관리·제품 변환 계획/결과 |
| `/api/events?projectId=…&cursor=…` | 인증된 SSE·단조 cursor |

수동 명령은 body의 requestId, clone/import/작업 생성·재개/충돌·migration 실행은 `X-Craft-Request-ID` UUID를 사용한다. expectedSnapshot/expectedDigest를 생략해서 강제로 덮어쓰는 경로는 없다. HTTP body는 2MiB, 본문 300,000자, 속성 초안 400,000자, 실제 diff 1MiB, 통합 proposal 200개, 선택 로컬 파일/가져오기 200개다. 변경 목록은 2,000개에서 잘림을 표시한다. 작업 요청 메모는 100개/각 12,000자/전체 1MiB다. 대규모 성능·타 OS/브라우저 전체 지원을 의미하지 않는다.
