# ADR-006 — v1 파일·타입·snapshot 계약

- 상태: 채택, 단계 1 구현·검증 완료
- 날짜: 2026-11-10
- 구분: 명세 v1.1 기술 기본값 구체화, 확정 요구 축소 없음

디스크 원본 계약을 Draft 2020-12 JSON Schema의 versioned $defs 번들로 고정했다. json-schema-to-typescript 16.0.0으로 타입을 생성하고 매 check에서 drift를 검사한다. 외부 도구 선언과 exactOptionalPropertyTypes 충돌은 JS 개발 도구 경계로 격리했으며 제품 strict/skipLibCheck=false는 유지한다.

내장 schema lock은 JSON 계약·참조 경로·kind mapping의 canonical SHA-256, custom schema는 상대 파일의 raw SHA-256이다. 프로젝트 JS나 remote resolver를 실행하지 않는다. 미지원 required는 전체 후보 쓰기, optional은 영향 요소 쓰기를 막고 원문을 보존한다. 알 수 없는 의미의 digest를 계산하지 않는다.

ID는 종류 접두사 + native UUIDv4를 선택했다. 명세의 UUIDv7은 충돌 저항 ID의 예시이고 순서는 parents/baseline이 결정하므로 추가 의존성이 필요하지 않다. 경로 portability를 검사하며 v1은 내부 symlink도 거부해 파일 집합 검증을 단순화한다.

loader는 고정 바이트를 파싱하고 재수집 지문을 대조한다. AST 안전 정책·위치를 제공하며 무변경 직렬화는 원문을 유지한다. 변경은 expected hash가 있는 메모리 후보이며 기존 불변 레코드는 raw bytes/Git tree로 비교한다.

semantic model 1의 포함 필드·기본값·배열 순서와 dependency digest는 [FILE_FORMAT_V1.md](../FILE_FORMAT_V1.md)에 고정했다. review 승계·migration 예외·실제 다중 파일 적용은 후속 기능이다. 단계를 우회하는 disk write API는 만들지 않았다.

검증: schema 타입 일치, strict typecheck/build 및 77개 테스트 통과. DB 없는 소설·게임 fixture, 참조/anchor/DAG, 안전 YAML, 경로/junction, 확장 호환, SOURCE_CHANGED, 실제 Git 수동 변경과 원본/index 보존을 포함한다. AT-31/50 범위 통과이며 제품 전체 인수 완료는 아니다.
