# ADR-013 — 탐색·설정·요소별 작업 UI

상태: UI 초안 02에 채택, 2026-11-11. 사용자 피드백에 따라 계속 수정한다.

## 확정 요구와 설계 선택

사용자는 시스템을 따르는 다크 모드, 분류 가능한 설정과 언어/테마/글꼴 이동, 중복 목록 제거, 프로젝트·분류 대시보드/의존 그래프, 왼쪽 크기 조절, 오른쪽 정보 제어와 요소별 대화/직접 편집을 요청했다. 추가 답변은 대화와 실시간 문서가 나란히 보이는 익숙한 작업 화면이며 좌우 순서는 바꿀 수 있어도 좋다는 것이다. 독립적으로 바꿀 장식·고급 기능은 후순위로 둘 수 있다.

앱 로컬 선호를 version 1 preferences와 typed 설정 registry로 분리한다. 기본은 system theme, ko/en별 권장 로컬 글꼴, UI 14px/본문 16px다. 설정의 전체 보기·분류·검색을 제공하고 언어/테마 선택을 설정 안으로 모은다. 선호는 브라우저 로컬에 보존하며 project.language/내용/semantic digest와 무관하다. 폰트/색/레이아웃 변경은 도메인 코드를 수정하지 않는다.

한 왼쪽 탐색에서 분류 제목은 대시보드, 별도 화살표는 펼침/접기를 담당한다. 열린 목록은 flex 높이를 나눠 쓰고 각 목록만 스크롤한다. 왼쪽 경계선은 pointer·keyboard로 조절하며 너비를 보존한다. 오른쪽 정보는 모든 화면에서 버튼으로 제어하고, 좁은 화면에서는 같은 버튼으로 여는 접힌 drawer를 기본으로 한다.

대시보드 graph는 같은 catalog generation의 검증된 Reference를 사용한다. 정확한 revision과 과거 핀을 보존하고 현재 분류 밖의 이웃을 표시한다. 렌더링은 48 nodes/120 edges로 제한하고 잘림을 알린다. force layout/위치 저장/내보내기는 후순위다. 그래프가 baseline을 바꾸거나 latest로 치환하지 않는다.

요소 작업은 기본 왼쪽 대화/오른쪽 문서이며 설정과 버튼으로 반전한다. 직접 편집은 독립 working 초안과 실시간 미리보기, 명시 저장을 제공한다. 실제 provider 실행은 단계 6이다. 현재 대화 창은 실행기 미연결을 표시하고 사용자 요청만 작업 메모로 보관한다. AI 응답·자동 수정·proposal을 꾸며내지 않는다.

## 저장과 복원

task working의 ui-context.json은 version 1과 source의 entity/revision/baseline·meta/body byte digest를 보존한다. ui-requests.json은 version 1과 사용자 요청 id/text/createdAt를 보존한다. local scope token·절대 경로·provider credential을 정본에 넣지 않는다. 기존 ui-draft.md는 유지한다. 이전의 문맥 없는 초안은 source:null로 읽고 임의 요소에 연결하지 않는다. 이들은 working 문서 계약이며 공개 core/schema v1 변경이 아니다.

저장은 기존 TaskService lease/journal·expectedDigest를 따른다. 요청은 최대 100개, 각 12,000자, 직렬화 전체 1MiB로 제한한다. 같은 requestId/같은 내용은 중복 기록하지 않고, 같은 ID의 다른 내용이나 오래된 digest는 거부한다. 이 멱등성은 메모 보관의 범위이며 외부 모델 실행의 정확히 한 번 처리를 보장하는 기능이 아니다.

요소·기준·리비전별 작업 선택을 분리한다. 여러 작업이 일치하고 명시 선택이 없으면 목록에서 선택하도록 한다. 새 작업을 만들기 전 저장된 작업 목록을 다시 읽고, 초기 목록 조회가 늦는 경우에도 복원을 기다린다. 리스트가 잘리거나 일부 작업을 읽지 못하면 새 작업을 추정 생성하지 않는다. 세션 pre-handler가 거부한 401만 로컬 session을 재발급받아 한 번 재시도하며, 네트워크 실패/불명 쓰기는 자동 반복하지 않는다.

## 글꼴과 지원 한계

Noto Sans KR Variable 5.3.1과 Inter Variable 5.3.0을 Fontsource 패키지로 exact pin·self-host한다. OFL은 앱의 public/licenses와 build 결과에 포함한다. OS에 글꼴을 설치하거나 외부 CDN에 접속하지 않는다.

queryLocalFonts는 지원되는 보안 context에서 사용자의 버튼 동작/브라우저 허용 이후에만 호출한다. family 이름만 UI에 사용하며 목록을 서버로 전송하거나 정본에 보관하지 않는다. 미지원/거부에는 직접 이름 입력과 권장 글꼴 fallback을 제공한다. 브라우저/OS별 실제 인식은 보편 지원으로 주장하지 않는다.

## 공식 근거

- [Fontsource variable fonts](https://fontsource.org/docs/getting-started/variable): 번들 import와 unicode-range 사용.
- [Noto CJK](https://github.com/notofonts/noto-cjk), [Inter](https://rsms.me/inter/): 원 글꼴과 라이선스 배경.
- [prefers-color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-color-scheme): 시스템 색상 선호.
- [queryLocalFonts](https://developer.mozilla.org/en-US/docs/Web/API/Window/queryLocalFonts): 제한된 지원·보안 context·사용자 허용/동작.
