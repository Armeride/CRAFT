# CRAFT

소설과 게임 기획에 공통으로 사용하는 로컬 우선 웹 앱의 소스 저장소다. 현재 **단계 0(환경·계획)과 단계 1(파일 계약·검증·DB 없는 조회)**을 완료했다. 단계 2는 시작하지 않았으며 사용자 지시를 기다린다. 웹 UI·migration·색인·에이전트 연동은 아직 없다.

구현 기준은 [PROJECT_SPEC.md v1.1](PROJECT_SPEC.md), 보완 배경은 [REVIEW_NOTES.md](REVIEW_NOTES.md)다. 원본 문서 세 개는 루트에 그대로 보존한다. 현재 진행 규칙은 **한 단계 완료 후 멈추고 대기**다. [START_HERE.md](START_HERE.md)의 일반적인 연속 구현 지시보다 현재 사용자 지시를 우선한다.

## 개발 환경

Windows x64, Node.js **24.21.0**, npm **11.19.0**, Git. Node는 `.node-version`, npm은 `packageManager`, 의존성은 `package-lock.json`에 고정했다. 다른 버전으로 변경할 때는 환경 테스트와 ADR-005를 함께 갱신한다.

```powershell
npm ci
npm run check
node dist/tools/environment.js
```

개별 명령은 `npm run schema:check`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:watch`다. 빌드는 packages와 tools를 dist에 컴파일한다. 앱 실행·개발 서버·E2E 명령은 해당 기능을 추가할 때 제공한다.

## 단계 1 실행

빌드 후 다음 명령으로 fixture를 읽는다. SQLite나 공급자 세션을 사용하지 않으며 원본 파일을 수정하지 않는다.

```powershell
npm run project:validate -- fixtures/valid-minimal
npm run project:validate -- fixtures/narrative
npm run project:validate -- fixtures/game-design
npm run project:baseline -- fixtures/game-design baseline_main ent_stamina
npm run project:get -- fixtures/game-design ent_stamina rev_stamina_b
```

baseline은 rev_stamina_a를 유지하며 exact 조회로 미채택 rev_stamina_b도 읽는다. 검증은 파일·참조 정합성 검사이며 release 승인이나 정본 통합은 수행하지 않는다.

## 개발 문서

- [요구사항 분류와 불변 조건](docs/REQUIREMENTS.md)
- [구현 단계·목표·완료 기준·AT 추적표](docs/IMPLEMENTATION_PLAN.md)
- [환경 설치·검증·제약](docs/DEVELOPMENT.md)
- [실제 완료 범위와 다음 작업](docs/IMPLEMENTATION_STATUS.md)
- [단계 1 파일 형식과 API 계약](docs/FILE_FORMAT_V1.md)
- [기술 결정 ADR](docs/adr/005-development-toolchain.md)

packages/domain, packages/schema, packages/project-fs에 제품 기반 코드를 둔다. tools는 로컬 검증·진단·타입 생성 도구다. fixtures는 시험용 사용자 프로젝트다. 실제 사용자 프로젝트 정본 파일을 앱 저장소 루트에 만들지 않는다.
