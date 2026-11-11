# v1 파일 계약과 단계 1 API

단계 1 구현 당시 기준은 PROJECT_SPEC.md v1.1이다. [schema.json](../packages/schema/core/v1/schema.json)이 디스크 계약 원본이고 [generated.ts](../packages/schema/src/generated.ts)는 자동 생성 타입이다. 이 문서는 단계 1의 구현 선택과 보장 범위를 기록한다.

2026-11-11의 목표 명세 v1.2는 UI i18n과 일반 요소의 조건부 상태 요구를 추가했다. 이 문서의 공개 v1 계약은 유지한다. 현재 v1이 일반 초기 상태·조건/trigger/효과·actor 가정 평가를 모두 표현한다고 해석하지 않는다. 단계 4에서 별도 [state_model@1 계약/지원표](STATE_MODEL_V1.md)와 내장 reader pin·기존 narrative 초기 상태의 단일 출처 adapter를 추가했다. 공개 v1을 수정하지 않으며 전체 평가기는 단계 8이다. [ADR-010](adr/010-versioned-state-model.md)을 따른다. UI locale은 Project.language와 독립이고 정본에 UI 번역 문자열을 저장하지 않는다.

단계 2에서 별도 [migration 엔진과 fixture registry](MIGRATIONS.md)를 추가했다. 아래 제품 v1 계약과 일반 변경 API는 유지하며 실제 core v2는 출시하지 않는다. fixture의 변환·attestation을 일반 디스크 쓰기/통합 지원과 구분한다.

아래 표의 디스크 적용 미구현 표시는 단계 1 당시 기록이다. 현재 일반 writer/작업 복구는 [WORKSPACES.md](WORKSPACES.md), 재구축 SQLite/조회는 [INDEXING.md](INDEXING.md), 상태 확장 지원은 [STATE_MODEL_V1.md](STATE_MODEL_V1.md)를 따른다.

## 스키마·지원 범위

`urn:craft:schema:core:1` 번들의 $defs에 Project/Entity/Revision/Reference/SnapshotTarget/Scope/Baseline/Review/Task/Checkpoint/Proposal/Sequence/SkillManifest/McpConfiguration/SchemaLock/MigrationHistory/ContextManifest와 소설·게임 계약을 둔다. 검증에는 해당 $defs를 선택한다. 번들 루트 anyOf 전체를 manifest 검증으로 쓰지 않는다.

Project.schema_version은 1이다. 미래 버전은 discriminator를 먼저 검사해 SCHEMA_UNSUPPORTED로 차단한다. task.base.schema_versions 같은 역사 정보는 그대로 보존한다. 공개 v1을 같은 번호로 재정의하지 않는다. schema:types는 타입 생성이지 migration이 아니다.

| 범위 | 읽기 | 메모리 후보 검증 | 디스크 적용/migration |
|---|---|---|---|
| core 1, 내장 narrative/game_design 1 | 가능 | 가능 | 미구현 |
| 잠긴 선언적 custom schema | 구조·명시 ref 경로 해석 | 지원하는 요소에 가능 | 미구현 |
| 미지원 required 확장 | core 제한 읽기·원문 보존 | 프로젝트 전체 차단 | 미구현 |
| 미지원 optional 확장 | core 제한 읽기·원문 보존 | 영향 요소 차단 | 미구현 |
| 미래 core | 호환 오류 | 차단 | 미구현 |

내장 확장 ID는 urn:craft:schema:extension:narrative:1 및 urn:craft:schema:extension:game_design:1이다. bundle digest는 `{schema, reference_paths, kind_schemas}`의 canonical JSON SHA-256이다. custom schema는 정확한 파일 바이트 SHA-256에 고정한다. lock과 manifest의 버전·선언을 대조한다.

required 생략은 true다. 필수 plugin이 없으면 제한 읽기다. custom JSON Schema는 ID/Draft를 검사하고 local 또는 내장 core $ref만 허용한다. 외부 URL 로더나 프로젝트 JS를 실행하지 않는다. lock의 reference_paths에 `/related`, `/links/*` 같은 추출 경로를 명시한다. 임의 문자열을 관계로 추정하지 않는다.

## 레코드와 경로

명세 표준 경로를 사용하며 ID는 파일명/디렉터리와 일치해야 한다. ID는 소문자 ASCII이고 새 ID는 종류 접두사 + native UUIDv4다. 번호·시간으로 현재 채택을 결정하지 않는다.

task/checkpoint/proposal 경로는 project root 기준, revision.body_path는 revision 디렉터리 기준의 .md, skill.entrypoint는 해당 skill 디렉터리 기준이다. checkpoint.input_manifest_path는 같은 task의 checkpoints 안에 있고 이름 접미사에 의존하지 않는다. latest_checkpoint는 실제 Checkpoint ID여야 한다.

core의 additionalProperties는 false다. 알려진 kind에는 해당 확장과 필수 필드를 요구한다. 인물은 profile과 tick가 있는 initial_state, 사건은 canon/plan과 완전 Reference를 가진다. 미설정 시간의 draft 사건을 보존할 수 있지만 상태 재생·불완전 timeline 계산은 단계 8 기능이며 자동 확정하지 않는다.

게임 Quantity는 value/unit/value_type 및 선택 minimum/maximum으로 표현하고 명시 타입·범위를 검증한다. 명세 예시의 invulnerability_seconds/stamina_cost도 단위를 이름에 고정한 호환 필드로 지원한다. game.observation의 build/시각/조건/측정/rule/evidence는 기획과 별개다.

## 안전 파싱·고정 snapshot

YAML 1.2 AST에서 중복 key, 명시 tag, alias/anchor/merge, 비문자열 key, 비유한 수치·손실 정수, 다중 문서·구버전 directive를 거부한다. 날짜는 문자열이고 위치는 file/line/column/JSON pointer로 제공한다. JSON 파일은 JSON 문법과 중복 key도 검사한다.

기본 제한은 YAML 2MiB/depth 64/100,000 nodes, 파일당 32MiB·프로젝트 합계 256MiB·100,000개 파일이다. 상대 경로 탈출, Windows 장치명/ADS/금지문자, case/NFC 충돌을 거부한다. v1에서는 내부 링크를 포함해 모든 symlink/junction을 거부한다.

한 handle의 바이트와 파일 identity·mtime/ctime을 확인하고, 캡처한 바이트만 파싱한다. 원문은 메모리의 base64/텍스트/지문에 고정된다. canonical 파일 집합을 재수집해 달라지면 SOURCE_CHANGED다. OS 보안 sandbox나 악성 writer에 대한 완전 격리라고 주장하지 않는다.

serializeYaml(value, original)은 무변경이면 주석·개행을 포함한 원문을 반환한다. 변경 값은 정렬 key/UTF-8/LF로 직렬화한다. 읽기만으로 기본값이나 파일을 저장하지 않는다. 단계 3에서 다중 파일 쓰기·OS 잠금·journal을 추가했으며 [WORKSPACES.md](WORKSPACES.md)를 따른다.

## 참조·지문·불변성

[reference-paths.json](../packages/schema/core/v1/reference-paths.json)의 선언 경로만 추출한다. core/확장/sequence는 완전 Reference, 선택·검토·입력은 SnapshotTarget이다. ref ID 유일성, 정확 target/anchor, 부모 존재·동일 요소 DAG, 본문 `[[ref:ref_id]]`와 `<a id="passage_discovery"></a>`를 검사한다.

baseline은 selected만 따른다. 적용 depends_on 불일치는 working 경고/release 구조 오류이고 과거 cites/compares/evidence 핀은 허용한다. continuity 기본 main, platform/mode는 OR 집합이고 빈 배열은 오류다. 완전한 전파·갱신 경고·release 승인·관점/시간/scope query는 후속 단계다.

지문 계약:

- source: 정확한 바이트의 SHA-256.
- snapshot: 경로/source digest 쌍을 경로순으로 정렬한 canonical JSON의 SHA-256.
- semantic model 1: kind + revision 메타/본문. created_at/created_by/body_path 제외, ID/parents/title/label/status/scope/본문/확장/ref 포함. 본문 LF 정규화.
- aliases/tags 생략은 [], continuity 생략은 main. parents/aliases/tags/platform/mode는 정렬 집합, core references는 ref ID순, 그 외 배열은 순서 보존. JSON key 정렬, 문자열 원문 유지.
- dependency manifest: depends_on을 따라 도달한 고정 target와 semantic digest를 ID/revision순으로 정렬한 SHA-256. cycle도 유한 계산. 미지원 의미 모델은 계산 차단.
- 단계 2는 source/semantic/dependency와 review/context mapping의 migration attestation을 구현했다. 단계 4는 user review·고정 입력 digest의 release 준비도를 검사한다. 전체 통합 diff 승인 토큰은 단계 5다. review 파일의 digest 존재만으로 통합 권한을 부여하지 않는다.

prepareChanges(snapshot, changeSet)는 expectedSnapshot/expectedDigest를 확인해 메모리 후보 전체를 검증한다. 디스크를 쓰지 않는다. 기존 revision/review/checkpoint 바이트 변경·삭제와 entity kind 변경을 차단한다. 새 revision을 추가해도 baseline은 자동 이동하지 않는다. 단계 2의 형식 변환은 별도 등록 engine에서 검증하며 이 API에 우회 boolean이나 임의 attestation 승인 경로를 추가하지 않았다.

loadCommittedProject/validateAgainstGit은 실제 Git tree/blob을 읽어 기준 commit과 수동 변경을 비교한다. index/working/ref/사용자 설정을 변경하지 않는다. worktree 생성·통합은 없다. 기준 commit이 없으면 schema만으로 과거 바이트의 불변성을 증명할 수 없다.

## 실행과 fixture

```powershell
npm ci
npm run check
npm run project:validate -- fixtures/valid-minimal
npm run project:validate -- fixtures/narrative
npm run project:validate -- fixtures/game-design
npm run project:baseline -- fixtures/game-design baseline_main ent_stamina
npm run project:get -- fixtures/game-design ent_stamina rev_stamina_b
```

실제 commit이 있는 CRAFT 사용자 프로젝트에서는 `npm run project:validate -- <root> --base <ref>`로 기존 바이트를 비교한다. 앱 소스 루트는 사용자 프로젝트가 아니다. CLI는 읽기/정합성 도구이며 앱 실행·통합·release 승인을 하지 않는다.

valid-minimal은 task/checkpoint/context/proposal/review/skill/MCP를 포함한다. narrative는 인물/사실/장면/상태/인식/공개/sequence, game-design은 수치/두 리비전/규칙/관찰을 포함한다. invalid-references는 MISSING_TARGET으로 실패해야 한다. unsupported-required/optional은 제한 읽기·원문 보존·쓰기 차단을 검증한다. 모두 시험 데이터다.
