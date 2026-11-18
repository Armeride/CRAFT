# 공급자 프로토콜 fixture

민감 정보 없는 최소 structured-event 형태만 보존한다. 실제 모델 응답을 기록한 성공 증거가 아니라, 설치 CLI 생성 schema와 공식 SDK 타입에서 추린 모델 없는 계약 시험 입력이다.

- Codex: `codex-cli 0.169.0-alpha.11.1`의 App Server initialize/config/thread/turn·양방향 approval/question·delta/usage/completion. `codex-server.mjs`는 UTF-8 분할·잘못된 JSON·interrupt·자식 프로세스를 생성한다.
- Claude: `@anthropic-ai/claude-agent-sdk 0.3.327`, 설치 `Claude Code 2.1.294`에 대응하는 `claude-stream.json`. 관련 필드만 포함한 축약 fixture다. 초기화·부분 text·assistant 중복/비부분 fallback·tool progress·result/usage를 시험하고 host permission callback은 별도로 시험한다.
- 토큰·계정·이메일·조직·실제 원고·개인 경로는 포함하지 않는다. 실제 공급자 opt-in smoke 결과는 구현 상태 문서에서 따로 구분한다.
