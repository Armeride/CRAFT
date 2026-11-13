# 작업 005 — 단계 5 수동 작업 흐름 완성

상태: 완료. 단계 6 착수 전 대기. 2026-11-13 사용자 확정: UI 초안 03은 승인하고, 단계 5의 남은 명세 기능까지 이번 작업에서 구현한다. 단계 6은 착수하지 않는다. 이후 새로운 UI 변경 요구는 별도 작업 식별자를 만들고 범위/인수 기준을 정한 뒤 진행한다.

기준 UI는 50b5b6c다. 그래프 외부 후보는 [검토 문서](../GRAPH_ENGINES.md)에 기록만 유지하고 이번 작업에서 도입하지 않는다.

## 구현 순서와 목표

1. 수동 변경 서비스: 새 요소/리비전·구조화 metadata/reference/state 확장 편집, 사용자 review·baseline 선택, 요청 멱등성/예상 snapshot, 독립 working/체크포인트.
2. 검토·통합: 실제 파일 diff·source/target/diff/review 결합 token, 별도 integration worktree, 차단 진단/target 변경 검사, consumed_proposals와 결과의 같은 commit, 중복/불명 결과 복구.
3. 웹 연결: 기존 화면을 유지하며 자동 저장/충돌, 수동 편집·상태 전파·검토/통합 UI, 프로젝트 clone/import·migration plan/report, basis/working scope와 복원.
4. 실시간 갱신: 단조 SSE sequence·재접속 cursor/범위 초과 동기화, writer/watch 힌트, 인증/프로젝트/작업 격리.
5. 인수/인계: 모델 없이 웹 초안→전파→사용자 검토→통합, 기준/참조 변경·중복·장애/복원, ko/en·접근성·회귀. 실제 통과 후에만 단계 5 완료 기록.

최종 검증: npm run check의 192개 Vitest 및 npm run test:ui의 12개 Chrome E2E 통과. [수동 흐름과 복구](../MANUAL_WORKFLOW.md)·[ADR-015](../adr/015-manual-review-integration-and-events.md)를 추가했다. 완료 기록·실행법·검증 결과는 [구현 상태](../IMPLEMENTATION_STATUS.md)에 남긴다. 178개 Vitest/8개 E2E는 기반 초안의 검증 이력이며 이번 잔여 기능의 완료 증거가 아니다. Git 정본/공개 schema v1·기존 fixture/불변 조건을 유지한다.
