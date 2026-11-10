# ADR-002 — 요소·리비전·baseline의 별도 정체성

- 상태: 채택, 명세 v1.1 기준
- 날짜: 2026-11-10
- 구분: ID/고정 참조는 확정 요구, 구체 모델은 설계 기준

entity는 안정 ID와 kind를 갖는다. title/alias/status/scope/body/reference/domain 내용은 불변 revision에 둔다. 내용·상태·참조 변경은 동일 요소의 새 revision이며 parents DAG로 인과를 표시한다. 생성 시간이나 번호로 후속·현재 채택을 결정하지 않는다.

baseline은 요소마다 명시적으로 한 revision을 선택하는 mutable Git 파일이다. 재현에는 baseline ID와 Git/file snapshot을 같이 쓴다. 적용 depends_on 폐쇄성은 검사하되 과거 evidence/cites/compares 핀을 최신으로 교체하지 않는다. Reference와 SnapshotTarget을 별도 계약으로 유지한다.

기본 ID는 소문자 ASCII 종류 접두사와 충돌 저항 ID를 쓴다. 단계 1에서 native UUIDv4 생성기를 선택했으며 근거는 ADR-006에 기록했다. 이름은 Unicode 허용/NFC 검색, 경로·대소문자 충돌은 검증한다. 리비전 ID는 영구 바이트 hash가 아니며 source/semantic digest를 구분한다.

직접 status는 파생 blocker와 분리한다. approved 선언만으로 release 승인하지 않고 별도 사용자 review를 검사한다. 이 모델은 저장량과 명시 갱신 작업이 늘지만 과거 인용·병렬 변경·검토 근거를 보존한다.

검증: 단계 1 schema/불변성/DAG·정확 조회·기본 폐쇄성 검사를 완료했다. 단계 4의 완전한 분기/상태 전파와 단계 8의 시간/범위 계산은 미구현이다. AT-31 통과, 관련 전체 AT는 후속 단계에서 검증한다.
