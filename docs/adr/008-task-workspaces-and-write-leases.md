# ADR-008 — 작업별 worktree와 OS lease·journal

- 상태: 채택, 단계 3
- 날짜: 2026-11-10
- 기준: PROJECT_SPEC 10~11·16절, REVIEW_NOTES R-08/09/18/19

프로젝트 정본을 변경하지 않고 두 작업을 병행하기 위해 registration/task/run/worktree ID를 분리하고 run마다 `workbench/task/<task>/<run>` branch와 linked worktree를 만든다. 모델 역할의 fake 실행도 task/brief/초기 checkpoint commit 뒤에만 시작한다. checkpoint·출력은 Git에, 절대 경로·실행 상태·잠금·부분 쓰기 journal은 app-data에 둔다. refs/tree에서 task를 다시 찾고 선택한 commit으로 새 run을 만든다.

원본 index를 사용하는 stash/checkout/add를 하지 않는다. 기본은 target의 committed tree이며 사용자가 고른 working 경로만 별도 snapshot branch에 보존한다. Git의 no-checkout와 raw blob/index plumbing을 재사용해 configured filter/hook를 실행하지 않는다. active target과 결과 통합 공간도 분리한다.

exclusive-create/PID/heartbeat만으로 프로세스 생존을 증명하지 않는다. `fs-native-extensions@1.5.3`의 OS tryLock/unlock을 선택하고 sidecar owner/heartbeat를 진단에 쓴다. stable lock 파일을 unlink하지 않으며 timeout으로 다른 owner를 강탈하지 않는다. 원본과 worktree들이 공유하는 common-dir metadata 잠금과 worktree 쓰기 잠금을 분리한다. 여러 run의 Git metadata 작업은 짧게 직렬화하고 파일 작업은 각 공간에서 진행한다. 잠금 순서는 worktree→metadata이며 기존 worktree 잠금을 metadata 안에서 기다리지 않는다. 단계 2 migration도 공통 metadata lock에 참여한다.

writer는 후보 전체 검증, expected snapshot/hash, 범위/lease 확인, before/after journal, 파일별 atomic rename, applied 기록 순서다. 중단 상태의 project read/write를 막고 recovery는 before/after가 입증될 때만 forward한다. 외부 제3의 편집은 충돌로 보존한다. 기존 Git 기록뿐 아니라 applied journal로 새 미커밋 불변 리비전도 보호한다. OS 잠금·hash 검사로 협력하는 앱의 경합을 다루며 공격적인 직접 파일 편집을 막는 OS sandbox라고 주장하지 않는다.

cancel 요청과 중단 확인을 분리한다. fake의 중단·실패는 초안과 checkpoint를 보존하고, 실행/미보존/dirty/untracked/ignored 상태는 정리하지 않는다. 정리해도 branch는 남긴다. Git commit 직후 운영 journal 손실은 검증된 같은 run의 checkpoint로 재연결한다. 불명 결과를 자동 재실행하지 않는다.

명시적인 import는 전용 branch에서 원문을 유지하고 draft document·선언형 출처 확장만 추가한다. 기존 baseline pin/리비전/review를 바꾸거나 사실 추출을 확정하지 않는다. import failure를 task run으로 오인해 실행하지 않는다.

검증 범위와 CLI는 [WORKSPACES.md](../WORKSPACES.md)를 따른다. SQLite/웹/실제 provider/MCP/검토 통합·원격 push는 이 결정의 구현 범위가 아니다. native 모듈 비용을 받아들이며 다른 OS/ABI·네트워크 볼륨과 전원 장애는 별도 검증한다.

근거: [fs-native-extensions](https://github.com/holepunchto/fs-native-extensions), [Git clone](https://git-scm.com/docs/git-clone), [Git worktree](https://git-scm.com/docs/git-worktree), [Git protocol 설정](https://git-scm.com/docs/git-config#Documentation/git-config.txt-protocolallow). 실제 Windows child process를 강제 종료한 뒤 새 OS lock을 획득하는 테스트를 포함한다.
