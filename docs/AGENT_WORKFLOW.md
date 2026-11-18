# AI 실행·검토·중단

단계 6 구현 범위다. 실제 공급자별 모델 시험은 명시 동의 후 수행하며 최신 결과는 [구현 상태](IMPLEMENTATION_STATUS.md)를 따른다. 저장 모델·승인·원본 보존 원칙은 [ADR-016](adr/016-isolated-agent-runners-and-internal-mcp.md)에 기록했다.

## 화면에서 사용

1. `npm ci`, `npm run ui:preview` 후 요소를 열고 **AI 대화 열기**를 누른다. 요소/리비전/채택 기준이 고정된 별도 작업 공간을 만든다.
2. **실행기**에서 Codex, Claude 또는 **로컬 테스트 실행기**를 선택한다. 버전과 인증은 각각 표시한다. 설치 확인은 모델을 호출하지 않는다. 경로/모델의 접힌 설정에서 전체 native executable 경로를 확인·변경할 수 있다. 로그인은 공급자의 앱/CLI에서 수행한다.
3. 아래 입력에 지시를 적고 **AI 실행**을 누른다. **메모 저장**은 AI 호출 없이 요청만 보관한다. 실제 실행은 지시와 작업 문맥을 해당 서비스에 보내며 구독 사용량 또는 요금이 발생할 수 있다.
4. 실행기의 원문 응답, 도구 활동, 상태, 제공된 토큰 사용량을 볼 수 있다. 질문은 선택/직접 답변으로 전송하고 승인 요청은 이번 요청만 허용하거나 거절한다. 앱 UI의 언어/테마 변경은 입력을 유지한다.
5. MCP로 생성한 결과는 옆의 working 문서와 **미채택 새 초안**에 반영한다. 직접 편집 탭에서 새 리비전/속성·사용자 검토·baseline 채택과 실제 diff 승인 통합을 수행한다. [수동 흐름](MANUAL_WORKFLOW.md)을 따른다. AI의 완료 표시는 사용자 승인이나 정본 반영이 아니다.

로컬 테스트 실행기는 실제 모델 없이 질문→승인→지시를 본문에 덧붙인 새 초안을 만든다. 테스트용 원문 질문/응답은 모델 출력 fixture이며 앱의 ko/en 조작 문구와 구분한다. 전역 공급자 MCP나 프로젝트 훅을 앱이 자동 활성화하지 않는다. 현재는 author 문맥이며 시점·actor·POV 계산은 단계 8에 남아 있다.

## 중단과 재시도

**실행 중단**은 종료 확인 중 상태를 거쳐 결과·조회 근거·상호작용과 checkpoint를 보존한다. 실패·취소·연결 중단 후에는 **보존 지점에서 새 작업 공간 열기**로 새 run을 만든 뒤 지시를 전송한다. 원래 작업 공간은 유지한다. 공급자 세션 자체 재개/교체와 전체 재문맥화는 단계 7이다.

앱 재시작 후 이전 승인을 다시 허용하지 않는다. 실행이 끝났는데 작업 공간 검증이 실패하면 `AGENT_RESULT_INVALID`다. 파일을 수동 삭제하거나 강제 정리하지 말고 안전한 checkpoint에서 새 공간을 열어 차이를 확인한다. 종료 미확인(`AGENT_TERMINATION_UNCONFIRMED`)은 성공/취소로 표시하지 않으며 기존 공간의 통합·정리를 차단한다. OS 프로세스를 별도로 확인해야 한다.

native executable을 직접 실행하며 `.cmd`/`.ps1`은 알려진 npm launcher의 실제 JS 파일만 Node로 실행한다. 임의 shell 문자열은 실행하지 않는다. Windows native만 검증하며 WSL은 지원하지 않는다. worktree가 OS 보안 sandbox라는 뜻은 아니다.

## 실제 공급자 시험

모델 없는 `npm run check`, `npm run test:ui`가 먼저다. 실제 모델 사용을 승인한 뒤 다음을 각각 실행한다.

```powershell
npm run build
node dist/tools/agent-smoke.js --provider codex --confirm-model-use
node dist/tools/agent-smoke.js --provider claude --confirm-model-use
```

선택적으로 `--model 이름`을 붙일 수 있다. 기본은 설치 실행기의 모델이다. 임시 `valid-minimal` 프로젝트만 사용하고 모델별 1개 짧은 draft proposal, MCP context/validation, 원본 불변을 검증한다. 120초 초과는 중단하며 질문/추가 권한은 자동 허용하지 않는다. 결과와 workspace 경로를 출력하고 보존한다. 실제 프로젝트 통합이나 push는 하지 않는다.

내부 API는 browser cookie/CSRF로, `/mcp/agent_UUID`는 해당 active 실행의 메모리 토큰으로 접근한다. 클라이언트가 프로젝트 root나 다른 run을 고를 수 없다. 토큰은 argv/브라우저/Git에 쓰지 않는다. 조회 receipt에는 snapshot/source/baseline·Git commit과 정확한 revision 근거를 보존한다. 세션/응답 원문에는 사용자가 보낸 자료가 포함되므로 작업 결과 파일로 취급한다.
