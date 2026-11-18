# ADR-016 — 격리 에이전트 실행기와 내부 MCP

- 날짜: 2026-11-18
- 상태: 채택. 사용자 opt-in 후 두 공급자 실제 smoke와 최종 회귀를 통과해 단계 6 완료.
- 기준: PROJECT_SPEC 10~12·16·18절, ADR-004/008/011/015, 작업 006.

## 요구와 선택

**확정 요구:** Codex/Claude 설치·버전·인증·지원 기능을 분리하고 웹의 지시/진행/질문/승인/중단을 격리 run의 검증된 초안으로 연결한다. 같은 run의 basis/working 조회를 구분하고 공급자 성공을 사용자 승인으로 해석하지 않는다. 앱 문구는 ko/en, 공급자 출력은 원문이다.

**설계 선택:** `agent-core`의 공통 DTO·수명주기 뒤에 Codex App Server와 Claude 공식 TypeScript SDK를 둔다. 작은 초기 구현에서는 실제 코드가 있는 같은 패키지 안에서 모듈을 분리한다. 공개 core/extension v1이나 Run schema에 공급자별 필드를 추가하지 않는다. 공급자 실행 상태는 앱 데이터 `agents/agent_UUID/execution.json`에 별도 저장하고 지시·응답·상호작용·조회 근거는 task working 파일과 Git checkpoint에 보존한다.

Codex는 설치한 `0.169.0-alpha.11.1`의 `generate-json-schema` 및 help를 확인했다. stdio JSON-RPC initialize/config/thread/turn, 승인·질문 응답, usage, interrupt를 사용한다. 시작 인수와 thread overlay에서 hooks/apps/plugins/remote_plugin/multi_agent/multi_agent_v2를 끄고 등록된 MCP를 비활성화한 뒤 이 run의 craft만 연결한다. config/read의 nullable 항목을 제거해야 TOML override가 정상 처리된다. read-only sandbox, experimentalApi 기능 선언으로 질문/승인 경로, 정확한 MCP readOnly/destructive/idempotent/openWorld 도구 힌트, ephemeral thread를 사용하며 전역 설정을 쓰지 않는다.

Claude는 설치 `2.1.294`와 공식 SDK `0.3.327`을 고정했다. 단방향 `-p`만으로 질문/승인 응답을 닫지 않고 SDK `canUseTool` 양방향 제어와 stream-json을 사용한다. 설치된 native executable을 지정하며 bundled CLI로 조용히 바꾸지 않는다. `settingSources: []`, `--restricted`, strict MCP, 허용한 7개 craft 도구와 AskUserQuestion으로 시작한다. 실제 초기화 시험에서 SDK의 `mcpServersDelivery: initialize`는 설치 CLI가 적용 확인을 반환하지 않아 SDK가 prompt 전송 전에 세션을 종료했다. 검증된 방식은 명시적 `argv` 설정에 `Bearer ${CRAFT_MCP_TOKEN}`이라는 참조만 넣고, 실제 토큰은 자식 환경에만 전달하는 것이다. argv에 실제 토큰이 없음을 시작 전에 검사한다. 네이티브 MCP 이름의 점→밑줄 정규화를 지원하며 strict craft의 7개 알려진 도구만 callback에서 허용한다. 별도 ask-only 정책과 다른 server 출처는 사용자 승인 경로로 보낸다. 관리자가 강제하는 공급자 정책은 별도이며 사용자 설정을 앱이 덮어쓰지 않는다.

탐지는 버전/help/auth status만 실행하고 모델을 부르지 않는다. 보수적 최소 지원 버전은 Codex 0.169.0, Claude 2.1.294이다. SDK 설명의 최소 버전 숫자만으로 초기화 기능 지원을 확정하지 않고 설치 바이너리의 실제 응답과 도구 접속으로 검증한다. unknown 인증은 성공으로 간주하지 않으며 미설치/미지원 capability는 비활성으로 반환한다. Windows native가 검증 대상이고 WSL runner는 아직 제공하지 않는다. provider 세션 자체 resume는 아직 false이며 단계 7에서 다룬다.

## 쓰기·접근 경계

checkpoint의 provider_hint.type에는 실제 실행기 종류를 기록한다. session_id는 기존 commit 직후 crash 복구에서 쓰는 run 식별자를 유지한다. 실제 공급자 세션 ID는 별도 agent-result 파일과 운영 실행 기록에 보존하며 hint를 native resume 인수로 사용하지 않는다.

내부 MCP는 loopback Streamable HTTP의 JSON 응답형, protocol 2025-06-18이다. 토큰은 메모리의 실행 ID에 바인딩되며 registration/project/task/run/worktree와 기준을 서버가 결정한다. 인수가 없는 도구의 arguments 생략/null은 빈 객체로 정규화하며 array/스칼라는 거절하고 도구별 필수 인수 검증은 유지한다. 클라이언트가 root/index/scope/baseline을 바꿀 수 없다. 종료·취소·재시작은 토큰을 만료시킨다. Host/Origin 검사와 browser API의 cookie/CSRF는 기존 경계를 유지한다.

search/entity/reverse/context/validate는 기존 ProjectIndex를 호출한다. 조회마다 view·query·snapshot/source/baseline fingerprint·Git commit·결과 digest, exact 대상의 revision/body/semantic digest를 기록한다. 현재 author view만 제공하며 전체 시점·actor·POV 계산은 단계 8이다. 일반 OS 파일 읽기를 강한 비밀 격리로 표현하지 않는다.

`changes.propose`는 기존 ManualService/TaskService의 잠금·CAS·journal·UUID receipt·검증·commit을 공유한다. 항상 새 `draft`, `created_by: agent`, `select:false`다. 사용자 review, baseline 채택, 통합 명령은 MCP에 제공하지 않는다. 결과를 작업 문서에도 반영하며 편집 충돌은 기존 digest 검사로 보존한다. 같은 UUID의 동일 요청은 재실행하지 않고 다른 payload는 거절한다.

시작 전에 지시와 초기 checkpoint를 보존하고 실행 동안 OS execution lease를 유지한다. 매 도구 호출과 종료 시 관리 명령 밖의 파일 변경을 검사한다. 정상 exit라도 범위 밖 변경이면 파일을 남기고 작업을 격리해 조회/통합을 차단한다. 안전한 이전 checkpoint에서 새 run을 열 수 있다. worktree는 OS 보안 경계가 아니므로 악의적인 네이티브 코드의 외부 쓰기를 사후 검증만으로 예방한다고 주장하지 않는다.

interrupt → 유예 → 소유 프로세스 트리 종료를 사용한다. 중단 요청과 실제 종료를 구분하고 종료 미확인은 failed로 보존하며 통합·cleanup을 막는다. 취소는 agent execution 기록으로 먼저 표시하고 terminal checkpoint와 경쟁하는 별도 run 상태 쓰기를 하지 않는다. 재시작한 프로세스는 stale pending 요청을 interrupted로 만들며 승인/답변을 재사용하지 않는다. 실패·취소 뒤 재시도는 보존 commit에서 새 run/worktree로 시작한다.

## 검증과 한계

민감 정보 없는 최소 버전별 fixture는 `packages/agent-core/test-fixtures`에 둔다. 이 입력은 모델 없는 계약 시험이며 실제 공급자 성공 증거와 구분한다. 표준 MCP Client로 초기화·7 도구·바인딩·중복 proposal·토큰 만료를 시험한다. 네이티브 프로세스로 한글 분할 출력·질문/승인·잘못된 JSON·실제 Windows 자식 종료를 시험한다. 웹의 로컬 테스트 실행기는 질문과 승인을 포함해 UI~초안~검토~통합을 시험한다.

2026-11-18 사용자가 두 실행기 시험을 명시 허용했고 각각 실제 smoke를 통과했다. [민감 정보 없는 증거](../validation/phase6-provider-smoke-2026-11-18.json)에 버전·run/checkpoint·미채택 agent draft·원본/기준/사용자 검토 불변·조회 근거를 기록했다. 실제 공급자는 `tools/agent-smoke.ts --provider ... --confirm-model-use`로만 시험한다. 임시 fixture에서만 호출하며 원본 불변과 미채택 초안·조회 근거·checkpoint를 확인한다. 이 시험은 전역 로그인 정보 변경, 실제 프로젝트 통합, 원격 push를 포함하지 않는다.

운영 실행 이벤트는 최근 500개, 응답 본문 1백만 자, 조회 receipt 500개, 단일 변경 본문 30만 자로 제한한다. 별도 agent 실행 목록은 최근이 아닌 운영 폴더 500개 검색 한도다. 대규모 로그/실제 원고 성능·페이징과 운영 상태 완전 손실 재문맥화는 후속 검증이다. 종료된 작업의 Git 파일을 자동 정리하지 않는다.

2026-11-18 npm audit: production 0건, 개발 도구 체인의 high 6건(picomatch/fdir/tinyglobby 및 이를 사용하는 Vite/Vitest/schema generator). 자동 제안이 주요 버전 다운그레이드이므로 `--force`를 실행하지 않았다. 개발 도구 의존성 교체는 별도 검증이 필요하다.

## 확인한 근거

- [Codex App Server](https://learn.chatgpt.com/docs/app-server) 및 설치 버전 생성 JSON schema.
- [Claude MCP 환경 변수 참조](https://code.claude.com/docs/en/mcp#environment-variable-expansion-in-mcpjson)와 [Claude SDK TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript), 설치 SDK의 typed options/CLI help(특히 initialize MCP 전달·restricted).
- [MCP 2025-06-18 transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), 호환성 시험용 SDK 1.32.2 exact dev dependency.
