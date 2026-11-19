# AGENTS.md

작업 시작 방법과 제품 기준은 [docs/START_HERE.md](docs/START_HERE.md)를 따른다. 이 파일은 모든 코딩 에이전트가 지켜야 할 규칙이다.

## 품질 게이트

### 반드시 실행할 것

| 시점 | 명령 | 통과 조건 |
|---|---|---|
| 처음 한 번 (`tools/quality/node_modules`가 없을 때) | `npm run quality:setup` | 설치 성공 |
| 코드를 수정할 때마다 | `npm run check:fast` | 변경 파일 기준 타입·린트 위반 0 (약 6초) |
| 작업 단위를 끝내기 전 (커밋·완료 보고 전) | `npm run check`, `npm run check:security` | 둘 다 exit 0 |

- 실패를 남긴 채 "완료"로 보고하지 않는다. 실패하면 코드를 고친다.
- Windows에서는 cwd의 드라이브 문자가 대문자(`D:\git\CRAFT`)인 셸(PowerShell)에서 실행한다. Git Bash의 소문자 `/d/...`에서는 Vitest가 모듈을 이중으로 로드해 테스트가 실패한다.
- `git commit --no-verify`를 사용하지 않는다. 같은 검사가 CI에서 다시 실행된다.
- 커밋은 로컬까지만 한다. `git push`, PR 생성, PR 라벨 변경은 하지 않는다. 관리자가 diff를 확인한 뒤 직접 push하고 PR을 연다.

### 금지

- `any` (명시적 `any`와 `as any` 모두), `@ts-ignore`, `@ts-nocheck`.
- 근거 없는 타입 단언(`as X`, `!`), 그리고 `as unknown as X`로 타입 검사를 피하는 것. 타입 가드, `satisfies`, 스키마 검증으로 해결한다.
- `@ts-expect-error`는 10자 이상의 설명이 있을 때만 쓸 수 있다.
- 설명 없는 `eslint-disable`, 범위를 지정하지 않은 `/* eslint-disable */`. 꼭 필요하면 `// eslint-disable-next-line <규칙> -- <이유>` 형식으로 쓰고, 완료 보고에 그 위치를 적는다.
- `eval`, `new Function`, `node:vm`, `child_process.exec`/`execSync`, `shell: true`.
- `child_process`·`better-sqlite3`·웹 `fetch`를 기존 래퍼 밖에서 직접 쓰는 것. 각각 process/git 래퍼, `packages/indexer/src/worker.ts`, `apps/web/src/api.ts`를 통한다.
- 순환 import, `packages/domain`·`packages/schema`에서 상위 패키지를 import하는 것.

### 수정 금지 파일 (관리자 전용)

다음 파일은 읽기만 한다. 로컬에서는 pre-commit 훅이, PR에서는 CI의 `guard` 검사가 이 파일들의 변경을 차단한다.

- `tools/quality/**`: 린트·구조 규칙, 베이스라인, suppression, 임계값, 러너
- `.semgrep/**`, `.semgrepignore`, `lefthook.yml`, `.github/**`, `AGENTS.md`, `.npmrc`
- `tsconfig*.json`, `apps/web/tsconfig.json`
- `package.json`의 `check`, `check:fast`, `check:security`, `lint`, `lint:prune`, `quality:setup` 스크립트. 의존성과 다른 스크립트는 수정해도 된다.

### 베이스라인 (기존 위반)

- 기존 위반은 베이스라인으로 동결돼 있다. 위치는 `tools/quality/eslint-suppressions.json`, `dependency-cruiser-known-violations.json`, `knip-baseline.json`, `semgrep-baseline.json`이다. 파일·규칙별 개수가 늘어나면 실패한다.
- 기존 위반을 고쳐 줄이는 것은 환영한다. 그러면 `npm run check`가 "unused suppressions"로 실패할 수 있는데, 이때는 `npm run lint:prune`을 실행하고 줄어든 `tools/quality/eslint-suppressions.json`을 함께 커밋한다. 이것이 수정 금지 파일의 유일한 예외이며, 개수가 줄어드는 변경만 허용된다(훅이 검사한다).
- type-coverage는 하한(`tools/quality/thresholds.json`)보다 낮아지면 실패한다.

### 의존성 추가

- 새 의존성을 추가하면 커밋 메시지에 이유를 적는다(무엇에 쓰는지, 왜 기존 것으로 안 되는지).
- 정확한 버전으로 고정하고, 추가한 뒤 `npm run check:security`(osv-scanner·Semgrep)가 통과하는지 확인한다.

### 오탐이라고 판단될 때

규칙을 끄거나, 설정·베이스라인을 고치거나, 코드를 비틀어 검사를 피하지 않는다. 대신 다음을 완료 보고에 적고 관리자 판단을 기다린다.

- `파일:줄`, 규칙 ID, 오탐이라고 보는 이유, 제안하는 처리 방법
