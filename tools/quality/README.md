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
| 훅 / CI | `../../lefthook.yml`, `../../.github/workflows/quality.yml`(check, security), `../../.github/workflows/quality-guard.yml`(guard) | |
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

## PR 운영 (GitHub 계정이 하나인 저장소)

GitHub에서는 PR 작성자가 자기 PR을 승인할 수 없다. 그래서 승인 리뷰와 CODEOWNERS 대신 다음 방식으로 운영한다.

1. 에이전트는 로컬 커밋까지만 한다(AGENTS.md). push와 PR 생성, 라벨 지정은 관리자만 한다.
2. `main`에 ruleset을 건다.
   - PR 필수(필요 승인 수 0)
   - 필수 상태 검사 `check`, `security`, `guard`
   - force push와 삭제 금지
3. `guard`(quality-guard.yml)는 게이트 파일 변경, ESLint suppression 증가, `package.json` 게이트 스크립트 변경을 막는다. PR에 `quality-gate-change` 라벨이 있을 때만 통과한다. 라벨을 붙였다 떼면 `guard`만 다시 실행된다.
4. 셀프 리뷰는 PR의 Files changed 화면에서 diff를 확인하는 것으로 한다.

한계: 에이전트가 관리자의 GitHub 자격 증명(`gh` 토큰, push 권한)을 쓸 수 있으면 라벨도 붙일 수 있다. 에이전트 실행 환경에 GitHub 토큰을 주지 않는 것이 전제다.

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

- Git Bash의 소문자 드라이브 cwd(`d:\git\CRAFT`)에서는 Vitest가 "failed to find the current suite/runner"로 모든 테스트가 실패한다. 대문자(`D:\`) cwd 또는 PowerShell에서는 정상이다. 이 때문에 벤치는 `--root bench`로 실행한다.
- Git Bash에서는 `packages/indexer/src/indexer.test.ts`의 stage-3 reader 테스트가 GNU tar 때문에 실패한다(`D:` 콜론을 원격 호스트로 해석). PowerShell에서는 통과한다.
