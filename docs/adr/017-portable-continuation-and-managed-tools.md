# ADR-017 · Git 작업 기록과 관리 MCP 재개

- 날짜: 2026-11-19
- 상태: 채택
- 관련: [작업 007](../tasks/007-resume-skills-mcp.md), [명세](../PROJECT_SPEC.md), [ADR-016](016-isolated-agent-runners-and-internal-mcp.md)

## 결정

- 작업 브랜치의 체크포인트, 입력 매니페스트, 작업 파일, 실행별 요청·결과로 새 실행을 구성한다. 원래 기준의 채택 입력을 현재 통합 대상과 비교하고 사용자 확인을 받는다. 공급자 고유 세션 재사용 capability는 `resume: false`를 유지한다.
- `SKILL.md`와 매니페스트를 발견하고 명시적으로 선택한 지시문을 전달한다. 출처·버전·해시와 사본을 작업에 고정한다. 재사용 때 보존된 텍스트와 핀을 대조한다.
- 외부 연결은 로컬 등록 후 실행별로 선택한다. Git 기록에는 자격 증명 참조와 비밀 없는 정책만 남긴다. HTTPS 또는 테스트용 루프백 HTTP에서 Streamable HTTP를 쓴다. [MCP 전송 명세](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports), [MCP 도구 명세](https://modelcontextprotocol.io/specification/2025-06-18/server/tools).
- 관리 쓰기는 사용자 승인 후 작업·연결·도구·입력에서 operation ID를 구한다. dispatch 전에 operation·멱등 키를 Git에 보존한다. Git 공통 잠금과 관측 가능한 작업 브랜치 기록으로 중복 제출을 막는다. 결과를 확정할 수 없으면 외부 결과 확인 필요 상태를 유지한다. 알려진 외부 job은 별도로 등록한 읽기 도구로 상태를 확인한다.
- PNG를 해시 경로 `assets/craft/<sha256>.png`로 보존한다. 기존 파일 트랜잭션 및 통합 경로를 적용한다. core·확장 v1 공개 계약을 유지한다.

[작업 007](../tasks/007-resume-skills-mcp.md)은 공급자 인터페이스와 로컬 MCP 서버로 재개·부작용 경계를 검증한다. 실제 공급자 smoke는 단계 6 기록을 따른다.
