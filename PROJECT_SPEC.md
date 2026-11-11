# 창작·게임 기획 지식 관리 및 에이전트 작업 도구 — 요구사항·설계 명세

- 문서 버전: 1.2
- 작성일: 2026-11-10, Asia/Seoul
- 재검토: 2026-11-10. 요구사항 누락·설계 충돌·구현 판단 경계를 재점검했다. 변경 이유는 `REVIEW_NOTES.md`에 기록한다.
- 추가 개정: 2026-11-11. 사용자 요청과 후속 답변에 따라 UI 전체 한국어·영어 i18n, 일반 요소의 시간·트리거·조건부 상태 변화를 추가했다.
- 상태: 제품 설계 기준. 단계 0~4의 실제 구현·검증은 `docs/IMPLEMENTATION_STATUS.md`를 따른다. 추가 요구는 진단·상태 계약/색인 기반까지 구현했으며 UI/전체 평가기는 후속 단계다. 한 단계 완료 후 대기한다.
- 제품명: CRAFT(Context, References, Agents, Files, Tasks)
- 대상 독자: 이 대화 없이 새 Codex 세션에서 개발을 시작하는 구현자.
- 짝 문서: `START_HERE.md` — 새 세션 시작 지시문과 구현 순서.
- 검토 문서: `REVIEW_NOTES.md` — v1.1 검토 이력과 v1.2 추가 요구·설계 경계.

### 주요 절 바로가기

- [요구사항](#2-요구사항-목록)
- [실행 아키텍처](#4-기술-구성과-실행-아키텍처)
- [프로젝트 파일 구조](#5-원본-프로젝트-파일-구조)
- [공통 데이터 모델과 스키마](#6-공통-데이터-모델과-파일-스키마)
- [참조와 상태 전파](#7-참조역참조상태-전파)
- [소설·게임 확장](#8-분야별-확장-모델)
- [검색·문맥·재개](#9-검색문맥-구성재개)
- [Git·worktree와 통합](#10-gitworktree-작업과-통합)
- [에이전트·스킬·MCP](#12-에이전트-어댑터스킬mcp)
- [스키마 마이그레이션](#14-스키마-버전과-마이그레이션)
- [단계별 개발 계획](#18-단계별-개발-계획)
- [인수 시험](#19-필수-인수-시험)
- [미결정 및 기본값](#20-미결정-사항과-기본값)

## 0. 문서의 적용 방법

이 문서는 사용자가 논의에서 요청한 요구사항과, 이를 구현하기 위한 구체적인 설계 제안을 함께 기록한다. 다음 표기를 구분한다.

- **확정 요구**: 사용자가 명시했거나 논의에서 유지된 제품 요구사항. 구현자가 임의로 제거하지 않는다.
- **설계 기준**: 요구사항을 충족하기 위한 이 문서의 기본 선택. 구현 중 근거를 남기고 조정할 수 있다.
- **미결정**: 사용자 선호 또는 기술 검증이 필요한 부분. 독립 작업을 먼저 진행하고, 의존 작업 전 결정을 받거나 명시된 기본값을 사용한다.

요구사항의 출처도 구분한다. Git 파일 정본, 재구축 가능한 DB, 작업별 worktree, 두 CLI, 웹 UI, Node/Bun, 스키마 마이그레이션은 사용자의 명시 요구다. 세부 제품 행동인 reader 관점·구현 관찰·승인 절차·로컬 우선·정확한 상태 enum·의미 검색의 후속 도입 등은 이를 구체화한 설계 기준이며, 과거 답변에서 제안했다는 이유만으로 사용자가 모든 세부에 동의한 것으로 취급하지 않는다.

2026-11-11 추가 사용자 요구는 UI 모든 요소의 다국어 지원과, 소설·게임 요소가 시간·트리거·조건에 따라 갖는 상태의 관리다. 초기 UI 언어는 **한국어·영어**, 게임 범위는 **기획 규칙 작성과 가정 입력에 따른 상태 조회·비교**로 확인했다. 실제 게임 실행·실시간 연동은 이번 요구가 아니다. 아래의 구체적인 조건 평가·파일 계약 선택은 요구를 실현할 설계 기준으로 구분한다. 문서 버전 1.2는 제품 core/extension schema 버전 2를 뜻하지 않는다.

개발 계획의 첫 작업 범위와 제품 전체 요구를 구분한다. 단계 0~2를 끝냈다는 이유로 소설·게임·두 실행기까지 지원하는 제품이 완료됐다고 표시하지 않는다. 사용자가 필요한 세부 기능을 줄이는 변경은 확인해야 하지만, 20절의 기술 기본값은 구현자가 ADR로 결정해 진행한다.

예시의 ID, 수치, 인물, 경로는 설명용이다. 기술 스택의 정확한 패키지 버전과 외부 CLI 프로토콜은 구현 시 공식 문서 및 설치 버전으로 검증하고 lockfile에 고정한다. 이 문서에서 제안하는 내부 API와 파일 형식은 기존 제품의 기능이 아니라 새로 구현할 사양이다.

## 1. 제품 목표와 배경

장편 소설 및 게임 기획은 한 번의 모델 컨텍스트에 담을 수 없는 정보가 누적된다. 필요한 정보를 검색할 뿐 아니라, 현재 작업 시점·버전·관점에서 유효한 정보만 선택해야 한다. 대화 기록이 끊기거나 모델을 교체해도 작업을 재개할 수 있어야 한다.

제품의 목표는 다음 네 가지다.

1. 소설과 게임 기획을 같은 프로젝트 기반에서 관리하되 각 분야의 조회 규칙을 분리한다.
2. 요소·리비전·참조를 명시하여 변경 영향과 상태 전파를 기계적으로 검사한다.
3. Git 프로젝트 파일을 유일한 정본으로 사용하고 DB는 삭제 가능한 색인으로 취급한다.
4. 웹 UI에서 로컬 Claude Code·Codex에 작업을 지시하고 작업별 임시 worktree에서 실행한다.

완료된 제품에서 가능한 요청 예:

- “10화 3장면 직전 ABCDE의 상태와 알고 있는 사실을 보여줘.”
- “ABCDE가 모르는 비밀을 제외하고 다음 대사를 작성해줘.”
- “PvE 기획 기준 0.4에서 회피 규칙과 채택 이유를 찾아줘.”
- “스태미나 규칙 변경에 영향받는 문서와 검토할 항목을 보여줘.”
- “이 초안을 Codex로 수정하고, 기존 참조가 여전히 유효한지 검사해줘.”
- “새 Claude 세션에서 중단한 기획을 이어가자.”

## 2. 요구사항 목록

### 2.1 기능 요구사항

| ID | 요구사항 | 구분 |
|---|---|---|
| FR-001 | 소설·게임 기획 프로젝트 및 공통 지식 구조 지원 | 확정 요구 |
| FR-002 | 로컬 Git 저장소와 원격 저장소 URL로 프로젝트 열기 | 확정 요구 |
| FR-003 | 요소마다 고유 ID, 내용 리비전, 상태, 태그, 적용 범위 관리 | 확정 요구 |
| FR-004 | 의미 있는 참조는 대상 ID와 리비전을 함께 고정 | 확정 요구 |
| FR-005 | 직접·간접 역참조, 변경 영향, 새 버전 존재 검사 | 확정 요구 |
| FR-006 | 논의중·초안 등 의존 상태의 전파와 이유 경로 표시 | 확정 요구 |
| FR-007 | 정확 조회, 전문 검색, 관계 탐색, 버전 비교 지원 | 확정 요구 |
| FR-008 | 소설의 시점별 상태·인식·공개 정보 조회 | 확정 요구 |
| FR-009 | 게임 기획의 버전·모드·플랫폼별 유효 규칙 조회 | 확정 요구 |
| FR-010 | 목표·결정·미결정 사항·진행 중 결과물을 보존하고 새 세션에서 재개 | 확정 요구 |
| FR-011 | 설치된 Claude Code·Codex 감지 및 선택 | 확정 요구 |
| FR-012 | 웹 UI에서 에이전트 작업 지시·진행 확인·중단·결과 검토 | 확정 요구 |
| FR-013 | 기본 제공 스킬과 프로젝트·사용자 스킬 사용 | 확정 요구 |
| FR-014 | 내부 지식 기능과 외부 API 기능을 MCP로 사용 | 확정 요구 |
| FR-015 | 에이전트 작업 전 별도 브랜치·임시 worktree 생성 | 확정 요구 |
| FR-016 | 프로젝트 파일만으로 DB 및 검색 색인 재구축 | 확정 요구 |
| FR-017 | 처음부터 스키마 버전과 단계별 마이그레이션 지원 | 확정 요구 |
| FR-018 | 변경안 검증, 충돌 표시, 검토 후 통합 | 설계 기준 |
| FR-019 | 기준 묶음과 고정된 문맥으로 결과의 근거 추적 | 설계 기준 |
| FR-020 | 자연어 요청과 구조화된 조회를 동일한 도메인 서비스로 처리 | 설계 기준 |
| FR-021 | 모든 앱 UI 요소의 i18n, 초기 한국어·영어 지원과 언어 전환 | 확정 요구 |
| FR-022 | 일반 요소의 시간·트리거·조건부 상태 변화 정의, 시점·가정별 상태 조회·비교와 근거 추적 | 확정 요구 |

### 2.2 비기능 요구사항

- **복원성**: 캐시 DB, 임베딩, 브라우저 저장소, 공급자 세션이 없어도 Git 파일에서 핵심 상태를 복원한다.
- **격리**: 작업 A는 작업 B 또는 기본 작업 공간의 변경·검색 결과와 섞이지 않는다.
- **추적성**: 검색·문맥·변경안에 요소 ID, 리비전, 근거를 제공한다.
- **일관성**: 잘못된 참조를 최신 버전으로 조용히 대체하지 않는다.
- **검증 가능성**: 필수 기계 검사는 모델 응답 없이 실행된다.
- **이식성**: 프로젝트에 절대 경로·계정 토큰·사용자 홈 경로를 필수 정보로 저장하지 않는다.
- **실패 안전성**: 중단·취소·마이그레이션 실패가 원본 및 미보존 작업을 삭제하지 않는다.
- **로컬 우선**: 첫 제품은 단일 사용자의 로컬 서버와 브라우저 UI. 원격 Git은 지원하되 다중 사용자 SaaS는 별도 범위다.
- **국제화**: 앱이 생성하는 UI 문구·접근성 설명·오류·형식 표시는 15.4절을 따른다. UI 언어와 프로젝트 원문 언어를 독립적으로 관리한다.
- **상태 재현성**: 같은 snapshot/baseline·시점·actor·입력 사건·가정으로 계산한 상태는 동일해야 한다. 문서 승인 상태와 세계/게임 상태, 정본 사건과 가정 결과를 혼합하지 않는다.
- **런타임**: Bun 또는 Node.js 기반. 기본 구현은 Node.js + TypeScript, Bun은 연결부 격리 후 호환 검증한다.
- **검증 성능 목표**: 초기 기준 데이터 1,000요소/10,000리비전에서 정확 조회 p95 200ms, 증분 점검 1초, 전체 재구축 30초를 잠정 목표로 측정한다. 모델·네트워크 시간은 제외하며 실제 결과에 따라 조정한다.

### 2.3 초기 범위에 포함하지 않는 것

- 자체 LLM 학습, CLI 인증 체계 대체, 구독 인증을 임의의 모델 API로 전용하는 기능.
- 문장 의미의 완전 자동 검증, 소설 전체의 완벽한 자동 지식 추출.
- 초기부터 별도 벡터 DB·그래프 DB·Redis·Kubernetes 운영.
- 실시간 다중 사용자 공동 편집, 자동 원격 게시·push, 무검토 자동 merge.
- 모든 과거 스키마로의 역변환.
- 실제 게임 엔진 실행, 플레이 세션 운용·실시간 게임 연동. 조건부 기획의 작성·가정 평가를 게임 런타임으로 확장하지 않는다.

### 2.4 요구사항 추적표

| 요구사항 | 주 구현 단계 | 대표 검증 |
|---|---|---|
| FR-001 | 1, 8 | AT-03~06, AT-23 |
| FR-002 | 3 | AT-01, AT-19, AT-30 |
| FR-003 | 1, 5 | 스키마·리비전 불변성 테스트 |
| FR-004 | 1, 4 | AT-09~10, AT-29 |
| FR-005 | 4, 9 | AT-09~12 |
| FR-006 | 4 | AT-07~08 |
| FR-007 | 4, 8 | AT-23~24, exact/diff 테스트 |
| FR-008 | 8 | AT-03~06, AT-29 |
| FR-009 | 8 | AT-23, 기획/관찰 분리 테스트 |
| FR-010 | 3, 7 | AT-02, AT-27 |
| FR-011 | 6 | detect/capability 계약 테스트 |
| FR-012 | 5~7 | AT-20, AT-25, 공급자 smoke test |
| FR-013 | 7 | 스킬 digest·실행기별 호출 테스트 |
| FR-014 | 6~7 | AT-11, 내부/외부 MCP fixture |
| FR-015 | 3, 6 | AT-11, AT-19~20 |
| FR-016 | 4 | AT-01~02, AT-26 |
| FR-017 | 2, 9 | AT-14~18 |
| FR-018 | 5, 9 | AT-12~13, AT-21~22 |
| FR-019 | 4, 7 | 문맥 manifest·재현 테스트 |
| FR-020 | 5, 6, 8 | REST/MCP/명령의 동일 서비스 계약 테스트 |
| FR-021 | 4(오류 계약), 5(UI 기반), 6~8(모든 추가 UI), 9 | AT-51~53 |
| FR-022 | 4(파일·참조·색인 계약), 5(편집 기반), 8(조회·비교 완성), 9 | AT-54~60 |

## 3. 핵심 용어와 불변 조건

| 용어 | 정의 |
|---|---|
| 프로젝트 | 하나의 Git 저장소에 저장되는 지식·문서·작업 묶음 |
| 요소 Entity | 인물, 스킬, 시스템, 문서, 사실, 장면, 상태 변화 등 고유 ID를 가진 대상 |
| 리비전 Revision | 특정 요소의 내용·직접 상태·참조가 고정된 버전 |
| 기준 묶음 Baseline | 프로젝트에서 채택한 요소별 리비전의 명시적 집합 |
| 참조 Reference | 출발 리비전에서 대상 요소 ID·리비전을 가리키는 유형 있는 연결 |
| 파생 상태 | 참조 그래프를 계산해 얻은 차단 사유·경고 등. 원본 상태와 구분 |
| 세계/게임 상태 | 특정 시점·actor·가정에서의 소유권·국경·위치·체력·퀘스트 단계 등 업무 값. 문서 status와 구분 |
| 상태 변화 정의 | 대상·발생 계기·조건·효과를 기술한 기획 규칙. 정의 존재와 실제 발생은 다름 |
| 사건 발생 기록 | 해당 세계에서 사건이 발생했다는 시간·근거가 고정된 기록 |
| 가정 시나리오 | 명시한 초기 상태·actor·입력 사건으로 평가하는 비정본 입력 묶음 |
| Git 스냅샷 | 특정 커밋과 필요시 작업 파일의 내용 지문으로 식별하는 파일 집합 |
| 작업 Task | 사용자의 목표, 입력 기준, 체크포인트, 변경안을 보존하는 프로젝트 기록 |
| 실행 Run | 특정 실행기·환경에서 작업을 수행한 한 번의 시도 |
| 문맥 묶음 | 요청에 맞게 필터링한 자료와 정확한 리비전·출처의 목록 |
| 형식 마이그레이션 | 내용 의미를 유지하며 프로젝트 파일 표현을 새 스키마로 변환 |

필수 불변 조건:

1. DB에는 파일에 없는 정본 지식을 만들지 않는다.
2. 정본 리비전의 내용·상태·참조 변경은 새 리비전으로 저장한다. 예외는 검증된 형식 마이그레이션뿐이다.
3. 의미 있는 의존 참조는 `entity_id + revision_id`를 포함한다.
4. 높은 리비전 번호·최근 생성 시간이 자동으로 현재 채택 상태가 되지 않는다.
5. 에이전트의 성공 메시지나 종료 코드만으로 정본 반영을 완료하지 않는다.
6. 검색·참조 확장·MCP 추가 조회는 동일한 프로젝트·worktree·baseline·관점 조건을 지킨다.
7. 확정되지 않은 초안이 확정 지식으로 자동 승격되지 않는다.
8. 복구 불가능한 임시 상태가 남아 있으면 worktree를 자동 제거하지 않는다.
9. 사람이 직접 파일을 수정한 경우도 앱과 같은 검증을 통과해야 한다.

위 불변 조건은 동적 상태에도 적용한다. 세계에서 1장→5장으로 시간이 흐르는 것은 문서의 새 revision 선택이나 `draft→approved` 변경이 아니다. 정의를 수정하면 새 revision을 만들고, 조회·가정 평가는 고정된 정의와 입력을 읽어 파생 결과를 계산한다. UI 언어 전환은 정본 파일·ID·enum·검토 digest·상태 계산 결과를 변경하지 않는다.

## 4. 기술 구성과 실행 아키텍처

### 4.1 기본 스택

| 영역 | 기본 선택 | 주의점 |
|---|---|---|
| 언어 | TypeScript | 공통 도메인은 런타임 의존성 최소화 |
| 런타임 | Node.js의 지원 중인 LTS | 정확 버전은 착수 시 고정, Bun 전용 기능은 core에서 금지 |
| 프런트엔드 | React + Vite | UI 라이브러리는 착수 시 선택 |
| 서버 | Fastify | 로컬 REST API 및 SSE |
| 원본 형식 | UTF-8 YAML + Markdown + JSON Schema | YAML 안전 파싱, 임의 코드·사용자 태그 실행 금지 |
| 스키마 | JSON Schema Draft 2020-12 + Ajv | Zod는 API 검증 보조. 디스크 형식의 기준은 JSON Schema |
| 색인 | SQLite + FTS5 | SQLite 드라이버는 Node·배포환경 실험 후 고정 |
| 프로세스 | 런타임별 spawn 어댑터 | shell 문자열 조립 금지, Windows shim 별도 검증 |
| 작업 큐 | 앱 제어 서비스 + 재구축 가능한 큐 색인 | Redis 없이 시작 |
| UI 이벤트 | SSE + HTTP 명령 | 재접속 이벤트 커서 지원 |
| 에이전트 | Codex App Server / Claude Code CLI 및 필요시 Agent SDK | 버전별 capability 탐지 |
| 도구 연결 | MCP TypeScript 기반 서버 | 내부 API와 같은 도메인 서비스를 호출 |
| 테스트 | Vitest, 브라우저 E2E 도구 | Git fixture와 가짜 실행기 필수 |

### 4.2 구성도

```text
브라우저 UI
   │ REST / SSE
로컬 제어 서버
   ├─ 프로젝트·Git·worktree 관리자
   ├─ 작업·실행·이벤트 관리자
   ├─ 변경안·검증·통합 서비스
   ├─ 버전·상태·문맥·검색 도메인 서비스
   ├─ 스키마·마이그레이션 실행기
   └─ 에이전트 어댑터
          ├─ Codex App Server
          └─ Claude Code CLI / Agent SDK
                 │
                 ├─ 작업별 내부 MCP → 같은 도메인 서비스
                 └─ 허용된 외부 MCP → 외부 API

원본: Git 프로젝트 파일 / 작업 브랜치 / 기준 묶음
파생: worktree별 SQLite·전문 검색·임베딩
로컬 실행 보조: 프로세스 정보·이벤트 로그·자격증명 연결
```

의존 방향은 `UI/REST/MCP → application services → domain → filesystem/git/index adapters`다. MCP에만 구현한 핵심 로직을 만들지 않는다. Git·파일·SQLite·실행기 어댑터는 교체 가능해야 한다.

### 4.3 로컬과 원격의 의미

- 로컬 저장소: 사용자가 선택한 기존 Git 저장소를 등록한다.
- 원격 저장소: URL을 로컬 앱 관리 경로에 clone하고 이후 동일하게 처리한다.
- 원격 Git을 지원한다는 것은 클라우드에서 사용자의 로컬 CLI를 바로 실행한다는 뜻이 아니다.
- 첫 버전에서는 로컬 서버가 설치된 실행기를 호출한다. 원격 서버형 UI는 후속 로컬 runner 연결 방식으로 확장한다.
- fetch는 원격 상태 확인, 통합은 로컬 파일 변경, push는 원격 반영으로 구분한다. 기본 동작에서 push를 자동 수행하지 않는다.

## 5. 원본 프로젝트 파일 구조

### 5.1 표준 디렉터리

```text
project/
├─ project.yaml
├─ README.md
├─ .gitignore
├─ schemas/
│  ├─ lock.json
│  └─ extensions/
│     └─ studio.example/
│        └─ v1/schema.json
├─ entities/
│  └─ ent_dodge/
│     ├─ entity.yaml
│     └─ revisions/
│        ├─ rev_dodge_a/
│        │  ├─ meta.yaml
│        │  └─ content.md
│        └─ rev_dodge_b/
│           ├─ meta.yaml
│           └─ content.md
├─ baselines/
│  ├─ baseline_main.yaml
│  └─ baseline_release_04.yaml
├─ reviews/                      # 정확한 리비전·입력에 고정된 검토 기록
├─ narrative/
│  └─ sequences/
│     └─ seq_main.yaml
├─ tasks/
│  └─ task_01/
│     ├─ task.yaml
│     ├─ brief.md
│     ├─ checkpoints/
│     │  └─ cp_01.yaml
│     ├─ decisions.md
│     ├─ working/
│     │  └─ tutorial-draft.md
│     └─ proposals/
│        └─ proposal_01.yaml
├─ skills/
│  └─ design-document/
│     ├─ SKILL.md
│     └─ skill.yaml
├─ integrations/
│  └─ mcp.yaml
├─ assets/
└─ migrations/
   └─ history/
      └─ mig_01.yaml
```

정식 결정 기록은 `kind: decision` 요소로 저장한다. 작업 폴더의 `decisions.md`는 논의 경위·인계 기록이며 정식 결정의 별도 정본을 만들지 않는다.

### 5.2 project.yaml 예시

```yaml
project_id: prj_example
schema_version: 1
name: 예시 프로젝트
language: ko
default_baseline_id: baseline_main
extensions:
  narrative:
    schema_version: 1
    required: true
  game_design:
    schema_version: 1
    required: true
policies:
  approval_blocks_on_dependency_states: [discussing, draft, in_review]
  missing_reference: error
  implicit_latest_reference: forbidden
```

`project_id`는 저장소 clone·이동 이후에도 같다. 로컬 등록 ID와 worktree ID는 별도다. `schema_version`은 파일 형식용 정수이며 앱 semver와 구분한다. 전역 형식 버전과 확장 버전은 manifest에서 관리하며 활성 개별 요소 파일에 반복하지 않는다. task의 `base.schema_versions` 같은 값은 실행 기준의 역사 기록이지 그 task 파일을 구 스키마로 해석하라는 표식이 아니다.

`language`는 프로젝트 원문·작성 언어다. 앱 UI locale과 독립이며 언어 전환 시 이 필드를 덮어쓰지 않는다.

### 5.3 저장 규칙

- 경로는 프로젝트 상대 경로, 직렬화된 구분자는 `/`로 통일한다.
- ID는 플랫폼 간 충돌이 없는 ASCII 제한 문자 집합을 사용한다. 구현은 UUIDv7 등 충돌 저항성 ID 생성기를 사용하고 fixture의 짧은 ID는 예시로만 사용한다.
- 표시 이름·별칭은 한국어 및 Unicode 허용. 이름 변경은 ID 변경이 아니다.
- 파일 정렬·개행·YAML 직렬화 규칙을 고정해 불필요한 diff를 줄인다.
- `entity.yaml`에는 최소한의 정체성만 저장한다. 제목·별칭·도메인 데이터는 리비전에 포함해 과거 상태를 복원한다.
- Git에 등록할 모든 내용은 비밀이 아닌 프로젝트 데이터여야 한다. 토큰·절대 worktree 경로·공급자 인증 파일은 포함하지 않는다.
- 파일 제거는 참조 무결성 검사 대상이다. 참조된 과거 리비전은 물리 삭제 대신 폐기 리비전으로 처리하는 것을 기본으로 한다.
- 다중 파일 변경은 staging에서 완성한 뒤 worktree 쓰기 잠금 안에서 반영하고, 전체 검증을 통과한 Git 커밋을 복원 가능한 경계로 삼는다. 파일시스템 전체 rename이 원자적이라고 가정하지 않는다.

### 5.4 로컬 앱 데이터: 정본과 분리

```text
<app-data>/
├─ registrations/          # 저장소 경로·remote 매핑, 파일 기반 복원 가능
├─ managed-repositories/   # 앱이 clone한 저장소
├─ worktrees/<run-id>/     # 임시 Git worktree
├─ caches/<scope>/         # SQLite·FTS·임베딩, 삭제 가능
├─ runs/<run-id>/          # 이벤트 JSONL, 프로세스 lease, 복구 journal
└─ credentials/            # OS 보안 저장소 사용 우선, Git 제외
```

프로젝트 파일만 전달받은 새 환경에서는 작업 의미와 결과를 복원한다. 이전 PC의 실행 중 PID·실시간 승인 요청·정확한 모든 토큰 로그까지 재현한다고 보장하지 않는다. 앱 로컬 로그는 운영 보조이며, 재개에 필수인 내용은 체크포인트로 프로젝트 파일에 저장한다.

## 6. 공통 데이터 모델과 파일 스키마

### 6.1 요소 정체성

```yaml
# entities/ent_dodge/entity.yaml
id: ent_dodge
kind: game.rule
```

초기 공통 kind: `document`, `decision`, `world.fact`, `location`, `item`. 소설 확장: `narrative.character`, `narrative.scene`, `narrative.state_event`, `narrative.knowledge_event`, `narrative.reveal_event`. 게임 확장: `game.system`, `game.rule`, `game.skill`, `game.item`, `game.parameter`, `game.observation`.

kind의 의미가 근본적으로 바뀌는 경우 ID 재사용 대신 새 요소와 `replaces` 관계를 만든다. kind enum 확장은 스키마 확장 규칙으로 수행한다.

### 6.2 리비전 예시

```yaml
# entities/ent_dodge/revisions/rev_dodge_b/meta.yaml
entity_id: ent_dodge
revision_id: rev_dodge_b
parents: [rev_dodge_a]
label: 회피 규칙 0.4 초안
title: 회피
aliases: [구르기]
status: draft
tags: [전투, 이동]
created_at: '2026-11-10T02:00:00Z'
created_by: {type: agent, id: codex, task_id: task_01}
scope:
  continuity: main
  platform: [pc]
  mode: [pve]
body_path: content.md
references:
  - reference_id: ref_stamina
    target: {entity_id: ent_stamina, revision_id: rev_stamina_a}
    relation: depends_on
    propagation: blocking
    update_policy: track_approved
    rationale: 회피 소비 자원을 결정하는 규칙
extensions:
  game_design:
    category: movement
    invulnerability_seconds: 0.2
    stamina_cost: 15
```

필수 필드: `entity_id`, `revision_id`, `parents`, `title`, `status`, `scope`, `body_path`, `references`, `extensions`, `created_at`, `created_by`. `aliases`와 `tags`는 생략 시 빈 배열로 해석한다. 예시에서 body는 동일 디렉터리의 Markdown이다. body_path는 리비전 디렉터리 밖을 가리킬 수 없다. 저장 시 정규화된 기본값을 기록하되, 읽기만으로 파일을 수정하지 않는다.

리비전은 생성 시 고정한다. 사용자 입력 중인 내용은 `tasks/.../working/`에서 자동 저장하고 명시적인 초안 저장·변경안 생성 때 새 리비전을 만든다. 매 키 입력마다 정본 리비전을 생성하지 않는다. 상태 변경도 새 리비전이며 `parents`로 연결한다.

`parents`는 동일 요소의 기존 리비전만 가리킨다. 리비전 그래프는 DAG이며 생성 시간으로 인과관계를 추정하지 않는다. 서로 다른 병렬 후속 리비전은 한쪽을 자동으로 최신으로 선택하지 않는다.

### 6.3 최소 JSON Schema 골격

다음은 구현자가 구체화할 핵심 계약이다. 실제로는 프로젝트·요소·리비전·기준 묶음·작업·제안·확장마다 완전한 JSON Schema를 작성한다.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "urn:workbench:schema:core:1:reference",
  "type": "object",
  "additionalProperties": false,
  "required": ["reference_id", "target", "relation", "propagation", "update_policy"],
  "properties": {
    "reference_id": {"type": "string", "pattern": "^[A-Za-z0-9_-]+$"},
    "target": {
      "type": "object",
      "additionalProperties": false,
      "required": ["entity_id", "revision_id"],
      "properties": {
        "entity_id": {"type": "string", "minLength": 1},
        "revision_id": {"type": "string", "minLength": 1},
        "anchor_id": {"type": "string", "minLength": 1}
      }
    },
    "relation": {"enum": ["depends_on", "evidence", "cites", "compares", "replaces", "related_to"]},
    "propagation": {"enum": ["blocking", "advisory", "none"]},
    "update_policy": {"enum": ["pinned", "track_approved", "track_all"]},
    "rationale": {"type": "string"}
  }
}
```

JSON Schema는 구조를 검증한다. 존재하지 않는 참조·리비전 DAG 순환·단위 불일치·권한 등은 도메인 validator가 검증한다. 확장 필드는 선언된 namespace 안에서만 허용하고, 알 수 없는 namespace는 보존하되 해당 내용을 해석한 것처럼 표시하지 않는다. 지원하지 않는 필수 확장이 있으면 쓰기를 차단한다. 7.4절은 확장 안의 참조도 위 JSON Schema와 동일한 완전한 Reference 객체로 쓰도록 규정한다.

### 6.4 상태·태그·파생 진단

직접 상태 enum:

| 값 | UI 표시 | 의미 |
|---|---|---|
| discussing | 논의중 | 선택·합의 전 |
| draft | 초안 | 작성되었지만 검토 전 |
| in_review | 검토중 | 검토 진행 |
| approved | 확정 | 해당 내용이 채택 가능한 상태 |
| deprecated | 폐기 | 신규 적용 비권장, 과거 참조 보존 |

태그는 자유 분류다. `status`의 대체 수단으로 자유 문자열 `논의중`을 사용하지 않는다. 파생 상태는 직접 status를 덮어쓰지 않는다.

이 enum은 문서의 작성·검토 수명주기다. 국경·점령·생존·문 개폐·플레이어/NPC 조건 충족 등의 업무 상태는 8.5절의 상태 모델로 관리하며 이 enum에 추가하지 않는다. 위 UI 표시는 한국어 예시이고 영어 표시는 번역 리소스에서 제공한다. 정본 enum은 locale과 무관하게 유지한다.

진단 예: `UNRESOLVED_DEPENDENCY`, `NEW_APPROVED_REVISION`, `DIVERGENT_REVISIONS`, `MISSING_TARGET`, `DEPRECATED_TARGET`, `REVIEW_REQUIRED`, `SCOPE_MISMATCH`, `INDEX_STALE`.

진단에는 severity, source entity/revision, reference ID, target, 경로, 해결 후보, 계산한 snapshot을 포함한다. 정본 baseline 정책에 따라 error와 approval block을 구분한다. 탐색용 초안에서는 경고를 허용할 수 있지만 누락 참조는 완료된 변경안의 hard error다.

### 6.5 기준 묶음

```yaml
id: baseline_main
name: 현재 PvE 기획
kind: working
scope: {continuity: main, mode: [pve], platform: [pc]}
selected:
  ent_dodge: rev_dodge_b
  ent_stamina: rev_stamina_a
closure_policy: require_selected_dependencies
```

- baseline은 현재 선택 상태이므로 Git으로 변경 이력을 관리하는 mutable 파일이다.
- 일반 `selected`에는 초안도 들어갈 수 있으나 UI에서 실제 상태와 파생 차단 사유를 표시한다.
- `kind: release` baseline은 선택된 모든 요소에 대해 확정·유효 검토·적용 의존 참조 폐쇄성 검증을 통과해야 한다.
- `depends_on`의 적용 의존 대상은 선택된 리비전과 일치해야 한다. 같은 요소의 v1과 v2를 활성 적용 규칙으로 동시에 요구하면 충돌이다. 인용·비교·증거·과거 사건 근거가 예전 리비전을 가리키는 것은 허용한다. 전체를 암묵적으로 v2로 치환하지 않는다.
- 과거 리비전 열람은 exact 모드로 원래 참조를 유지한다. 현재 baseline과 다른 경우 차이를 보여준다.
- baseline 자체의 재현은 baseline ID만으로 충분하지 않다. Git snapshot도 함께 지정한다.

baseline의 `selected`는 현재 적용·집필에 참여하는 요소 집합이다. 저장소 안에 존재하는 모든 초안·과거 이벤트가 활성인 것은 아니다. 정확 리비전 조회는 비선택 리비전도 반환할 수 있지만 현재 채택된 것처럼 표시하지 않는다. `working` baseline에서는 closure mismatch를 갱신 검토 진단으로 허용하고 release 승격 때 차단한다.

한 baseline에서 한 요소는 한 리비전만 선택한다. PvE/PvP 등 동일 요소의 여러 적용 변형이 필요하면 첫 버전은 baseline을 나누거나 변형을 별도 요소로 만든다. 한 baseline에서 scope에 따라 임의로 다른 리비전을 자동 선택하는 기능은 제공하지 않는다.

### 6.6 검토·승인과 폐기

`approved`는 작성자가 선언한 상태이고, 반영 가능 여부는 별도 검토·의존성 검사로 계산한다. 승인 권한과 관계없이 에이전트가 `status: approved`를 써서 release 검사를 우회할 수 없어야 한다.

```yaml
# reviews/review_01.yaml
id: review_01
subject: {entity_id: ent_dodge, revision_id: rev_dodge_approved}
semantic_model_version: 1
subject_semantic_digest: '<sha256>'
dependency_manifest_digest: '<sha256>'
scope: {continuity: main, platform: [pc], mode: [pve]}
outcome: accepted
reviewer: {type: user, id: local-user}
created_at: '2026-11-10T05:00:00Z'
```

검토한 초안에서 승인 리비전·검토 레코드·baseline 선택을 하나의 변경 세트로 만든다. 검토 결과는 최종 승인 리비전 ID와 그 의미 내용/입력 digest에 고정한다. 본문·적용 참조·scope가 바뀌면 재검토한다. 기본 release 반영에는 사용자 검토가 필요하며, 자동 승인 권한은 별도의 명시 정책 없이는 부여하지 않는다. 모든 검토 기록은 불변 추가 파일이며 원본의 Git 이력으로 보존한다.

폐기는 과거 approved 파일을 수정해 기록을 지우는 동작이 아니다. 부모를 가리키는 새 deprecated 리비전을 만들고 현재 baseline에서 채택한다. 현재 baseline이 deprecated를 선택하면 같은 요소의 과거 리비전을 적용하는 문서에 `DEPRECATED_IN_BASELINE`을 표시한다. 다른 분기에서 만든 미채택 deprecated 초안만으로 전역 폐기하지 않는다. 과거 snapshot을 조회하면 그 당시 상태를 그대로 재현한다.

## 7. 참조·역참조·상태 전파

### 7.1 참조의 유형과 해석

| 관계 | 기본 전파 | 용도 |
|---|---|---|
| depends_on | blocking | 규칙·공식을 실제 적용 |
| evidence | advisory | 결정·설계의 근거 |
| cites | none | 인용 |
| compares | none | 과거안·폐기안과 비교 |
| replaces | none | 이전 대상을 대체 |
| related_to | none | 연관 탐색 |

스키마에 허용된 범위에서 propagation을 명시적으로 바꿀 수 있다. 변경 이유를 기록한다. 부모 리비전 연결과 업무상 의존 참조는 다른 그래프다.

Markdown 본문의 일반 링크는 탐색용일 수 있다. 기계적 영향 검사를 보장하려면 meta의 구조화 참조로 등록해야 한다. UI에서 `@요소` 삽입 시 실제 ID·리비전 참조를 생성하고 본문은 reference_id 마커로 연결한다. 서술 중 중요 의존성이 참조로 등록되지 않은 문제는 기계적으로 완전 보장할 수 없고 별도 AI 검토로 보완한다.

### 7.2 전파 알고리즘

1. 현재 snapshot의 고정 리비전을 노드로 삼는다.
2. blocking 간선을 따라 의존 대상의 직접 상태와 진단을 계산한다.
3. unresolved 상태 또는 hard error가 있으면 출발 노드에 blocker와 원인 경로를 붙인다.
4. advisory 간선은 주의 진단만 전파하고 직접 상태·확정 여부를 자동 변경하지 않는다.
5. 중복 원인은 안정된 진단 키로 합치고 경로 수·표시 길이를 제한한다.
6. SCC(강연결요소) 또는 방문 집합으로 순환을 처리한다. 리비전 부모 DAG의 순환은 오류, 업무 의존 순환은 유한하게 계산하며 별도 진단한다.

초기 정책에서 blocking 의존 순환은 working baseline에 진단하며 release/확정 반영은 차단한다. 상호 소속·관계·사건 참여 같은 정체성 연결을 blocking 의존으로 모델링하지 않는다. 필요시 공통 규칙을 독립 요소로 추출한다. 초안 A↔B를 서로 고정 참조하게 만들어 승인 리비전을 영원히 만들지 못하는 구조를 피한다.

직접 approved이지만 draft 의존성을 가진 요소는 `approved + approval_blocked`로 표시할 수 있다. 새 승인/출시 반영은 차단하지만 원래 상태를 draft로 자동 변경하지 않는다.

### 7.3 새 버전 검사

- `pinned`: 새 버전 존재는 정보 표시. 의도된 과거 기준을 갱신 요구로 취급하지 않는다.
- `track_approved`: 적용 범위가 호환되는 approved 후속 리비전이 있으면 갱신 검토 경고.
- `track_all`: 초안·논의중을 포함한 호환 후속 리비전도 알림.
- 리비전의 후속 관계는 parents 그래프로 확인한다. 분기된 형제 리비전은 `DIVERGENT_REVISIONS`이며 시간으로 우열을 정하지 않는다.
- scope 호환성은 명시 규칙으로 계산한다. PvP 후속 리비전이 있다는 이유로 PvE 문서에 필수 갱신 경고를 내지 않는다.
- 자동 참조 교체는 하지 않는다. 갱신은 새 출발 리비전·본문 검토·baseline 변경으로 수행한다.
- 참조 대상만 교체해도 본문이 의미상 맞는 것은 아니다. 검토 기록은 검토한 입력 리비전 집합에 고정한다.

갱신 후보는 현재 파일 snapshot에서 읽을 수 있는 리비전에 한정한다. 다른 작업 브랜치의 미통합 리비전은 별도의 '다른 작업 변경' 화면에 표시하고 현재 프로젝트의 새 버전이라고 혼합하지 않는다. 선택한 baseline이 후속 리비전을 채택한 경우와 저장소에 단지 후보가 존재하는 경우도 구분한다.

`draft@A`의 승인 후속 `approved@B`가 생겨도 A를 고정 참조하는 문서의 파생 차단은 자동 해제되지 않는다. A는 여전히 draft다. '승인 버전으로 갱신 가능'을 표시하고 문서가 B를 참조하는 새 리비전을 저장·검토했을 때 해제한다. 자동 상속은 직접 status 덮어쓰기 대신 파생 배지로 구현한다는 의미다.

### 7.4 모든 참조의 공통 계약

리비전 core/extension과 sequence 안의 도메인 관계는 동일한 Reference 객체를 사용한다. `subject`, `proposition`, `scene` 같은 키는 역할 이름이며, 그 값 안에 `reference_id`, `target`, `relation`, `propagation`, `update_policy`를 모두 둔다. 이 영역에 Target만 저장하는 별도 관계 형식을 만들지 않는다.

baseline.selected의 map, review.subject, context manifest의 입력 목록, proposal의 input_revisions 등은 관계 선언이 아닌 선택·검토·출처의 SnapshotTarget 레코드다. 이들도 반드시 ID와 리비전을 고정하지만 status 전파 간선을 만들지 않는다. 스키마에서 Reference와 SnapshotTarget의 사용 경로를 명시해 혼동하지 않는다.

- reference_id는 출발 리비전 전체에서 유일하다. meta.references와 extension에서 중복 정의하지 않는다.
- 스키마는 Reference 객체가 놓이는 경로를 선언하고 추출기는 해당 경로만 수집한다.
- 사건의 subject·적용 장면은 보통 `related_to + none + pinned`다. 이 핀은 당시 자료 근거이며 현재 동일 인물의 다른 리비전을 금지하지 않는다.
- 실제 사용하는 규칙은 `depends_on + blocking`으로 분류한다.
- evidence/cites/compares는 전체 리비전 존재 여부를 검사하지만 baseline의 같은 버전 선택을 강제하지 않는다.
- 구조화 ref가 가리키는 anchor 마커의 기본 문법은 `<a id="passage_discovery"></a>`로 고정한다. 같은 리비전 본문 내 중복 anchor는 오류다.
- 본문 reference 마커는 `[[ref:ref_stamina]]`를 기본으로 한다. 미등록 마커는 오류, 등록했으나 본문 마커가 없는 ref는 확장 필드 등에서 사용될 수 있어 오류가 아니다.

### 7.5 scope의 기본 판정

| 항목 | v1 판정 |
|---|---|
| continuity | 생략 시 `main`, 요청과 정확히 일치 |
| platform/mode | 생략은 제약 없음, 빈 배열은 잘못된 입력 |
| 배열의 의미 | OR 집합. `[pc, console]`은 둘 중 하나 |
| 요청의 구체 값 | 후보의 해당 집합에 포함되거나 후보가 제약 없음이어야 함 |
| 요청 조건 생략 | 여러 적용 변형이 가능하면 AMBIGUOUS_SCOPE, 임의 선택 금지 |
| 상위 버전 호환 | 현재 요청 scope에 실제 적용 가능한 후속 리비전만 갱신 후보 |
| 미지원 차원 | 선언되지 않은 차원은 쓰기 오류, 지원하지 않는 필수 확장은 읽기 제한 |

scope가 더 좁다는 이유만으로 자동 우선순위를 부여하지 않는다. baseline 선택과 명시 query가 우선이다. 태그는 scope 필터를 대체하지 않는다. continuity는 작품/설계의 내용 분기이고 Git 작업 브랜치 이름과 다르다.

## 8. 분야별 확장 모델

### 8.1 소설: 진실·인식·공개·계획 분리

다음은 독립된 기록이다.

- 세계의 실제 사실: 재상이 왕을 죽였다.
- 인물의 인식: ABCDE는 장군이 범인이라고 믿는다.
- 독자 공개: 재상이 독약을 구하는 장면은 공개됐다.
- 작가의 계획: 후반에 범인이 드러날 예정이며 아직 정본 사건은 아니다.

knowledge enum: `knows`, `believes`, `suspects`, `explicitly_unaware`. 기록이 없으면 조회 결과에서 `unrecorded`로 표시한다. 진실 여부와 인물의 믿음은 서로 다른 축이다.

장면은 stable entity ID로 식별한다. `10화 3장면`은 sequence 파일의 표시 순서이며 ID가 아니다. 회차 삽입·장면 재배치가 참조를 깨뜨리지 않아야 한다.

소설 조회에는 최소한 sequence, scene ID, before/after, 작중 시간 기준, POV, baseline, snapshot이 포함된다. 원고 순서와 작중 시간은 별개다. 시점 정보가 불완전하거나 사건 순서가 모호하면 관련 상태를 추정으로 확정하지 않는다.

상태 변화는 위치·부상·복장·소지품·관계 등으로 기록하고 적용 시점을 가진다. 나이·말투·외형도 변할 수 있으므로 모두 영구 불변 설정이라고 가정하지 않는다.

```yaml
# narrative.knowledge_event 리비전의 확장 데이터 예시
extensions:
  narrative:
    record_role: canon
    world_tick: 70100
    event_order: 1
    subject:
      reference_id: ref_subject
      target: {entity_id: ent_abcde, revision_id: rev_abcde_a}
      relation: related_to
      propagation: none
      update_policy: pinned
    proposition:
      reference_id: ref_proposition
      target: {entity_id: ent_fact_passage, revision_id: rev_fact_a}
      relation: related_to
      propagation: none
      update_policy: pinned
    attitude: knows
    effective_at:
      scene:
        reference_id: ref_scene
        target: {entity_id: ent_scene_07_01, revision_id: rev_scene_07_a}
        relation: related_to
        propagation: none
        update_policy: pinned
      boundary: after
    evidence:
      reference_id: ref_evidence
      target:
        entity_id: ent_scene_07_01
        revision_id: rev_scene_07_a
        anchor_id: passage_discovery
      relation: evidence
      propagation: advisory
      update_policy: track_all
```

확장 내부의 typed reference도 공통 참조 추출기가 반드시 수집한다. meta.references와 중복된 정본을 수동 관리하지 않도록 스키마에 reference 타입/경로를 등록한다. 스키마가 모르는 임의 문자열에서 참조를 추측하지 않는다.

sequence의 scenes 엔트리 역시 7.4절의 완전한 Reference 객체를 쓴다.

```yaml
id: seq_main
chapters:
  - id: chapter_10
    label: 10화
    scenes:
      - reference_id: ref_scene_10_03
        target: {entity_id: ent_scene_10_03, revision_id: rev_scene_a}
        relation: depends_on
        propagation: blocking
        update_policy: track_approved
```

본문 anchor는 작성자가 지정한 stable ID다. 위치 번호만 사용하지 않는다. anchor 존재 여부를 검증한다. 근거 장면이 수정되면 해당 지식 기록을 검토 대상으로 표시한다. 장면 삭제 후 자동으로 같은 번호의 다른 장면을 근거로 연결하지 않는다.

### 8.2 관점별 문맥 정책

- `author`: 정본·계획을 구분해 전체 정보를 볼 수 있다.
- `character`: 해당 인물의 인식과 관찰 가능한 정보만 작문 문맥에 포함한다.
- `reader`: 지정한 공개 순서까지의 정보만 포함한다.

필터는 검색, linked reference 확장, 근거 본문, 요약, 후속 MCP 조회에도 적용한다. 비밀 내용을 먼저 전달한 뒤 “사용하지 마”라고만 지시하지 않는다. 숨겨진 사실의 제목·snippet도 누설 경로가 될 수 있다.

관점 필터는 생성 품질을 위한 기본 정책이다. 에이전트에 원본 저장소의 무제한 Read/Bash 권한을 주면 기술적 비밀 격리를 보장할 수 없다. 강한 비밀 격리가 필요한 작업은 필터된 자료를 MCP로만 제공하고 원본 파일 읽기를 제한한 별도 프로필로 실행해야 한다. 첫 제품은 이 차이를 UI에 명시한다.

### 8.3 게임 기획: 규칙·제안·구현 관찰 분리

기획 규칙은 status와 baseline으로 관리한다. 실제 구현·테스트 관찰은 별도 evidence/observation 요소로 기록하고 빌드 ID·실험 조건·측정 시점을 가진다. 확정 기획 0.2초와 실제 빌드 관찰 0.25초를 같은 필드에 덮어쓰지 않는다.

게임 scope의 초기 차원: continuity, platform, mode. 지역·난이도 등은 확장한다. 수치는 단위·값 타입·유효 범위를 명시한다. 예: `seconds`, `percent`, `flat_damage`. v1은 7.5절의 명시적 baseline 선택을 따르며, 그래도 조건에 맞는 규칙이 여러 개이면 충돌을 반환하고 임의 선택하지 않는다. 자동 특이도 우선순위는 도입하지 않는다.

필수 조회:

- 특정 baseline과 scope의 규칙·수치·조건.
- 두 리비전 간 구조화 필드·본문·참조 차이.
- 변경 결정과 근거.
- 직접·간접 영향 대상.
- 기획과 구현 관찰의 차이.

게임 kind에 `game.observation`을 포함한다. 관찰은 `build_id`, 관찰 시각, 조건, 값/단위, 근거를 포함하며 참조로 기획 규칙을 연결한다. 스키마 단계에서 도메인 확장을 활성화한 프로젝트의 필수 필드를 검증한다.

공유 세계관은 명시적 참조로 연결한다. 첫 버전의 강한 참조 범위는 동일 저장소 내부로 제한한다. 서로 다른 저장소 간 참조는 repository/project ID + commit + entity/revision을 고정하는 별도 설계가 필요하므로 후속 범위다.

### 8.4 시점 계산의 결정 규칙

상태·인식은 저장소의 모든 사건 리비전을 재생하는 방식으로 계산하지 않는다. 선택한 snapshot/baseline에서 활성인 사건 요소의 선택 리비전만 사용한다. 이전·폐기·미채택 초안 사건은 제외한다. 사건의 `record_role: canon | plan`은 필수이며 계획의 승인 여부와 실제 발생 여부를 분리한다. `approved + plan`도 발생 사건으로 재생하지 않는다.

query의 `content_mode: confirmed | working`도 명시한다. 기본 confirmed는 approved와 유효한 검토를 갖춘 canon 사건만 재생한다. working은 선택된 논의중·초안 canon 사건도 포함할 수 있으나 해당 필드/지식과 그 후속 결과를 provisional로 표시한다. strict 작문 프로필은 확정되지 않은 상태를 확정 사실처럼 넘기지 않는다. 상태·계획·시간·선택 여부 중 하나만으로 발생 여부를 판단하지 않는다.

v1 시간 모델은 작품 내 명시적 정렬 키 `world_tick`(정수)와 `event_order`(동일 tick 안의 정수)다. 현실 날짜를 강요하지 않는다. 장면에는 시작/종료 tick 또는 명시적 사건 위치를 둔다. sequence는 독자에게 보여주는 순서만 관리한다. 회상에서는 query의 world_tick은 과거, reader boundary는 현재 공개 순서일 수 있다. 세계 시간 키는 업무 스키마 버전·리비전 생성 시간과 무관하다.

- state_event: subject ref, 필드명, 값, 단위(해당 시), world_tick, event_order, effective_at scene/boundary, evidence ref.
- knowledge_event: subject ref, proposition ref, attitude, world_tick, event_order, effective_at, evidence ref. 취득·정정·망각은 새 event로 기록하며 같은 proposition에 대한 인물의 최근 유효 태도를 계산한다.
- reveal_event: 공개 대상 ref, reader sequence 위치와 boundary, 독자에게 공개한 표현/범위. 인물이 아는 것과 독자 공개를 독립 계산한다.
- event의 취소·오류 정정: 현재 baseline에서 대체 리비전/이벤트 선택을 바꾸고 의도와 근거를 기록한다. 과거 Git snapshot은 바뀌지 않는다.
- 동률 tick/order에서 같은 subject의 같은 필드를 서로 다르게 바꾸는 사건은 `AMBIGUOUS_EVENT_ORDER`다. ID/파일 순서로 승자를 정하지 않는다.
- 순서가 없는 사건은 현재 상태 계산에서 제외하고 `INCOMPLETE_TIMELINE`을 표시한다. 불완전한 결과를 완전한 상태로 표현하지 않는다.
- 근거 장면의 baseline 선택 리비전이 evidence 핀과 달라지면 `EVIDENCE_REVIEW_REQUIRED`다. 원래 근거는 exact 조회 가능하지만 strict 집필 문맥에서는 미검토 이벤트를 제외하거나 불완전 상태로 반환한다.
- before/after는 해당 scene boundary에 배치된 사건 포함 여부다. 장면 내부 정밀 조회는 event_order까지 지정하며 정의되지 않은 중간 시점을 추정하지 않는다.

인물 리비전의 `profile`은 출생지 등 시간 불변으로 명시된 정보만 담는다. 시간에 따라 달라지는 위치·나이·복장·말투·이름·관계는 `initial_state`와 state_event로 관리한다. initial_state에는 `world_tick` 시작점을 반드시 지정하며, query가 그보다 이전이면 값을 추정하지 않는다. 나이는 필요하면 출생 시점과 명시된 작품 시간 규칙으로 계산한다.

`char_status`는 선택된 인물의 profile + 작품 초기 시점의 initial_state에서 시작해 query 시점까지 유효한 state_event만 적용한다. 현재 인물 리비전에 적힌 '20화의 현재 상태'를 5화 조회의 초기값으로 사용하지 않는다. 초기값이 없는 필드는 unknown이다. 말투·복장·배경은 별도 요소 참조로 분리 가능하며 같은 query scope에서 확장한다. 판타지 기억 조작·거짓 명제 등 세부는 proposition과 인식 사건으로 표현하되 완전한 논리 추론기는 초기 범위가 아니다.

원래 요구의 '이미 전개됐지만 인물이 모르는 지식'도 지원한다. author 관점 char_status는 현재 world_tick 이전에 발생한 관련 사실 중 explicitly_unaware인 항목을 별도로 반환하고, 인식 기록이 없는 사실은 unrecorded로 분리한다. character 작문 문맥에는 이 비밀의 실제 제목·내용을 넘기지 않는다. 이 목록은 전체 세계의 모든 미지식이 아니라 현재 장면과 관련된 제한 집합이며, 사실의 발생 시점 자체가 미설정이면 이미 발생했다고 단정하지 않는다.

### 8.5 일반 요소의 시간·트리거·조건부 상태 변화

**확정 요구:** 인물만이 아니라 지역·국경·세력·소속·시설·아이템·시스템·플레이어/NPC 등 상태를 갖는 요소에 적용한다. 초기 상태와 변화, 특정 시점/조건의 결과 및 두 결과의 차이·근거를 작성·조회할 수 있어야 한다. 지도 편집기나 게임 엔진이 필수라는 의미는 아니다.

서로 다른 세 축을 유지한다.

| 축 | 예 | 의미 |
|---|---|---|
| 문서 revision/status | 규칙 A의 초안·승인 후속 | 어떤 정의를 채택했는가 |
| 세계/게임 상태 | 어느 세력이 지역을 소유하는가, 문이 열렸는가 | 주어진 세계 시점·조건의 값 |
| 평가 결과의 신뢰/근거 | confirmed, provisional, unknown, 가정 결과 | 무엇을 근거로 계산했고 어느 범위가 미확정인가 |

**설계 기준 — 공통 모델:**

1. 상태를 갖는 대상, 시점이 고정된 초기 값, 상태 필드의 타입·단위·허용 범위, 변화 정의, 사건 발생 기록, 가정 입력을 구분한다. 정본은 Git 파일이고 DB에는 파생 색인/결과만 둔다.
2. 변화 정의에는 대상/actor 바인딩, trigger(언제 평가하는가), condition(무엇이 참이어야 하는가), effects(무엇이 바뀌는가), 순서·반복 규칙·근거를 명시한다. 시간 경계, 명명된 입력 사건, 조건 변화에 의한 계기를 지원 대상으로 한다. 조건이 계속 참인 것과 false→true 진입은 다르며, 이전 상태가 없으면 진입했다고 추정하지 않는다.
3. 조건은 타입이 있는 선언적 비교·논리 조합을 기본으로 한다. 프로젝트의 JS/eval/임의 shell을 실행하지 않는다. 지원 연산·타입·단위·최대 평가량을 계약으로 고정하고 해석할 수 없는 자연어 조건은 자동 참으로 처리하지 않는다.
4. 조건 평가는 true/false/unknown을 구분한다. 입력 부재는 false나 0이 아니다. 논리 조합에서 결과를 확정할 수 있는 부분만 판정하고, 결과가 unknown인 변화는 효과를 적용하지 않고 미확정 후보로 반환한다. 사용자가 가정을 명시하면 그 가정별로 별도 평가한다. 초기값이 없는 과거 시점도 unknown이다.
5. 각 명시된 사건 occurrence에 대해 이전 상태로 조건을 평가하고 효과를 한 변화 단위로 적용한다. 같은 occurrence의 중복 입력으로 효과를 이중 적용하지 않는다. 반복/재진입·연쇄 실행은 명시한 정책과 유한 한도를 따르며, 모호한 동시 쓰기나 한도 초과는 진단한다. 파일명·ID·생성 시간으로 승자를 고르지 않는다.
6. 기본 scope(platform/mode/continuity)의 정의 선택과 플레이 중 조건(레벨·퀘스트·actor의 상태)은 별개다. 조건이 충족됐다는 이유로 baseline이나 고정 revision을 다른 것으로 교체하지 않는다.
7. 대상·규칙·근거 등 의미 관계는 7.4절의 완전한 Reference 및 선언된 추출 경로를 쓴다. 변경 영향·역참조·review 유효성 계산에서 조건/효과의 입력 의존을 누락하지 않는다.
8. 조회에는 snapshot/baseline/schema·시점·actor 바인딩·입력 사건 순서·가정을 고정한다. 결과에 사용한 초기값·적용/미적용/미확정 변화·정확 revision·근거·정책 버전과 입력 digest를 남긴다. 비교는 조건 차이와 상태 차이를 함께 보여준다. worktree/actor/시나리오가 다른 결과를 캐시에서 혼합하지 않는다.

**소설 적용:** 8.4절의 world_tick/event_order·장면 before/after·선택 canon/plan·confirmed/working·POV 정책을 유지하고 일반 요소로 확장한다. 예를 들어 1장 종료 시 지역 X의 소유 세력이 A이고 3장의 정본 조약 사건으로 B가 된다면, 1장에서는 A, 5장에서는 B와 해당 조약 근거를 반환한다. 장 번호는 현재 sequence의 표시이며 실제 기준은 stable scene ID·경계·세계 시간이다. 후속 장면 작성이나 sequence 재배치만으로 이전 시점 값을 덮어쓰지 않는다. 승인된 변화 규칙/계획만 있거나 시간이 지났다는 사실만으로 실제 사건이 발생했다고 간주하지 않는다.

**게임 적용:** 사용자가 고른 기획 기준에서 플레이어 또는 특정 NPC의 레벨·소지품·플래그·퀘스트 등의 가정과 입력 사건을 주면 전후 상태를 계산·비교한다. 예를 들어 '입장 사건 + actor 레벨 10 이상 + 퀘스트 완료'일 때 대상 문을 연다고 정의하고, 레벨 9/10·완료/미완료/미기록을 각각 비교한다. 서로 다른 NPC instance의 상태를 공유하지 않는다. 결과는 **기획 가정 평가**로 표시하고 실제 플레이에서 문이 열렸다는 관찰이나 정본 세계 사실로 자동 저장하지 않는다. 실제 빌드 observation과도 별개다. 가정을 보존하려면 사용자 명시 저장으로 시나리오/작업 자료를 Git에 기록한다.

**호환성 구현:** 공개 core/narrative/game_design v1은 그대로 유지하고 단계 4에서 state_model@1을 추가했다. 내장 reader pin과 유한 AST/효과·반복 한도, narrative 초기값의 단일 출처 adapter, 참조·semantic digest·지원표·fixture는 [ADR-010](docs/adr/010-versioned-state-model.md)과 [상태 계약](docs/STATE_MODEL_V1.md)을 따른다. 옛 앱은 새 필수 확장의 쓰기를 차단한다. 기존 v1 schema/fixture를 같은 번호로 바꾸거나 초기값·조건을 추정 생성하지 않는다. 현재는 검증·색인·입력 근거만 지원하며 전체 평가기·시점 비교·도메인 UI 완성은 단계 8이다.

## 9. 검색·문맥 구성·재개

### 9.1 조회 경로

| 요청 | 처리 |
|---|---|
| 인물 출신·스킬 소비 자원 | ID·필드의 정확 조회 |
| 장면 직전 위치·특정 기준의 규칙 | 시점/버전/scope 계산 |
| 말투 예시·유사한 설계 논의 | 전문 검색, 필요시 의미 검색 |
| 변경 영향·알고 있는 인물 | 그래프·역참조·인식 조회 |
| 채택 이유 | decision + evidence 조회 |
| 작업 이어가기 | task checkpoint + 새 문맥 구성 |

의미 검색만으로 상태·정본을 판단하지 않는다. 한국어는 Unicode 정규화·별칭 정확 조회를 우선 제공하고 FTS5 tokenizer를 실제 원고로 검증한다. trigram을 사용하더라도 1~2글자 이름을 별도 ID/별칭 경로로 처리한다. 의미 검색은 MVP 필수가 아니며 embedding provider/version/chunking/content hash를 캐시 키에 포함한다.

### 9.2 문맥 구성 순서

1. 프로젝트, snapshot, baseline, scope, 시점, perspective를 고정한다.
2. 요청의 명시적 대상·참조를 정확 조회한다.
3. 같은 조건에서 관련 본문·결정·근거를 검색한다.
4. 참조를 제한된 깊이·개수·토큰 예산으로 확장한다.
5. 관점 필터와 상태 정책을 적용한다.
6. 중복 제거 후 필수 규칙·상태·근거·최근 원고를 우선 배치한다.
7. 누락·잘림·미설정 사항과 실제 입력 manifest를 함께 기록한다.

context manifest에는 요소 ID/리비전/anchor, 본문 지문, baseline Git snapshot, 검색 조건, 문맥 구성기 버전, 선택한 스킬 버전을 포함한다. 동적 상태를 사용하면 시점·actor·가정/사건 입력·상태 평가 정책 버전과 digest도 고정한다. 가정 결과는 그 가정과 함께 표시하며 confirmed 세계 사실로 섞지 않는다. 출력은 본문과 manifest를 분리한다. 대규모 원고 전체를 매번 주입하지 않는다.

### 9.3 재개 계약

`resume`는 CLI 세션 ID만 여는 기능이 아니다. 작업 목표, 기준, 마지막 결과, 결정, 미해결 질문, 다음 행동을 복원한다.

필수 보존 항목:

- 사용자 목표·완료 기준·진행 단계.
- 시작 Git 커밋과 baseline, 입력 요소 리비전.
- 선택한 실행기·스킬·MCP 정책의 비밀 없는 manifest.
- 현재 초안 파일, 생성한 변경안, 검토 결과.
- 채택된 결정, 미결정 항목, 다음 행동.
- 최신 체크포인트와 중단 원인.

공급자 세션이 존재하면 활용할 수 있다. 없으면 같은 자료로 새 세션을 만든다. 기준이 변경됐으면 변경된 의존성을 먼저 보여주고 재문맥화한다. 모델의 저장되지 않은 내부 추론이나 모든 대화 뉘앙스 복구를 보장하지 않는다.

### 9.4 삭제 복원 시험의 범위

- 캐시 DB 삭제: 앱이 자동 재색인하여 동일한 요소·참조·진단·체크포인트 조회를 제공해야 한다.
- 로컬 실행 로그 삭제: 프로젝트 체크포인트로 재개하되 이전 실시간 이벤트는 없어도 된다.
- worktree 삭제: 보존된 작업 브랜치/커밋으로 재생성한다. 커밋되지 않은 파일까지 Git이 보존한다고 가정하지 않는다.
- 새로운 clone: push되지 않은 로컬 브랜치는 포함하지 않는다. UI는 결과가 로컬에만 보존됐는지 원격에도 보존됐는지 구분한다.

### 9.5 고정 기준과 작업 중 조회의 구분

RunSpec은 작업 시작 기준인 `basis_snapshot`을 불변 commit으로 고정한다. 이후 작업 폴더가 바뀌는 것을 금지한다는 뜻은 아니다. query에는 `view: basis | working`을 명시한다.

- basis: 시작 commit의 프로젝트 파일·baseline·schema로 조회한다. 검토 근거와 원래 지시 재현에 사용한다.
- working: 같은 실행의 현재 작업 파일 generation으로 조회한다. 에이전트가 방금 만든 초안과 참조를 검사할 때 사용한다.
- 일반 작업 MCP 조회 기본은 working이다. 시작 문맥 manifest에는 실제 basis 또는 working snapshot token을 남긴다.
- provider 세션에 자료를 여러 번 추가하면 각 자료의 snapshot token을 기록한다. 서로 다른 generation을 하나의 동일 시점 자료라고 표현하지 않는다.
- API가 발급한 snapshot token은 repo/worktree/view/schema/baseline fingerprint/file-set digest를 가리킨다. runtime scope token은 접근 권한이고 snapshot token은 자료 버전이므로 별도다.
- 한 context.build/validate 요청은 읽어들인 파일 집합을 메모리/임시 snapshot으로 고정해 처리한다. 읽는 동안 외부 파일 변경을 발견하면 다시 수집하거나 SOURCE_CHANGED를 반환한다. 해시 검사만 한 뒤 본문은 새 파일에서 읽는 TOCTOU를 만들지 않는다.
- 기본 브랜치의 새 commit은 기존 run의 basis를 바꾸지 않는다. rebase/재개/통합은 새 기준으로 명시적 run 또는 검증 기록을 만든다.

## 10. Git·worktree 작업과 통합

### 10.1 저장소 등록과 작업 시작

1. 저장소를 선택하거나 원격 URL을 clone한다. 기존 폴더를 임의로 초기화·덮어쓰지 않는다.
2. Git 사용 가능 여부, 프로젝트 manifest, 지원 스키마, 저장소 상태를 확인한다.
3. target branch와 시작 commit을 명시한다. 앱의 기본값은 현재 선택 브랜치이며 이름 `main`을 강제하지 않는다.
4. dirty 상태를 표시한다. 기본은 마지막 커밋 기준으로 시작한다. 사용자가 현재 변경 포함을 선택하면 선택된 변경을 전용 스냅샷 브랜치에 보존한 뒤 사용한다. 원래 index·작업 파일을 변경하는 자동 stash는 하지 않는다.
5. `workbench/task/<task-id>/<run-id>` 형태의 고유 브랜치와 앱이 관리하는 임시 절대 경로를 만든다.
6. 시작점과 작업 등록 journal을 먼저 로컬 파일에 기록하고, worktree 생성 성공 후 task.yaml에 의미상 기록을 보존한다. 중간 실패는 journal로 복구한다.
7. 스킬·MCP 설정은 이 worktree 또는 외부 run overlay에서 생성한다. 사용자 전역 CLI 설정을 덮어쓰지 않는다.

각 실행은 전용 worktree를 갖는다. 같은 실행기를 사용해도 worktree를 공유하지 않는다. 작업 재시도는 새 run ID로 실행하고 이전 checkpoint commit을 새 시작점으로 삼을 수 있다. Git linked worktree의 `.git`은 디렉터리 대신 파일일 수 있으므로 경로를 추정하지 말고 Git이 보고하는 common dir를 사용한다.

모델 실행 전 task.yaml·brief·초기 checkpoint를 작업 브랜치에 commit한다. 이 commit 전의 준비 실패는 운영 journal로만 복구해도 되지만, 실행을 시작한 작업 목표가 journal에만 남아서는 안 된다. 사용자 입력을 받은 즉시 working 파일에 저장하고, 마지막 커밋 이후 내용은 '로컬 미커밋 저장'으로 표시한다. 앱/브라우저 crash에서 파일을 복구할 수 있어도 임시 폴더 자체가 사라지면 마지막 checkpoint commit 이후 입력은 잃을 수 있음을 구분한다.

### 10.2 작업별 경계

다음 조합을 실행 scope로 고정한다.

```text
repository registration ID + project ID + worktree ID + task ID + run ID
base commit + schema version set + baseline snapshot + capability profile
```

MCP session token은 이 scope에 서버 측으로 바인딩한다. 도구 인수의 임의 project_id/worktree 경로를 신뢰해 다른 작업에 접근시키지 않는다. 에이전트의 cwd와 Git 작업 경로도 같은 scope여야 한다.

worktree 파일 변경은 해당 색인에만 반영한다. 핵심 조회 응답에는 source fingerprint와 freshness 상태를 포함한다. 파일 watcher는 힌트이며 단독 정합성 보장 수단이 아니다. 중요 검증·문맥 구성 시 manifest/hash 확인으로 최신 상태를 확인한다.

### 10.3 변경안 및 낙관적 동시성

```yaml
# tasks/task_01/proposals/proposal_01.yaml
id: proposal_01
task_id: task_01
base_commit: '<git-object-id>'
expected_baseline_fingerprint: '<sha256>'
input_revisions:
  - {entity_id: ent_dodge, revision_id: rev_dodge_a}
changes:
  - action: add_revision
    entity_id: ent_dodge
    revision_id: rev_dodge_b
  - action: select_revision
    baseline_id: baseline_main
    entity_id: ent_dodge
    revision_id: rev_dodge_b
```

proposal 파일은 의도와 근거를 저장하고 실제 본문은 revision/working 파일에 둔다. 소비된 proposal ID는 task 기록에 보존해 중복 적용을 막는다. 파일 쓰기 잠금 안에서 현재 기준을 다시 확인하고 검증된 변경 세트를 적용한다.

proposal은 의도 레코드이며 Git diff 자체를 대체하지 않는다. 통합 검토 시 source commit, target commit, 전체 diff digest, review ID를 묶은 검증 토큰을 발급한다. 그 후 파일·commit·diff가 바뀌면 승인을 재사용하지 않는다. task의 consumed_proposals는 결과 파일·적용 기록과 같은 Git commit에 넣는다. 쓰기 중 crash 후에는 예상 파일 digest를 journal과 대조해 완료·미완료·부분 적용을 판별하고 무작정 다시 적용하지 않는다.

에이전트가 허용 범위 밖의 파일을 수정한 경우 diff 검사에서 차단한다. 이 검사는 악성 프로세스의 OS 접근 자체를 차단하는 보안 경계와는 다르다. 강한 제한은 공급자·OS 권한으로 별도 적용한다.

### 10.4 통합 절차

1. 작업 결과·체크포인트를 커밋해 보존한다.
2. 대상 브랜치의 현재 head를 다시 읽는다.
3. 필요시 작업 브랜치의 스키마를 대상 버전으로 변환한다.
4. 전용 통합 worktree에서 현재 target과 결과를 통합한다. 활성 사용자의 dirty 폴더에 직접 merge하지 않는다.
5. Git 충돌 및 의미상 충돌을 검증한다.
6. diff·진단·반영할 기준 변경을 UI에 보여준다.
7. 사용자가 검토한 결과 또는 미리 정한 정책에 따라 target을 반영한다. 검토 이후 head가 바뀌면 재검증한다.
8. 원격 push는 별도 명시 작업으로 제공한다.

대상 브랜치가 다른 worktree에 checkout되어 있으면 그 브랜치 ref만 뒤에서 강제로 이동하지 않는다. 첫 구현에서는 대상 작업 공간이 clean이고 앱이 쓰기 잠금을 확보한 경우 안전한 Git 통합 명령으로 반영한다. 그렇지 않으면 검증된 통합 브랜치를 보존하고 반영 대기로 둔다.

의미상 충돌 예:

- A가 회피를 수정하는 동안 B가 과거 회피에 맞춰 튜토리얼을 작성했다.
- A/B가 같은 요소의 서로 다른 후속 리비전을 만들고 baseline 선택도 갈라졌다.
- 새 문서가 참조하는 요소가 다른 작업에서 폐기됐다.
- 각 브랜치는 정상이나 통합 후 논의중 간접 의존성이 생겼다.
- 새 스키마에서 허용되지 않는 custom field를 기존 작업이 추가했다.

### 10.5 취소·실패·정리

- 취소 요청과 종료 확인을 구분한다. `cancelling` 동안 UI에서 완료로 표시하지 않는다.
- 실행기 interrupt → 유예 → 프로세스 트리 종료 순서를 플랫폼별로 구현한다.
- 외부 MCP에 이미 제출된 장기 작업은 CLI 종료로 취소됐다고 가정하지 않는다. 외부 작업 ID와 상태를 가능한 범위에서 추적한다.
- 재시도가 외부 API 부작용을 중복 실행할 수 있다. 재개 가능한 호출에는 idempotency key를 사용하고 결과가 불명확한 호출은 자동 반복하지 않는다.
- 실패 시 working 파일과 검증 결과를 보존한다. invalid 상태는 checkpoint/보존 브랜치로 남길 수 있지만 정본 baseline에 통합하지 않는다.
- 정상 결과·중단 결과의 보존 commit과 미추적 파일을 확인한 뒤에만 worktree를 제거한다.
- 정리 대상 절대 경로가 앱이 만든 worktree 루트 내부인지 확인한다. Git worktree 명령과 플랫폼 네이티브 경로 API를 사용한다.
- 자동 GC는 캐시와 보존 완료 임시 폴더만 대상으로 한다. 작업 브랜치 삭제는 별도 정책이다.

## 11. 작업·실행·체크포인트의 스키마

### 11.1 task.yaml

```yaml
id: task_01
title: 회피 변경에 맞춘 튜토리얼 수정
status: paused
goal: 현재 PvE 회피 규칙과 일치하는 튜토리얼 초안을 작성한다.
acceptance:
  - 참조가 정확한 리비전으로 고정되어 있다.
  - 소비 자원과 무적 시간이 선택한 규칙과 일치한다.
base:
  commit: '<git-object-id>'
  schema_versions: {core: 1, narrative: 1, game_design: 1}
  baseline_id: baseline_main
  baseline_fingerprint: '<sha256>'
latest_checkpoint: cp_01
skills:
  - {id: design-document, version: '1.0.0', digest: '<sha256>'}
integration_profile: project-default
outputs:
  - tasks/task_01/working/tutorial-draft.md
consumed_proposals: []
```

task 상태: `planned`, `active`, `paused`, `ready_for_review`, `integrated`, `cancelled`, `failed`. paused는 저장된 작업의 의미 상태이며 실제 프로세스 생존 여부와 다르다.

실행 상태는 `queued`, `starting`, `running`, `waiting_for_input`, `cancelling`, `completed`, `failed`, `cancelled`, `interrupted`, `unknown`으로 구분한다. DB 삭제 후 살아 있던 PID를 무조건 재사용하지 않는다. PID 재사용·실행기 세션 상태를 검증할 수 없으면 unknown/interrupted로 두고 재개 선택을 제공한다.

### 11.2 checkpoint 예시

```yaml
id: cp_01
task_id: task_01
created_at: '2026-11-10T03:00:00Z'
summary: 회피 수치와 설명을 수정했고 예외 조건 검토가 남았다.
working_files:
  - tasks/task_01/working/tutorial-draft.md
decisions:
  - 설명에서 프레임 대신 초 단위를 사용한다.
open_questions:
  - 연속 회피의 예외 조건을 별도 절로 설명할지 결정 필요.
next_actions:
  - 스태미나 고갈 시 예외를 확인한다.
  - 참조 검사 후 변경안을 생성한다.
input_manifest_path: tasks/task_01/checkpoints/cp_01-inputs.yaml
provider_hint: {type: codex, session_id: '<optional-opaque-id>'}
```

checkpoint는 변경하지 않고 새 파일을 추가한다. checkpoint가 자신을 포함한 Git commit hash를 필수로 담는 순환 참조는 만들지 않는다. 해당 커밋은 Git 이력에서 찾고 base commit만 명시한다. 자동 체크포인트는 작업 브랜치에 로컬 commit할 수 있으며 push하지 않는다. 빈번한 실행 이벤트는 Git에 넣지 않고 의사결정·중간 결과가 생긴 경계에서 체크포인트를 만든다.

task/checkpoint/proposal의 파일 경로는 project root 기준이다. 리비전의 body_path만 해당 revision 디렉터리 기준이며 스키마에 그 예외를 명시한다. latest_checkpoint는 경로가 아니라 같은 task의 checkpoint ID다.

### 11.3 중단 복구

앱 재시작 시 로컬 journal, Git worktree 목록, task checkpoint를 대조한다. 미완료 run을 재분류하고 결과 보존 여부를 확인한다. checkpoint 없이 journal만 남은 시작 실패는 정본 작업이 아니라 준비 실패로 표시한다. Git 파일만 있는 새 환경은 task를 가져오고 새 run으로 재개한다. 이전 provider session hint는 선택적이며 작동하지 않아도 재개 가능해야 한다.

### 11.4 작업 재발견과 보존 범위

작업 파일이 target branch에 아직 통합되지 않았더라도 작업 브랜치에 존재할 수 있다. 따라서 프로젝트의 작업 목록은 현재 checkout 폴더의 tasks만 읽어서는 안 된다.

1. 현재 프로젝트 파일과 앱 namespace의 로컬 task/run 보존 브랜치를 조사한다.
2. 등록된 remote-tracking task 브랜치도 사용자가 fetch한 범위에서 조사한다.
3. worktree가 없으면 Git tree에서 task manifest/checkpoint를 읽는다. 색인 재구축을 위해 과거 프로젝트를 자동 변환하지 않는다.
4. task ID별로 보존 branch/commit과 run provenance를 묶는다. 서로 다른 계보의 동시 실행은 최종 시간으로 하나를 고르지 않고 선택지를 보여준다.
5. 재개할 commit을 선택하면 새 전용 worktree를 만들고 새 run으로 시작한다.

이 목록도 DB 캐시일 뿐이며 위 Git refs와 파일에서 재발견한다. 로컬 등록 파일이 없어도 repo 경로를 다시 지정하면 찾을 수 있어야 한다. task refs까지 삭제한 경우 보장을 하지 않으며 GC는 보존 기간·원격 보존 확인 없이 이를 제거하지 않는다. 원격 clone만으로 재개하려면 해당 task 브랜치 또는 통합된 task 파일이 실제 remote에 push돼 있어야 한다. 실행 중 화면의 상세 이벤트는 재발견 범위 밖이다.

### 11.5 외부 호출과 사용자 입력의 복구 경계

pending 승인·질문은 run에 귀속되며 token·프로세스가 사라지면 과거 요청을 자동 승인하지 않는다. 재개 시 답변이 아직 필요한지 재확인한다. 이미 답한 제품 결정은 checkpoint/decision으로 보존한다.

외부 변경을 수반한 호출은 비밀을 제외한 operation ID, idempotency key, 외부 job ID, 확인된 결과 상태를 체크포인트에 보존한다. 공급자가 이를 제공하지 않거나 crash 전에 기록하지 못했으면 `external_state_unknown`으로 표시하고 자동 재전송하지 않는다. 에이전트의 직접 shell/API 호출까지 앱이 모두 정확히 중복 방지한다고 보장하지 않는다. 관리되는 MCP 경로에서 보장 가능한 범위를 명시한다.

## 12. 에이전트 어댑터·스킬·MCP

### 12.1 실행기 탐지

- PATH 탐색 + 사용자 지정 실행 경로를 지원한다. 버전 확인은 로컬 명령으로 수행하고 감지만을 위한 유료 모델 호출은 하지 않는다.
- Windows 네이티브와 WSL은 별도 runner다. 첫 지원은 Windows 네이티브를 우선 검증하고 WSL은 별도 capability로 표시한다.
- 실행 경로·버전·로그인 상태는 분리해 표시한다. 인증 상태를 확인할 수 없으면 unknown이며 로그인됐다고 추정하지 않는다.
- CLI별 설정 위치·로그인 방법은 공급자 공식 방식으로 연결한다. 인증 파일을 브라우저로 전달하지 않는다.
- 설치되었어도 요구 기능이 없는 버전은 제한 실행 또는 업데이트 필요로 표시한다.

### 12.2 공통 인터페이스 제안

```ts
interface AgentAdapter {
  detect(): Promise<AgentInstallation[]>;
  capabilities(installation: AgentInstallation): Promise<Capabilities>;
  start(spec: RunSpec): AsyncIterable<AgentEvent>;
  respond(requestId: string, answer: UserAnswer): Promise<void>;
  interrupt(runId: string): Promise<void>;
  resume(spec: ResumeSpec): AsyncIterable<AgentEvent>;
}
```

capability 예: streaming, resume, interruption, interactiveApproval, userQuestions, structuredOutput, skills, mcp, usageReporting. 지원되지 않는 기능은 UI에서 비활성화한다. 각 어댑터는 공급자 이벤트를 정규화하면서 원시 이벤트도 로컬 진단용으로 남길 수 있다.

공통 이벤트: `run.started`, `message.delta`, `tool.started`, `tool.completed`, `approval.requested`, `input.requested`, `usage.updated`, `artifact.created`, `run.completed`, `run.failed`, `run.cancelled`. 사용량은 공급자가 제공하는 범위만 표시하고 구독 사용을 임의 달러 금액으로 환산하지 않는다.

### 12.3 Codex 연결

기본은 설치된 Codex의 App Server 프로토콜이다. 공식 문서는 양방향 이벤트·승인·스킬 조회를 제공한다. 개발 시 설치 버전의 프로토콜 schema와 지원 메서드를 확인한다. 단발 작업의 fallback으로 `codex exec`를 검토할 수 있지만, 터미널 UI 화면 파싱을 주요 연결 방식으로 삼지 않는다.

App Server 연결부는 initialize, thread/turn, event stream, 요청 응답, interrupt, reconnect 기능을 분리한다. 특정 버전의 실험적 기능에 핵심 저장 모델을 종속시키지 않는다. 실패·권한 요청·사용자 질문은 정상 결과와 구분한다.

### 12.4 Claude 연결

첫 실행 경로는 `claude -p`와 structured event 출력이다. 실시간 이벤트 예시는 공식 문서에서 `--output-format stream-json --verbose --include-partial-messages`를 안내한다. 정확한 인수 조합은 설치 버전에서 검증한다.

대화 중 승인·질문 응답·추가 지시가 CLI 경로에서 충분하지 않으면 공식 TypeScript Agent SDK 연결을 추가한다. SDK의 인증·CLI 활용 방식·배포 요구를 실제 버전으로 검증한다. SDK가 설치된 사용자 CLI와 완전히 같은 설정을 자동 공유한다고 가정하지 않는다. 비대화형 실행에서 사용자 입력이 필요한데 전달할 수 없으면 명확한 제한을 표시하고 승인 우회를 기본값으로 삼지 않는다.

### 12.5 스킬 관리

앱 기본 스킬, 프로젝트 스킬, 사용자·공급자 스킬을 출처별로 구분한다. 앱 기본 스킬은 릴리스에 고정하고 작업 manifest에 version+digest를 기록한다. 완전한 재현이 필요하면 프로젝트에 스킬 사본을 고정한다. 사용자 스킬은 명시적으로 가져오지 않는 한 Git에 자동 복사하지 않는다.

초기 제공 스킬:

1. `project-resume`: 체크포인트와 현재 기준의 차이를 확인하고 재개.
2. `design-document`: 채택된 규칙·결정·근거로 게임 기획 초안 작성.
3. `scene-writing`: 시점·인물 인식·문체를 지켜 장면 작성.
4. `change-impact`: 기계적 역참조 결과를 해석하고 검토 우선순위 제안.
5. `consistency-review`: 기계 검사의 범위 밖인 의미상 모순 후보 제시.

공통 원본은 SKILL.md와 비밀 없는 skill manifest다. Codex/Claude별 발견 경로·호출법·metadata 차이는 adapter가 처리한다. 공급자에 없는 tool 이름을 공통 스킬에 하드코딩하지 않는다. 필수 검증은 스킬 실행 여부와 무관하게 코드로 실행한다.

### 12.6 MCP의 두 역할

**내부 서버**: `knowledge.search`, `entity.get`, `references.reverse`, `context.build`, `task.checkpoint`, `changes.propose`, `project.validate`를 제공한다. 프로젝트 파일 쓰기는 검증된 application command로 수행한다.

**외부 연결**: 외부 MCP가 제공하는 API를 사용한다. MCP가 없는 서비스는 필요한 기능만 wrapper로 노출할 수 있다. UI에서 스킬·연결을 고를 때 실제 인증·권한·실행 가능 여부를 구분한다.

```yaml
# integrations/mcp.yaml — 토큰 값은 저장하지 않음
profiles:
  project-default:
    internal_tools: [knowledge.search, entity.get, context.build, changes.propose]
    external_connections:
      - id: issue-tracker
        credential_ref: local:issue-tracker
        enabled: false
```

프로젝트의 MCP 정의는 실행 코드가 될 수 있는 설정이다. clone 직후 임의 서버·스크립트를 자동 실행하지 않는다. 앱에 등록한 실행 정책과 사용자 선택으로 실제 연결을 활성화한다. provider별 설정은 run overlay에서 생성하며 시크릿을 프로젝트 파일이나 로그에 저장하지 않는다.

## 13. DB·색인 재구축 설계

### 13.1 캐시 범위와 키

cache key는 로컬 repository registration, worktree identity, core/extension schema set, index format version, 검색 설정으로 구성한다. 동일 project_id의 서로 다른 clone을 하나의 working index로 공유하지 않는다.

상태 결과 캐시는 이 범위에 더해 source/baseline fingerprint, 시점, actor 바인딩, 가정/순서 있는 사건 입력 digest, 평가기 정책 버전을 포함한다. UI locale은 상태 의미를 바꾸지 않는다. locale별 표시 문자열을 캐시한다면 의미 결과와 분리한다.

인덱스 manifest에 indexed file fingerprints, baseline fingerprint, indexer version, rebuilt_at을 저장한다. dirty worktree는 HEAD만으로 내용이 식별되지 않으므로 관련 파일 hash를 포함한다. 검색 결과에는 `fresh`, `rebuilding`, `stale`, `invalid_source` 중 상태를 제공한다.

### 13.2 권장 파생 테이블

| 테이블 | 내용 |
|---|---|
| source_files | 경로, hash, 파싱 상태 |
| entities | ID, kind |
| revisions | 리비전 메타 및 scope |
| revision_parents | 후속 관계 |
| references | 모든 typed reference와 역할 |
| baseline_selections | 채택 리비전 |
| diagnostics | 기계 검사 결과와 원인 경로 |
| narrative_events | 상태·인식·공개 이벤트 |
| state_definitions/transitions/inputs | 지원 schema의 초기 상태·조건·효과·참조·가정. 단계 4는 state_records에 저장하며 전체 평가 결과는 단계 8 |
| tasks/checkpoints | 파일에서 읽은 재개 상태 |
| document_fts | 본문·제목 검색 |

서버 실행 큐의 빠른 조회를 같은 DB에 둘 수는 있지만 원본은 task 파일과 로컬 run journal로부터 복원되어야 한다. DB에만 있는 변경안·승인 기록·checkpoint를 만들지 않는다.

### 13.3 전체 재구축

1. worktree read/write lock과 source generation을 확인한다.
2. schema set을 로드하고 지원 여부를 확인한다.
3. 모든 canonical source를 파싱·검증한다.
4. 새 임시 DB에 전체 색인을 만든다.
5. 참조·baseline·진단·검색을 계산한다.
6. 작업 중 원본 generation이 바뀌었는지 다시 확인한다.
7. 일관된 새 index generation으로 교체한다. 실패한 새 DB로 이전 정상 색인을 덮어쓰지 않는다.

원본이 invalid면 원본 오류를 먼저 표시한다. 구 index를 제공해야 한다면 반드시 stale임을 표시하고 변경 반영·확정 조회에는 사용하지 않는다. 정확 조회는 필요시 파일을 직접 읽을 수 있지만 같은 검증·권한 규칙을 적용한다.

단계 4 구현 선택: 메모리에서 검증된 후보를 준비하고 기존 DB의 단일 transaction으로 새 generation을 게시한다. 오류는 rollback하며 이전 정상 generation을 보존한다. Windows DB 파일 교체 대신 이 방식을 사용한 근거와 전후 원본 검사는 [ADR-011](docs/adr/011-worker-index-and-generations.md)을 따른다.

### 13.4 증분 갱신

파일 watcher + 파일 지문으로 변경을 감지하고 바뀐 노드 및 역참조 폐쇄를 재계산한다. baseline·스키마·scope 정책 변경은 영향 범위가 크므로 전체 재구축을 허용한다. 삭제·rename도 처리하고 주기적으로 원본과 대조한다. 앱 관리 쓰기는 즉시 generation을 갱신해 watcher 전달 지연을 보완한다.

단계 4는 source epoch·요청 시 hash 대조/자동 refresh와 파일·revision·FTS 행의 증분 갱신을 구현했다. 그래프·진단은 정확성을 우선해 전체 재분석한다. background watcher는 단계 5의 UI 갱신 힌트, 영향 closure 최적화/목표 규모 성능 검증은 단계 9에 남긴다.

## 14. 스키마 버전과 마이그레이션

### 14.1 버전 체계

- core schema: 프로젝트 manifest·리비전·참조·baseline·task 등의 공통 표현.
- extension schema: narrative/game_design/custom namespace의 데이터 표현.
- app version: 실행 프로그램 버전.
- index version: 캐시 테이블·tokenizer·chunking 등. 변경 시 재구축하면 된다.
- skill version: 작업 절차의 버전. 프로젝트 스키마와 별개다.

프로젝트는 일관된 core+extension 버전 집합을 사용한다. 개별 파일이 몰래 다른 버전인 상태를 정상으로 처리하지 않는다. 앱은 지원 읽기/쓰기 버전과 migrate-from 범위를 명시한다. 개발 중이라도 이미 저장된 fixture나 사용자 프로젝트의 버전을 몰래 재정의하지 않는다.

### 14.2 스키마 배포와 사용자 확장

내장 스키마와 변환기는 앱의 `packages/schema` 및 `packages/migrations`에 버전별로 포함한다. 프로젝트의 `schemas/lock.json`에는 내장 스키마 ID·버전·digest 및 custom schema 경로·digest를 기록한다. 내장 스키마 전체를 프로젝트마다 복제할 필요는 없지만 과거 버전 재현을 위해 앱 배포물 또는 공식 패키지에 남겨야 한다.

사용자 custom JSON Schema는 선언적 데이터로 읽고 namespace를 분리한다. 알 수 없는 필드는 무조건 버리지 않는다. 지원하지 않는 필수 namespace는 수정·통합을 차단하고 읽기 가능 범위를 표시한다. 프로젝트가 제공하는 JS migration은 자동 실행하지 않는다. 첫 제품에서는 custom migration을 명시적으로 검토·등록한 앱 플러그인으로 제한한다.

project.extensions의 required는 생략 시 true다. required:false 확장은 원문을 보존한 제한 읽기가 가능하지만 이를 사용한 의존 계산·엄격 문맥을 완전 지원한다고 표시하지 않는다. 알 수 없는 확장을 가진 요소의 본문/metadata를 writer가 재직렬화해 손실시킬 위험이 있으면 해당 요소의 쓰기를 차단한다. 사용자 선언 스키마·typed reference 경로 정보는 Git 파일에 포함하고, 별도 plugin이 필요한 기능은 plugin ID/version/digest를 lock에 기록한다. 새 환경에 필수 plugin이 없으면 설치 필요 상태이며 자동 코드 실행이나 조용한 fallback을 하지 않는다. 프로젝트 파일 복원은 해당 schema/reader가 지원되는 앱 환경을 전제로 한다.

### 14.3 변환기 계약

```ts
interface MigrationStep {
  id: string;
  from: SchemaVersionSet;
  to: SchemaVersionSet;
  preflight(input: ProjectSnapshot): Promise<MigrationPlan>;
  transform(input: ProjectSnapshot, decisions: DecisionMap): Promise<FileChangeSet>;
  verify(before: ProjectSnapshot, after: ProjectSnapshot): Promise<MigrationReport>;
}
```

각 단계는 from/to, 전제조건, 입력 필드, 출력 구조, 수동 결정 요구, 의미 보존 조건, 경고를 정의한다. `v1→v2→v3`처럼 단계를 조합하고 건너뛴 임의 변환을 구현하지 않는다. 독립 확장이 아닌 경우 core·extension 업그레이드 의존성을 명시한다. 초기에는 명시적인 지원 경로만 허용한다.

### 14.4 형식 변경과 내용 변경

- 필드명 변경, 구조 재배치, 의미가 동일한 enum 명칭 변경: 형식 마이그레이션, ID·리비전·parents 유지.
- 의미를 바꾸는 값 선택, 규칙 수정, 새 사실 확정: 사용자 내용 변경, 새 리비전/결정 기록.
- default 추가: 기존 자료에서 그 default가 실제로 참이라는 근거가 있어야 자동 처리. 없으면 unknown 또는 수동 결정.
- 원본 hash는 표현 변경으로 바뀐다. 과거 byte hash와 새 hash를 이력에 보존하고 schema version을 포함한다. 리비전 ID가 영구 byte hash라고 가정하지 않는다.
- 의미 보존 검사는 구/신 loader가 만드는 normalized semantic view로 비교한다. 의미 동등성을 비교할 수 없는 항목은 검토 대상으로 보고한다.

과거 정본의 고정 원칙에 대한 형식 변환 예외는 이 절에서만 허용한다. 원래 파일 바이트는 Git 이력에서 보존한다. 과거 commit을 열 때 자동 마이그레이션으로 과거 ref를 수정하지 않는다.

### 14.5 실행 절차

1. clean Git 기준을 확보하거나 명시적으로 선택한 작업 스냅샷을 만든다.
2. 현재/목표 schema set과 변환 경로를 검사한다.
3. preflight에서 예상 파일 변경, 정보 손실 위험, 수동 결정 항목을 생성한다.
4. migration 전용 브랜치·임시 worktree를 만든다.
5. 필요한 결정을 파일로 기록한다. 미해결 필수 항목이 있으면 여기서 대기한다.
6. 모든 단계를 전용 worktree의 staging 영역에 적용한다. 중간 부분 변환 상태는 활성 프로젝트로 공개하지 않는다.
7. 구조·참조·리비전 계보·baseline·semantic invariants를 검증한다.
8. manifest/lock/history를 최종 버전으로 일관되게 기록한다.
9. 파일 diff와 검증 보고서를 검토하고 migration 결과를 커밋한다.
10. target head가 시작 이후 바뀌었으면 새로운 head에서 재실행/재통합 후 검증한다.
11. 통합 후 색인을 새로 구축한다.

DB 변환은 원본 migration과 분리한다. index schema가 바뀌면 폐기하고 재구축한다. 프로젝트 열기만으로 원본 파일을 자동 업그레이드하지 않는다.

### 14.6 마이그레이션 이력

```yaml
# migrations/history/mig_01.yaml
id: mig_01
tool_version: '0.1.0'
base_commit: '<git-object-id>'
from: {core: 1, narrative: 1, game_design: 1}
to: {core: 2, narrative: 1, game_design: 1}
steps:
  - {id: core-1-to-2, implementation_digest: '<sha256>'}
decisions: []
verification:
  schema_valid: true
  references_valid: true
  semantic_checks_passed: true
created_at: '2026-11-10T04:00:00Z'
```

이력이 자신을 포함한 최종 commit hash를 요구하지 않도록 한다. 같은 목표 버전에서 재실행하면 no-op이어야 한다. 중간 변환 실패는 원본에 영향이 없고 진단과 전용 worktree를 보존한다. 역변환보다 이전 Git 상태 복원을 기본으로 한다.

### 14.7 활성 작업과 스키마 변경

- 이미 실행 중인 작업은 시작한 스키마에서 계속 작업할 수 있지만 새 기준과의 통합은 별도다.
- 구 스키마를 이해하는 서버 측 reader가 있으면 해당 worktree에서 제한적으로 지원한다. 없으면 실행을 중단·체크포인트 후 업그레이드 경로를 제공한다.
- 작업 중 파일 구조를 몰래 바꾸거나 CLI가 사용하는 디렉터리를 교체하지 않는다.
- 작업 결과 통합 전 작업 브랜치를 target schema로 변환하고 semantic merge를 검증한다.
- target보다 미래 스키마인 결과는 구 앱이 수정·통합하지 않는다.

### 14.8 서로 다른 스키마의 브랜치 통합

'작업 브랜치를 새 형식으로 변환한 뒤 Git merge'만으로 충분하다고 가정하지 않는다. 변환 전 merge-base의 옛 필드가 새 필드와 동시에 남거나 삭제/추가로 잘못 충돌할 수 있다.

통합 엔진은 공통 조상 B, 현재 target T, 작업 결과 R을 구분한다.

1. 통합 목표 schema set S를 정한다. 기본은 target T의 지원되는 현재 버전이다. R이 더 새로우면 target 업그레이드 여부를 별도로 결정한다.
2. 임시 공간에서 B와 R을 S로 정규화한다. T도 동일 schema set임을 검증한다.
3. 동일한 변환 단계·수동 결정 mapping을 사용해 B와 R의 비교 가능한 표현을 만든다. 순수 형식 변경과 사용자 내용 변경을 구분한다.
4. 정규화된 B→R 변경과 B→T 변경을 의미 단위로 비교한다. 파일 수준 3-way merge 도구는 이 동일 형식의 세 입력에만 사용한다.
5. 통합 결과는 실제 target T 위의 새 commit으로 만든다. 원래 작업 결과 commit과 migration provenance는 task/integration 기록에 보존하고 원본 브랜치를 고쳐 쓰지 않는다.
6. 모든 참조·baseline·불변성·검토 유효성을 재검증하고 검토된 diff가 그대로인지 확인한다.

초기 엔진이 특정 변환의 3-way 정규화를 지원하지 못하면 `MIGRATION_MERGE_UNSUPPORTED`로 통합을 보류한다. 재개 가능한 작업 기록을 만든 뒤 새 기준에서 변경안을 다시 작성할 수 있다. 옛/새 필드를 함께 남겨 통합 성공으로 처리하지 않는다. 이는 전체 자동 해결을 보장하지 않고 손상 없이 진단하는 기본 계약이다.

### 14.9 hash·검토·역사 기록의 유효성

서로 다른 용도의 digest를 구분한다.

- `source_digest`: 실제 바이트 지문. 형식·개행 변경에도 바뀐다.
- `semantic_digest`: 스키마별 reader가 만드는 공통 의미 모델의 지문. `semantic_model_version`도 함께 기록한다.
- `dependency_manifest_digest`: 고정 ID·리비전과 사용한 의미 입력 집합의 지문.
- `diff_digest`: 검토한 정확한 source/target 결과 변경의 지문.

단순 형식 migration에서 semantic model version과 의미 내용이 유지되면 기존 review/문맥 근거의 의미 유효성을 이어갈 수 있다. source digest가 달라진 사실과 mapping은 migration report에 기록한다. review 파일 자체를 과거 승인인 것처럼 다시 작성하지 않고 migration attestation에 before/after mapping을 추가한다.

semantic model version이 바뀌거나 의미 동등성을 증명할 수 없으면 기존 검토를 유효하다고 자동 인정하지 않는다. 내용을 추정 변경하지 않고 `REVIEW_REVALIDATION_REQUIRED`를 남긴다. 의미 모델은 JSON key 정렬, 명시적 기본값, UTF-8, Markdown LF 개행을 기준으로 canonicalize하며 배열 순서의 의미는 각 필드 스키마에 명시한다. 시각·실행 환경 metadata는 의미 digest에서 제외하되 status·scope·본문·적용 참조는 포함한다. 알고리즘과 포함 필드 목록을 첫 schema package에 고정하고 시험한다.

task·checkpoint·proposal 등 활성 레코드는 현재 파일 형식으로 변환하되 `base.commit`, 과거 snapshot ID, 당시 schema set은 역사 사실로 유지한다. 이전 context manifest의 실제 raw input을 보존한다면 `historical_payload`로 명시해 당시 schema 정보와 묶고 활성 리비전처럼 색인하지 않는다. 프로젝트 버전 하나를 쓴다는 규칙이 과거 입력의 출처까지 현재 버전으로 덮어쓰라는 뜻은 아니다.

### 14.10 최초 버전과 호환성 지원표

아직 사용자 데이터가 없다는 이유로 공개한 v1 스키마를 같은 번호로 다시 정의하지 않는다. 지원표는 core/extension 조합별 read/write/migrate 가능 여부를 제공한다. 프로젝트 단위 버전 일치와 JSON Schema draft 버전도 다른 개념이다.

단계 2의 v1→v2 시험은 fixture 전용 namespace/schema registry에서 수행한다. 실제 제품의 v2가 확정된 것처럼 배포하지 않는다. 제품 v1 포맷 자체에 migration 엔진을 검증하기 위해 의미 없는 필드를 강제로 추가하지 않는다. 실제 v2가 필요해지면 새 명시 버전을 정의하고 보존 fixture를 추가한다.

## 15. 웹 UI와 내부 API

### 15.1 주요 화면

| 화면 | 핵심 기능 |
|---|---|
| 프로젝트 열기 | 로컬 경로/원격 URL, Git 상태, 스키마 호환성 |
| 프로젝트 개요 | baseline, 작업, 미해결 경고, 실행기 상태 |
| 지식 탐색 | 요소·본문·태그·상태·scope 검색 |
| 요소 상세 | 리비전·diff·참조·역참조·검토 이력 |
| 소설 작업 | scene sequence, POV, 상태·인식·원고 |
| 게임 기획 | 규칙·수치·적용 범위·결정·구현 차이 |
| 작업 실행 | 목표·실행기·스킬·MCP·기준 선택, 진행 스트림 |
| 변경 검토 | 파일 diff, 리비전 차이, 기계 진단, 통합 |
| 스키마 관리 | 버전 호환, 변환 계획·결정·보고서 |

UI는 사용자의 작업 용어를 우선 사용한다. 단순 작업에서 경로·토큰·프로토콜 설정을 항상 노출하지 않는다. 반면 기준 버전·작업 범위·결과가 로컬/원격 중 어디에 보존됐는지는 명확하게 표시한다.

### 15.2 REST 예시

```text
POST /api/projects/open
GET  /api/projects/:id/status
POST /api/projects/:id/reindex
GET  /api/projects/:id/entities/:entityId?revision=...
POST /api/projects/:id/search
POST /api/projects/:id/context
POST /api/projects/:id/validate
GET  /api/agents
POST /api/projects/:id/tasks
POST /api/tasks/:taskId/runs
GET  /api/runs/:runId/events?after=...
POST /api/runs/:runId/respond
POST /api/runs/:runId/cancel
POST /api/tasks/:taskId/resume
POST /api/proposals/:proposalId/validate
POST /api/proposals/:proposalId/integrate
POST /api/projects/:id/migrations/plan
POST /api/projects/:id/migrations/run
```

API는 project ID 외에 서버가 발급한 snapshot/scope token을 검증한다. 쓰기 요청에 expected fingerprint/revision과 idempotency key를 사용한다. SSE는 단조 이벤트 sequence와 재연결 cursor를 제공한다. 보존 범위 밖 cursor라면 상태 snapshot부터 재동기화한다.

표준 오류는 `code`, `message`, `details`, `retryable`, `request_id`를 포함한다. 예: `SCHEMA_UNSUPPORTED`, `REFERENCE_MISSING`, `BASE_CHANGED`, `WORKTREE_BUSY`, `AGENT_UNAVAILABLE`, `AUTH_REQUIRED`, `CONTEXT_FORBIDDEN`, `MIGRATION_DECISION_REQUIRED`.

기계 판정과 UI 번역을 분리한다. 안정적인 code와 구조화된 params/details를 보내고 UI가 locale별 문구를 만든다. 사람이 읽는 message는 호환/진단용이며 이를 파싱해 오류 종류를 추정하지 않는다. ID·enum·JSON 수치·시점 정렬 키는 번역하지 않는다.

### 15.3 명령어 표현

slash command는 도메인 API의 편의 표현이다. 특정 CLI가 이 명령을 기본 제공한다고 가정하지 않는다.

```text
/char_info ABCDE
/char_status ABCDE --at episode10/scene03:before
/char_knowledge ABCDE --at episode10/scene03:before
/scene_context episode10/scene03 --pov ABCDE
/design_context combat/dodge --baseline release-04 --mode pve
/impact combat/dodge
/resume --task task_01
```

이름/별칭이 여러 요소와 일치하면 disambiguation을 제공한다. 자연어 요청은 모델이 typed query를 구성할 수 있지만 실제 판정과 권한 검사는 서버에서 한다.

상태 조회·비교도 같은 application service를 사용한다. 시간/장면 또는 actor·입력 사건·가정을 명시하며 자연어에서 누락된 값을 모델이 정본 사실로 만들어 넣지 않는다. API·MCP·UI의 상태 평가 결과와 근거가 일치해야 한다.

### 15.4 UI 전체 i18n

**확정 요구:** 초기 정식 UI 언어는 한국어(`ko`)와 영어(`en`)다. 모든 앱 UI 요소에 번역 가능한 구조를 적용하며 이후 언어를 추가할 수 있어야 한다.

**설계 기준:**

- 화면 제목·메뉴·버튼·라벨·placeholder·tooltip·상태 배지·검색/필터·표/차트/범례·빈 화면·로딩·알림·확인/승인 dialog·오류/검증 안내·도움말·접근성 이름/설명·앱이 생성하는 내보내기 표제까지 앱 소유 문구를 번역 리소스 key로 관리한다. 향후 단계에서 추가하는 UI에도 같은 규칙을 적용한다.
- 언어 선택을 UI에서 제공하고 사용자 로컬 설정으로 보존한다. 명시 선택을 우선하고, 없으면 브라우저의 지원 언어를 사용하며 일치하지 않으면 한국어를 기본으로 한다. UI 언어는 project.language·원고·요소 제목·ID·태그 원문을 변경하지 않는다.
- 문장을 조각 문자열로 이어 붙이지 않고 문맥에 맞는 전체 메시지와 명명된 변수·복수형을 사용한다. 수치·날짜·시간·단위는 표시 locale로 형식화하되 내부 수치·정렬·단위 식별자는 고정한다. 입력 시 locale 형식은 명시적으로 파싱·검증한다.
- 서버 진단은 code/params/details로 번역하고 경로·사용자 입력·외부 도구 원문은 데이터로 안전하게 삽입한다. 프로젝트 원고·사용자 작성 이름·에이전트 출력·외부 로그 자체를 자동 번역하는 기능은 요구에 포함하지 않는다. 앱이 붙이는 제목·설명·상태·오류 요약은 번역한다.
- locale 변경은 미저장 초안·폼 값·선택 기준·작업 상태를 보존한다. 정본 파일·review/semantic digest·상태 평가를 갱신하지 않으며 숫자 표시만 바뀌어 의미 diff가 생겨서는 안 된다.
- 한국어/영어 catalog의 key·변수·복수형 누락, 하드코딩한 앱 문구, 접근성 설명 누락을 검증한다. 개발 중 누락은 드러내고 CI에서 거부한다. 배포 중 예외적 누락은 기본 한국어 메시지로 fallback하되 진단하고, 공식 언어 전체 지원의 통과로 간주하지 않는다.
- 긴 영어 문구·긴 번역·변수 경계·글꼴·줄바꿈·레이아웃과 키보드/스크린리더 언어를 시험한다. 단계 5부터 화면 E2E와 catalog 검사를 통과하고 단계 6~8의 추가 화면도 같은 gate를 따른다. i18n 라이브러리/리소스 배치는 단계 5 착수 시 ADR과 정확 버전으로 결정한다.

## 16. 실행 안전성·운영 경계

제품 범위에 필요한 구체적 실행 경계만 구현한다.

- 로컬 서버는 기본 loopback에 바인딩하고 session token과 Origin 검증으로 외부 웹 페이지의 작업 실행을 막는다. 임의 CORS 허용 금지.
- 외부에서 전달된 명령 문자열을 shell에 그대로 넣지 않는다. executable/args/env/cwd를 구조화하고 실행 allowlist를 둔다.
- Windows `.cmd` shim·native executable·WSL의 경로와 인수 처리를 별도로 검증한다.
- 프로젝트 상대 경로의 `..`, 절대 경로, symlink escape를 검사한다. 아카이브·첨부 자료도 동일하다.
- Git hooks·MCP server·skill script·provider hooks는 실행 가능 내용이다. 등록 정책 없이 임의 프로젝트 설정을 자동 활성화하지 않는다.
- clone URL은 Git이 지원하는 안전한 transport 범위로 제한하고 임의 local helper 실행을 차단한다. 인증은 Git의 공식 credential helper를 우선 사용한다.
- 앱 DB 파일 자체를 에이전트가 수정해 정본 검사를 우회하게 하지 않는다.
- 외부 도구 호출 로그·환경·프롬프트에서 시크릿을 마스킹한다. 원문 저장이 필요하면 별도 명시 정책을 둔다.
- 권한을 모두 해제하는 실행 옵션을 정상 동작의 전제로 삼지 않는다. 지원하지 않는 승인 경로는 사용자에게 제한으로 표시한다.
- 서버 측 변경 검증은 Git 결과 무결성 검사다. worktree가 OS 보안 격리라고 주장하지 않는다.

### 16.1 잠금·변경 저널·수동 편집

- worktree는 동시에 하나의 쓰기 작업만 허용한다. 파일 편집·proposal 적용·checkpoint commit은 같은 쓰기 잠금을 사용한다.
- repo의 공통 Git metadata를 변경하는 worktree 생성/제거·ref 반영·통합은 저장소 단위로 직렬화한다. 독립 worktree에서 모델이 생각하거나 파일을 읽는 것은 병렬 가능하다.
- 앱 인스턴스 간 OS 파일 잠금과 owner/lease를 사용한다. 단순 메모리 mutex만으로 두 앱 실행을 보호하지 않는다. owner 사망이 확실하지 않으면 timeout만으로 강제 탈취하지 않는다.
- UI autosave는 working 파일에 임시 파일+rename으로 반영한다. 여러 파일 변경 세트에는 전/후 파일 지문과 단계 journal을 사용한다. 복구 중인 scope는 읽기·검증 결과에 표시하고 통합을 막는다.
- 외부 편집기는 앱 잠금을 따르지 않을 수 있다. 쓰기 직전 expected digest를 비교하고 달라졌으면 overwrite 대신 `FILE_CHANGED_EXTERNALLY`로 충돌을 표시한다.
- 저장된 리비전 불변성은 schema만으로 보장되지 않는다. Git 기준과 비교해 기존 리비전의 변경·삭제를 탐지하고 허용된 migration attestation이 없는 한 새 리비전 작성을 요구한다.

### 16.2 직렬화·확장·이름의 기본값

v1의 식별자는 소문자 ASCII `종류_충돌저항ID` 형태를 기본으로 한다. 같은 ID의 대소문자 변형·Unicode 경로 변형을 별개 객체로 허용하지 않는다. 표시 이름은 Unicode NFC로 검색 정규화하되 원문을 임의 변경하지 않는다.

YAML은 JSON-compatible 값만 허용한다. 중복 key, 사용자 tag, merge key, alias/anchor는 거부하고 깊이·크기 제한을 둔다. 날짜는 문자열, 수치는 유한값만 허용한다. Markdown 본문은 plain body이며 두 번째 정본 metadata인 frontmatter를 만들지 않는다. 새 custom 속성은 확장 namespace와 선언된 schema version을 사용하고 core의 additionalProperties 규칙을 몰래 완화하지 않는다.

### 16.3 기존 문서 가져오기

manifest 없는 Git 저장소는 기존 프로젝트를 손상시킨 상태로 보지 않고 '가져오기 필요'로 표시한다. 첫 버전은 명시적으로 선택한 Markdown/text 파일을 document 초안 요소로 복사·등록하는 비파괴 import를 제공한다. 원본 파일은 유지하고 source path/commit을 근거로 기록한다. 자동 추출한 인물·규칙·참조는 제안으로만 저장한다. PDF/DOCX/외부 서비스의 고급 import와 완전 자동 사건 추출은 후속 범위다.

초기 import, baseline 생성, schema migration은 모두 전용 작업 브랜치에서 수행한다. 빈/unborn Git 저장소라면 사용자가 새 프로젝트 생성을 선택한 경우에만 초기 commit을 만들고, 기존 폴더를 프로젝트 파일로 조용히 덮어쓰지 않는다.

## 17. 애플리케이션 소스 저장소 구조 제안

다음은 제품의 소스 코드 구조다. 5절의 사용자가 관리하는 프로젝트 파일 구조와 혼동하지 않는다. 제품 소스와 사용자 프로젝트는 서로 다른 저장소가 기본이다.

```text
workbench-app/
├─ apps/
│  ├─ web/                      # React UI
│  └─ server/                   # Fastify 및 서비스 composition
├─ packages/
│  ├─ domain/                   # 버전·참조·상태·scope·문맥 규칙
│  ├─ schema/
│  │  ├─ core/v1/
│  │  └─ extensions/
│  ├─ migrations/
│  │  ├─ registry.ts
│  │  └─ steps/
│  ├─ project-fs/               # 안전한 파일 로딩·직렬화·변경 세트
│  ├─ git-workspace/            # repository·branch·worktree·integration
│  ├─ indexer/                  # SQLite·FTS·재구축
│  ├─ context/                  # 분야별 조회 및 문맥 manifest
│  ├─ agent-core/               # 공통 adapter·event·capability
│  ├─ agent-codex/
│  ├─ agent-claude/
│  ├─ mcp-server/
│  ├─ skills/                   # 앱 기본 스킬
│  └─ test-support/             # fake agent, 임시 Git 저장소 등
├─ fixtures/
│  ├─ valid-minimal/
│  ├─ narrative/
│  ├─ game-design/
│  ├─ invalid-references/
│  ├─ concurrent-changes/
│  └─ migrations/
│     ├─ v1-input/
│     └─ v2-expected/
├─ docs/
│  ├─ PROJECT_SPEC.md
│  ├─ IMPLEMENTATION_STATUS.md
│  └─ adr/
├─ package.json
└─ <선택한 패키지 관리자의 lockfile>
```

초기부터 물리 패키지를 모두 만들 필요는 없다. 도메인/파일/마이그레이션/Git 경계를 먼저 분리하고 나머지는 기능이 생길 때 추출한다. 의미 없는 빈 패키지와 대규모 추상화보다 작동하는 수직 흐름을 우선한다.

각 기능 완료 때 `IMPLEMENTATION_STATUS.md`에 완료 범위, 실행 방법, 실제 테스트, 미해결 사항, 다음 작업을 기록한다. 이 문서는 개발 인계용이며 사용자 프로젝트의 task와 다른 용도다.

## 18. 단계별 개발 계획

개발 단계는 순서와 완료 기준을 가진다. 시간 추정은 현재 개발 인원·환경을 모르는 상태에서 확정하지 않는다. 각 단계가 통과하기 전 다음 단계로 넘어가 테스트 실패를 쌓지 않는다.

### 단계 0 — 저장소·환경·기술 결정

작업:

- 실제 개발 저장소, AGENTS.md, 기존 코드·변경 여부를 확인한다.
- Node/Bun/Git/운영체제와 사용 가능한 패키지 관리자를 조사한다.
- 제품 소스 저장소와 사용자 프로젝트 저장소의 경계를 문서화한다.
- Node 기본 런타임, schema validator, SQLite 드라이버, 파일 writer를 최소 실험으로 결정한다.
- Codex/Claude 설치 여부는 조사할 수 있지만 이 단계에서 모델을 호출할 필요는 없다.
- ADR-001 파일 정본/캐시, ADR-002 ID/리비전, ADR-003 migration, ADR-004 runner 경계를 작성한다.

완료 기준:

- 최소 TypeScript 빌드·타입 검사·테스트 명령이 실제로 실행된다.
- UTF-8 한국어 경로, 공백 있는 Windows 경로의 읽기·쓰기를 확인한다.
- runtime/package version과 로컬 실행 방법이 기록돼 있다.

### 단계 1 — 파일 형식과 검증기

작업:

- project/entity/revision/reference/baseline/task/checkpoint/proposal의 v1 스키마를 작성한다.
- 안전한 YAML 로더와 결정적 writer를 구현한다.
- typed reference 추출, ID 중복, 부모 DAG, scope, 경로 검증을 구현한다.
- valid-minimal, game-design, invalid-reference fixture를 작성한다.
- 파일 snapshot/fingerprint와 변경 세트를 구현한다.

완료 기준:

- DB 없이 프로젝트를 읽고 exact revision과 baseline을 조회한다.
- 누락 참조·잘못된 anchor·중복 ID·경로 탈출을 정확한 위치와 함께 진단한다.
- 수정하지 않은 파일은 round-trip으로 불필요한 diff가 발생하지 않는다.
- 스키마 파일과 TypeScript API 타입이 어긋나지 않도록 생성 또는 계약 테스트를 둔다.

### 단계 2 — 마이그레이션 기반을 먼저 완성

작업:

- 버전 지원표, migration registry, preflight/transform/verify를 구현한다.
- 시험용 v1→v2 변환을 만들고 실제 fixture에 적용한다.
- 필드 이동/enum 변경은 의미 보존, 필드 분리는 수동 결정 fixture로 검증한다.
- manifest·schema lock·history 작성과 no-op 재실행을 구현한다.
- 최소 Git 임시 저장소/전용 worktree 기능을 이 단계에서 함께 구현한다.

완료 기준:

- 원본 브랜치를 바꾸지 않고 별도 worktree에서 완전한 변환을 생성한다.
- 중간 단계 실패 시 원본 파일 hash가 동일하다.
- 같은 목표 버전 재실행 시 추가 리비전·history 중복이 없다.
- 미래 버전 쓰기 차단과 미해결 결정 대기를 검증한다.
- 이전 Git 상태를 열어 구 형식 원본을 확인할 수 있다.

주의: 단계 2를 완성하기 전 사용자 데이터를 축적하는 편집 UI를 먼저 만들지 않는다.

### 단계 3 — Git 프로젝트와 작업 격리

작업:

- 로컬 저장소 등록 및 원격 URL clone을 구현한다. 원격 시험은 로컬 bare fixture로 네트워크 없이 수행한다.
- task/run 브랜치, 임시 worktree, 시작 commit, journal을 구현한다.
- 작업 시작 전 task 초기 commit과 보존 브랜치 기반 작업 재발견을 구현한다.
- dirty 저장소 처리, checkpoint commit, 안전한 중단 보존·정리를 구현한다.
- 활성 대상 worktree와 통합 worktree의 분리를 구현한다.
- 아직 실제 LLM 없이 fake agent로 파일 변경을 생성한다.

완료 기준:

- 두 작업이 같은 요소의 다른 초안을 독립적으로 만들 수 있다.
- 원본의 staged/unstaged/untracked 파일이 임의 변경되지 않는다.
- 정리 전 결과 commit을 확인하고 미보존 worktree는 제거하지 않는다.
- 저장소 위치 이동·공백 경로·linked worktree의 .git 파일을 지원한다.

### 단계 4 — 색인·역참조·진단·검색

작업:

- SQLite 전체·증분 재구축 및 색인 generation을 구현한다.
- 직접·간접 역참조, 상태 전파, scope별 후속 리비전 검사를 구현한다.
- FTS·ID·별칭 조회와 경고 원인 경로를 구현한다.
- baseline 폐쇄성·분기된 리비전·deprecated 참조 검사를 구현한다.
- snapshot view 분리, 완전형 확장 참조, approval review 저장·유효성 검사를 구현한다.
- FR-022 준비 하위 작업을 먼저 수행한다: 새 상태 모델의 versioned 파일 계약·기존 v1 호환 계획·참조 추출/의미 digest·대표 fixture를 고정하고 그 지원 범위를 색인한다. 전체 상태 평가기는 단계 8로 유지한다.
- FR-021을 위해 진단 code와 구조화된 params/details를 표시 문구와 분리한다. 번역 문자열을 색인의 정본 사실로 저장하지 않는다.

완료 기준:

- DB 삭제 전후 핵심 조회 결과가 같다.
- 두 worktree의 검색이 섞이지 않는다.
- cycle이 있어도 전파가 종료되고 정해진 진단을 반환한다.
- stale 색인을 최신 조회로 표시하지 않는다.
- 한국어 1~2글자 이름과 별칭을 찾을 수 있다.

### 단계 5 — 웹 UI로 수동 작업 수직 흐름

작업:

- 프로젝트 열기, 요소 상세·리비전·검색·참조·경고 화면을 구현한다.
- task working 초안 자동 저장과 새 리비전 생성 기능을 구현한다.
- 변경안 검토·baseline 선택·통합 흐름을 연결한다.
- migration plan/report 화면을 연결한다.
- REST와 SSE, 오류 표준을 구현한다.
- 모든 UI에 한국어·영어 catalog와 언어 선택·형식화를 처음부터 적용한다. 상태 정의/가정 파일 편집도 공통 검증·새 revision 흐름을 따른다. 전체 조건 평가·비교 UI는 단계 8에서 완성한다.

완료 기준:

- 모델 없이 UI에서 규칙 초안을 만들고 상태 전파를 확인하며 검토 후 통합한다.
- 브라우저 새로고침 후 작업 초안과 선택 기준을 복구한다.
- 참조만 갱신한 문서에 검토 필요 표시가 유지된다.
- 사용자가 실제 변경 diff와 통합 결과를 볼 수 있다.
- 두 UI 언어의 모든 앱 문구·접근성 설명·오류와 locale 변경 중 초안 보존을 검증한다(AT-51~53).

### 단계 6 — 에이전트 실행과 내부 MCP

작업:

- 설치 탐지, capability registry, fake/실제 어댑터를 구현한다.
- Codex App Server와 Claude 비대화형 실행을 각각 연결한다.
- 내부 MCP 조회·checkpoint·변경 제출을 연결한다.
- 작업별 cwd/scope token/실행 정책을 연결한다.
- 결과 텍스트와 실제 파일 변경·검증 결과를 구분한다.

완료 기준:

- UI 지시 → 전용 worktree → MCP 자료 조회 → 변경안 → 검증 → 검토를 끝까지 수행한다.
- 인증 실패·실행기 없음·잘못된 이벤트·강제 종료를 정상 처리한다.
- 실제 공급자 시험은 각각 짧은 opt-in smoke test로 수행하고 반복 CI는 fake로 검증한다.
- 한 공급자가 설치되지 않아도 나머지와 fake 개발이 막히지 않는다.
- CLI 실행이 끝나도 invalid proposal을 성공 반영으로 표시하지 않는다.

### 단계 7 — 재개·스킬·외부 MCP

작업:

- 기본 스킬 패키징과 provider별 호출·발견을 구현한다.
- checkpoint/context manifest/재문맥화 흐름을 구현한다.
- 승인·질문이 필요한 경우 capability에 맞게 SDK/양방향 경로를 보완한다.
- 외부 MCP 연결 설정·자격증명 참조·run별 허용 목록을 구현한다.
- 앱 재시작·브라우저 재접속·세션 교체를 구현한다.

완료 기준:

- 공급자 세션과 캐시를 제거해도 작업 기록으로 새 세션을 시작한다.
- Claude 작업을 Codex로 이어가거나 그 반대로 이어간다.
- 외부 호출은 로컬 fixture MCP 서버로 검증하고 실제 외부 변경을 기본 테스트에서 하지 않는다.
- 재시도 시 proposal 및 외부 부작용을 중복 실행하지 않는다.

### 단계 8 — 소설·게임 도메인 완성

작업:

- 소설의 sequence·시간·상태·인식·공개 모델과 query를 구현한다.
- 게임의 수치 단위·scope·결정·구현 관찰 조회를 구현한다.
- POV 문맥 필터와 linked-reference의 누설 방지를 검증한다.
- 두 도메인의 UI와 예시 프로젝트를 완성한다.
- 일반 요소의 시점 초기 상태·트리거·선언적 조건·효과·actor 바인딩·가정 평가/비교 및 근거를 구현한다(8.5절). 모든 신규 UI에 15.4절의 ko/en 지원을 적용한다.

완료 기준:

- 미래 회차 작성 후 과거 장면 상태 조회가 변하지 않는다.
- 사실·믿음·의심·명시적 무지·미기록을 구분한다.
- 회상 장면의 작중 시간과 독자 공개 순서를 별도로 적용한다.
- PvP 새 버전이 PvE 문서의 필수 갱신으로 잘못 전파되지 않는다.
- 확정 기획·미채택 제안·실제 빌드 관찰을 구분한다.
- 1장/5장 국경·소유권 차이와 플레이어/NPC의 조건 충족/미충족/불명 결과를 재현하고, 시나리오·actor·worktree 혼합이나 정본의 자동 변경이 없음을 확인한다(AT-54~59).

### 단계 9 — 통합·마이그레이션·장애 복구 검증

작업:

- 실제 프로젝트 규모의 fixture와 성능 계측을 추가한다.
- 스키마 업그레이드 중 진행된 구 버전 작업의 통합을 검증한다.
- 공통 조상까지 같은 schema로 정규화하는 3-way 검증과 review digest 승계/무효화를 시험한다.
- Git 충돌 없는 의미상 충돌과 target head 변경을 처리한다.
- 취소·중간 crash·disk write 오류·MCP 연결 끊김을 주입한다.
- 설치·업데이트·백업·복구 문서를 작성한다.

완료 기준:

- 전체 인수 시험이 통과하고 제한 사항이 문서화돼 있다.
- 앱 업데이트로 사용자 프로젝트가 자동 손상되지 않는다.
- 캐시·worktree 손실 뒤 보존된 Git 브랜치로 결과를 복원한다.
- 잠정 성능 목표의 실측 결과와 미달 사유를 기록한다.

### 단계 10 — 선택적 확장

- 의미 검색·reranking, Bun 호환, WSL runner.
- 원격 UI와 로컬 runner pairing.
- 다른 저장소의 세계관 패키지 참조.
- 고급 그래프 뷰, 자동 생성 표, 수치 검산.
- 협업·원격 PR 워크플로, 선택적 자동 통합 정책.

이 단계는 핵심 인수 기준을 대체하지 않는다. 사용자 요구와 측정 결과를 보고 착수한다.

## 19. 필수 인수 시험

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| AT-01 | 프로젝트 clone 후 DB 없이 열기 | 색인을 재구축해 요소·참조·작업 조회 |
| AT-02 | DB와 공급자 세션 삭제 후 resume | 목표·초안·결정·다음 행동 복원 |
| AT-03 | 20화 작성 후 5화 상태 조회 | 초기 상태에서 5화까지만 계산, 현재 profile에 미래 상태 혼입 금지 |
| AT-04 | 인물이 잘못 믿는 사실 조회 | 실제 진실과 믿음을 분리 |
| AT-05 | 인식 기록 누락 | 모른다고 단정하지 않고 unrecorded |
| AT-06 | POV 본문 및 연결 자료 조회 | 숨겨진 제목·snippet·근거도 정책대로 제외 |
| AT-07 | draft 의존성의 간접 참조 | 원인 경로와 확정 차단 표시, 직접 상태 유지 |
| AT-08 | 폐기안을 비교 인용 | blocking 상태를 무조건 전파하지 않음 |
| AT-09 | 새 approved 후속 리비전 생성 | track_approved 참조에 경고, 자동 교체 없음 |
| AT-10 | 형제 리비전 생성 | 최신 자동 선택 없이 분기 진단 |
| AT-11 | 두 worktree 동시 작업 | 파일·MCP·검색 scope가 섞이지 않음 |
| AT-12 | 다른 파일의 의미상 충돌 | 통합 후 갱신 검토/의존 충돌 감지 |
| AT-13 | 참조 대상만 새 버전으로 변경 | 본문 검토 완료로 자동 처리하지 않음 |
| AT-14 | migration 중간 실패 | 원본 브랜치·파일 불변 |
| AT-15 | 같은 migration 재실행 | no-op, 이력·리비전 중복 없음 |
| AT-16 | 수동 결정 필요한 필드 분리 | 임의 값 생성 없이 대기·결정 보존 |
| AT-17 | 구 스키마 작업을 신 스키마에 통합 | 변환 후 검증 또는 명확한 보류 |
| AT-18 | 앱보다 미래 스키마 열기 | 수정 차단·호환 안내 |
| AT-19 | dirty 저장소에서 작업 시작 | 원래 index·working 상태 보존 |
| AT-20 | 중단 작업 정리 | 결과 보존 전에 임시 폴더 제거 금지 |
| AT-21 | 기준 변경 후 proposal 적용 | BASE_CHANGED로 재검증 |
| AT-22 | proposal 재전송 | 중복 반영 없음 |
| AT-23 | 게임 mode/platform 불일치 | 적용 범위에 맞는 규칙만 선택 |
| AT-24 | 한국어 두 글자 별칭 | exact/alias 조회로 검색 |
| AT-25 | 네트워크 없는 fake 실행기 | UI~통합 핵심 흐름 시험 가능 |
| AT-26 | 캐시 재구축 중 파일 변경 | 불일치 generation을 최신으로 공개하지 않음 |
| AT-27 | 작업 브랜치만 보존 후 worktree 재생성 | checkpoint와 결과 재개 가능 |
| AT-28 | 범위 밖 파일 수정·경로 탈출 | 쓰기/통합 차단 및 진단 |
| AT-29 | 참조된 과거 장면 수정·삭제 | 인식 근거 검토 경고 또는 누락 오류 |
| AT-30 | 원격 미반영 로컬 결과 | 로컬 보존과 원격 보존을 구분해 표시 |
| AT-31 | 확장 안에 target만 있는 관계 | 완전 Reference 필수 오류, 누락된 전파 정책을 추정하지 않음 |
| AT-32 | 현재 규칙 v2와 과거 인용 v1 동시 존재 | 인용은 허용, applies depends_on의 mismatch만 진단 |
| AT-33 | draft 핀에 approved 후속 생성 | 고정 핀의 blocker 유지 + 갱신 가능 안내 |
| AT-34 | 비선택·폐기·plan 사건과 선택 draft canon 공존 | confirmed에서 제외, working의 draft만 provisional로 계산 |
| AT-35 | 같은 시간·순서의 충돌 상태 이벤트 | AMBIGUOUS_EVENT_ORDER, 임의 승자 없음 |
| AT-36 | 작중 시간과 공개 순서가 다른 회상 | 과거 인물 상태와 현재 독자 공개를 별도 계산 |
| AT-37 | 작업 중 basis와 working 조회 | 각 snapshot·내용을 구분, basis 불변 |
| AT-38 | task가 보존 브랜치에만 있고 worktree·DB 없음 | Git refs/tree로 재발견하고 새 run으로 복원 |
| AT-39 | migration 후 source hash만 변경 | 동등 semantic digest 검증 시 승인 유지, mapping 기록 |
| AT-40 | semantic model 변경·동등성 검증 불가 | 승인 자동 승계 없이 재검토 필요 |
| AT-41 | 옛/새 스키마의 공통 조상과 두 변경 통합 | 정규화한 3-way 또는 안전한 보류, 옛/새 필드 중복 없음 |
| AT-42 | baseline 미채택 deprecated 리비전 존재 | 현재 사용 요소를 전역 폐기로 오판하지 않음 |
| AT-43 | blocking 의존 cycle의 release 승격 | 진단 계산 종료, release 차단 |
| AT-44 | metadata에 approved만 기입한 에이전트 결과 | 유효한 사용자 review 없으면 release 반영 차단 |
| AT-45 | 검토 후 결과 commit·diff가 변경 | 기존 통합 승인 재사용 불가 |
| AT-46 | 수동 편집으로 저장된 리비전 내용 변경 | 허용된 migration 이외 불변성 오류 |
| AT-47 | manifest 없는 기존 Markdown Git 프로젝트 | 원본 보존한 명시 import, 자동 사실 확정 없음 |
| AT-48 | 플랫폼 조건 누락·변형 다중 후보 | AMBIGUOUS_SCOPE, 생성 시간·파일 순서로 선택하지 않음 |
| AT-49 | crash 후 외부 변경의 결과 불명 | external_state_unknown, 자동 중복 호출 금지 |
| AT-50 | 중복 YAML key·alias·JSON 아닌 값 | 파서 오류와 위치 제공, 손실 변환 없음 |
| AT-51 | 모든 앱 화면을 한국어·영어로 사용 | 메뉴·버튼·상태·오류·접근성·내보내기 표제 등 앱 소유 문구를 두 언어로 제공 |
| AT-52 | 미저장 초안이 있는 상태에서 locale 전환 | 값·선택·작업 보존, 정본/ID/enum/review digest·상태 결과 불변, 표시 형식만 변경 |
| AT-53 | 번역 key/변수 누락·긴 번역·동적 메시지 | CI 누락 검출, 문장/복수형·레이아웃·접근성 확인, 무언의 누락을 지원 완료로 표시하지 않음 |
| AT-54 | 같은 기준에서 1장/5장 국경·소유 세력 조회 | 초기 값+해당 시점의 정본 사건만 적용, 값 차이와 정확 근거 제공, 미래 상태 혼입 없음 |
| AT-55 | 플레이어/서로 다른 NPC의 trigger와 조건 경계값 | 충족/미충족·사건 부재·개체별 결과를 구분, 다른 actor나 baseline을 자동 변경하지 않음 |
| AT-56 | 조건 입력·초기 값·이전 조건 상태 미기록 | unknown과 false 구분, 임의 0/false·진입 사건 생성이나 확정 효과 적용 없음 |
| AT-57 | 동시 충돌·중복 occurrence·순환 연쇄 | 임의 승자/중복 효과 없음, 명시 순서·반복 정책·유한 한도에 따라 진단 |
| AT-58 | 고정 가정 재평가·DB 재구축·입력 참조 변경 | 같은 입력은 같은 근거/결과, actor/가정/worktree 캐시 비혼합, 변경된 입력은 무효화·영향 추적 |
| AT-59 | 승인된 변화 계획·가정 결과와 실제 정본 사건 공존 | 정의/plan/what-if를 발생 사실로 자동 승격하지 않음, confirmed/working·POV 규칙 유지 |
| AT-60 | 새 상태 모델 도입 전후 기존 v1 프로젝트 열기 | 공개 v1/fixture 의미 불변, 명시 버전·지원표·검증된 migration만 사용, 미기록 조건/초기값 추정 없음 |

테스트는 규칙·복원성·격리·장애 경계에 집중한다. 스냅샷 문자열만 비교하거나 구현의 내부 동작을 그대로 복제하는 테스트를 남발하지 않는다. 공급자 연동의 raw event fixture는 민감 정보를 제거한 뒤 버전별로 보존한다.

## 20. 미결정 사항과 기본값

| 항목 | 기본값/처리 |
|---|---|
| 제품명 | 가칭 유지, 개발을 막지 않음 |
| 실제 개발 저장소 경로 | 다음 구현 세션에서 우선 확인. 기존 repo를 임의 변경하지 않음 |
| Node vs Bun | Node 기본. Bun-only 요구가 생기면 ADR 갱신 |
| 패키지 관리자·드라이버 버전 | 환경 조사·최소 검증 후 lockfile 고정 |
| 첫 운영체제 | 현재 사용자 환경인 Windows 우선 검증, core는 이식 가능하게 구현 |
| 승인·자동 통합 정책 | 초안 자동 저장 가능, 정본 통합은 검토 후 반영이 기본 |
| 원격 push | 명시 작업으로 분리 |
| 과거 schema 읽기 범위 | 최근 버전 + migration 지원표. 모든 버전 상시 실행 지원은 보장하지 않음 |
| custom migration 코드 | 초기에는 앱에 검토·등록한 변환기만 실행 |
| 강한 POV 비밀 격리 | 별도 제한 실행 프로필. 일반 worktree 읽기 권한만으로 보장하지 않음 |
| 외부 프로젝트 참조 | 초기에는 같은 repo 내 연결만 강한 참조로 지원 |
| Git 대형 첨부 관리 | assets 기본, 크기 문제 발생 시 LFS 정책 추가 |
| UI 디자인 | 기능 중심 기본 UI, 별도 디자인 요청 전 대규모 시각 작업 불필요 |
| 초기 UI 언어·게임 범위 | 사용자 확정: 한국어·영어, 기획 규칙 작성과 가정 조회·비교. 실제 게임 실행/실시간 연동 제외 |
| i18n 구현체 | 모든 UI catalog/형식화 계약은 확정, 라이브러리·리소스 배치는 단계 5에서 검증·고정 |
| 상태 모델 파일 계약 | state_model@1 + 내장 reader pin·유한 AST/효과·한도·legacy adapter(ADR-010), 전체 평가기 8 |

### 20.1 구현자가 바로 사용할 결정표

| 판단 상황 | 기본 결정 | 사용자 확인이 필요한 조건 |
|---|---|---|
| 라이브러리/파일 배치 선택 | 명세 경계 유지, 실험 후 ADR 작성 | 데이터 정본 원칙이나 런타임 요구를 바꾸는 경우 |
| 문서 전체 수정 요청 | working 초안으로 저장 후 새 리비전 | 기존 확정 내용을 직접 덮어쓰려는 경우 |
| 논의중 의존성 발견 | 파생 배지와 blocker 계산 | 자동 확정/임의 상태 변경을 원하는 경우 |
| 새 approved 리비전 발견 | 고정 참조 유지, 갱신안 생성 가능 | 검토 없이 현재 기준 자동 변경을 원하는 경우 |
| 적용 vs 인용 모호 | 임의 blocking 지정 없이 관계를 명시하도록 요청 | 실제 업무 의존의 의미가 자료에서 불명확한 경우 |
| schema field 추가 | namespace 확장 또는 명시 버전 migration | 새 필드의 기본 의미가 사용자 결정인 경우 |
| migration에서 의미 변경 필요 | 형식 변환과 내용 변경안을 분리 | 잃거나 추정해야 할 정보가 있는 경우 |
| cross-schema merge 불가 | 원본 보존, 새 기준 재작성 경로 제공 | 자동 해결되지 않는 의미 충돌의 채택 결정 |
| actual CLI 없음/인증 안됨 | fake adapter로 독립 개발 계속 | 실제 호출·계정 연결이 필요한 최종 검증 |
| 의미 검색 도입 여부 | 정확 조회+FTS부터 완료 | 현재 요구가 유사 표현 탐색을 필수로 하는 경우 |
| dirty 원본 포함 여부 | 마지막 commit 기준, UI에 누락 표시 | 현재 변경을 포함하려면 사용자의 포함 선택 필요 |
| 저장소/개발 위치 미지정 | 현재 세션에 연결된 repo와 지침 확인 | 실제 repo가 없고 임의 생성 위치를 결정할 근거가 없는 경우 |

질문은 해당 결정에 의존하는 작업만 멈춘다. 독립 schema·fixture·fake 테스트는 진행한다. 개발 세션의 목표가 제한되지 않은 경우 단계 0~2는 첫 검증 지점이지 임의 종료 지점이 아니다. 진행 상태를 기록하며 다음 단계로 계속하되 실제 사용자 입력·환경 제약이 있으면 명확히 보고한다.

사용자가 바꿔야 하는 제품 결정과 구현자가 판단할 수 있는 라이브러리 선택을 구분한다. 중요 원칙의 변경은 ADR과 이 명세를 갱신하고 사용자에게 설명한다.

## 21. 구현 시 피해야 할 실패 패턴

1. SQLite가 사실상 정본이고 export가 있어야만 복구되는 구조.
2. DB를 삭제하면 작업 목표·미결정 사항·변경안이 사라지는 구조.
3. 모든 문서를 임베딩한 뒤 유사 검색만으로 정본·시점을 판단하는 구조.
4. status를 의존성 계산 때 덮어써 원래 검토 상태를 잃는 구조.
5. `latest` 참조가 작업 중 조용히 바뀌는 구조.
6. 작업별 cwd만 분리하고 MCP/색인을 공유해 다른 worktree를 읽는 구조.
7. worktree를 sandbox라고 간주해 원본 비밀 격리를 주장하는 구조.
8. 새 CLI 버전에 맞춘 문자열 화면 파싱에 모든 제어를 의존하는 구조.
9. 프로젝트 스키마 변경 때 과거 fixtures를 삭제하고 현재 형식만 남기는 구조.
10. migration이 요소 리비전을 모두 새로 만들어 내용 변경처럼 보이게 하는 구조.
11. 자동 정리·강제 Git 명령으로 미커밋 변경을 잃는 구조.
12. 개발 초기에 UI나 에이전트 데모만 만들고 파일 계약·복원·migration을 나중으로 미루는 구조.

## 22. 공식 자료와 구현 전 재확인 지점

확인일: 2026-11-10. 외부 기능은 설치 버전과 다를 수 있다. 아래는 공급자 기능의 근거이며 본 문서의 제품 내부 사양을 보장하는 자료는 아니다.

- [Codex App Server — 공식 OpenAI 문서](https://learn.chatgpt.com/docs/app-server): 양방향 연결, 승인, 스킬 목록·호출 등. 실제 설치 버전의 프로토콜 schema를 확인한다.
- [Codex 비대화형 실행](https://learn.chatgpt.com/docs/non-interactive-mode): 단발 작업 fallback 검토용.
- [Codex 스킬](https://learn.chatgpt.com/docs/build-skills): 발견 위치·패키징. 프로젝트 공통 스킬은 실행기별 설정을 생성한다.
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): 내부·외부 MCP 연결 가능 범위를 확인한다.
- [Claude Code 프로그램 실행](https://code.claude.com/docs/en/headless): `-p`, structured output/streaming, SDK 연결 설명. 승인·질문·재개·종료 동작을 설치 버전에서 시험한다.
- [Claude Code 스킬](https://code.claude.com/docs/en/skills): 공통 SKILL.md와 공급자별 부가 기능의 경계를 확인한다.
- [Claude Code MCP](https://code.claude.com/docs/en/mcp): 연결·scope·인증·외부 작업 동작을 확인한다.
- [MCP 아키텍처](https://modelcontextprotocol.io/docs/learn/architecture): MCP는 연결 프로토콜이며 프로젝트 기억·정본 규칙 자체를 제공하지 않는다.
- [SQLite FTS5](https://www.sqlite.org/fts5.html): tokenizer·검색 한계. 한국어 및 짧은 이름을 별도 시험한다.

## 23. 개발 완료의 정의

초기 제품의 완료는 UI가 열리고 에이전트가 답하는 상태가 아니다. 다음을 모두 충족해야 한다.

1. 프로젝트 파일과 Git 이력만으로 정본 지식·버전·참조·작업을 복원한다.
2. 로컬·원격 Git 프로젝트를 열고 작업별 임시 worktree에서 격리 실행한다.
3. Claude와 Codex 각각에 대한 지원 범위가 명확하고, 설치된 실행기로 실제 작업 흐름을 검증한다.
4. 상태 전파·역참조·버전 경고를 코드로 계산하고 근거를 보여준다.
5. 소설 시점 조회와 게임 버전/scope 조회가 각각 정해진 규칙으로 작동한다.
6. 새 세션·공급자 교체·앱 재시작 후 체크포인트에서 이어간다.
7. 프로젝트 형식 업그레이드를 전용 worktree에서 계획·변환·검증·통합한다.
8. 필수 인수 시험과 문서화된 실행·복구 절차가 통과한다.
9. 모든 앱 UI를 한국어·영어로 사용할 수 있고 언어 전환이 정본·초안을 손상시키지 않는다.
10. 일반 요소의 시점·조건부 상태를 근거와 함께 조회·비교하며, 가정 결과와 발생 사실을 구분한다.

개발자는 매 단계 실제로 구현·시험한 범위를 명시하고, 미구현 기능을 지원한다고 표현하지 않는다. 이 명세의 예시는 제품 구현물이나 테스트 통과 증거가 아니다.


