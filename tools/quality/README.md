# 품질·보안 게이트 (관리자용)

에이전트가 따라야 할 규칙은 [AGENTS.md](../../AGENTS.md)에 있다. 이 문서는 게이트를 유지보수하는 사람을 위한 설명이다. 2026-11-19에 구성했다.

## 구조

| 구성 요소 | 위치 | 비고 |
|---|---|---|
| 격리된 도구 패키지 | `tools/quality/package.json`, lockfile, `.npmrc` | TypeScript **6.0.3**을 고정한다. 앱은 TS 7.0.2를 쓰고, typescript-eslint 8.x와 type-coverage는 TS 7 API가 없어 동작하지 않는다(typescript-eslint #12518). 타입 *검사*는 계속 앱의 TS 7 `tsc`가 한다. `.npmrc`에 `min-release-age=7`을 둔다 |
| 러너 | `run.mjs` | 모든 진입점. shell을 쓰지 않는다(`spawnSync`, `shell:false`) |
| ESLint | `eslint.config.mjs`, `eslint-suppressions.json` | `strict-type-checked`, regexp, sonarjs, security, eslint-comments, react-hooks, no-unsanitized(웹). 모든 `warn`은 `error`로 올린다 |
| lint 전용 tsconfig | `tsconfig.web-tests.json`, `tsconfig.e2e.json`, `tsconfig.bench.json` | 앱 tsconfig에 포함되지 않던 파일을 검사 대상으로 만든다. e2e는 기존 오류 3건 때문에 아직 lint 전용이다 |
| type-coverage | `thresholds.json` | `--strict --ignore-catch`의 하한 |
| knip | `knip.json`, `knip-baseline.json` | 심볼 단위 베이스라인(러너가 비교). `ignoreIssues`는 생성 파일에만 쓴다 |
| dependency-cruiser | `dependency-cruiser.cjs`, `dependency-cruiser-known-violations.json` | 순환, 레이어 초안, 운영 코드→테스트, 운영 코드→devDependency 금지 |
| size-limit | `.size-limit.json` | 웹 JS 148kB, CSS 36kB (gzip). 측정값은 144.7kB와 34.6kB |
| Semgrep | `../../.semgrep/craft.yml` (+ 픽스처 `craft.ts`), `semgrep-baseline.json` | 레지스트리 p/typescript, p/nodejs, p/owasp-top-ten, p/react와 전용 규칙 6개 |
| osv-scanner, gitleaks | `binaries.json`, `osv-scanner.toml` | 릴리스 바이너리를 sha256으로 검증해 `.tools/`에 설치한다 |
| 훅 / CI | `../../lefthook.yml`, `../../.github/workflows/quality.yml`(check, security), `../../.github/workflows/quality-guard.yml`(guard, 보고 전용) | |
| 승인 | `../../.github/CODEOWNERS` | 모든 경로의 Code Owner는 관리자 |
| Codex 훅 (제안) | `codex-hooks.example.json` | 아래 참고 |
| 벤치마크 | `../../bench/graph-analysis.bench.ts` | `npm run bench` |

## 명령

| 명령 | 내용 | 측정 시간 (로컬 Windows) |
|---|---|---|
| `npm run check:fast [-- 파일...]` | tsc(core, web, bench) + 변경 파일 ESLint | 약 6초 |
| `npm run check` | 기존 check(schema → typecheck → build → ui:build) → 러너 `check`(추가 tsconfig, 전체 ESLint, type-coverage, knip, depcruise, size-limit) → vitest | 게이트 약 25초, 전체 약 7.5분 |
| `npm run check:security` | Semgrep + osv-scanner(lockfile 2개) + gitleaks(전체 이력) | 약 15초 |
| `node tools/quality/run.mjs security --sarif` | SARIF를 `.tmp/quality-reports/`에 저장 | ESLint도 `lint --sarif`로 가능 |
| `npm run lint:prune` | 해결된 ESLint suppression 제거(개수 감소만) | |
| `npm run quality:setup` | tools 설치, 바이너리 설치, lefthook 훅 설치 | |

훅 구성:

- pre-commit: 보호 파일 가드, gitleaks(staged), 스테이징된 TS 파일에 대한 check:fast
- pre-push: check:security, 전체 lint
- 전체 `check`는 약 7.5분이라 CI에서만 돌린다

## PR 운영 (에이전트별 GitHub App)

에이전트(Codex, Claude)는 WSL 환경에서 각자의 GitHub App 설치 토큰으로 브랜치를 push하고 PR을 연다. PR 작성자가 봇이므로 관리자가 승인할 수 있다.

1. **`main` ruleset** (2026-11-23 설정)
   - 브랜치 대상: 기본 브랜치
   - PR 필수, 승인 1, Code Owner 리뷰 필수, 새 커밋이 오면 기존 승인 취소, 마지막 push 이후 승인 필수
   - 필수 상태 검사: `check`, `security` (`check`는 2026-11-24 추가)
   - force push와 삭제 금지
   - bypass: Repository admin, *pull request에서만*. 관리자가 직접 연 PR(게이트 수정 등)은 승인해 줄 사람이 없으므로 bypass로 머지한다. App은 bypass에 넣지 않는다.
2. **`CODEOWNERS`가 `* @Armeride`인 이유**: App이 둘이라 한 App이 다른 App의 PR을 승인할 수 있다. Code Owner 리뷰를 요구하면 관리자의 승인만 인정된다.
3. **`guard`는 보고 전용이다.** App은 PR 라벨도 붙일 수 있으므로 라벨로는 관리자의 의도를 증명할 수 없다. 그래서 PR에서는 게이트 파일 변경, ESLint suppression 증가, `package.json` 게이트 스크립트 변경을 경고 주석과 job summary로 보여주기만 한다. 막는 것은 위 승인 규칙이다. 로컬 pre-commit의 `guard`는 그대로 커밋을 막는다.
4. **App 권한**: Contents, Pull requests는 read/write, Metadata는 read만 준다. Workflows, Administration, Actions, Secrets는 주지 않는다. Workflows 권한이 없으면 `.github/workflows/**`를 바꾼 push는 GitHub이 거부한다.
5. **저장소 설정**: Actions의 기본 토큰 권한은 read로 두고, "Allow GitHub Actions to create and approve pull requests"는 끈다.
6. **`quality.yml`에 `paths` 필터를 넣지 않는다.** 필수 검사가 필터 때문에 실행되지 않으면 그 PR은 검사를 기다리다 머지할 수 없게 된다.

리뷰할 때 `guard`가 경고를 남긴 PR은 해당 파일의 diff를 반드시 확인한다. 에이전트가 게이트를 바꾸려는 이유는 PR 본문에 적혀 있어야 한다(AGENTS.md "오탐이라고 판단될 때").

## 베이스라인 갱신 (관리자만)

```powershell
node tools/quality/run.mjs baseline eslint      # 또는 depcruise | knip | semgrep
$env:QUALITY_GATE_OVERRIDE = '1'; git commit ...; Remove-Item Env:QUALITY_GATE_OVERRIDE
```

- 베이스라인을 *늘리는* 커밋은 규칙을 새로 도입할 때만 한다. 커밋 메시지에 이유를 적는다.
- type-coverage 하한은 실제 값이 오르면 올린다. 내리지 않는다.
- size-limit 예산을 올릴 때는 커밋 메시지에 증가 원인을 적는다.

## 2026-11-19 기준선

| 도구 | 기존 위반 | 처리 |
|---|---|---|
| tsc (TS 7, 앱 tsconfig) | 0 | — |
| tsc (web 테스트 + vite 설정, 새로 검사 대상) | 0 | `check`에 포함 |
| tsc (tests/ui + playwright 설정) | 3 (`tests/ui/draft.spec.ts` TS2352) | lint 전용. 고친 뒤 `typecheck`에 추가 |
| ESLint | 1,962건 / 141개 파일 | `eslint-suppressions.json` |
| type-coverage | core 98.14%, web 99.08% | 하한 |
| knip | 35건 (미등록 의존성 1, 미사용 export 13, 미사용 타입 21) | `knip-baseline.json` |
| dependency-cruiser | 8건 (순환 2, domain→state-model 5, tools/agent-smoke→test-helpers 1) | known-violations |
| Semgrep | 1건 (`.npmrc`에 `min-release-age` 없음) | `semgrep-baseline.json` |
| osv-scanner | 앱 0, 도구 1 (minimatch GHSA-g3hv-75wg-m249) | `osv-scanner.toml`, 2027-02-17 만료 |
| gitleaks | 이력 0 | — |

## 제외하거나 보류한 항목과 근거

- **`security/detect-non-literal-fs-filename`(271건), `security/detect-object-injection`(165건) 끔.** 타입 정보 없이 패턴만으로 판단하는 대표적 오탐 규칙이다. 이 앱은 설계상 프로젝트 파일 경로를 다룬다. 경로·프로세스 경계는 Semgrep 전용 규칙과 리뷰로 지킨다.
- **oxlint + oxlint-tsgolint 보류.** TS 7 네이티브로 175개 파일 타입 기반 검사가 0.9초다. 다만 1.94에는 bulk suppression이 없어 래칫을 만들 수 없다. typescript-eslint가 TS 7 API를 지원하지 못한 채 TS 6 지원이 끝나면 이쪽으로 옮긴다.
- **Biome(포매터) 보류.** 현재 포매터가 없다. 도입하면 전체 재포맷으로 진행 중인 작업과 충돌한다.
- **ESLint `--cache` 미사용.** 타입 기반 규칙은 의존 파일이 바뀌어도 캐시가 무효화되지 않는다.
- **벤치마크 절대 임계값 없음.** 기기마다 편차가 크다. 결과 정합성(SCC 개수)만 검증한다.
- **CodeQL: 제안만.** 공개 저장소라 무료이고, GitHub의 *Default setup*(Settings → Code security → Code scanning)으로 워크플로 파일 없이 켤 수 있다. JavaScript/TypeScript 추출기는 자체 파서를 쓰므로 프로젝트의 TS 7과 무관할 것으로 예상하지만, 첫 실행 결과로 확인해야 한다.
- **GitLab CI는 작성하지 않음.** GitHub Actions를 쓰고 있기 때문이다.

## Codex 훅 (제안)

Codex는 `.codex/hooks.json`의 `PostToolUse`(matcher `apply_patch|Edit|Write`)를 지원한다. 신뢰된 프로젝트에서만 로드되고, 사용자가 `/hooks`에서 승인해야 한다.

켜려면 `codex-hooks.example.json`을 `.codex/hooks.json`으로 복사하고 Codex에서 승인한다. 그러면 파일을 수정할 때마다 `node tools/quality/run.mjs codex-hook`이 check:fast를 실행한다. 실패하면 `{"decision":"block","reason":...}`로 오류를 모델에게 되돌린다.

## 알려진 환경 이슈

- **해결됨(#3, 2026-11-23): GitHub Windows 러너에서 앱 테스트 2건이 실패하던 문제.**
  - `packages/indexer/src/indexer.test.ts` stage-3 reader 테스트: 한글이 든 임시 경로를 시스템 `tar`에 넘기다 러너의 코드 페이지에서 경로가 깨졌다. tar 대신 `git read-tree`와 `checkout-index`로 바꿨다.
  - `packages/agent-core/src/phase7.test.ts` provider 전환 복구 테스트: 승인 대기가 느린 러너에서 시간 초과됐다.
- 관리자가 Windows에서 직접 검사를 돌릴 때는 대문자 드라이브 cwd(`D:\git\CRAFT`)의 PowerShell을 쓴다. 에이전트는 WSL에서 실행한다(AGENTS.md).
- Git Bash의 소문자 드라이브 cwd(`d:\git\CRAFT`)에서는 Vitest가 "failed to find the current suite/runner"로 모든 테스트가 실패한다. 대문자(`D:\`) cwd 또는 PowerShell에서는 정상이다. 이 때문에 벤치는 `--root bench`로 실행한다.
