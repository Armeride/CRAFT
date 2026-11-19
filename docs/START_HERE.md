# 새 Codex 세션에서 개발 시작하기

작성일: 2026-11-10, 갱신: 2026-11-18. 명세 v1.4 반영본. 현재 단계 0~6 완료, 단계 7 착수 전 대기다. UI 초안 03을 승인 기준선으로 [작업 005](tasks/005-manual-workflow.md)의 잔여 수동 기능을 완성했다. 현재 전체 Vitest 206개와 Chrome E2E 14개가 통과했다. 실행기·내부 MCP와 실제 Codex/Claude opt-in 시험은 작업 006·ADR-016에서 완료했다. 공급자 세션 재개·스킬·외부 MCP는 7, 상태 평가/시점·actor 비교는 8에 남아 있다. 새 UI 요구는 별도 작업으로 진행하며 **한 단계 완료 후 멈추고 대기** 지시를 유지한다. 최신 검증 범위와 한계는 상태 문서를 따른다.

## 1. 전달할 파일

- [PROJECT_SPEC.md](PROJECT_SPEC.md): 전체 요구사항, 아키텍처, 원본 파일 구조, 스키마, 마이그레이션, 실행 흐름, 개발 계획, 인수 시험.
- 이 문서: 시작 지시문과 작업 인계 방법.
- [REVIEW_NOTES.md](REVIEW_NOTES.md): 요구사항 대조, 발견한 설계 충돌과 보완 이유, 남은 구현 판단.

저장소에는 세 파일을 모두 `docs/`에 보관한다. 새 세션에는 이들과 `docs/REQUIREMENTS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/IMPLEMENTATION_STATUS.md`를 함께 전달한다. 구현 기준은 보완이 통합된 PROJECT_SPEC.md v1.4이며 REVIEW_NOTES.md를 상충 사양으로 해석하지 않는다. 기존 개발 저장소의 경로·지침·Git 변경부터 확인하고 완료한 단계를 초기화/재구현하지 않는다.

## 2. 새 세션에 붙여넣을 시작 지시문

```text
docs/PROJECT_SPEC.md v1.4와 docs/IMPLEMENTATION_STATUS.md를 기준으로 현재 작업을 이어가줘.
REVIEW_NOTES.md도 읽어서 버전·참조·복원·마이그레이션의 함정을 확인해.

이 프로젝트는 소설과 게임 기획에 공통으로 사용하는 로컬 우선 웹 앱이야.
반드시 명세의 전체 요구사항과 불변 조건을 읽고, 확정 요구·설계 기준·미결정을 구분해.

핵심 요구:
1. TypeScript와 Node 또는 Bun 기반, 브라우저 UI로 조작.
2. Git 프로젝트 파일이 유일한 정본. DB·검색 색인은 언제든 삭제하고 재구축 가능.
3. 요소의 고유 ID와 고정 리비전, typed reference, baseline, 역참조 및 상태 전파.
4. 논의중/초안 의존성과 새 버전 경고를 기계적으로 검사.
5. 소설의 시점·인물 인식과 게임의 버전·scope 조회를 분리.
6. Claude Code·Codex를 감지하고 작업별 임시 Git worktree에서 실행.
7. 스킬·내부 MCP·외부 MCP를 사용하되 프로젝트·작업별 경계를 유지.
8. 공급자 세션이나 DB 없이 체크포인트로 재개.
9. 첫 구현부터 스키마 버전·단계별 migration·fixture·복원 검증 포함.
10. 모든 앱 UI의 한국어·영어 i18n. UI 언어와 프로젝트 원문/정본/식별자를 분리.
11. 일반 요소의 시간·trigger·조건부 상태 정의와 시점/가정 조회·비교·근거.
    게임은 기획 규칙과 플레이어/NPC 가정 평가이며 실제 게임 실행/실시간 연동은 제외.

먼저 실제 작업 저장소, AGENTS.md, 기존 변경, 런타임을 확인해.
기존 파일을 덮어쓰지 말고, 개발 위치가 정해지지 않았다면 그 정보만 확인해.
현재 단계 0~6은 완료했어. UI 초안 03을 승인 기준선으로 docs/tasks/005-manual-workflow.md의 수동 revision/review/baseline·autosave/충돌·실제 diff 승인/통합·clone/import/migration 관리·SSE를 완성했어. docs/MANUAL_WORKFLOW.md와 ADR-015를 확인해. 단계 6의 작업 006/ADR-016·두 실제 공급자 smoke 증거도 확인해. 단계 7은 사용자 진행 지시 전 착수하지 말고 대기해. 새 실제 호출은 승인된 범위를 먼저 확인해. 이후 새 UI 변경은 새 작업을 만들어 진행해.
이번 지시가 기획 변경이면 문서만 반영하고 구현을 시작하지 마.
각 단계는 순서대로 진행하되 한 단계 완료 후 반드시 멈추고 대기해.
UI나 모델 호출 데모보다 파일 형식·검증·마이그레이션을 먼저 완성해.
명세는 목표 계약이고 실제 지원은 코드/상태 문서로 확인해. FR-021은 현재 구현한 웹 화면의 ko/en·접근성·자동 저장/언어 전환 회귀까지 검증했어. 후속 6~8의 새 화면도 같은 gate를 유지해. FR-022는 상태 계약/참조·입력 근거/색인·정의 편집까지야. 조건 평가·상태 비교와 제품 전체 AT 완료로 표시하지 마.
외부 CLI 프로토콜과 패키지 버전은 공식 문서/설치 버전으로 확인해.

구현 중 기본값으로 해결 가능한 라이브러리 선택은 진행하고 ADR에 남겨.
확정 요구를 바꾸는 결정은 임의로 하지 마.
실제 공급자 테스트가 불가능해도 fake agent로 독립 작업을 계속해.
원격 push나 미보존 데이터 삭제를 자동 수행하지 마.
상세 판단은 명세 20.1절의 기본 결정을 사용하고, 제품 의미가 필요한 항목만 확인해.

각 단계가 끝나면 실행 방법·테스트 결과·제한 사항을 정리하고,
docs/IMPLEMENTATION_STATUS.md에 다음 세션이 이어갈 수 있는 상태를 남겨.
```

## 3. 초기 단계 0~2의 목표와 현재 경계

다음 초기 수직 흐름은 이미 완료한 범위다. 새 세션에서 원본을 초기화하거나 반복 구현하지 않는다.

```text
예시 Git 프로젝트 읽기
→ 파일 스키마 검증
→ 고정 리비전·참조·baseline 조회
→ 별도 worktree에서 fixture 전용 v1→v2 형식 변환
→ 의미 보존·참조 검증
→ 원본 불변과 결과 보존 확인
```

해당 세션에서 모든 제품 기능을 한 번에 만들기보다, 이후 변경에도 원본을 잃지 않는 기반을 실제로 작동시킨다. 명세의 단계 0~2를 통과한 뒤 Git 작업·색인·UI·실행기를 순서대로 추가한다.

fixture용 v2 시험은 제품 v2를 미리 확정하는 작업이 아니다. 실제 사용자 포맷은 명시적으로 릴리스하며, 같은 버전 번호의 의미를 나중에 재정의하지 않는다.

## 4. 저장소에서 보존할 문서

```text
README.md
docs/
├─ README.md
├─ PROJECT_SPEC.md
├─ REVIEW_NOTES.md
├─ START_HERE.md
├─ REQUIREMENTS.md
├─ IMPLEMENTATION_PLAN.md
├─ IMPLEMENTATION_STATUS.md
└─ adr/
   ├─ 001-file-source-of-truth.md
   ├─ 002-entity-and-revision-identity.md
   ├─ 003-schema-and-migration.md
   └─ 004-agent-runner-boundaries.md
```

ADR은 선택 이유와 트레이드오프를 남긴다. 단순 진행 로그로 사용하지 않는다. 요구사항 변경 시 PROJECT_SPEC.md와 관련 ADR을 함께 갱신한다.

## 5. IMPLEMENTATION_STATUS.md에 남길 항목

```markdown
# 구현 상태

## 기준
- Git 브랜치/기준 커밋:
- 명세 버전:
- 실제 런타임/패키지 관리자:

## 완료한 범위
- 요구사항 ID와 구현 위치:

## 실제 실행 방법
- 설치:
- 개발 서버:
- 타입 검사/빌드:
- 단위/통합/E2E 테스트:

## 검증 결과
- 실행한 명령과 통과/실패:
- 실제 CLI smoke test 여부:

## 미해결 사항
- 재현 조건과 영향:
- 설계 미결정/사용자 확인이 필요한 항목:

## 다음 작업
- 바로 실행할 수 있는 구체적 순서:

## 보존 상태
- 미커밋 변경:
- 작업 브랜치/임시 worktree:
- 정리하면 안 되는 파일:
```

위 명령 항목은 구현 후 실제 동작하는 명령으로 채운다. 문서에 나온 가상 파일 경로·API가 이미 존재한다고 보고 실행하지 않는다.

## 6. 새 세션에서 반드시 유지할 설계 요약

- 직접 status와 참조에서 파생된 blocker를 구분한다.
- 새 버전 존재와 갱신 필요는 다르며 자동 latest 치환을 하지 않는다.
- 요소 리비전과 파일 스키마 버전은 다르다.
- 형식 migration은 의미를 유지하면 요소 ID/리비전을 유지한다.
- Git commit, baseline, 요소 리비전이 각각 다른 기준이다.
- worktree는 작업 격리 수단이며 OS 보안 sandbox가 아니다.
- 작업별 검색/MCP/cwd는 반드시 같은 worktree를 가리킨다.
- task/checkpoint는 Git 파일에 보존하고 runtime 로그는 부가 정보다.
- clone으로 가져올 수 있는 것은 원격에 보존된 커밋뿐이다. 로컬 전용 결과도 구분한다.
- 강한 참조 범위는 초기에는 동일 저장소 내부다.
- 정확한 검증은 코드, 의미 검토·초안 작성은 에이전트가 담당한다.
- 적용 의존과 과거 인용·근거는 baseline 일치 규칙이 다르다.
- draft 핀의 승인 후속이 생겨도 기존 핀은 자동 교체·해제되지 않는다.
- domain ref는 extension 안에서도 완전한 Reference 객체를 쓴다. review/manifest의 SnapshotTarget과 구분한다.
- 작업 시작 basis와 현재 working snapshot을 구분한다.
- 인물 상태 재생에는 baseline에서 선택한 사건만 사용하며 시간 동률은 충돌로 반환한다.
- task는 기본 브랜치에 없을 수 있으므로 보존 작업 브랜치에서도 재발견한다.
- 승인 기록은 고정 리비전·입력에 연결하고 파일 status만으로 승인하지 않는다.
- cross-schema 통합은 공통 조상까지 같은 형식으로 정규화하거나 안전하게 보류한다.
- byte hash와 semantic digest를 구분하고 migration 후 검토 유효성을 다시 판정한다.
- UI locale·프로젝트 language·도메인 enum/ID·상태 계산 의미를 구분한다. UI 문구는 ko/en으로 제공한다.
- 문서 revision/status와 세계/게임 상태는 별개다. 시간 진행/가정 평가는 정본을 직접 수정하지 않는다.
- 인물 외의 국경·지역·세력·아이템 등에도 초기값·변화·시점 근거를 적용한다.
- 조건 입력 미기록은 unknown이다. 변화 정의/승인된 계획과 실제 발생, actor별 가정 결과를 혼합하지 않는다.
- 새 상태 파일 계약은 명시 versioned 확장/호환 경로로 추가하고 공개 v1을 재정의하지 않는다.

## 7. 이 전달물의 현재 상태

단계 0~5를 완료했다. 단계 5 구현은 96847f4에 보존했고 전체 Vitest 192개와 Chrome E2E 12개를 통과했다. 실제 검증 범위와 후속 UI 보강 결과는 docs/IMPLEMENTATION_STATUS.md를 따른다.

기획 추가 완료: 2026-11-11 사용자 요청으로 FR-021/022와 AT-51~60을 추가했다. 당시 요구는 FR 22개·AT 60개였으며 새 인수 기준 중 AT-58의 색인 기반과 AT-60의 계약/옛 reader 호환을 검증했다. 전체 UI/상태 평가 인수는 아직 아니다.

현재 요구는 FR 26개·AT 68개다. FR-026/AT-67~68에 외부 검토·엔진 선택·중심 배치/군집·캔버스 탐색을 기록했다. FR-023~025/AT-61~66으로 추가 UI 요구를 기록하고 확정 요구·설계 선택·후순위를 분리했다.

UI 초안 03은 사용자 승인을 받았다. 수동 작성·검토·실제 diff 승인 통합·자동 저장/충돌/복구·관리/SSE까지 작업 005에서 완성했다. 단계 6에서 실행기·내부 MCP·웹 제어와 실제 두 공급자 시험까지 완료했다. 다음은 단계 7이지만 사용자 진행 지시 전 대기한다. [작업 006](tasks/006-agent-runners.md)·[ADR-016](adr/016-isolated-agent-runners-and-internal-mcp.md)·[AI 안내](AGENT_WORKFLOW.md)를 따른다. 상태 평가·시점/actor 비교는 단계 8의 목표다.

문서 버전 1.4도 제품 schema v2 출시가 아니다. 공개 core/narrative/game_design v1·기존 fixture를 유지하며 별도 state_model@1 계약을 추가했다. 상세 지원/실행법은 docs/STATE_MODEL_V1.md와 docs/INDEXING.md를 따른다.

## 8. 다른 세션에서 이어갈 때

이 문서 다음에는 현재 구현 상태, 전체 프로젝트 명세와 설계 검토 기록, 요구사항 분류와 단계 7 계획을 순서대로 읽는다. 실행기 경계는 ADR-004, 작업 격리는 ADR-008, 조회 scope는 ADR-011, 수동 검토/통합은 ADR-015에 근거를 남겼다. [현재 구현 상태](IMPLEMENTATION_STATUS.md), [요구사항 구분](REQUIREMENTS.md), [단계 7 계획](IMPLEMENTATION_PLAN.md#단계-7--재개스킬외부-mcp)

| 재사용할 기반 | 코드와 계약 |
|---|---|
| 작업 생성·파일 저장·checkpoint·fake·취소/복구 | packages/tasks/src/service.ts, docs/WORKSPACES.md |
| basis/working·검색·역참조·검증 | packages/indexer/src/service.ts, packages/indexer/src/types.ts, docs/INDEXING.md |
| 수동 명령·proposal·사용자 검토·통합 | packages/tasks/src/manual.ts, integration.ts, manual-contracts.ts, docs/MANUAL_WORKFLOW.md |
| Git 실행·worktree·잠금·운영 상태 | packages/git-workspace/src/, packages/workspace-runtime/ |
| REST·SSE·기존 작업 UI | apps/server/, apps/web/src/ManualWorkspace.tsx, useDrafts.ts, useWorkspaceEvents.ts |

새 checkout의 검증 명령은 아래와 같다. npm ci는 Node 24.21.0/npm 11.19.0에서 실행하며 Chrome E2E는 설치된 Chrome을 사용한다.

~~~powershell
npm ci
npm run check
npm run test:ui
npm run ui:preview -- --port 4174
~~~

같은 PC의 다른 세션은 D:/git/CRAFT를 열고 branch·HEAD·미커밋 변경부터 확인한다. 2026-11-13 확인 시 원격 main은 6391781, 로컬 단계 5 구현은 96847f4였다. 새 clone의 인수인계 기준은 원격에 반영된 commit으로 결정되므로 필요한 구현·문서 commit이 포함됐는지 먼저 확인한다. 최신 로컬 문서 commit은 git log -1로 확인한다.

node_modules/dist는 재생성할 수 있다. .tmp/ui-preview에는 사용자가 작성한 초안과 앱 운영 데이터가 있을 수 있으며 Git에서 제외된다. 같은 PC에서는 해당 자료를 보존하고, 다른 PC로 옮길 자료가 있으면 별도로 전달한다. tracked 소스·fixture·문서로 테스트와 기본 예시를 재생성할 수 있다.

2026-11-13 ChatGPT 앱 전환 점검에서 일반 셸은 helper_unknown_error와 setup refresh 오류를 보였고 권한 검토를 거친 실행은 통과했다. 새 세션에서는 실제 오류와 권한 설정을 확인해 실행 경로를 판단한다. Git 소유권 오류가 발생하면 해당 명령의 safe.directory에 실제 checkout 경로를 지정할 수 있다. 이 세션에서는 D:/git/CRAFT 한 명령 범위로 사용했다. 타입 검사·SQLite·Chrome·검토 서버·Git 원격 읽기/push dry-run을 확인했다.

단계 6은 구현과 실제 공급자 시험까지 완료했다. 단계 7 진행 지시를 받으면 작업 006/ADR-016·AI 사용 안내·검증 증거를 읽고 checkpoint 재문맥화, 기본 스킬의 출처/version/digest, 외부 MCP 프로필과 부작용 중복 방지 순서로 구체화한다. 현재 native provider resume capability는 false다. 실제 호출은 승인 범위를 확인하고 모델 없는 fixture를 먼저 사용한다. 한 단계 완료 후 멈추는 규칙은 계속 유지한다.
