# ADR-005 — Node/npm·개발 검증 도구 선택

- 상태: 채택, 단계 0 실험 완료
- 날짜: 2026-11-10
- 구분: 기술 판단, 기능 요구 변경 없음

설치된 지원 LTS인 Node.js 24.21.0과 npm 11.19.0을 사용한다. 시스템 전역 설치를 바꾸지 않고 `.node-version`/engines/packageManager/정확 버전 lockfile로 재현한다. Node 26으로 올려야만 한다는 요구는 없으며 최신 패치로 검증했다고 표시하지 않는다. Bun 전용 API는 core에 쓰지 않는다.

TypeScript 7.0.2 strict/NodeNext ESM, Vitest 5.1.0을 채택했다. 현재 물리 workspace 패키지를 만들지 않고 tools에 환경 진단만 둔다. 제품 단계에서 명세 경계를 따라 패키지를 추가한다. React/Vite/Fastify는 명세 기본값을 유지하며 설치·정확 버전 선택은 UI 수직 흐름 착수 시 한다.

JSON Schema에는 Ajv2020 8.20.0을 사용한다. 기본 Ajv export의 draft-07과 혼동하지 않는다. API 보조 타입 라이브러리가 디스크 schema의 정본을 대체하지 않는다. yaml 2.9.1의 AST·위치 정보를 이용해 단계 1에서 금지 문법과 제한을 구현한다. YAML 기본 parse 성공을 안전성 검증으로 보지 않는다.

SQLite는 Windows Node 24에서 설치/로드·WAL·FTS5 trigram·rollback을 통과한 better-sqlite3 13.0.3(SQLite 3.53.4)을 선택했다. 동기 API는 단순하지만 큰 재구축이 서버 이벤트 루프를 막을 수 있어 단계 4에서 worker 경계와 성능을 검증한다. native ABI 재설치·배포 비용을 수용하고 어댑터 뒤에 둔다. Node 내장 SQLite나 Bun 전용 SQLite에 core를 결합하지 않는다.

writer 기반은 node:fs의 동일 디렉터리 임시 파일 + sync + close + rename이다. 한글·공백·emoji와 기존 파일 교체를 확인했다. 원자적인 다중 파일 저장·OS 잠금·전원 장애 내구성은 이 실험으로 보장하지 않는다. CAS/OS owner lease/journal은 단계 1/3에서 구현한다.

검증: `npm run check`의 typecheck/build 및 환경 probe 6개 통과. native Node child argv의 문자 그대로 전달도 확인했다. Windows .cmd shim·프로세스 트리 종료·실제 provider 프로토콜은 이후 단계 과제다. 이 선택은 미검증 제품 기능을 지원한다고 선언하지 않는다.

공식 근거와 설치 버전표는 [DEVELOPMENT.md](../DEVELOPMENT.md)에 기록했다. 버전 갱신은 lockfile과 pin·probe·이 ADR을 함께 바꾼다.
