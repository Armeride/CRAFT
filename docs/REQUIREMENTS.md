# 요구사항 해석과 구현 경계

기준: 2026-11-11, Asia/Seoul. [PROJECT_SPEC.md v1.4](PROJECT_SPEC.md) 전체 0~23절, [REVIEW_NOTES.md](REVIEW_NOTES.md) 전체, [START_HERE.md](START_HERE.md)를 읽고 정리했다. 이 문서는 명세를 대체하지 않는다. 요구사항이 바뀌면 명세와 관련 ADR도 함께 갱신한다.

## 분류 원칙

- **확정 요구**: 명시된 기능과 제약. 구현자가 임의로 축소하거나 제거하지 않는다.
- **설계 기준**: 요구를 만족하는 기본 동작·아키텍처. 근거를 남긴 ADR로 조정할 수 있으나 요구를 바꾸는 결정은 사용자와 확인한다.
- **미결정**: 기술 실험 또는 실제 자료의 의미 판단이 필요한 항목. 기본값이 있으면 적용하고, 없는 업무 의미는 추정하지 않는다.

직접 상태 enum·reader 관점·승인 절차·로컬 우선의 세부 행동·의미 검색 후속 도입은 명세에서 구체화한 설계 기준이다. 세부 선택 전체를 사용자가 직접 지정한 것으로 취급하지 않는다. 이번 사용자는 로컬 우선 앱이라는 제품 방향을 재확인했다.

## 기능 요구 추적

아래 단계는 명세 18절의 번호다. 현재 단계 1의 파일·검증·정확 조회, 단계 2의 migration, 단계 3의 Git 프로젝트·작업 격리·보존, 단계 4의 재구축 색인·참조 진단·검색과 상태 계약 기반을 구현했다. 단계 5는 UI 초안 03 승인 후 작업 005의 수동 작성·검토·승인 통합·자동 저장/충돌·관리/SSE를 완료했고 단계 6의 실행기/내부 MCP·UI 제어와 사용자 opt-in 후 두 공급자 실제 모델 시험도 완료했다. 단계 7에서 작업 기록 기반 재개·스킬·관리 MCP를 검증했다. 각 요구의 구현 범위는 [구현 상태](IMPLEMENTATION_STATUS.md)에서 확인한다.

| ID | 구분 | 구현할 행동 | 주 단계 |
|---|---|---|---|
| FR-001 | 확정 | 소설·게임 공통 프로젝트 및 분야별 확장 | 1, 8 |
| FR-002 | 확정 | 로컬 Git 열기·원격 URL clone | 3 |
| FR-003 | 확정 | 요소 ID·불변 리비전·상태·태그·scope | 1, 5 |
| FR-004 | 확정 | 의미 참조를 entity/revision 쌍에 고정 | 1, 4 |
| FR-005 | 확정 | 직접·간접 역참조·영향·새 버전 검사 | 4, 9 |
| FR-006 | 확정 | 의존 상태 전파와 원인 경로 | 4 |
| FR-007 | 확정 | exact·전문 검색·관계 탐색·버전 비교 | 4, 8 |
| FR-008 | 확정 | 소설 시점별 상태·인식·공개 조회 | 8 |
| FR-009 | 확정 | 게임 버전·모드·플랫폼 규칙 조회 | 8 |
| FR-010 | 확정 | 목표·결정·미결정·초안 보존과 재개 | 3, 7 |
| FR-011 | 확정 | Claude Code·Codex 설치 탐지와 선택 | 6 |
| FR-012 | 확정 | 웹 작업 지시·진행·중단·결과 검토 | 5~7 |
| FR-013 | 확정 | 기본·프로젝트·사용자 스킬 | 7 |
| FR-014 | 확정 | 내부 지식·외부 API의 MCP 연결 | 6~7 |
| FR-015 | 확정 | 실행마다 별도 브랜치·임시 worktree | 3, 6 |
| FR-016 | 확정 | Git 파일만으로 DB·색인 재구축 | 4 |
| FR-017 | 확정 | 처음부터 형식 버전·단계별 migration | 2, 9 |
| FR-018 | 설계 기준 | 변경안 검증·충돌 표시·검토 통합 | 5, 9 |
| FR-019 | 설계 기준 | baseline·고정 문맥·입력 근거 추적 | 4, 7 |
| FR-020 | 설계 기준 | 자연어·구조 조회가 같은 서비스 호출 | 5, 6, 8 |
| FR-021 | 확정 | 모든 앱 UI i18n·초기 한국어/영어·언어 선택 | 4 기반, 5~9 |
| FR-022 | 확정 | 일반 요소의 시간·trigger·조건부 상태 정의와 시점/가정 조회·비교·근거 | 4 계약/색인, 5 편집, 8 완성, 9 |
| FR-023 | 확정 | 분류/전체 개인 설정·시스템 테마·언어/폰트 | 5, 9 |
| FR-024 | 확정 | 한 열 탐색·대시보드/참조 그래프·리사이즈/정보 제어 | 5, 8, 9 |
| FR-025 | 확정 | 요소별 대화/문서 분할·좌우 전환·직접 편집/실시간 확인 | 5~7, 9 |
| FR-026 | 확정 | 교체형 그래프 엔진·설정 선택·관계 중심 군집·zoom/pan 캔버스 | 5, 9 |

2026-11-11 사용자가 초기 UI 언어를 한국어·영어로, 게임 범위를 기획 규칙 작성과 가정 입력에 따른 상태 조회·비교로 확정했다. FR-021은 진단 기반과 첫 ko/en UI/언어 전환까지, FR-022는 versioned 파일·참조·입력 digest/색인까지 구현했다. 전체 UI/평가·비교 완료는 아니다. 문서의 v1.2는 제품 디스크 schema v2 출시가 아니다.

## 반드시 유지할 불변 조건

명세 3절의 9개 항목을 각각 검증 대상으로 유지한다.

| 번호 | 불변 조건 | 검증할 위치 |
|---|---|---|
| 1 | 파일에 없는 정본 지식을 DB에 만들지 않는다 | 파일 loader·DB 삭제 복원, 단계 1/4 |
| 2 | 내용·직접 상태·참조 변경은 새 리비전이다. 검증된 형식 migration만 예외다 | Git 불변성 비교·migration attestation, 단계 1/2/9 |
| 3 | 의미 의존 참조에는 entity_id + revision_id가 있다 | core/extension/sequence schema, 단계 1 |
| 4 | 높은 번호·최근 시간이 현재 채택 상태를 결정하지 않는다 | baseline·parents DAG·분기/시간 충돌, 단계 1/4/8 |
| 5 | 에이전트 성공 문구·종료 코드만으로 정본 반영하지 않는다 | 실제 diff·도메인 검증·review, 단계 5/6/9 |
| 6 | 검색·확장·MCP 추가 조회는 동일 프로젝트/worktree/baseline/관점을 지킨다 | scope/snapshot token·컨텍스트, 단계 3/4/6/8 |
| 7 | 미확정 초안이 확정 지식으로 자동 승격되지 않는다 | 유효 사용자 review·confirmed/working·release gate, 단계 4/5/8 |
| 8 | 복구 불가능한 임시 상태가 있으면 worktree를 자동 제거하지 않는다 | 보존 commit·untracked 확인·정리 gate, 단계 3/9 |
| 9 | 사람이 직접 고친 파일도 앱과 같은 검증을 통과한다 | 외부 편집 digest·Git 비교·통합 검증, 단계 1/3/9 |

동적 세계/게임 상태와 문서 status/revision·참조 blocker는 서로 다른 축이다. 상태 조회·시뮬레이션과 locale 전환은 정본을 덮어쓰거나 새 승인/발생 사실을 만들지 않는다. 정의 수정은 기존 불변성·새 revision/검토 규칙을 따른다.

## 비기능 요구와 운영 경계

- 복원성: Git 파일에 지식뿐 아니라 task/checkpoint/proposal/review를 남긴다. DB·공급자 세션·브라우저 저장소 없이 의미 상태를 복원한다.
- 격리: 실행별 cwd·파일·DB·MCP scope를 맞춘다. 같은 project_id라도 clone/worktree가 다르면 working 색인을 공유하지 않는다.
- 추적성·일관성: 조회와 문맥에는 ID/리비전/출처/snapshot/freshness를 남긴다. 누락 참조를 latest로 대체하지 않는다.
- 검증 가능성: 필수 구조·그래프·Git 검사는 모델 없이 실행한다. 의미상 모든 모순을 검출한다고 주장하지 않는다.
- 이식성: 정본에는 상대 경로, 비밀 없는 manifest를 쓴다. 토큰·홈 경로·절대 worktree 경로는 앱 로컬에 둔다.
- 실패 안전성: 취소·쓰기 실패·migration 실패는 원본과 미보존 결과를 지우지 않는다. unknown 외부 호출을 자동 반복하지 않는다.
- 제품 범위: 단일 사용자 로컬 서버/브라우저, 원격 Git 지원. 다중 사용자 SaaS는 후속이다. TypeScript + Node 기본, Bun 연결부 후속 검증.
- 성능은 잠정 목표다: 1,000요소/10,000리비전, exact p95 200ms, 증분 점검 1초, 전체 재구축 30초. 모델/네트워크 제외. 단계 9에서 실측한다.
- loopback·Origin/session 검증·안전한 clone transport·구조화 spawn을 적용한다. hooks/MCP/프로젝트 스크립트는 clone만으로 자동 실행하지 않는다.
- path traversal/symlink 탈출, OS 파일 잠금·lease, 예상 digest, 다중 파일 journal을 검증한다. worktree는 OS 보안 sandbox가 아니다.

## 설계 기준으로 유지할 구체 계약

| 영역 | 기본 계약과 검토 메모 반영 |
|---|---|
| 정본과 모델 | Git YAML/Markdown이 정본. entity 최소 정체성, title/alias/status/domain 내용은 revision. 부모는 동일 요소 DAG. baseline은 snapshot과 함께 식별한다. |
| 참조 | core/extension/sequence는 완전 Reference, review/manifest/선택은 SnapshotTarget. 선언 경로만 추출하고 reference_id는 출발 revision 내 유일하다. anchor와 `[[ref:id]]`를 검증한다. R-01/02/21 |
| 상태·승인 | 직접 status와 파생 blocker 분리. draft 핀은 승인 후속이 생겨도 유지. 별도 불변 사용자 review + semantic/dependency digest로 release를 검사한다. blocking cycle은 working 진단, release 차단. R-03/04/15 |
| scope·폐기 | continuity 기본 main, 배열 OR, 생략은 무제약, 빈 배열 오류. 다중 후보는 모호성. 한 baseline/요소 한 revision. 채택 deprecated만 현재 폐기를 뜻한다. R-13/14 |
| 소설 | profile 불변 정보 / tick가 있는 initial_state / event 분리. baseline 선택 사건만 재생, canon/plan 및 confirmed/working 분리. tick/order 동률은 충돌. 독자 순서와 작중 시간은 별개. R-06/07/23/24 |
| 관점 | author/character/reader 필터를 제목·snippet·근거·연결 확장·추가 MCP에도 적용. 강한 비밀 격리는 원본 읽기 제한 프로필에서만 보장한다. |
| 게임 | 기획 규칙·제안·build observation 분리, 수치의 단위/타입/범위 고정. scope 특이도로 자동 선택하지 않는다. |
| 조회·문맥 | basis 불변 commit과 working generation을 구분. scope token은 권한, snapshot token은 자료 버전. 한 요청의 입력 파일 집합 고정, SOURCE_CHANGED 처리. R-05 |
| 작업·Git | 모델 호출 전 task/brief/초기 checkpoint commit. 보존 refs/tree에서 작업 재발견. dirty 자동 stash 금지. 검토 diff/head 변경 시 재검증. 로컬/원격 보존 구분. R-08/09/18 |
| migration | 단계별 preflight/transform/verify를 별도 worktree에서 수행. fixture 전용 v2 사용. 의미 보존이면 ID 유지. B/T/R을 같은 schema로 정규화하거나 보류. R-10/17 |
| digest·역사 | source/semantic/dependency/diff digest 구분. review 원본은 재작성하지 않고 attestation mapping. semantic model 동등성 미증명은 재검토. task의 과거 기준 schema는 역사로 유지. R-11/12 |
| 확장·입력 | unknown required 확장 쓰기 차단. optional도 손실 위험 요소는 쓰기 차단. JSON-compatible YAML만 허용, 중복 key/tag/merge/alias/anchor 및 비유한 값 거부, 크기·깊이 제한. R-16/21 |
| 가져오기·외부 호출 | 기존 Markdown/text는 전용 브랜치에서 비파괴 import, 추출은 제안. 외부 operation/idempotency/job 상태를 보존하고 불명 호출은 자동 재전송하지 않는다. R-19/20 |
| UI 국제화 | 앱 소유 문구·접근성·오류·형식화·내보내기 표제를 ko/en catalog로 제공. UI locale과 프로젝트 원문/식별자·digest 분리. R-25 |
| 동적 상태 | 모든 상태 보유 요소에 초기 상태·trigger/조건/효과·발생/가정·actor·시점/근거를 구분. missing은 unknown, 모호성·중복/연쇄는 명시 정책. scope/문서 status와 혼합 금지. R-26 |
| 실행기·스킬·MCP | provider capability별 지원 표시. 공통 domain service 사용. 버전/digest 고정 스킬, run overlay, 시크릿 분리. 직접 shell/API 부작용 전체를 관리 MCP와 같은 수준으로 보장하지 않는다. |

R-01~R-24는 기존 검토 식별자, R-25/26은 추가 사용자 요구의 설계 반영 식별자이며 제품 테스트 통과를 뜻하지 않는다. R-22는 범위가 제한되지 않은 세션의 지속 원칙이다. 현재는 사용자의 명시 요청에 따라 각 단계 완료 후 멈춘다. 사용자의 단계 4/5 요청과 UI 초안 승인 후 잔여 기능 구현 확정에 따라 단계 5와 6을 완료했고, 작업 007에서 보존 자료를 사용한 실행기 전환과 외부 요청 추적을 확인했다. 새 UI 요구는 별도 작업으로 관리한다.

## 결정한 기술 사항과 남은 판단

| 항목 | 현재 결정/기본값 | 후속 판단 시점 |
|---|---|---|
| 개발 위치 | 현재 `D:/git/CRAFT`, 앱 소스용 로컬 Git | 확정, 사용자 프로젝트는 별도 repo |
| 런타임·패키지 관리자 | 설치된 지원 LTS Node 24.21.0 / npm 11.19.0, exact lock | 업그레이드 시 환경 probe 재실행 |
| 검증기·YAML | Ajv2020 / yaml AST 기반 안전 정책 | 단계 1: 전체 schema·금지 문법·제한 구현 |
| SQLite | better-sqlite3 13.0.3, FTS5 사용 가능 확인 | 단계 4: worker·한국어 실원고·증분/복원 검증 완료, 대규모 성능은 9 |
| writer | node:fs 임시 파일+sync+close+rename, OS lease·expected hash·forward journal 복구 | 단계 3에서 프로세스 사망/부분 쓰기·외부 충돌 검증, 단계 9에서 전원/디스크·전체 장애 확대 |
| Git 작업 | task/run별 worktree·초기 checkpoint·선택 snapshot, 로컬/remote-tracking 보존 구분 | 단계 3 완료. UI 검토·통합은 단계 5/9, 실제 provider 재개는 단계 7 |
| UI·서버 | React/Vite + Fastify, SSE/HTTP, 기능 중심 UI | 단계 5 초안에서 React 19.3.1/Vite 8.3.8/Fastify 5.12.8와 Playwright/axe를 고정(ADR-012), SSE/수동 전체 흐름 완료(ADR-015), 실제 AI는 단계 6 |
| UI 언어 | 확정: 초기 ko/en, 모든 앱 문구와 접근성·오류·형식화, locale 전환 시 초안/정본 유지 | i18next 27.1.1/react-i18next 18.0.1·ko/en catalog 고정(ADR-012), 현재 웹 화면 인수 완료, 단계 6~8 새 화면에도 같은 gate 적용 |
| 동적 상태 | 확정: 일반 요소의 시간·조건·trigger 상태와 가정 비교. 설계: 공통 의미 모델·3값 조건·근거·비정본 평가 | 단계 4에서 state_model@1/AST/효과/한도·내장 reader pin·legacy adapter 고정(ADR-010). 전체 평가기 8 |
| CLI | 두 실행기 설치·버전만 확인, 인증 unknown | 단계 6: protocol/capability·취소·실제 smoke, 필요 시 Claude SDK |
| 타입 생성 | JSON Schema → json-schema-to-typescript 16.0.0, drift 검사 | 단계 1에서 선택·검증 완료 |
| schema 지원 범위 | 제품 core/narrative/game_design v1 + state_model@1, 별도 fixture registry의 core 1/2와 migration | 단계 2 지원표·결정/의미 검증 완료, 실제 제품 v2 미출시 |
| 이름·대형 자산 | CRAFT 가칭, assets 기본 | 변경 필요 시 이름/LFS 정책 결정 |
| 후속 범위 | 의미 검색·Bun·WSL·원격 runner·교차 repo 강한 참조 | 핵심 인수 기준 뒤 사용자 필요/실측에 따라 |

실제 의존/인용 의미, 초기 상태·시점·canon 여부, 서로 다른 변경안 채택, migration 새 필드의 의미, dirty 포함 선택은 원자료가 불명확할 때만 사용자 판단이 필요하다. 현재 환경·계획을 막는 질문은 없다. 자동 승인·자동 통합·원격 push 확대는 기본값으로 부여하지 않는다.

상태 모델의 namespace·조건/효과 AST·연쇄 한도·기존 narrative 초기값 단일 출처 매핑은 [ADR-010](adr/010-versioned-state-model.md)과 fixture로 결정했다. 색인 게시/격리·전체 그래프 재분석과 요청 시 refresh는 [ADR-011](adr/011-worker-index-and-generations.md)을 따른다. 실제 평가·관점/상태 충돌 검증은 단계 8, i18n 구현체/초기 리소스는 [ADR-012](adr/012-web-draft-and-local-session.md)로 결정했다. UI의 시각 방향·탐색/편집 흐름은 사용자 초안 검토를 기다린다. 자연어 조건의 업무 의미·입력 초기값이 없으면 임의 확정하지 않는다. [ADR-009](adr/009-ui-locales-and-state-planning.md)를 따른다.

## UI 피드백의 분류와 우선순위

FR-023~025는 사용자 확정 요구다. 기본 시스템 테마·분류 가능한 설정·한 열 탐색과 대시보드·크기/패널 제어·요소별 대화/문서 분할을 초안 02에 반영했다. 좌우 순서는 선택 가능하다는 후속 답변을 반영했다. 요구는 FR 25개/AT 66개이며 전체 인수 완료는 아니다.

설계 기준: 라이트를 기본 밝은 모드로 해석하고 초기 선호는 시스템, 로컬 Noto Sans KR/Inter와 14px UI/16px 본문, typed registry·로컬 선호 저장, 정확한 Reference 기반 bounded graph, 독립 working/메모 보관이다. 실제 AI 실행은 6이며 미연결 상태를 표시한다. 설치 폰트 인식은 browser API의 명시 동작/허용에 한정하고 직접 이름 입력으로 대체한다.

후순위/미결정: 추가 설정 항목, 더 정교한 graph layout/위치 저장·내보내기, 실제 OS/브라우저 글꼴 인식 확대, 고급 에디터·AI 자동 수정의 검토 UX. 핵심 데이터 의미나 기존 불변 조건을 바꾸지 않는 범위에서 피드백에 따라 확장한다. [ADR-013](adr/013-workspace-navigation-and-preferences.md)을 따른다.

## 그래프 추가 요구의 분류

2026-11-13 확정: 외부 오픈소스 우선 검토, 엔진 확장/사용자 선택, 연결 중심·주변 확산/군집·확대 이동. 현재 FR 26개/AT 68개다. 설계 선택은 내장 두 엔진과 공통 모델/renderer 분리, 표시 범위의 고유 이웃 수·유한 force/modularity 휴리스틱·SVG/HTML viewport다. 외부 최종 채택/실측·고급 배치/위치 저장 등은 미결정/후순위다. [검토](GRAPH_ENGINES.md), [ADR-014](adr/014-pluggable-relationship-graph.md)를 따른다. 기존 UI 피드백의 후순위 중 이번 요청 범위만 앞당긴다.

## 초기 범위에서 제외

자체 모델 학습, CLI 인증 대체/구독의 임의 API 전용, 완전 자동 의미·지식 검증, 초기 벡터/그래프 DB·Redis·Kubernetes, 실시간 공동 편집, 자동 push·무검토 merge, 모든 과거 schema 역변환은 초기 범위가 아니다. 제외 항목과 미구현 필수 요구를 혼동하지 않는다.

실제 게임 엔진 실행·플레이 세션 제어·실시간 연동, 프로젝트 원고/사용자 내용/에이전트·외부 로그 원문 자동 번역은 이번 추가 요구의 범위가 아니다.
