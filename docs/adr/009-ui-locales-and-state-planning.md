# ADR-009 — UI 언어와 동적 상태 요구의 개발 계획 반영

- 상태: 채택한 기획 기준, 기능 구현 전
- 날짜: 2026-11-11, Asia/Seoul
- 기준: PROJECT_SPEC.md v1.2 FR-021/022, 8.5·15.4절, REVIEW_NOTES R-25/26

사용자가 단계 4 착수 전에 UI 전체 i18n과 일반 요소의 시간·trigger·조건부 상태 변화를 추가했다. 후속 답변으로 초기 UI 언어는 한국어·영어, 게임은 기획 규칙 작성과 가정 입력에 따른 상태 조회·비교까지로 확정했다. 이 ADR을 작성한 당시 작업은 문서 개정이며 단계 4 구현을 시작하지 않았다. 후속 사용자 지시에 따른 구현 결정은 아래 후속 기록을 따른다.

UI 소유 문구는 접근성 설명·오류·동적 메시지·앱 생성 표제를 포함해 catalog로 관리하고 code/params와 표시를 분리한다. UI locale은 사용자 로컬 선호이고 project.language·사용자 원문·ID·enum·정본 digest와 독립이다. 원고나 에이전트/외부 로그 원문 자동 번역을 요구하지 않는다. catalog/형식화의 구체 구현체는 UI를 만드는 단계 5에서 버전·테스트와 함께 결정한다. 단계 4 진단 계약은 번역 가능한 구조를 준비하고 단계 6~8의 새 화면에도 같은 ko/en gate를 적용한다.

상태 모델은 인물뿐 아니라 국경·지역·세력·아이템·플레이어/NPC 등에 공통으로 적용한다. 문서의 revision/status, 세계/게임 값, 그 값의 정본/가정/미확정 근거를 별도 축으로 둔다. 정의를 수정하면 새 revision을 만들지만 시간 진행이나 가정 평가 자체가 revision 교체·승인·정본 쓰기를 일으키지는 않는다. baseline/scope 선택과 actor 실행 조건을 혼합하지 않는다.

초기값·trigger/조건/효과·발생 기록·가정 입력·actor 바인딩·정확 참조·평가 근거를 구분하는 선언적 모델을 사용한다. 조건 미기록은 unknown이며 임의 0/false를 생성하지 않는다. 충돌/중복 occurrence·반복/연쇄는 명시 정책과 유한 한도를 따르고 파일 순서로 해결하지 않는다. 소설의 world_tick/장면 경계·canon/plan·confirmed/working·POV를 유지한다. 승인된 정의나 what-if 결과가 실제 발생 사실이 되지 않도록 한다. 실제 게임 엔진 실행과 실시간 연동은 범위 밖이다.

기존 v1은 일반 초기 상태·조건 전이를 모두 표현하지 못한다. 공개 core/narrative/game_design v1과 기존 fixture를 재정의하는 대신, **단계 4의 첫 하위 작업**에서 새 versioned 확장/필요 migration, 기존 narrative 상태의 단일 출처 매핑, 참조 추출·semantic digest·지원표·호환 fixture를 고정한다. namespace·조건 AST·효과 연산·반복/연쇄 한도는 아직 기술 미결정이며 의존 구현 전에 별도 상세 ADR로 확정한다. 기존 내용의 초기값이나 조건을 migration에서 추정하지 않는다.

이 선행 계약으로 단계 4가 새 상태 정의/참조를 누락한 색인을 만들지 않게 한다. 단계 4는 계약·색인·진단 기반, 단계 5는 ko/en UI 및 검증된 편집 기반, 단계 8은 시점/가정 평가기·비교·도메인 UI 완성, 단계 9는 전체 회귀를 담당한다. 기존 단계 0~3 완료 범위는 역사로 유지하며 신규 요구 완료로 소급하지 않는다.

새 인수 기준은 AT-51~60이다. 국경의 1장/5장 차이, actor별 조건 경계값·미기록·충돌·재현/캐시 격리, 정본/가정 구분, v1 호환성과 UI 전환/누락·접근성을 검증한다. 기존 123개 테스트와 새 AT를 혼동하지 않는다. 세부 순서와 gate는 [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md), 현재 실제 지원은 [IMPLEMENTATION_STATUS.md](../IMPLEMENTATION_STATUS.md)를 따른다.

## 후속 구현 결정 — 2026-11-11

사용자의 단계 4 지시에 따라 [ADR-010](010-versioned-state-model.md)에서 state_model@1/reader pin/단일 출처 adapter를 고정했고 [ADR-011](011-worker-index-and-generations.md)에서 색인·generation을 구현했다. 위의 미결정 기록은 작성 당시 상태다. UI i18n 구현체는 5, 전체 상태 평가·비교는 8에 남아 있다.
