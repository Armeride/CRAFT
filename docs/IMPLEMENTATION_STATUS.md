# 구현 상태

갱신: 2026-11-10, Asia/Seoul.

## 현재 단계와 진행 규칙

- 단계 0·1 완료, 단계 2~9 미착수, 단계 10 선택 확장.
- 사용자 지시: 순서대로 한 단계씩 진행하고, 한 단계 완료 후 반드시 멈추고 대기한다.
- 현재 단계 1을 마쳤으며 대기한다. 단계 2를 자동 시작하지 않는다.
- 기준: PROJECT_SPEC.md v1.1 전체 및 REVIEW_NOTES.md. 원본 3개 문서는 SHA-256 비교로 무변경 확인.
- 앱 소스 저장소: D:/git/CRAFT, master/unborn(커밋 없음), remote·추가 worktree 없음.

## 단계 1 완료 범위

| 위치 | 실제 구현 |
|---|---|
| packages/schema/core/v1 | core 및 narrative/game_design JSON Schema, 선언된 참조 추출 경로 |
| packages/schema/src | 자동 생성 타입, Ajv2020 validator, 확장/kind 연결 |
| packages/domain/src | 정본 snapshot 모델, exact/baseline 조회, 부모 DAG·대상/anchor/역할/폐쇄성 검증, 의미 정규화 |
| packages/project-fs/src/yaml.ts | AST 안전 정책·위치, 무변경 원문 보존·결정적 직렬화 |
| packages/project-fs/src/files.ts | UTF-8·portable 경로·junction/충돌 검사, 고정 바이트 캡처·지문·UUIDv4 ID |
| packages/project-fs/src/project.ts | lock/버전/확장 호환, 전체 파일 로더, SOURCE_CHANGED, task/checkpoint/context 정합성 |
| packages/project-fs/src/changes.ts | expected snapshot/hash의 메모리 변경 후보, 불변성, semantic/dependency digest |
| packages/project-fs/src/git-baseline.ts | Git commit/tree/blob 읽기와 실제 수동 변경 비교, index/working 불변 |
| tools/project-cli.ts | 읽기 전용 validate/exact/baseline CLI |
| fixtures | 최소/소설/게임/누락 참조/미지원 required·optional 실제 프로젝트 |

FR-001/003/004/016의 파일 기반을 구현했다. FR-016의 DB 재구축과 FR-017의 migration 엔진 등 전체 요구를 완료한 것은 아니다. review/task/proposal/MCP/스킬 파일의 구조·참조는 읽지만 실행·승인·통합을 수행하지 않는다.

단계 1 gate:

1. DB 없이 프로젝트·exact revision·baseline 조회: 통과.
2. 누락 ref/anchor·중복 ID/ref·부모 DAG·경로 탈출을 위치와 함께 진단: 통과.
3. 파일 읽기 및 무변경 직렬화에 원본 diff 없음: 통과.
4. JSON Schema에서 타입 생성 및 drift 검사: 통과.
5. 소설·게임 fixture, 확장 손실 방지, 실제 Git 불변성: 통과.

## 실제 실행 명령

최초 설치는 npm ci, 전체 검증은 npm run check다. schema:check → typecheck → build → test를 실행한다.

빌드 후:

~~~powershell
npm run project:validate -- fixtures/valid-minimal
npm run project:validate -- fixtures/narrative
npm run project:validate -- fixtures/game-design
npm run project:baseline -- fixtures/game-design baseline_main ent_stamina
npm run project:get -- fixtures/game-design ent_stamina rev_stamina_b
~~~

모두 실제 실행·통과했다. baseline은 rev_stamina_a를 유지하고 exact는 미채택 rev_stamina_b를 읽는다. commit이 있는 사용자 프로젝트는 project:validate -- <root> --base <ref>로 기존 바이트를 비교한다. 앱 저장소 루트는 사용자 프로젝트가 아니다.

## 실제 검증 결과

- 생성 타입 일치, strict 타입 검사(skipLibCheck=false), 전체 빌드 통과.
- Vitest: 3파일 / 77개 통과. 단계 1 테스트 71개와 단계 0 환경 probe 6개.
- 최종 재현 확인: npm ci(61패키지 설치, audit 취약점 0) 후 확인된 dist 생성물만 비우고 npm run check 재통과. 원본 3개 지문 불변·문서 로컬 링크 19개 유효·FR 20개/AT 50개 추적표 유지 확인.
- 안전 YAML(금지 문법·손실 수치·자원 제한·위치), UTF-8·한글/공백 경로, junction 탈출·NFC 충돌, core/extension/sequence 참조 및 SnapshotTarget 구분 확인.
- 기존 bytes/Git commit 불변성·raw source와 semantic 차이·미지원 필수/선택 확장·미래 포맷·외부 파일 변경 주입·메모리 후보의 비적용 확인.
- 원본 PROJECT_SPEC/REVIEW_NOTES/START_HERE 무변경. 테스트 임시 디렉터리와 독립 Git fixture는 경로 확인 후 정리됨.
- Node 24.21.0/npm 11.19.0 유지. json-schema-to-typescript 16.0.0 추가, Ajv/ajv-formats/yaml을 runtime dependencies로 이동.
- CLI 버전 확인은 이전 환경 단계의 Claude 2.1.294 / Codex 0.164.0-alpha.11.1뿐이다. 모델 호출·인증·protocol smoke 없음.

AT 추적: 현재 구현 범위에서 AT-31(완전 Reference), AT-50(안전 YAML) 통과. AT-18/28/29/32/37/46/48의 기반 검사는 일부 있지만 migration·통합·실행·도메인 query가 결합된 전체 인수 통과로 세지 않는다. AT-01~50 전체 인수는 단계 9의 별도 gate다.

## 현재 한계

- 직렬화기와 메모리 FileChangeSet만 있다. 디스크 변경 적용·OS 잠금/lease·다중 파일 journal/crash 복구는 단계 3 범위다.
- 형식 migration 예외가 없어 기존 revision/review/checkpoint 변경을 엄격히 차단한다. registry·preflight/transform/verify·attestation은 단계 2 미구현이다.
- full blocker/갱신 경고/사용자 review 유효성/release 승인/diff digest·의미 통합은 미구현이다. CLI 성공은 release 반영 승인이 아니다.
- exact/baseline과 구조 검증만 제공한다. FTS/index generation, 실제 소설 시간 재생·POV/게임 scope query, 컨텍스트 서비스, REST/UI/SSE, provider/MCP 실행·스킬/재개는 후속 단계다.
- 미래 core는 차단한다. 미지원 확장은 제한 읽기·원문 보존이며 완전한 의미/참조 그래프 지원으로 표시하지 않는다. semantic 동등성을 증명할 수 없는 데이터의 digest를 제공하지 않는다.
- 현재 Windows 네이티브 검증. .cmd shim/WSL/프로세스 트리 종료/다른 OS는 미확인이다.
- Git 초기화 후 샌드박스 setup refresh 오류가 있어 일반 권한 명령으로 실행했다. 앱 repo Git 명령에는 명령별 safe.directory를 사용했고 전역 설정·소유권은 바꾸지 않았다.

## 다음 단계: 사용자 지시 후 단계 2만 진행

1. 로컬 변경을 검토해 개발 기준 commit을 확보하고 schema 버전/semantic 계약과 fixture를 보존한다.
2. fixture 전용 v1→v2 registry를 작성한다. 실제 제품 v2를 배포하거나 v1을 재정의하지 않는다.
3. read/write/migrate 지원표·preflight/transform/verify·수동 결정·manifest/lock/history·attestation을 구현한다.
4. 단계 2에 필요한 최소 Git 임시 저장소·전용 migration worktree를 추가한다.
5. 원본 hash 불변, 실패 보존, 의미 보존 ID 유지, no-op, 미래 schema 쓰기 차단·수동 결정 대기를 검증한다.
6. 결과와 한계를 기록하고 다시 멈춰 대기한다. 단계 3 자동 착수 금지.

## 보존 상태

앱 저장소는 최초 commit이 없다. 초기 문서·환경 파일과 추가한 packages/fixtures/docs/tools는 untracked 상태로 디스크에 보존돼 있다. Git 이력/원격 백업 완료로 간주하지 않는다. 원격 추가·push·실제 사용자 데이터 변경·추가 worktree 생성은 하지 않았다.

node_modules/dist/.tmp는 재생성 가능한 제외 산출물이다. 일회성 fixture 작성 보조 도구는 제거했고 고정된 fixture 원본만 남겼다. 실제 실행 중인 앱·모델·백그라운드 프로세스는 없다. 상세 계약은 FILE_FORMAT_V1.md 및 ADR-006을 따른다.
