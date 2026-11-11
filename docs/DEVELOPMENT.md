# 개발 환경과 검증 절차

확인일: 2026-11-11, Asia/Seoul. 현재 개발 기준은 Windows 네이티브 x64다. 전역 런타임·패키지·Git 설정은 변경하지 않았다.

## 도구와 버전

| 도구 | 실제 확인 버전 | 역할 |
|---|---|---|
| Node.js | 24.21.0 | 지원 중인 LTS, `.node-version` 및 engines 고정 |
| npm | 11.19.0 | 기존 설치 사용, packageManager/engines 고정 |
| Git | 2.55.0.windows.5 | 로컬 저장소 초기화 |
| TypeScript | 7.0.2 | strict, NodeNext ESM, noUncheckedIndexedAccess |
| Vitest | 5.1.0 | Node 환경 probe 실행 |
| @types/node | 24.19.2 | Node 24 타입 |
| Ajv / ajv-formats | 8.20.0 / 3.0.1 | Draft 2020-12 검증기 후보·날짜 형식 보조 |
| yaml | 2.9.1 | AST·오류 위치·결정적 직렬화 기반 |
| fs-native-extensions | 1.5.3 | Windows OS 파일 잠금·owner 사망 후 release 검증 |
| better-sqlite3 | 13.0.3 | 로컬 native SQLite 드라이버 |
| @types/better-sqlite3 | 9.6.0 | 드라이버 타입 |
| json-schema-to-typescript | 16.0.0 | JSON Schema에서 v1 TypeScript 계약 생성 |
| SQLite | 3.53.4 | 위 설치에서 실제 SQL 조회로 확인 |
| Claude Code | 2.1.294 | `--version`만 실행 |
| Codex CLI | 0.164.0-alpha.11.1 | `--version`만 실행 |

pnpm/Bun은 현재 PATH에서 발견되지 않았다. 추가 설치는 필요하지 않다. 두 CLI의 인증·protocol/capability·실제 실행은 미확인이다. 설치된 alpha Codex를 제품 지원 완료로 취급하지 않는다.

Ajv/ajv-formats/yaml과 fs-native-extensions는 runtime dependencies다. better-sqlite3도 단계 4의 runtime dependency이며 파싱·분석·동기 SQL은 별도 worker에서 실행한다. React/Vite/Fastify/MCP SDK/E2E 도구는 해당 기능 착수 시 고정한다. 현재 packages는 논리 모듈 경계이며 별도 npm 배포 패키지는 아니다.

## 설치와 실행

```powershell
node --version
npm --version
npm ci
npm run check
node dist/tools/environment.js
```

`npm ci`는 lockfile의 정확한 버전을 설치한다. `.npmrc`의 engine-strict가 Node/npm 버전 불일치를 거부한다. 전역 업데이트 대신 프로젝트 기준 버전으로 실행한다. `better-sqlite3`는 native 모듈이므로 다른 OS/아키텍처/Node ABI로 옮기면 node_modules를 복사하지 않고 다시 설치한다.

`package.json`의 allowScripts에는 native 빌드에 필요한 `better-sqlite3@13.0.3`만 기록했다. 해당 설정으로 `npm ci` 재설치와 전체 환경 검증을 다시 통과했다. [npm의 설치 스크립트 설정](https://docs.npmjs.com/cli/commands/npm-install-scripts/)을 따른 프로젝트 로컬 설정이다.

| 명령 | 실제 범위 |
|---|---|
| `npm run schema:types` | core·migration audit·workspace runtime·state_model JSON Schema 타입 재생성(migration 실행이 아님) |
| `npm run schema:check` | 생성 타입과 schema 일치 확인, 파일 쓰기 없음 |
| `npm run typecheck` | packages/tools 및 Vitest 설정 strict 타입 검사 |
| `npm run build` | 제품 기반 모듈과 도구를 dist에 컴파일 |
| `npm test` | 8파일 158개 테스트: 단계 4의 35개 + 이전 123개. worker/별도 프로세스 시험은 먼저 build 필요 |
| `npm run test:watch` | 테스트 감시 모드 |
| `npm run check` | schema 타입 일치 → 타입 검사 → 빌드 → 전체 테스트 |
| `npm run migration -- support` | 제품 registry의 지원표, fixture는 명시 --registry fixture |
| `npm run workspace -- open ...` | 단계 3 로컬 등록·task/run·fake·복구·clone·import CLI, [계약](WORKSPACES.md) 참조 |

`npm run index -- support`와 색인 CLI는 [INDEXING.md](INDEXING.md)를 따른다. 현재 개발 서버 명령은 없다. 설치 직후 브라우저 앱을 실행할 수 있다고 안내하지 않는다.

## 단계 0 환경 probe 기록과 후속 검증

아래 표는 초기 환경 실험의 범위다. 단계 1의 제품 구현은 [FILE_FORMAT_V1.md](FILE_FORMAT_V1.md)를 따른다.

| 실제 probe | 확인한 결과 | 후속 검증 |
|---|---|---|
| runtime | 지정 Node 실행 | 업그레이드 시 exact pin 동시 갱신 |
| Windows 파일 | 한글·공백 경로, UTF-8/emoji, wx 임시 파일·sync·close·rename 교체 | 단계 3에서 native 잠금·hash·journal 복구 검증. 전원 장애 완전 내구성은 미확인 |
| Ajv2020 | prefixItems의 2020-12 의미, 잘못된 입력 거부·자동 변환 없음 | 단계 1에서 v1 schema·date format·생성 타입 계약 검증 완료 |
| YAML | 한국어·문자열 날짜 보존, 중복 key 위치, stringify round-trip | 단계 1에서 AST 금지 문법·크기/깊이·손실 수치·위치 정책 구현 완료 |
| SQLite | 한글 경로 DB/WAL, FTS5 trigram, 실패 transaction rollback | 단계 4에서 실원고·짧은 별칭·worker·증분/복원 검증 완료, 목표 규모 성능은 9 |
| native 프로세스 | shell:false, 한글·공백 cwd와 메타문자 인수의 문자 그대로 전달 | .cmd shim/WSL/interrupt/프로세스 트리 종료는 단계 6 |

테스트 임시 파일은 `.tmp/환경 점검 *`의 실행별 디렉터리에 생성한다. 정리 전 실제 경로와 이름을 확인하며, 그 디렉터리만 제거한다. node_modules/dist/.tmp/coverage 및 환경 비밀 파일은 Git에서 제외한다.

## Git 및 실행 환경 제약

앱 소스의 기본 브랜치는 master다. 단계 0·1 기준 3847002와 단계 2 결과 6a83094를 로컬에 보존했다. 단계 3 결과 906e996, 추가 기획 2220dc5와 단계 4 결과도 로컬 commit으로 보존하며 remote/push는 없다. 테스트는 .tmp 아래 독립 Git repo/worktree를 만들고 전체 소유 경로를 확인해 정리한다. 단계 2·3·4 실제 CLI smoke 결과는 별도 .tmp 폴더에 보존한다. 앱 소스 branch와 사용자 프로젝트 branch는 별개다.

초기화 이후 자동화 샌드박스에서 `setup refresh had errors`가 발생했다. 읽기·설치·검증 명령은 일반 권한 실행으로 진행했다. 초기 `.git` 소유자는 CodexSandboxOffline, 일반 실행 계정은 Jun이므로 Git의 dubious ownership 검사가 발생한다. 이번에는 전역 safe.directory를 추가하지 않고 각 자동화 명령에 이 저장소만 지정했다.

```powershell
git -c safe.directory=D:/git/CRAFT status --short --branch
git -c safe.directory=D:/git/CRAFT diff --check
```

같은 오류가 재현되는 환경에서만 위 명령을 사용한다. `safe.directory=*` 또는 사용자 전역 설정 변경은 필요하지 않다. 샌드박스 오류 자체를 제품 오류로 간주하지 않는다. 다음 세션의 자동화 권한 경로는 환경에 따라 재확인이 필요하다.

## 공식 근거

- [Node 릴리스 지원표](https://github.com/nodejs/Release): Node 24는 확인일 기준 Maintenance LTS로 지원 중이다. 설치된 정확 패치로 실험했으며 최신 패치라고 주장하지 않는다.
- [TypeScript strict](https://www.typescriptlang.org/tsconfig/strict), [module 설정](https://www.typescriptlang.org/tsconfig/): strict ESM 기준.
- [Vitest 시작 문서](https://vitest.dev/guide/): Node 테스트 도구.
- [Ajv JSON Schema 버전](https://ajv.js.org/json-schema): Draft 2020-12 전용 Ajv2020 클래스 사용.
- [yaml 공식 문서](https://eemeli.org/yaml/): parseDocument/AST·오류 위치 기반. 라이브러리의 기본 파싱만으로 제품의 안전 정책을 충족하지 않는다.
- [better-sqlite3 공식 저장소](https://github.com/WiseLibs/better-sqlite3): native 드라이버. 이 Windows 설치에서 모듈 로드·FTS5를 직접 검증했다.
- [Node 파일 API](https://nodejs.org/docs/latest-v24.x/api/fs.html): writer 기반. 제품의 잠금·트랜잭션 보장은 별도로 구현한다.
- [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript): 타입 생성. 도구의 외부 선언과 exactOptionalPropertyTypes 충돌은 JS 개발 스크립트로 격리했으며 제품 skipLibCheck=false는 유지했다.
