# 작업 009 — 통합·장애·성능·배포 인수

기준은 명세 v1.4, `origin/main`의 `e79ceb2`다. 단계 9의 검증 대상은 작업 결과의 승인 통합, 장애 시 보존과 복구, 1,000요소 규모, 로컬 설치·복원이다. [단계 9 계획](../IMPLEMENTATION_PLAN.md#단계-9--전체-통합장애성능배포-기준), [로컬 배포와 복구](../LOCAL_RELEASE.md).

WSL2 Ubuntu 24.04에서 `npm run check:fast`, `npm run check`(Vitest 27파일 225개), `npm run check:security`가 통과했다. Chrome 158.0.8127.36에서 `npm run test:ui` 19개가 통과했다. 임시 Playwright 설정에서 해당 Chrome 실행 경로를 지정하고 저장소의 기존 테스트와 서버 설정을 사용했다.

## 통합과 복구

- Git에서 대상 T와 작업 체크포인트 R의 유일한 공통 조상 B를 구한다. 작업 생성 시 선택한 미커밋 입력은 별도 기준으로 유지해 작업이 변경하지 않은 파일이 통합에 섞이지 않게 한다. 채택 기준의 정의가 같으면 요소별 리비전 선택을 병합한다. 같은 요소의 다른 선택과 삭제한 경로는 보존한 상태에서 충돌로 돌려준다.
- 정규화는 대상 T의 schema set에서 비교한다. 비교용 B/R 사본에 같은 등록 변환을 적용하고 버전·참조·의미 digest를 확인한다. 자동으로 증명할 수 없는 결정, 미지원 스키마, writer가 없는 대상은 `MIGRATION_MERGE_UNSUPPORTED`로 보류한다. 변환 근거와 기존 검토의 의미 유효성은 migration 보고서에서 확인할 수 있다. fixture v2는 시험 전용이다.
- 통합 후보에 새로 생긴 의존성·범위 충돌은 차단하고 해당 진단을 반환한다. 후속 리비전·분기 경고는 검토 diff와 함께 보여 준다. 원래 핀과 각 소스 브랜치를 보존한다. 승인에는 실제 source/target commit과 diff digest가 연결되며, 하나라도 바뀌면 다시 준비하고 승인한다. 원래 바이트로 되돌린 파일은 승인된 상태를 확인한 뒤 Git 인덱스의 파일 상태 정보를 갱신해 정상 통합한다.
- 복구 검증은 실제 자식 프로세스의 OS 잠금 해제, 완료 응답 유실, 저장 journal의 부분 완료, SQLite 트랜잭션 롤백, 가상 `ENOSPC`, MCP 전송 단절을 사용한다. 실제 전원 차단과 불량 디스크의 내구성은 환경별 검증 항목이다.

## AT 회귀 근거

아래 경로는 시험 소스다. 여러 시나리오의 근거를 공유하는 경우 관련 ID를 한 행에 적었다. 로컬 Git과 프로토콜 fixture를 사용하는 경계는 표와 실행기 기록에 명시한다.

| AT | 재검증하는 시나리오와 근거 |
|---|---|
| 01 | 로컬 bare clone, DB 삭제 후 동일 결과와 프로젝트 등록을 검증한다. [색인](../../packages/indexer/src/indexer.test.ts) |
| 02, 27, 38 | 로컬 로그·등록·이전 worktree가 없어도 refs의 checkpoint를 찾고 목표·출력·결정·스킬을 새 run으로 가져온다. [작업](../../packages/tasks/src/tasks.test.ts), [재개](../../packages/agent-core/src/phase7.test.ts) |
| 03, 04, 05, 06, 36 | 과거 장면에 미래 상태가 들어오지 않으며 진실·잘못된 믿음·무지·미기록, 장면 시간과 공개 순서를 구별한다. 누설 방지는 본문·제목·검색·연결 자료에 적용한다. [서사](../../packages/domain/src/story.test.ts), [제한된 관점](../../packages/agent-core/src/pov.test.ts), [도메인 UI](../../tests/ui/domain.spec.ts) |
| 07, 08, 09, 10, 32, 33, 42, 43, 44 | 간접 blocker, 과거 인용, 고정 핀, 승인 후속·형제, 미채택 폐기안, 순환과 정확한 사용자 검토 연결을 검증한다. [영향 분석](../../packages/domain/src/analysis.test.ts), [사용자 검토](../../packages/tasks/src/manual.test.ts) |
| 11, 37 | 동시 작업의 파일·색인·MCP 범위와 basis/working 영수증, 취소 후 scope 철회를 점검한다. [색인](../../packages/indexer/src/indexer.test.ts), [실행기](../../packages/agent-core/src/service.test.ts), [HTTP MCP](../../apps/server/agents.test.ts) |
| 12, 13, 21, 22, 45 | Git에서 충돌 없이 합쳐지는 다른 파일의 의미 경고, 병합 시에만 생기는 의존성 오류, 참조 변경 후 재검토, commit/diff 변경 후 기존 승인 거부, 중복 무효화를 검증한다. [통합](../../packages/tasks/src/manual.test.ts), [UI에서 실제 diff 승인](../../tests/ui/manual.spec.ts) |
| 14, 15, 16, 17, 18, 39, 40, 41, 46 | 실패·수동 결정·no-op, 미래 버전 차단, 공통 조상 정규화와 제품 안전 보류, 검토 digest 승계/재검토, 기존 리비전의 수동 편집을 시험한다. [migration](../../packages/migrations/src/migrations.test.ts), [통합](../../packages/tasks/src/manual.test.ts), [정본 불변성](../../packages/project-fs/src/project.test.ts) |
| 19, 28, 30, 47 | staged/unstaged/untracked 보존, 범위 밖 변경과 경로 탈출 차단, 로컬 전용과 bare clone 구분, 명시 import를 검증한다. [작업](../../packages/tasks/src/tasks.test.ts), [정본 경로](../../packages/project-fs/src/project.test.ts), [격리 실행](../../packages/agent-core/src/service.test.ts), [관리 API](../../apps/server/manual.test.ts) |
| 20, 25 | 실제 모델이 없는 질문·승인·초안·검토·통합과 중단 후 결과 보존·새 worktree, 종료 미확인 시 정리 금지를 검증한다. [에이전트 UI](../../tests/ui/agents.spec.ts), [실행 절차](../../packages/agent-core/src/service.test.ts) |
| 23, 48 | mode/platform에 맞는 관측과 설계를 분리하고 여러 후보를 임의로 고르지 않는다. [도메인 조회](../../packages/domain/src/story.test.ts), [도메인 UI](../../tests/ui/domain.spec.ts) |
| 24, 26 | 한국어 짧은 별칭과 FTS, 게시 중 원본 변경 및 SQLite 롤백으로 이전 generation이 유지되는지 검사한다. [색인](../../packages/indexer/src/indexer.test.ts) |
| 29 | 근거 핀이 오래됐을 때 확정 상태에 반영되지 않으며 삭제로 필수 핀이 사라지면 오류가 난다. [상태 평가](../../packages/state-model/src/evaluate.test.ts), [참조 검증](../../packages/project-fs/src/project.test.ts) |
| 31, 50 | 확장의 완전 Reference, 중복 키·위치·alias·안전한 YAML 범위를 검증한다. [파일](../../packages/project-fs/src/project.test.ts), [YAML](../../packages/project-fs/src/yaml.test.ts) |
| 34, 35, 54, 55, 56, 57, 59 | 장면별 정본 근거, 계획·가정·실제 발생, actor별 입력, unknown, 동시 변화와 순환 한도를 점검한다. [상태 평가](../../packages/state-model/src/evaluate.test.ts), [상태 계약](../../packages/state-model/src/state-model.test.ts), [도메인 UI](../../tests/ui/domain.spec.ts) |
| 49 | 외부 변경 도중 연결을 끊고 처리 여부가 불명인 상태에서 자동 재전송하지 않는지 확인한다. [외부 MCP](../../packages/agent-core/src/phase7.test.ts), [명령 결과](../../apps/server/commands.test.ts) |
| 51, 52, 53 | ko/en key 및 변수, 복수형, locale 전환·재접속 뒤 초안, 화면과 접근성의 자동 회귀를 확인한다. [카탈로그](../../apps/web/src/i18n.test.ts), [작업 UI](../../tests/ui/draft.spec.ts), [관리 UI](../../tests/ui/manual-restoration.spec.ts), [실행기 UI](../../tests/ui/agents.spec.ts), [도메인 UI](../../tests/ui/domain.spec.ts) |
| 58, 60 | 가정 입력 digest와 재구축 결과의 일치, 캐시 scope 격리, 과거 v1과 새 상태 계약의 호환성 및 옛 reader의 쓰기 차단을 확인한다. [평가 색인](../../packages/indexer/src/domain.test.ts), [색인](../../packages/indexer/src/indexer.test.ts), [상태 계약](../../packages/state-model/src/state-model.test.ts) |
| 61, 62, 63, 64, 65, 66, 67, 68 | 테마와 분류·글꼴 설정, 목록·패널 크기, 편집·대화 보존, engine 복구·군집·캔버스를 확인한다. [작업 UI](../../tests/ui/draft.spec.ts), [저장과 복원](../../tests/ui/manual-restoration.spec.ts), [설정](../../apps/web/src/preferences.test.ts), [그래프 배치](../../apps/web/src/graph-layout.test.ts), [작업 API](../../apps/server/app.test.ts) |

## 공급자 기록

2026-11-18에 사용자 승인 범위에서 Codex 0.169.0-alpha.11.1과 Claude Code 2.1.294(SDK 0.3.327)를 검증했다. 두 공급자가 같은 작업의 `context.build` → `changes.propose` → `project.validate`를 호출하고, 정본·사용자 review·채택 기준을 그대로 둔 채 draft와 checkpoint를 보존했다. 이 세션의 Linux 환경에서는 Codex 0.171.0 설치와 로그인 상태를 확인했다. Claude CLI는 PATH에서 찾지 못했다. 이번 세션의 회귀는 실제 모델 호출 없이 실행했다. [두 공급자 실측 기록](../validation/phase6-provider-smoke-2026-11-18.json), [실행기 지원 범위](../AGENT_WORKFLOW.md).

## 성능 재현

`npm run build` 후 `npm run bench:index`를 실행한다. 명령은 별도 임시 Git 프로젝트에 요소 1,000개, 요소별 고정 리비전 10개, 참고 관계와 채택 기준을 만들고 전체 재구축, warm exact 20회, 변경 파일 하나의 증분 점검을 측정한다. 측정은 실제 worktree와 색인 worker 경로를 포함한다. 성능 목표는 exact p95 200ms, 증분 1초, 전체 30초다.

WSL2 Ubuntu 24.04와 Node 24.21.0에서 21,007파일·10,000리비전·8,000참조를 사용했다. 같은 fixture 조건에서 변경 전후를 측정했다. 일부 표본은 자동 회귀 실행과 겹쳤다.

| 작업 | 변경 전 | 변경 후 | 잠정 목표 |
|---|---:|---:|---|
| 작업 폴더 exact p95 (20회) | 35.55초 | 12.01초 | 0.20초 미달 |
| README 한 파일 증분 점검 | 46.07초 | 14.57초 | 1초 미달 |
| 전체 재구축 | 44.26초 | 13.63초 | 30초 충족 |

파일 수집을 16개씩 묶고 배치 전체 바이트 한도를 유지한다. 이미 검증한 Git 기준 스냅샷은 지문이 같을 때 다시 파싱하지 않으며 전체 SQLite 게시에서 중복 쓰기를 제거했다. 변경 후 전체 준비/SQLite 게시는 1.66초/0.48초였고 증분은 2.56초/0.22초였다. 나머지 시간의 주요 비용은 작업 파일 열거와 지문 확인이다. exact는 조회 전후에 21,007파일의 내용과 경로를 확인한다. 증분도 게시 전후에 파일을 다시 읽고 그래프와 진단을 다시 계산한다.

## 로컬 배포 확인

빈 임시 디렉터리에서 잠금 파일로 `npm ci --offline`을 실행해 패키지 설치와 네이티브 SQLite FTS5 trigram을 확인했다. 임시 Git 저장소로 배포 서버를 시작해 HTTP 200, 예시가 없는 세션, 등록과 fresh exact 조회를 확인했다. 이 저장소의 작업 branch를 `git bundle --all`로 저장하고 검증한 뒤 새 경로에 복제했다. 새 앱 데이터에서 정본 검증, 원격 추적 작업 참조 재발견, 같은 checkpoint의 새 worktree 재개를 확인했다. Windows 배포 시작, 현재 브랜치의 Windows CI, 물리적 저장 매체 장애는 별도 환경 검증이 남아 있다.
