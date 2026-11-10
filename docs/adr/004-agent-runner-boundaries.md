# ADR-004 — 실행기·작업 scope와 결과 검증

- 상태: 채택, 명세 v1.1 기준
- 날짜: 2026-11-10
- 구분: 두 실행기/작업 worktree/스킬/MCP는 확정 요구, 연결·정책은 설계 기준

공통 adapter/capability/event 계약 뒤에 Codex App Server와 Claude structured CLI를 연결한다. Claude CLI의 대화 제어가 부족하면 공식 SDK를 검증한다. 터미널 화면 파싱을 핵심 연결로 쓰지 않으며 설치·버전·인증·지원 기능을 분리한다. fake로 모델 없이 기반 흐름을 검증한다.

실행마다 고유 branch/worktree/cwd를 사용하며 task/brief/초기 checkpoint를 모델 전에 commit한다. MCP token은 서버 측 repository/project/worktree/task/run scope에 바인딩한다. basis commit과 working generation은 별도 snapshot이다. 검색·문맥·추가 MCP도 같은 조건을 지킨다.

worktree는 작업 격리이며 OS sandbox가 아니다. 일반 POV 필터와 강한 읽기 제한 프로필을 구분한다. spawn은 executable/args/env/cwd를 구조화하고 shell 문자열을 만들지 않는다. 취소 요청과 실제 종료를 구분하며 보존 commit·미추적 파일 확인 전 정리하지 않는다.

공급자 성공 메시지·exit 0 대신 파일 diff/도메인 검사/유효 사용자 review로 반영한다. 스킬·MCP 설정은 run overlay에 생성하고 사용자 전역 설정·인증을 덮어쓰지 않는다. clone 프로젝트 코드를 자동 실행하지 않는다. 외부 결과 불명은 재전송하지 않는다.

검증 계획: 단계 3 Git/fake, 단계 6 실제 두 공급자 opt-in smoke·capability·취소·내부 MCP, 단계 7 재개/외부 fixture. AT-11/20/25/27/28/37/38/44/49. 현재는 CLI --version과 native Node 인수 전달만 확인했다.
