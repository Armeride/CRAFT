# ADR-011 — worker 색인과 transaction generation

상태: 채택, 2026-11-11.

## 결정

better-sqlite3 13.0.3을 runtime dependency로 사용하고 파싱·도메인 분석·SQLite를 Node worker로 분리한다. [Node worker API](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html)와 설치된 Node 24.21.0에서 실제 worker thread 실행을 확인했다. 메인 서비스는 scope/lease/비동기 원본 캡처와 전후 검사를 담당한다. [구체 API·오류·검색 계약](../INDEXING.md)을 따른다.

명세의 새 임시 DB 준비/교체 목적은 실패 시 이전 정상 generation을 보존하는 것이다. Windows 파일 핸들 교체 대신 **메모리 후보 준비 + 하나의 SQLite 게시 transaction**을 사용한다. prepare 중 기존 DB는 그대로이고 SQL 오류는 rollback된다. WAL read transaction과 native cache writer lock을 함께 사용하며 generation CAS로 경합을 거부한다. 파일과 SQL의 완전한 원자성은 주장하지 않고 게시 뒤 hash가 바뀌면 fresh 응답을 거부한다.

변경 source/revision/FTS 행은 증분 처리하고 그래프/진단은 전체 재분석한다. 초기부터 영향 부분 최적화를 넣는 대신 정확한 재구축 결과를 기준으로 유지한다. source epoch와 요청 시 hash 감사/자동 refresh를 우선 구현하고 watcher는 단계 5의 UI 갱신 힌트로 남긴다. 작은 fixture 실측을 대규모 목표 달성으로 해석하지 않는다.

cache scope에 등록·물리 Git/worktree·basis/working을 포함하고 권한 scope token과 자료 snapshot token을 분리한다. portability가 필요한 상태 입력 digest에는 로컬 scope를 넣지 않고 별도 scopeCacheKey로 격리한다. POV 필터가 없는 단계에서 character/reader 요청은 거부한다. 폐쇄성/검토 유효성 분석은 통합 승인 자체를 대신하지 않는다.

## 대안과 검증

메인 thread의 동기 SQLite는 UI 응답 지연을 키울 수 있어 채택하지 않았다. 파일 watcher만 신뢰하거나 appData를 정본으로 삼는 방식도 배제했다. SQLite transaction/rollback·trigram 제약은 [공식 API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)와 [FTS5 문서](https://www.sqlite.org/fts5.html) 및 설치된 native 모듈 시험으로 확인했다.

DB 삭제/손상, 증분 삭제·추가, 원본 경합·rollback, 두 인스턴스, pending journal, 별도 run과 offline clone, 짧은 한국어·NFD·emoji, review 없는 approved/의존 SCC와 부모 분기를 회귀 시험한다. 대규모 성능, 전원/디스크 장애 확대, UI/MCP 동작은 각 후속 단계의 통과 기준으로 유지한다.
