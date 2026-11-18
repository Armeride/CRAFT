# 작업 006 — 에이전트 실행기와 내부 MCP

2026-11-18 사용자가 같은 세션에서 다음 작업을 이어가도록 지시했다. 사용자 opt-in 후 두 공급자 실제 시험과 최종 회귀까지 단계 6을 완료했다. 단계 7 착수 전 대기한다.

확정 요구는 두 설치 실행기 탐지·선택, 격리 작업의 지시/진행/중단/결과 검토, 같은 scope의 내부 MCP와 ko/en UI다. 명세 12절과 단계 6 인수 기준을 따른다. Codex App Server와 Claude structured CLI/필요시 공식 SDK는 기존 설계 기준이다. 버전별 실제 지원 기능과 인증/권한 전달은 설치 프로토콜과 시험으로 확인한다.

구현 목표는 공통 실행 상태/이벤트·프로세스 수명주기, 설치/인증/capability, run에 바인딩된 7개 내부 MCP 도구, 웹 진행/승인/질문/취소, 검증된 초안 proposal과 기존 사용자 검토/통합 연결이다. 모델 없는 fixture로 격리·인수·실패·취소를 검증하고 실제 두 공급자 smoke는 사용자 동의 범위에서 실행한다.

코드/검증 결과와 남은 실제 환경 한계는 IMPLEMENTATION_STATUS.md에 기록한다. 단계 6 완료 후 대기한다.

## 구현 결과와 통과 조건

- 공통 adapter/DTO·설치/버전/auth/capability, native 프로세스/인수·수명주기, fake/두 공급자 연결을 구현했다. Claude 공식 SDK는 정확 버전으로 고정하고 설치 CLI를 지정한다.
- 내부 MCP 7개는 run의 토큰·worktree·baseline을 서버에서 바인딩하고 기존 조회/변경 서비스·CAS·검증/commit을 공유한다. 토큰은 메모리에만 두고 종료 후 만료시킨다. 조회·결과·상호작용은 task working/checkpoint에 보존한다.
- UI 지시/질문/승인/중단·ko/en·실시간 작업 문서·사용자 검토/실제 통합을 연결했다. 로컬 테스트 실행기는 모델 없이 이 흐름을 끝까지 시험한다. 실패/취소 뒤 재시도는 새 run을 만든다.
- 검증한 결과만 반영한다. 관리 명령 밖의 변경과 종료 미확인은 보존·격리하며 사용자 review를 에이전트가 만들거나 자동 채택할 수 없다.
- 공개 schema/생성 타입/기존 fixture는 변경하지 않았다. 전체 공급자 세션 재개·스킬·외부 MCP는 단계 7이다.

검증: 전체 `npm run check`의 schema/typecheck/build와 **21파일 206개 Vitest 통과**. 이후 실제 공급자 checkpoint.type 표시 보강은 core/web typecheck/build 및 agent/MCP 서비스 6개 시험으로 재검증했다. 표준 MCP Client와 실제 Windows native 프로세스를 포함한다. Codex native 초기화·read-only thread와 이 앱 MCP의 context.build까지 **model turn 없이** 접속·scope를 검증했다. 이후 사용자 명시 동의로 두 공급자의 실제 모델 smoke도 통과했다.

**Chrome E2E 14개 전체 통과(6.5분)**. 로컬 실행기의 실제 질문·승인·언어/테마 변경·초안/검토/통합과 중단/새 run 및 기존 UI 회귀를 검증했다. AI 통합 시나리오는 별도 프로젝트로 분리해 공용 탐색 예시를 유지한다. 외부 편집 모사 시험은 동시 자동 저장의 정상적인 WORKTREE_BUSY/BASE_CHANGED 응답 때 같은 UUID·명시 갱신한 snapshot으로 재시도하며 다른 오류는 실패시킨다.

**실제 공급자 결과:** Codex 0.169.0-alpha.11.1, Claude Code 2.1.294/SDK 0.3.327 모두 context.build → changes.propose → project.validate → checkpoint를 완료했다. 각각 미채택 agent draft 1개이며 원본 HEAD/tree·baseline·사용자 review 불변과 조회 receipt를 다시 검증했다. [증거](../validation/phase6-provider-smoke-2026-11-18.json)를 보존했다. Codex의 실험 기능/도구 힌트, Claude의 초기화 전달 지원·환경 참조와 이름 정규화, 빈 MCP 인수·비밀값 가린 오류를 보강했다. tools/agent-smoke.ts는 --confirm-model-use 없이는 실행하지 않는다. 최종 전체 npm run check의 21파일/206개 Vitest를 통과했고 변경 화면의 AI/중단/접근성 E2E 3개도 다시 통과했다. 단계 6을 완료하고 대기한다.
