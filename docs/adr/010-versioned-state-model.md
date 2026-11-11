# ADR-010 — 새 상태 확장과 내장 reader pin

상태: 채택, 2026-11-11. [ADR-009](009-ui-locales-and-state-planning.md)의 단계 4 선행 결정을 구체화한다.

## 배경

공개 v1에는 일반 요소의 초기값·trigger·조건·actor 가정을 함께 표현하는 계약이 없다. 기존 schema의 같은 version을 넓히면 옛 앱이 새 의미를 검증하지 않은 채 수정할 수 있다. 사용자 요구는 기획 규칙과 가정 조회이며 게임 런타임은 범위 밖이다.

## 결정

core/narrative/game_design v1은 그대로 두고 state_model@1을 추가한다. definition/transition/occurrence/scenario를 구분하고 유한 flat 조건 AST·선언적 효과·명시 반복 한도를 고정한다. 모든 domain 참조는 payload.links의 완전한 Reference이며 AST는 local link 이름만 쓴다. 기존 narrative 초기 상태는 source adapter로 단일 원본을 읽는다. 입력이 없는 자료에 값을 추정하는 migration은 만들지 않는다.

기존 schema lock의 plugin 필드를 사용해 내장 craft.state-model@1.0.0의 의미 reader digest를 고정한다. 예전 앱은 plugin을 지원하지 않으므로 새 required 확장의 쓰기를 차단한다. 현재 앱도 정확한 pin/schema/참조 경로/kinds만 허용한다. 이는 프로젝트 코드를 로딩하는 기능이 아니다. 이 결정은 실제 이전 commit reader를 실행하는 테스트로 검증했다.

단계 4는 구조·참조·입력 digest·색인까지 구현하고, 단계 8에서 평가기를 만든다. 지원표는 평가기 부재를 명시한다. portable 입력 digest와 로컬 scope cache key를 분리해 복제 가능한 근거와 작업 격리를 함께 유지한다. [직렬화·지원 계약](../STATE_MODEL_V1.md)을 따른다.

## 결과와 대안

일반 custom schema만 선언하는 방식은 옛 앱의 의미 검증을 보장하지 못해 채택하지 않았다. core v2로 전체 프로젝트를 변환하는 방식은 아직 변경할 필요가 없는 core와 기존 내용을 이동시키므로 피했다. 새 확장을 채택하는 의미 변경에는 기존 불변성/새 revision 규칙을 적용한다. 전체 runtime 검증을 이 단계의 완료로 오표시하지 않는다.
