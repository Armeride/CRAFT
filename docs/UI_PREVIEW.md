# 단계 5 — UI 초안 01

현재는 **사용자 검토를 위한 첫 UI 초안**이다. 단계 5 전체 완료가 아니다. 사용자가 화면을 확인하고 추가 요구를 전달하면 같은 단계에서 수정한다. 이 검토 지점에서 멈추며 단계 6으로 넘어가지 않는다.

## 실행과 확인

~~~powershell
npm ci
npm run ui:preview
~~~

기본 주소는 **http://127.0.0.1:4173**이다. 로컬 서버는 127.0.0.1에서만 수신한다. 종료는 실행 터미널의 Ctrl+C다. 재실행하면 기존 예시와 저장한 작업 파일을 재사용한다. 별도 port/home이 필요하면 다음처럼 실행한다.

~~~powershell
npm run ui:preview -- --port 4174 --home .tmp/my-ui-preview
~~~

처음 실행하면 fixtures/state-model을 .tmp/ui-preview/example-project에 복사하고, UI 확인용 본문과 미채택 국경 검토안을 **복사본에만** 추가해 독립 Git 프로젝트를 만든다. 기존 fixture·앱 소스 baseline·사용자 원본은 바꾸지 않는다. 앱 데이터와 작업 worktree는 .tmp/ui-preview/app-data에 둔다. 이 폴더는 재실행 시 덮어쓰거나 자동 삭제하지 않는다. 로컬 예시이며 원격 백업이 아니다.

## 이번에 검토할 흐름

1. 왼쪽에서 모든 요소/세계와 설정/사건과 변화/조건과 가정을 탐색한다. 가운데 문서와 오른쪽 연결·영향·직접 상태를 비교한다.
2. 국경 지역의 본문, 참조와 영향, 리비전 탭을 연다. rev_border_proposal로 전환하거나 채택본과 비교한다. 현재 baseline의 선택은 유지된다.
3. 상단에서 이름/본문을 검색한다. 예를 들어 “조약에”는 본문까지 검색하고, 1~2글자는 정확한 이름/별칭 경로를 사용한다.
4. 한국어/영어를 전환한다. 프로젝트 이름·원고·ID·태그·조건 입력은 원문을 유지한다. UI 언어는 로컬 선호로 보존한다.
5. 초안 만들기에서 목표를 입력하고 별도 작업 공간을 만든다. 본문을 편집하고 **초안 저장**을 누른다. 새로고침 후 작업 초안 → 이전 작업 초안 열기로 복원한다. 현재는 명시 저장 방식이다.
6. 검토할 항목에서 실제 baseline 진단과 근거를 확인한다. 직접 status를 자동 변경하거나 정본 통합을 수행하지 않는다.
7. 프로젝트 열기에서 project.yaml이 있는 다른 로컬 Git 프로젝트 경로를 입력할 수 있다. 원격 clone UI는 아직 없다.

차분한 녹색·밝은 문서 영역, 왼쪽 탐색/목록·가운데 본문·오른쪽 문맥 구조로 시작했다. 화면 폭이 줄면 보조 문맥을 접고, 작은 화면에서는 탐색 메뉴를 버튼으로 연다. 실제 이미지·외부 폰트·CDN을 사용하지 않는다.

## 구현과 검증 경계

- apps/web: React/Vite, ko/en i18next catalog, 언어·선택/폼 상태, safe text Markdown 표시, 반응형 CSS·키보드 탭/모달·접근성 이름.
- apps/server: Fastify의 같은 origin/session/CSRF 검증, Host 제한·보안 header·표준 오류. 서버가 ProjectIndex/TaskService의 scope를 바인딩하며 브라우저는 경로/token으로 다른 작업 범위를 고르지 못한다.
- 색인의 catalog/exact/search/reverse/analyze/diff를 재사용한다. catalog와 exact는 같은 generation의 원본에서 읽으며 exact의 참조 목록은 모든 지원 확장의 선언 경로를 따른다. UI locale은 정본·semantic digest 입력이 아니다.
- 초안은 TaskService의 초기 task/checkpoint commit과 별도 run/worktree를 사용한다. 저장은 expectedDigest와 기존 검증·lease/journal을 사용하며 외부 수정 충돌 시 입력을 보존하고 덮어쓰지 않는다.
- 브라우저의 최근 run ID는 복원 편의값이다. 실제 초안은 task working 파일에 보존하며 브라우저 저장소를 정본으로 사용하지 않는다. 미저장 상태에서는 페이지 이탈 경고를 제공한다.

검증 명령:

~~~powershell
npm run check
npm run test:ui
~~~

check는 생성 타입·core/web strict typecheck·서버/worker build·Vite build·Vitest 전체를 실행한다. test:ui는 **별도** .tmp/ui-e2e와 4175 포트의 예시 서버에서 설치된 Chrome을 headless로 실행한다. 사용자 브라우저의 기존 profile을 사용하지 않는다. Chrome이 없다면 Playwright의 공식 브라우저 설치/설정을 먼저 준비해야 한다. 전체 지원 브라우저/OS 검증을 완료한 것은 아니다.

이번 검증은 API session/Origin/Host·잘못된 범위, 원본 보존·초안 저장/충돌/복구, catalog key/변수·복수형/locale 선택과 실제 브라우저의 검색/리비전/diff, 목표·미저장 입력의 언어 전환 보존, 저장 후 재로드, 390px/1440px·키보드 탭을 포함한다. ko/en의 표시된 본문/참조/리비전/진단/모달에 axe의 WCAG A/AA 자동 점검을 적용했다. 자동 검사 통과를 전체 수동 접근성·스크린리더 검증 완료로 간주하지 않는다. 구체 수치는 [구현 상태](IMPLEMENTATION_STATUS.md)를 따른다.

## 아직 연결하지 않은 단계 5 기능

실제 사용자 diff 승인·proposal 영속 idempotency·정본 통합, 새 revision/review/baseline 편집, working autosave·여러 작업 탐색, remote clone/import/migration 화면, scope 선택·SSE cursor/reconnect·watcher 힌트는 남아 있다. 상태 조건의 평가·시점/actor 전후 비교는 단계 8이다. 실제 모델/MCP/에이전트 실행은 아직 연결하지 않았다.

UI 피드백을 받은 뒤 탐색 구조·용어·정보 밀도·편집/검토 흐름을 수정하고 나머지 단계 5 요구를 이어간다. 현재 초안을 단계 5 전체 완료로 표시하지 않는다.
