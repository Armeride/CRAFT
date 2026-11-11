# 단계 4 색인·진단·검색

2026-11-11. [ADR-011](adr/011-worker-index-and-generations.md), [상태 계약](STATE_MODEL_V1.md)을 따른다. packages/indexer의 ProjectIndex가 CLI와 향후 REST/MCP가 함께 호출할 application service다. 파일과 Git이 정본이고 SQLite는 삭제 가능한 파생 캐시다.

## 범위와 조회

ProjectIndex.registered(appData, registrationId), .run(appData, runId, working|basis), .committed(appData, registrationId, commit)로 scope를 바인딩한다. scope는 등록/project ID뿐 아니라 실제 root/common-dir/git-dir/worktree/task/run/view/commit을 포함한다. 같은 project_id의 clone과 두 run의 working, run의 basis는 별도 캐시다. managed run을 일반 등록 경로로 우회하지 못한다.

각 호출은 인스턴스의 opaque scopeToken을 요구한다. snapshotToken은 권한이 아닌 자료 버전이며 expectedSnapshot으로 변경을 거부할 수 있다. 응답은 scope, snapshotToken, sourceFingerprint/currentSourceFingerprint, baselineFingerprint, generationId, freshness와 data를 포함한다. 현재 author 관점만 지원한다. character/reader를 author로 fallback하지 않으며 해당 관점은 단계 8까지 거부한다.

| operation | 현재 결과 |
|---|---|
| exact / selected | exact 고정 revision / baseline이 선택한 revision의 원문·metadata |
| search | 제목·별칭·ID/전문 검색, 제한된 요약/snippet, history/files는 명시 선택 |
| reverse | exact target의 직접·간접 역참조와 경로, 활성 closure 기본/history 선택 |
| analyze | baseline 전체 검증·전파·releaseEligible·갱신 경고 |
| diff | metadata 경로별 변경, reference_id별 변화, 본문 공통 접두/접미 기반 단일 hunk |
| tasks | 파일에 있는 task/checkpoint 등과 working files |
| state / state-input | 상태 raw 계약 / 검증한 가정 입력·근거 digest, 평가 결과 없음 |

baseline/scope를 명시할 수 있다. selected/search/reverse/state/state-input은 continuity/platform/mode를 검증한다. baseline으로 단일 scope를 결정할 수 없고 제한 차원이 여러 후보면 명시 입력을 요구한다. analyze는 baseline 전체를 검사하므로 별도 scope 필터를 받지 않는다. diff는 비교 기반이며 3-way merge나 통합은 제공하지 않는다.

## generation과 실패

메인 서비스가 worktree lease 아래 파일 바이트와 Git 기준을 고정해 비동기로 읽는다. 파싱·도메인 분석·동기 SQLite는 별도 Node worker에서 실행한다. worker는 메모리에 후보를 준비하고 불변성/확장/그래프를 검증한다. 메인이 게시 직전에 원본을 다시 확인한 뒤 SQLite transaction으로 generation 전체를 게시한다. 게시 후에도 원본을 확인한다. [better-sqlite3 transaction 계약](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md)에 맞춰 SQL transaction 내부에 await를 두지 않는다.

DB는 앱 데이터의 caches/<scope SHA-256>/index.sqlite에 둔다. format 1, WAL/FULL이며 별도 native OS lock이 다중 앱 writer를 직렬화한다. query는 read transaction으로 metadata/원문/FTS를 같은 generation에서 읽는다. SQL 게시 실패는 rollback되고 준비 실패는 기존 DB를 바꾸지 않는다. DB와 외부 파일 시스템을 하나의 atomic transaction으로 묶을 수 없으므로 게시 뒤 외부 편집이 있으면 fresh 응답을 거부하고 stale로 표시한다.

source_files에는 정확한 raw bytes/hash를 저장하고 다시 읽을 때 해시·텍스트·parser를 검증한다. revisions/names/edges/selections/diagnostics/state_records/document_records/document_fts는 파생 테이블이다. 변경 파일·revision·FTS 행은 증분 upsert/delete한다. **현재 그래프·baseline·진단은 전체 재분석**한다. 영향 closure만 재계산하는 최적화는 후속 성능 단계다.

앱 writer는 쓰기 완료 시 worktree별 source epoch를 갱신한다. 외부 편집은 조회/status/명시 rebuild의 파일 hash 대조로 감지하고 조회 시 자동 refresh한다. 독립 background watcher는 아직 없으며 단계 5에서 갱신 힌트로 연결한다. 정확성은 watcher 이벤트에 의존하지 않는다. 중요한 query는 원본 전후 검사를 수행한다.

| 상태/오류 | 동작 |
|---|---|
| fresh / rebuilding / stale / invalid_source | 현재 원본과 generation의 관계를 응답에 표시 |
| INDEX_STALE | 자동 rebuild를 끈 최신 조회, 또는 사용할 최신 generation이 없음 |
| SOURCE_CHANGED / BASE_CHANGED | 캡처·게시·조회 중 원본 변경 / expected snapshot 불일치 |
| SOURCE_INVALID | 구조·참조·불변성 등 원본 검증 실패, 이전 정상 generation 보존 |
| INDEX_CORRUPT | 캐시 파일·부속 WAL/SHM만 quarantine하고 파일에서 재구축 |
| INDEX_STORAGE_FULL / INDEX_IO_ERROR | 저장 공간/I/O 실패, 정본은 수정하지 않음 |
| WORKTREE_BUSY | native lock 또는 SQLite busy/locked, 잠금 탈취 없음 |
| CONTEXT_FORBIDDEN / RECOVERY_REQUIRED | 잘못된 scope / pending write journal, stale 요청으로 우회 불가 |

allowStale는 명시적인 탐색에만 사용한다. analyze에는 허용하지 않는다. 잘못된 원본을 정상으로 간주하거나 release 승인에 오래된 색인을 사용하지 않는다. DB를 삭제하면 최초 조회에서 자동 재구축하며 정본 지식·참조·진단·task 결과는 동일하고 새 generation/snapshot token은 달라진다. worker는 close 시 종료한다.

## 참조·진단·검토

도메인 분석은 Node/SQLite에 의존하지 않는 순수 함수다. SCC는 반복형 알고리즘으로 순환을 유한하게 처리한다. blocking/advisory/none 전파를 구분하고 직접 status를 수정하지 않는다. 원인 경로는 node당 최대 32개, 경로 최대 64 edge이며 잘림을 명시한다. 역참조는 depth 최대 64/results 최대 1000이다.

baseline의 적용 depends_on은 선택 revision과 일치해야 한다. cites/evidence/compares의 과거 고정 target은 허용한다. 선택하지 않은 deprecated revision이 현재 요소를 폐기시키지 않는다. blocking cycle은 working 진단을 제공하면서 release를 차단한다. baseline 밖의 과거 exact 의존도 활성 closure와 영향 경로에 포함한다.

update_policy pinned는 알림만 제공하고 track_approved/track_all은 parents DAG의 후속과 형제 분기를 구분한다. 날짜나 높은 번호로 latest를 정하지 않는다. 출발 revision·baseline·기존 target·후보 scope의 공통 영역이 있어야 경고하므로 PvP 후속이 PvE에 전파되지 않는다. 핀은 자동 교체하지 않는다.

releaseEligible에는 직접 approved뿐 아니라 고정 subject의 user review·semantic model/digest·dependency manifest digest·scope 유효성이 필요하다. draft 핀에 승인 후속이 생겨도 blocker는 유지한다. 이것은 **release 준비도 검사**이며 통합 권한이 아니다. 사용자 diff 승인/token, target HEAD 재검증·통합은 단계 5/9에서 추가한다.

진단에는 안정된 code, messageKey, 구조화 params와 위치를 둔다. 기존 message는 fallback이다. Ajv 오류도 validation key/params를 제공한다. 번역된 UI 문자열을 정본/의미 digest로 쓰지 않는다. ko/en catalog와 화면은 단계 5에서 구현한다.

## 검색과 실제 실행

ID/제목/별칭은 검색용 NFC로 정규화하고 원문은 변경하지 않는다. auto 모드의 1~2 code point는 exact 이름/별칭 경로, 3 이상은 literal FTS5 trigram 경로다. 짧은 본문 substring은 명시 text 모드의 bounded fallback이다. SQL은 parameter binding하고 FTS 입력은 literal 인용한다. [SQLite trigram 문서](https://www.sqlite.org/fts5.html#the_trigram_tokenizer)의 짧은 검색어 한계를 보완한 선택이다.

검색은 기본 baseline 선택만 반환한다. history/files를 켜야 과거 revision/working file이 포함된다. hit에는 전체 body/meta를 싣지 않고 최대 200 code point의 snippet과 요약만 반환한다. NFC 검색 위치를 원문 grapheme 위치로 매핑해 NFD/emoji에서도 원문을 보존한다. 정확한 전체 원문은 exact로 읽는다. character/reader 비밀 필터를 아직 제공하지 않는다.

빌드 후 독립 사용자 Git 프로젝트를 등록한다. 꺾쇠 부분은 실제 ID로 바꾼다.

~~~powershell
npm run index -- support
npm run project:validate -- fixtures/state-model
npm run workspace -- open --app-data D:/craft-local --root D:/my-project
npm run index -- rebuild --app-data D:/craft-local --registration <등록-ID>
npm run index -- selected --app-data D:/craft-local --registration <등록-ID> --entity ent_border
npm run index -- search --app-data D:/craft-local --registration <등록-ID> --text "국경"
npm run index -- analyze --app-data D:/craft-local --registration <등록-ID>
npm run index -- state-input --app-data D:/craft-local --registration <등록-ID> --entity ent_gate_scenario --revision rev_gate_scenario --actor player
~~~

registration 대신 --run <run-ID>를 쓰면 같은 task worktree를 조회한다. --view basis는 run의 고정 basis를 읽는다. 일반 등록의 basis는 --view basis --commit <OID>를 함께 지정한다. query는 --baseline, --expected-snapshot, --allow-stale true|false, --auto-rebuild true|false를 받는다. --scope는 continuity/platform/mode 문자열 JSON 파일, state-input --inputs는 override JSON 파일이다. analyze는 release 불가 시 exit 2, 성공 0, 명령/조회 오류 1이다. 상세 flag는 [CLI](../tools/index-cli.ts)를 따른다.

현재 작은 fixture에서의 실측과 시험 수는 [구현 상태](IMPLEMENTATION_STATUS.md)에 기록한다. 1,000요소/10,000리비전의 p95·증분·전체 재구축 목표는 단계 9에서 검증한다.
