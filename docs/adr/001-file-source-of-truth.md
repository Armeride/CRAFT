# ADR-001 — Git 파일 정본과 삭제 가능한 캐시

- 상태: 채택, 명세 v1.1 기준
- 날짜: 2026-11-10
- 구분: 파일 정본/재구축은 확정 요구, 세부 배치는 설계 기준

정본은 사용자 프로젝트 Git의 UTF-8 YAML/Markdown이다. 요소·revision·baseline뿐 아니라 task/checkpoint/proposal/review/결정도 파일로 남긴다. SQLite·FTS·향후 임베딩은 worktree별 재구축 캐시다. 운영 journal·PID·이벤트는 앱 로컬 보조 상태이며 재개 필수 의미는 checkpoint로 보존한다.

이 저장소는 앱 소스용이다. 실제 사용자 프로젝트 저장소와 앱 데이터/캐시를 루트에 혼합하지 않는다. UI/REST/MCP는 같은 application service를 호출하고 핵심 도메인 규칙을 특정 API나 DB에만 구현하지 않는다.

파일 기반은 diff·복원·도구 간 이식에 유리하지만 다중 파일 쓰기와 외부 편집 경쟁을 처리해야 한다. 임시 staging/예상 digest/OS 잠금/journal 및 검증 commit을 복원 경계로 사용한다. DB export가 있어야만 복구되는 구조는 채택하지 않는다.

검증: 단계 1의 DB 없는 loader와 원본 무변경 검사를 완료했다. 단계 4의 DB 삭제 재구축·worktree 격리·generation과 단계 7의 세션 없는 resume는 미구현이다. AT-01/02/11/26/27/38의 전체 검증은 후속 단계다.
