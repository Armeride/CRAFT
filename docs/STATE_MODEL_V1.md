# 상태 모델 v1 계약과 현재 지원

2026-11-11. FR-022의 단계 4 산출물이다. [ADR-010](adr/010-versioned-state-model.md), [명세 8.5절](PROJECT_SPEC.md#85-일반-요소의-시간트리거조건부-상태-변화)을 따른다. **현재는 파일 검증·참조·색인·입력 manifest까지 제공한다. 사건 재생, 조건 평가, 상태 결과/전후 비교는 단계 8이다.** `state`와 `state-input`은 `evaluatorAvailable: false`를 반환한다.

## 파일과 호환성

- namespace/version: `state_model@1`, schema ID `urn:craft:state-model:1`.
- [JSON Schema](../packages/schema/extensions/state_model/v1/schema.json)가 원본이며 [generated.ts](../packages/state-model/src/generated.ts)는 생성 타입이다.
- 기존 core/narrative/game_design v1과 semantic model 1, 기존 fixture는 변경하지 않았다. project.schema_version은 계속 1이다.
- 새 프로젝트 또는 명시적으로 새 확장을 채택하는 프로젝트는 project.extensions.state_model과 schemas/lock.json을 선언하고 schema 파일을 함께 보존한다. [fixture](../fixtures/state-model/project.yaml)가 완전한 예시다. 기존 내용의 초기값을 추정하는 자동 migration은 없다. 기존 revision에 내용을 덧붙이면 의미 변경이므로 새 revision을 만든다.
- lock은 schema의 정확한 바이트 digest, schema ID/version/kinds, reference_paths `['/links/*']`와 내장 reader pin을 고정한다. pin은 `craft.state-model`, `1.0.0`, [statePlugin](../packages/project-fs/src/state-support.ts)의 digest다. `npm run index -- support`로 실제 값을 확인한다. digest는 schema·참조 경로·kind·정책·내장 interpreter 계약의 canonical SHA-256이며 프로젝트 JS 실행 허가가 아니다.
- pin이 없거나 다르거나 미래 버전이면 지원하지 않는 확장으로 제한 읽기한다. required(생략 시 true)이면 프로젝트 쓰기를 차단한다. 현재 reader는 정확한 계약만 해석한다. 실제 단계 3 reader를 이전 commit에서 빌드한 회귀 시험도 새 required 확장의 쓰기 차단을 확인한다.

| 입력 | 읽기/후보 검증 | 파일 적용 | 자동 migration/평가기 |
|---|---|---|---|
| 정확한 pin의 state_model 1 | typed 구조·도메인 검증 | 기존 shared writer의 lease/새 revision 규칙 | 없음/없음 |
| narrative 1 초기값·상태 사건 | 원본을 보존하는 읽기 adapter | 기존 v1 writer 규칙 | 없음/없음 |
| 미지원 state_model | core 제한 읽기, 원문 보존 | required 전체 차단, optional 영향 요소 차단 | 없음/없음 |

## 레코드와 참조

payload는 revision.meta.extensions.state_model에 둔다. 다음 네 kind를 새로 제공하며 일반 요소에도 definition payload를 붙일 수 있다. narrative에서는 character에만 허용한다.

| record_type / kind | 내용 |
|---|---|
| definition / state_model.definition | fields의 타입·단위·범위와 시점이 있는 initial |
| transition / state_model.transition | bindings, input_fields, trigger, 조건 nodes, effects, repeat 한도 |
| occurrence / state_model.occurrence | canon/plan, transition/evidence, world_tick/event_order, bindings/inputs |
| scenario / state_model.scenario | baseline_id, world_tick, actors의 prototype/가정 값, input_fields/inputs, 순서 있는 occurrences, assumptions |

각 payload.links의 값은 **완전한 core Reference**다. 상태 AST의 link, binding, field, node, actor는 해당 payload 내 소문자 snake_case 이름이며 global entity ID와 다르다. 이 이름만으로 별도 숨은 domain 참조를 만들지 않는다. 링크 대상은 entity_id/revision_id에 고정하고 기존 reference_id 중복·anchor·대상·scope 검사도 그대로 적용한다. 상태 적용 대상과 transition/prototype 연결은 depends_on + blocking이어야 한다. evidence/비교는 적용 의존과 구분한다.

reference 값은 `{ "link": "local_name" }`, reference_set은 그 값들의 배열이다. **값을 선언한 payload의 links**에서 해석한다. 서로 다른 payload의 동일 local_name을 같은 참조로 간주하지 않는다. 비교/집합 처리 시 해석된 정확한 target을 사용한다. 일반 object/array에 Reference를 몰래 넣어 관계로 추정하지 않는다.

definition.fields는 string/boolean/number/integer/array/object/reference/reference_set을 지원한다. 숫자에만 unit/minimum/maximum을 허용하며 enum 값과 입력·효과의 타입/단위를 검사한다. 누락 값은 미기록이며 false/0/빈 문자열로 채우지 않는다. 임의 object 내부 의미의 검증까지 보장하지 않는다.

initial.source는 declared 또는 narrative_v1이다. declared는 world_tick와 values를 가진다. 기존 narrative.character의 initial_state를 사용하는 definition은 narrative_v1을 지정해 **같은 원본의 값과 tick**을 읽는다. 두 초기값을 중복 선언하면 거부한다. 기존 character에 definition이 없으면 untypedLegacyFields adapter로 읽고, 기존 state_event도 legacy_occurrence로 읽는다. 새로운 발생 사실이나 초기값을 만들지 않는다.

## 유한한 조건과 변화 계약

조건은 flat nodes와 ID 연결로 표현한다. constant/all/any/not/compare를 지원하며 compare의 피연산자는 literal/state/input이다. eq/ne는 canonical 값 동등성, lt/lte/gt/gte는 숫자 순서, in은 배열/참조 집합 소속이다. 암묵적 숫자·문자 변환은 없다. 노드 누락·중복·순환과 비교 타입/단위 오류를 검출한다. 조건의 true/false/unknown 계산은 단계 8 구현 대상이다.

trigger는 time(world_tick/event_order), event(name), condition_entered(node)다. effects는 set/increment/decrement/unset/add_to_set/remove_from_set이다. unset은 값을 제거하고 unknown으로 만든다는 계약이다. set 등의 값·타입·단위를 검사한다. increment/decrement는 숫자, 집합 연산은 array/reference_set에 한정한다.

repeat는 once_per_occurrence 또는 on_entry이며 condition_entered에만 on_entry를 허용한다. once_per_occurrence의 max_per_occurrence는 1이다. 반복 한도는 최대 64, max_chain_steps는 최대 256이다. nodes/effects는 각각 최대 128, scenario occurrences는 최대 1024다. 고정된 세계 시간/순서와 occurrence ID를 보존하며 중복 ID는 거부한다. 순서 동률의 상태 충돌, unknown 진입, 연쇄 한도 도달 등 **실제 실행 진단은 평가기 단계에서 검증한다.** 프로젝트 코드/eval을 실행하지 않는다.

semantic model 1은 확장 payload를 포함한다. extension 내부 배열 순서는 보존되므로 효과/발생 순서 변경은 digest를 바꾼다. 적용 링크 변경은 기존 dependency digest·역참조에도 반영된다. 정책 식별자는 state-model-1이며 의미를 바꾸려면 명시 버전/지원 경로를 추가한다.

## 가정 입력과 색인

`state`는 선택 baseline/scope의 raw typed 레코드를 반환한다. `state-input`은 scenario와 actor 선택, 가정 입력 override를 **메모리에서만 검증**해 manifest/inputDigest를 만든다. actor 선택은 scenario 전체 사건 이력을 임의로 필터링하지 않는다. 여러 actor가 같은 대상을 공유하려면 같은 scenario actor로 명시한다.

portable manifest에는 project/commit/파일 지문, baseline/lock digest, 정책 버전, scenario exact target와 semantic digest, actor·actors·입력·순서 있는 사건·가정, baseline 선택 입력과 digest를 포함한다. 같은 commit/자료/가정의 clone은 같은 inputDigest를 얻는다. worktree·등록·generation을 포함한 로컬 scope와 inputDigest로 만든 scopeCacheKey는 clone/작업별로 다르다. Git에는 portable manifest/inputDigest만 보존하고 로컬 cache key·권한 token·절대 경로를 정본으로 저장하지 않는다.

fixture는 1장/5장에 대응하는 국경 초기값과 tick 30의 변경 정의/발생 기록, 레벨 10·퀘스트 완료 player와 레벨 9 NPC의 문 상호작용 가정을 담는다. 지금은 **입력을 검증·복원하는 예시**이며 문이 열렸다는 평가 결과를 계산하지 않는다. 전체 시점/actor 전후 비교, canon/plan·confirmed/working·POV 정책은 단계 8이다.
