# ADR-007 — registry와 별도 worktree의 형식 변환

- 상태: 채택, 단계 2 완료
- 날짜: 2026-11-10
- 기준: 명세 v1.1 14절, REVIEW_NOTES R-10/11/12/17/18

제품 v1을 바꾸지 않고 엔진을 검증하기 위해 production registry(core 1)와 opt-in fixture registry(core 1/2)를 분리했다. 실제 제품 v2는 출시하지 않는다. core와 migration audit 계약에서 타입을 생성하고 drift를 검사한다.

versioned reader가 각 표현을 공통 의미 모델로 해석한다. 명시 경로의 preflight/transform/verify와 독립적인 엔진 필수 검증을 통과해야 형식 변경 결과로 보존한다. 일반 변경 API에 불변성 우회 boolean을 추가하지 않았다.

source commit/index/파일 guard를 고정하고 전용 branch/worktree/staging을 사용한다. dirty·ignored canonical 데이터는 추정 포함하거나 stash하지 않는다. common dir는 Git으로 확인하고 local Git의 shell/hooks/filter 실행을 피한다. source index는 갱신하지 않는다.

단순 checkout/add/commit보다 코드가 늘지만, 프로젝트 코드 실행과 원본 쓰기를 피하면서 실제 결과 바이트를 검증한다. metadata lock은 현재 run 전체를 직렬화하는 보수적 방식이다. 일반 편집과 짧은 repo 잠금/owner lease는 단계 3에서 확장한다.

source hash와 의미 동등성을 구분한다. 같은 모델·subject·dependency가 입증되면 review/context mapping을 남기고 과거 review는 재작성하지 않는다. 확장 해석 변경·invalid review·미증명은 재검토한다. 수동 분리는 source digest에 묶인 값/근거를 받고 원문을 바꾸는 답은 거부한다.

history/decisions/attestation은 Git에, 경로/PID·plan/report·실패 candidate는 managed root에 둔다. 자기 hash 순환을 만들지 않는다. 실패는 자동 재실행/정리하지 않고 completed/clean 결과만 정리하되 branch는 보존한다.

검증: 4파일 101개 테스트 및 빌드 CLI 자동/수동/재개/no-op 통과. B/T/R 통합, 일반 crash 복구, 원격 보존·UI·release 승인 전체는 완료 범위에 포함하지 않는다. 상세는 [MIGRATIONS.md](../MIGRATIONS.md)를 따른다.
