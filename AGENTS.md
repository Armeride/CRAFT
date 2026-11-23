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
- `git commit --no-verify`를 사용하지 않는다. 같은 검사가 CI에서 다시 실행된다.

### 실행 환경 (WSL)

- 에이전트는 WSL(Linux)에서 작업한다. 저장소는 WSL 파일시스템(예: `~/git/CRAFT`)에 클론한다. `/mnt/c`, `/mnt/d` 아래의 Windows 경로에서 작업하지 않는다. 느리고, 파일 권한과 줄바꿈이 섞인다.
- Node와 npm은 `.node-version`과 `tools/quality/package.json`의 `engines`에 적힌 버전을 쓴다.
- `npm run quality:setup` 전에 Semgrep을 설치한다: `uv tool install semgrep==1.185.0`. gitleaks와 osv-scanner는 setup이 Linux용 바이너리를 내려받아 sha256으로 검증한다.
- Windows 전용 동작(경로, 프로세스 종료, 코드 페이지)을 바꿨다면 Linux에서 통과해도 CI의 Windows `check` 결과를 확인한다.

### Git과 PR

에이전트는 자기 GitHub App(봇 계정) 자격 증명으로 **브랜치 push와 PR 생성까지만** 한다. 머지는 관리자가 리뷰하고 승인한 뒤에 한다.

- 작업은 `main`에서 갈라진 새 브랜치에서 한다. 이름은 `<에이전트>/<주제>` 형식이다(예: `codex/fix-indexer-tar-path`, `claude/web-draft-panel`).
- 자기 브랜치에만 push한다. `main`에 push하지 않고, 다른 에이전트나 관리자의 브랜치에 push하거나 force push하지 않는다.
- PR 본문에 다음을 적는다.
  - 무엇을 왜 바꿨는지
  - 실행한 검사(`check`, `check:security`)와 결과
  - 추가한 `eslint-disable`의 위치와 이유
  - 오탐이라고 판단한 항목(아래 형식)
- 하지 않는 것:
  - PR 승인·리뷰 제출, 머지, 라벨 변경, 다른 PR 닫기
  - 저장소 설정·ruleset·Actions 설정 변경
  - 관리자 계정의 자격 증명(`gh` 로그인, 개인 토큰, SSH 키) 사용
- CI가 실패하면 같은 브랜치에 수정 커밋을 push한다. 원인이 앱 코드 밖(러너 환경, 게이트 설정)이라고 판단되면 고치지 말고 PR 코멘트로 보고한다.

### 금지

- `any` (명시적 `any`와 `as any` 모두), `@ts-ignore`, `@ts-nocheck`.
- 근거 없는 타입 단언(`as X`, `!`), 그리고 `as unknown as X`로 타입 검사를 피하는 것. 타입 가드, `satisfies`, 스키마 검증으로 해결한다.
- `@ts-expect-error`는 10자 이상의 설명이 있을 때만 쓸 수 있다.
- 설명 없는 `eslint-disable`, 범위를 지정하지 않은 `/* eslint-disable */`. 꼭 필요하면 `// eslint-disable-next-line <규칙> -- <이유>` 형식으로 쓰고, 완료 보고에 그 위치를 적는다.
- `eval`, `new Function`, `node:vm`, `child_process.exec`/`execSync`, `shell: true`.
- `child_process`·`better-sqlite3`·웹 `fetch`를 기존 래퍼 밖에서 직접 쓰는 것. 각각 process/git 래퍼, `packages/indexer/src/worker.ts`, `apps/web/src/api.ts`를 통한다.
- 순환 import, `packages/domain`·`packages/schema`에서 상위 패키지를 import하는 것.

### 수정 금지 파일 (관리자 전용)

다음 파일은 읽기만 한다. 로컬에서는 pre-commit 훅이 이 파일들의 변경을 차단한다. PR에서는 `guard`가 변경 목록을 경고로 표시하고, 관리자의 Code Owner 승인 없이는 머지되지 않는다.

- `tools/quality/**`: 린트·구조 규칙, 베이스라인, suppression, 임계값, 러너
- `.semgrep/**`, `.semgrepignore`, `lefthook.yml`, `.github/**`(`CODEOWNERS`, 워크플로), `.codex/**`, `AGENTS.md`, `.npmrc`
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

규칙을 끄거나, 설정·베이스라인을 고치거나, 코드를 비틀어 검사를 피하지 않는다. 대신 다음을 PR 본문(또는 완료 보고)에 적고 관리자 판단을 기다린다.

- `파일:줄`, 규칙 ID, 오탐이라고 보는 이유, 제안하는 처리 방법
