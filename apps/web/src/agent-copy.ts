export const agentKo = {
  "agent.controls": "AI 실행",
  "agent.diagnostic": "실행기 오류 원문 · 비밀값 가림",
  "errors.AGENT_TOOL_FAILED": "도구 호출이 실패했습니다.",
  "errors.AGENT_HOST_REQUEST_UNSUPPORTED":
    "이 실행기 요청 형식은 아직 지원하지 않습니다.",
  "agent.provider": "실행기",
  "agent.choose": "실행기를 선택하세요",
  "agent.provider.codex": "Codex",
  "agent.provider.claude": "Claude",
  "agent.provider.fake": "로컬 테스트 실행기",
  "agent.notInstalled": "설치를 찾지 못했습니다",
  "agent.auth.authenticated": "인증됨",
  "agent.auth.unauthenticated": "로그인 필요",
  "agent.auth.unknown": "인증 상태 확인 필요",
  "agent.auth.not_required": "인증 불필요",
  "agent.advanced": "실행기 경로와 모델",
  "agent.path": "설치 실행 파일의 전체 경로",
  "agent.probe": "설치 확인",
  "agent.model": "모델 이름 (비우면 실행기 기본값)",
  "agent.fixtureHint":
    "실제 모델 없이 지시를 본문에 덧붙여 변경안을 만드는 테스트입니다.",
  "agent.contextHint":
    "지시와 이 작업의 자료를 선택한 AI 서비스에 전달합니다. 이용 중인 서비스의 사용량이 발생하며 변경안은 사용자 검토 후 통합합니다.",
  "agent.hint":
    "아래에 지시를 입력하고 AI 실행을 누르세요. 결과는 옆의 작업 문서와 변경안에 반영됩니다.",
  "agent.memoHint": "메모 저장은 AI를 실행하지 않습니다.",
  "agent.ready": "실행기 준비됨",
  "agent.start": "AI 실행",
  "agent.starting": "실행 준비 중…",
  "agent.cancel": "실행 중단",
  "agent.response": "실행기 응답",
  "agent.preserved": "결과와 조회 근거를 체크포인트에 보존했습니다.",
  "agent.usage": "입력 {{input}} · 출력 {{output}} 토큰",
  "agent.events": "도구 실행 내역",
  "agent.event.tool.started": "진행",
  "agent.event.tool.completed": "완료",
  "agent.question": "추가 질문",
  "agent.approval": "실행 승인 요청",
  "agent.freeAnswer": "직접 답변",
  "agent.answer": "답변 보내기",
  "agent.allowOnce": "이번 요청 허용",
  "agent.decline": "거절",
  "agent.retryWorkspace": "보존 지점에서 새 작업 공간 열기",
  "agent.state.starting": "준비 중",
  "agent.state.running": "실행 중",
  "agent.state.waiting_for_input": "입력 대기",
  "agent.state.cancelling": "중단 확인 중",
  "agent.state.completed": "완료 · 사용자 검토 필요",
  "agent.state.failed": "실패 · 결과 보존",
  "agent.state.cancelled": "중단됨",
  "agent.state.interrupted": "연결이 끊긴 실행",
  "errors.AGENT_NOT_INSTALLED":
    "실행기를 찾지 못했습니다. 설치 경로를 확인하세요.",
  "errors.AGENT_UNAVAILABLE": "이 실행기는 현재 사용할 수 없습니다.",
  "errors.AGENT_VERSION_UNSUPPORTED":
    "설치된 실행기의 버전을 지원하지 않습니다.",
  "errors.AGENT_PROBE_FAILED":
    "실행기 설치 확인에 실패했습니다. 경로와 실행 권한을 확인하세요.",
  "errors.AGENT_AUTH_REQUIRED":
    "선택한 실행기의 데스크톱 앱이나 CLI에서 먼저 로그인하세요.",
  "errors.AGENT_CAPABILITY_UNSUPPORTED":
    "설치된 실행기의 프로토콜을 지원하지 않습니다. 실행기를 업데이트하세요.",
  "errors.AGENT_PATH_INVALID": "실행 파일의 전체 경로를 입력하세요.",
  "errors.AGENT_SHIM_UNSUPPORTED":
    "이 시작 스크립트는 지원하지 않습니다. 실제 실행 파일을 지정하세요.",
  "errors.AGENT_PROBE_TIMEOUT": "설치 확인 시간이 초과되었습니다.",
  "errors.AGENT_BUSY": "이 작업에서 실행 중인 AI를 먼저 중단하세요.",
  "errors.AGENT_NEW_RUN_REQUIRED":
    "실패하거나 중단된 실행은 보존 지점에서 새 작업 공간을 열어 다시 시작하세요.",
  "errors.AGENT_INPUT_EXPIRED": "이미 처리했거나 만료된 요청입니다.",
  "errors.AGENT_INPUT_UNAVAILABLE": "지금은 추가 입력을 받을 수 없습니다.",
  "errors.AGENT_SESSION_UNAVAILABLE":
    "실행 연결을 복구할 수 없습니다. 보존 지점에서 새 작업 공간을 여세요.",
  "errors.AGENT_INTERRUPTED":
    "앱이 닫혀 실행이 끊겼습니다. 보존 지점에서 새 작업 공간을 여세요.",
  "errors.AGENT_STATE_INVALID": "실행 기록을 확인할 수 없습니다.",
  "errors.AGENT_CANCELLED": "실행을 중단했습니다.",
  "errors.AGENT_PROVIDER_FAILED":
    "실행기가 실패했습니다. 보존된 결과를 확인하세요.",
  "errors.AGENT_PROTOCOL_INVALID": "실행기의 응답 형식을 확인할 수 없습니다.",
  "errors.AGENT_REQUEST_REJECTED":
    "실행기가 요청을 거절했습니다. 인증과 모델 설정을 확인하세요.",
  "errors.AGENT_PERMISSION_REQUIRED": "실행에 필요한 요청이 거절되었습니다.",
  "errors.AGENT_OUTPUT_LIMIT":
    "한 번에 보존할 수 있는 응답 크기를 초과했습니다.",
  "errors.AGENT_RESULT_INVALID":
    "허용된 변경안 외의 변경을 발견했습니다. 작업 공간은 보존되며 검증 전 통합할 수 없습니다.",
  "errors.AGENT_PRESERVATION_REQUIRED":
    "결과 보존을 완료하지 못했습니다. 기존 작업 공간을 유지한 채 확인이 필요합니다.",
  "errors.AGENT_TERMINATION_UNCONFIRMED":
    "실행기 종료를 확인하지 못했습니다. 실행 상태를 확인하세요.",
} as const;

export const agentEn: Record<keyof typeof agentKo, string> = {
  "agent.controls": "AI execution",
  "agent.diagnostic": "Runner error details · secrets redacted",
  "errors.AGENT_TOOL_FAILED": "The tool call failed.",
  "errors.AGENT_HOST_REQUEST_UNSUPPORTED":
    "This runner request format is not supported yet.",
  "agent.provider": "Runner",
  "agent.choose": "Choose a runner",
  "agent.provider.codex": "Codex",
  "agent.provider.claude": "Claude",
  "agent.provider.fake": "Local test runner",
  "agent.notInstalled": "Installation not found",
  "agent.auth.authenticated": "Authenticated",
  "agent.auth.unauthenticated": "Sign in required",
  "agent.auth.unknown": "Check authentication",
  "agent.auth.not_required": "No authentication needed",
  "agent.advanced": "Runner path and model",
  "agent.path": "Full path to installed executable",
  "agent.probe": "Check installation",
  "agent.model": "Model name (leave empty for runner default)",
  "agent.fixtureHint":
    "A model-free test that appends your instruction to the document and creates a proposal.",
  "agent.contextHint":
    "Your instruction and this task’s context will be sent to the selected AI service and use your service allowance. Changes require your review before integration.",
  "agent.hint":
    "Enter an instruction below and choose Run AI. Results appear in the working document and proposals.",
  "agent.memoHint": "Saving a note does not run AI.",
  "agent.ready": "Runner ready",
  "agent.start": "Run AI",
  "agent.starting": "Preparing execution…",
  "agent.cancel": "Stop execution",
  "agent.response": "Runner response",
  "agent.preserved":
    "Results and context receipts were preserved in a checkpoint.",
  "agent.usage": "{{input}} input · {{output}} output tokens",
  "agent.events": "Tool activity",
  "agent.event.tool.started": "In progress",
  "agent.event.tool.completed": "Completed",
  "agent.question": "Follow-up question",
  "agent.approval": "Execution approval",
  "agent.freeAnswer": "Write an answer",
  "agent.answer": "Send answer",
  "agent.allowOnce": "Allow this request",
  "agent.decline": "Decline",
  "agent.retryWorkspace": "Open a new workspace from checkpoint",
  "agent.state.starting": "Preparing",
  "agent.state.running": "Running",
  "agent.state.waiting_for_input": "Waiting for input",
  "agent.state.cancelling": "Confirming stop",
  "agent.state.completed": "Complete · review required",
  "agent.state.failed": "Failed · output preserved",
  "agent.state.cancelled": "Stopped",
  "agent.state.interrupted": "Disconnected execution",
  "errors.AGENT_NOT_INSTALLED":
    "Runner not found. Check its installation path.",
  "errors.AGENT_UNAVAILABLE": "This runner is currently unavailable.",
  "errors.AGENT_VERSION_UNSUPPORTED":
    "The installed runner version is unsupported.",
  "errors.AGENT_PROBE_FAILED":
    "Runner detection failed. Check its path and execution permissions.",
  "errors.AGENT_AUTH_REQUIRED":
    "Sign in through the selected runner’s desktop app or CLI first.",
  "errors.AGENT_CAPABILITY_UNSUPPORTED":
    "The installed runner protocol is unsupported. Update the runner.",
  "errors.AGENT_PATH_INVALID": "Enter the full path to the executable.",
  "errors.AGENT_SHIM_UNSUPPORTED":
    "This launcher is unsupported. Select the actual executable.",
  "errors.AGENT_PROBE_TIMEOUT": "The installation check timed out.",
  "errors.AGENT_BUSY": "Stop the AI running in this task first.",
  "errors.AGENT_NEW_RUN_REQUIRED":
    "Open a new workspace from checkpoint to retry a failed or stopped execution.",
  "errors.AGENT_INPUT_EXPIRED": "This request was handled or has expired.",
  "errors.AGENT_INPUT_UNAVAILABLE":
    "Additional input is unavailable right now.",
  "errors.AGENT_SESSION_UNAVAILABLE":
    "The execution connection is unavailable. Open a new workspace from checkpoint.",
  "errors.AGENT_INTERRUPTED":
    "Execution disconnected when the app closed. Open a new workspace from checkpoint.",
  "errors.AGENT_STATE_INVALID": "The execution record could not be verified.",
  "errors.AGENT_CANCELLED": "Execution stopped.",
  "errors.AGENT_PROVIDER_FAILED":
    "The runner failed. Check the preserved output.",
  "errors.AGENT_PROTOCOL_INVALID":
    "The runner response format could not be verified.",
  "errors.AGENT_REQUEST_REJECTED":
    "The runner rejected the request. Check authentication and model settings.",
  "errors.AGENT_PERMISSION_REQUIRED":
    "A request required for execution was declined.",
  "errors.AGENT_OUTPUT_LIMIT":
    "The response exceeded the preservation size limit.",
  "errors.AGENT_RESULT_INVALID":
    "Changes outside managed proposals were detected. The workspace is preserved and cannot be integrated before validation.",
  "errors.AGENT_PRESERVATION_REQUIRED":
    "Result preservation could not finish. Keep the existing workspace for inspection.",
  "errors.AGENT_TERMINATION_UNCONFIRMED":
    "Runner termination could not be confirmed. Check its execution status.",
};
