# 단계 2 — 격리된 형식 마이그레이션

기준은 PROJECT_SPEC.md v1.1 14절·18절이다. 제품 core v1은 유지했다. **fixture 전용 core v1→v2**로 엔진을 검증하며, 제품 v2를 출시하거나 프로젝트 열기만으로 원본을 변환하지 않는다.

## 지원표와 코드

| registry | 읽기·후보 검증 | 등록 변환 | 제한 |
|---|---|---|---|
| craft-production | 제품 core 1·지원 확장 | 없음, 동일 버전 no-op | core 2 거부 |
| craft-migration-fixture | 시험 core 1/2 | fixture-core-1-to-2 | 명시 opt-in |
| fixture.person | 선언적 시험 확장 1/2 | 위 core 변환에 의존해 1→2 | 분리 값·근거 필요 |

미지원 필수 확장/plugin과 해석 불가능한 영향 요소는 변환을 막는다. 프로젝트 JS나 임의 경로의 migration은 실행하지 않는다. 계획 테스트의 가상 v3는 실제 지원 codec이 아니다.

- [registry.ts](../packages/migrations/src/registry.ts): 버전 지원표·명시 경로·preflight.
- [engine.ts](../packages/migrations/src/engine.ts): 대기/재개·staging·검증·감사 기록·결과 보존.
- [verify.ts](../packages/migrations/src/verify.ts): ID·의미·의존 입력·역사 기록 검사.
- [worktree.ts](../packages/git-workspace/src/worktree.ts): 최소 Git 분리·source guard·결과 정리.
- [audit-v1.schema.json](../packages/migrations/schemas/audit-v1.schema.json): 계획·답변·report·attestation·로컬 journal 계약.
- [generated-audit.ts](../packages/migrations/src/generated-audit.ts): 자동 생성 타입. 기존 core와 함께 schema:check로 drift 검사.

## 실행 절차

1. clean Git commit과 HEAD/index/파일 지문을 고정한다. dirty나 Git 밖의 ignored canonical 데이터는 거부하고 자동 stash하지 않는다.
2. reader/단계 경로를 확인하고 전체 from/to, codec/구현 digest, 예상 파일·질문을 만든다. 후속 단계 preflight는 변환된 입력에서 다시 수행한다.
3. managed root에 journal을 먼저 남기고 고유 workbench/migration/mig_* 브랜치·worktree를 만든다. common dir는 Git으로 확인한다.
4. 답변이 없으면 원본 형식 worktree와 계획을 보존해 waiting_for_decision으로 반환한다. stale digest·잘못된 값·빈 근거를 유효한 답으로 쓰지 않는다.
5. 변환을 메모리에서 수행하고 새 reader로 구조·참조·DAG·baseline·semantic invariants를 검사한다. step의 성공 주장과 별도로 엔진의 필수 검증을 수행한다.
6. 완전한 후보와 감사 파일을 별도 staging에 저장·검증하고 전용 worktree에 반영한다. 전체 바이트 집합과 source guard를 다시 확인한다.
7. 검증된 raw bytes를 결과 브랜치에 commit하고 실제 committed tree를 대조한다. source branch 통합·원격 push는 하지 않는다.

시험 core 변환은 title→heading, status→lifecycle의 동등 enum 이동이다. ID/revision/parents/body/ref/baseline 핀을 유지하며 old/new 필드를 혼합하지 않는다. 제품 v1 loader는 시험 v2를 계속 SCHEMA_UNSUPPORTED로 거부한다.

## 수동 결정과 검토 근거

fixture.person의 author_line을 given_name/family_name/display_order로 나눌 때 이름 순서를 추정하지 않는다. requestDigest로 원본 파일·snapshot을 고정하고 값·근거를 보존한다. 선택한 조합이 기존 문자열을 정확히 재현하지 않으면 MIGRATION_DECISION_CHANGES_MEANING이다. 내용 변경은 새 revision/decision으로 처리한다.

이 시험 확장의 legacy 의미 모델은 표시 문자열을 비교한다. 새 구조 해석은 명시 답변에 근거하며 확장 버전 변경 시 기존 review/context는 보수적으로 revalidation_required다. 수동 답변만으로 기존 승인을 새 해석에 자동 승계하지 않는다.

동일 semantic model·subject·dependency가 입증되면 source hash 변경과 별개로 semantic_continuity_verified mapping을 남긴다. 과거 review 바이트는 재작성하지 않고 invalid review를 복구된 승인으로 표시하지 않는다. 모델 동등성이 미증명이거나 의미가 바뀌면 review_required로 보존하고 성공 commit을 만들지 않는다. 의미 연속성은 사용자 통합 승인이 아니다.

## 저장 경계

성공 branch의 Git 파일:

```text
migrations/
├─ history/<id>.yaml       # base commit, from/to, step digest, 검증
├─ decisions/<id>.json     # basis fingerprint, 답변·근거
└─ attestations/<id>.json  # source/semantic/dependency/review/context mapping
```

자기 자신을 포함하는 commit hash나 자기 바이트 hash를 요구하지 않는다. payloadDiffDigest는 변환 payload의 정확한 변경 목록이며 새 감사 파일은 제외한다. 전체 결과 바이트는 최종 Git tree/commit에 고정된다. 통합용 전체 diff 승인 토큰은 후속 기능이다.

Git에 넣지 않는 managed root:

```text
managed/
├─ runs/<id>/
│  ├─ run.json, plan.json, report.json
│  ├─ decisions/answer_*.json   # 수신별 추가 답변 기록
│  ├─ staging/                 # 완전 후보
│  ├─ invalid-stage-*/          # 구조 검사에 실패한 실제 후보
│  ├─ verification-failed-*/   # 의미 검사에 실패한 실제 후보
│  └─ recovery-*/              # 실패 전 마지막 변환 상태
└─ worktrees/<id>/
```

절대 경로·PID는 로컬 journal에만 있다. task/checkpoint의 base.commit·과거 schema set·이전 입력 manifest는 역사 사실로 유지한다.

## CLI

```powershell
npm ci
npm run check
npm run migration -- support
npm run migration -- support --registry fixture
```

source는 commit이 있는 **독립 CRAFT 프로젝트의 Git root**다. 앱 소스 루트나 이 저장소의 fixture 하위 폴더를 그대로 선택하지 않는다. 시험하려면 v1-input 또는 manual-v1-input을 새 폴더에 복사해 그 폴더에서 명시적으로 Git init/초기 commit을 만든다. managed는 source 밖에 둔다.

```powershell
npm run migration -- plan --registry fixture --root <source> --target-core 2
npm run migration -- run --registry fixture --root <source> --target-core 2 --managed-root <managed>
```

v2-expected/manual-v2-expected는 변환 함수를 호출하지 않고 작성한 고정 예상 결과다. 실제 사용자 프로젝트 업그레이드에 fixture registry를 사용하지 않는다.

waiting의 missingDecisions에서 key/requestDigest를 복사해 JSON으로 답한다.

```json
{
  "<request-key>": {
    "requestDigest": "<계획의 정확한 digest>",
    "value": {"given_name": "준", "family_name": "김", "display_order": "family_given"},
    "rationale": "시험 원자료의 성·이름·표시 순서를 확인했다."
  }
}
```

```powershell
npm run migration -- resume --registry fixture --root <source> --managed-root <managed> --run-id <id> --answers <answers.json>
```

exit code: 완료/no-op 0, 결정 대기 3, 실패/재검토 필요 1. 성공한 result worktree에서 같은 target으로 run하면 추가 worktree/commit/history 없이 no-op이다. 과거 승인 요청을 자동 재사용하지 않는다.

## 실패·정리·한계

- source HEAD/index/working을 보존하고 실패 report·candidate·worktree를 남긴다. 다중 파일 교체를 filesystem 전체 원자 연산이라고 주장하지 않는다.
- resume은 결정 대기 run만 지원한다. failed/review_required/프로세스 crash를 자동 재실행하지 않는다. 보존 자료를 확인하고 clean source에서 새 run을 만든다.
- metadata lock은 exclusive create로 획득하고 timeout으로 빼앗지 않는다. stale lock의 owner/lease 복구는 단계 3 과제다.
- 정리 API는 app 소유 경로·branch·completed journal·결과 commit/history·dirty/untracked/ignored 데이터를 확인한다. 미보존 상태는 거부하고 clean tree를 제거해도 branch를 남긴다. 기본 실행은 자동 정리하지 않는다.
- Windows 네이티브·정규 파일에서 검증했다. symlink/submodule, 모든 attributes 조합, 다른 OS를 지원 완료로 표시하지 않는다. worktree는 OS sandbox가 아니다.
- 일반 편집·다중 writer 잠금/journal, 프로젝트 등록, task/run 수명주기, 복구 UI는 단계 3 이후다. B/T/R의 cross-schema 정규화 통합은 단계 9다.

local Git runner는 shell을 쓰지 않고 hooks/fsmonitor/filter와 상속 Git scope 변수를 차단한다. worktree --no-checkout/read-tree 후 raw blob을 materialize하고 hash-object --no-filters/update-index/commit-tree로 바이트를 보존한다. 근거: [worktree](https://git-scm.com/docs/git-worktree), [read-tree](https://git-scm.com/docs/git-read-tree), [hash-object](https://git-scm.com/docs/git-hash-object), [update-index](https://git-scm.com/docs/git-update-index), [commit-tree](https://git-scm.com/docs/git-commit-tree).

검증 결과: npm run check — schema/type 일치·strict 타입 검사·빌드 및 4파일 101개 테스트 통과. 빌드 CLI의 자동·수동/재개·no-op smoke도 통과했다. AT-14/15/16/18/39/40 범위를 검증했으며 제품 전체 인수 완료는 아니다.
