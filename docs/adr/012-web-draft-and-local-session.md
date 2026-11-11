# ADR-012 — 로컬 UI 초안과 공통 서비스 연결

상태: 초안 01 구현에 채택, 2026-11-11. UI 구조/시각 방향은 사용자 검토 후 수정한다.

## 결정

사용자는 단계 5를 UI 초안 → 사용자 확인 → 추가 요구 반영 방식으로 진행하도록 요청했다. 첫 검토 지점은 실제 자료 탐색과 독립 working 초안 저장까지로 정하고, 이 지점에서 멈춘다. 단계 5 전체 통과나 단계 6 착수로 처리하지 않는다.

React 19.3.1/React DOM 19.3.1, Vite 8.3.8, Fastify 5.12.8/@fastify/static 10.1.10, i18next 27.1.1/react-i18next 18.0.1을 공식 registry에서 확인해 exact pin했다. @types/react·react-dom은 19.3.0이다. Vite의 기본 JSX 변환을 사용하고 추가 compiler plugin은 넣지 않았다. Playwright 1.65.0/axe-core Playwright 4.14.0은 설치된 Chrome을 사용하는 검증 도구다.

브라우저와 API는 한 loopback origin에서 제공한다. Fastify는 Host·Origin/Sec-Fetch-Site와 HttpOnly/SameSite cookie·메모리 CSRF를 검사하고 프로젝트 scope를 서버에서 바인딩한다. cache/schema/working 파일 처리는 기존 application service를 재사용한다. SSE·watcher와 사용자 검토/통합 권한은 후속 단계 5 구현이다.

UI는 외부 CDN·폰트·raw HTML에 의존하지 않는다. i18next catalog는 앱 문구/접근성/오류/동적 counts를 번역하며 데이터 원문은 React text로 삽입한다. 언어 선택은 로컬 선호 → 지원 browser locale → ko fallback 순서다. main/type contract에서 Node hash 코드를 분리해 브라우저에 Node 런타임을 포함하지 않는다.

첫 초안은 정적 Vite build와 Fastify preview로 실행한다. 별도 dev proxy/CORS를 열지 않고 화면 소스 수정 후 ui:build/새로고침으로 확인한다. 실시간 개발 서버 최적화가 필요하면 이 same-origin/Host/session 경계를 유지한다.

## 검증과 제한

catalog·보간 변수/복수형, API 격리/저장 충돌과 headless Chrome E2E/axe를 실행한다. 기본 CUA 브라우저 연결은 환경 오류로 초기화하지 못해, 로컬 Playwright 테스트 브라우저와 screenshot으로 확인했다. 운영용 preview와 UI E2E의 파일/포트를 분리한다. 사용자가 확인할 수 있도록 로컬 preview를 유지하며 종료 시 작업 파일은 보존한다.

## 공식 근거

- [React Quick Start](https://react.dev/learn): 상태·컴포넌트와 이벤트 기반 UI.
- [Vite 안내](https://vite.dev/guide/), [서버 옵션](https://vite.dev/config/server-options.html): build와 로컬 서버 경계.
- [Fastify 서버](https://fastify.dev/docs/latest/Reference/Server/), [static 호환 표](https://github.com/fastify/fastify-static): 설치된 plugin의 fastify 5.x 선언도 확인했다.
- [react-i18next hooks](https://react.i18next.com/latest/using-with-hooks), [i18next plurals](https://www.i18next.com/translation-function/plurals): catalog·언어 전환·count 처리.
- [Playwright 설정](https://playwright.dev/docs/test-configuration), [지원 브라우저 설정](https://playwright.dev/docs/browsers): 별도 서버·설치된 Chrome 검증.
