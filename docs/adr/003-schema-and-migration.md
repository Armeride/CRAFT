# ADR-003 — 버전별 schema와 격리된 형식 migration

- 상태: 채택, 명세 v1.1 기준
- 날짜: 2026-11-10
- 구분: 최초부터 migration은 확정 요구, 실행 절차는 설계 기준

디스크 계약은 JSON Schema Draft 2020-12다. core/extension 버전, 앱 버전, 캐시 버전, skill 버전을 분리한다. 공개 v1은 같은 번호로 재정의하지 않는다. read/write/migrate 지원 조합과 schema digest lock을 제공한다.

변환은 명시 registry의 단계별 preflight/transform/verify로 실행한다. clean 기준 또는 명시 snapshot에서 별도 migration worktree를 만들고 미해결 의미 결정은 대기한다. 프로젝트 열기만으로 변환하지 않는다. 첫 v1→v2 시험은 fixture 전용 registry에 두고 제품 v2를 확정하지 않는다.

형식만 바꾸면 normalized semantic view 동등성을 검증해 ID/revision/parents를 유지한다. 의미 변경은 새 내용 revision/decision이다. source/semantic/dependency/diff digest를 구분하고 review 원본을 다시 쓰지 않는다. 동등성을 증명한 attestation만 승계를 허용하고 나머지는 재검토한다. 역사적 task base/schema 정보도 덮어쓰지 않는다.

구/신 schema 통합은 B/T/R을 같은 schema로 정규화해 비교한다. 불가능하면 원본과 결과를 보존하고 보류한다. 단순 Git merge 성공을 의미 보존으로 취급하지 않는다. 변환기·과거 fixture 유지 비용을 수용해 원본 손실을 방지한다.

검증 상태: 단계 1의 v1 schema/생성 타입/semantic·dependency digest 및 미래 core 차단까지 구현했다. migration 엔진은 미구현이다. 단계 2에서 실패 불변/no-op/수동 결정/attestation을, 단계 9에서 정규화 통합을 검증한다. AT-14~18/39~41/46의 전체 통과는 후속 단계다.
