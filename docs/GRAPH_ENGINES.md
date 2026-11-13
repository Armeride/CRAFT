# 관계 그래프 엔진 검토

검토일: 2026-11-13. 외부 오픈소스는 **문서 검토만** 수행했다. 설치·실행 비교·채택·버전 pin은 하지 않았고 package.json/lockfile은 유지한다. 아래 적합성은 공식 기능을 현재 요구에 대조한 설계 판단이며 실측 결과가 아니다.

## 후보 비교

| 후보 | 공식 기능과 라이선스 | CRAFT 적용 판단 | 도입 전에 확인할 항목 |
|---|---|---|---|
| [Cytoscape.js](https://js.cytoscape.org/) + [fCoSE](https://github.com/iVis-at-Bilkent/cytoscape.js-fcose) | core/fCoSE MIT. pan/zoom, 방향 관계와 그래프 조회, 확장형 layout. fCoSE는 force 기반 compound layout과 고정/상대 위치 제약 지원 | 고정 참조·의존 탐색·다양한 배치의 균형이 좋아 우선 검토 후보. compound group과 자동 community 탐지는 별개이며 군집 입력/계산은 따로 설계 | React mount/unmount, 긴 한글 레이블·HTML 정보 카드, worker/배치 중 UI 응답, 1,000요소 규모, 확장별 라이선스 |
| [Sigma.js](https://www.sigmajs.org/get-started/quickstart/) + [Graphology ForceAtlas2](https://graphology.github.io/standard-library/layout-forceatlas2.html) + [Louvain](https://graphology.github.io/standard-library/communities-louvain.html) | 확인한 upstream은 각 MIT. WebGL 렌더러/카메라와 그래프·배치/군집 계산 분리. ForceAtlas2 worker 지원, Louvain은 community 탐지 | 요청한 연결 중심 네트워크와 자연스러운 군집에 잘 맞을 것으로 판단. 렌더러만으로 군집이 생기지는 않으므로 알고리즘과 표현을 결합해야 함 | GPU/컨텍스트 손실·미지원 fallback, 현재 Sigma major API와 React 통합, 한글 label/노드 크기·병렬/self edge, 별도 keyboard/list, worker 종료 |
| [react-force-graph-2d](https://github.com/vasturiano/react-force-graph) | MIT. React, 2D HTML Canvas, force 배치, zoom/pan·drag·click·zoomToFit | React에서 네트워크 초안을 빠르게 비교하기 좋은 후보. 2D 패키지만 검토하며 3D/VR/AR는 현재 범위 밖 | 긴 한글 canvas text·고해상도/폰트 변경, 접근성 별도 목록, 고밀도 edge/레이블 충돌, 군집 탐지·중심성 규칙 추가 |

ForceAtlas2의 attraction/repulsion은 군집을 시각적으로 모이게 할 수 있지만 community 탐지의 정답이나 모든 고차수 노드의 중심 배치를 보장하지 않는다. Louvain/fCoSE도 프로젝트 분류·인과 관계의 의미를 확정하는 기능이 아니다. 향후 대표 프로젝트로 화면·성능·라이선스/전이 의존성·접근성을 비교한 뒤 정확 버전을 고정한다. GitHub의 star 수나 문서상의 성능만으로 채택하지 않는다.

## 이번 초안에 구현한 범위

설정 → **관계 그래프 → 그래프 엔진**에서 동작하는 두 내장 엔진만 선택한다.

- **관계 중심 배치**(기본): 표시된 그래프에서 방향/중복/self edge를 제외한 고유 이웃 수로 중심을 정한다. 고차수 중심을 고정하고 간선 끌림·노드 반발·겹침 완화로 주변을 펼친다. 단순 무방향 투영의 양의 modularity 병합으로 가까운 이웃을 시각적 군집으로 표시한다. 이것은 Louvain/ForceAtlas2 구현이라고 주장하지 않는다. 최대 48노드의 결정적 유한 반복 휴리스틱이며 모든 노드의 최적 위치/무겹침을 보장하지 않는다.
- **열 배치**: 기존 종류별 열 배치를 유지한다. 동일한 고정 참조·목록·확대/이동을 제공한다.

표시 범위와 필터가 연결 수·군집의 계산 기준이다. 전체 프로젝트 중심성이나 명세상 차단 원인 계산과 혼합하지 않는다. 화살표는 여전히 원래 source → 고정 target revision이며 blocking/advisory/none도 보존한다. 과거 pin과 외부 분류를 표시하고 48노드/120관계 한도를 알린다. 군집은 프로젝트 분류에 기록되지 않는다.

캔버스 형태의 viewport는 SVG 간선·HTML 버튼으로 구현한다. HTML Canvas/WebGL 도입을 뜻하지 않는다. 빈 공간 drag/pointer와 방향키로 이동, 버튼·Ctrl/Cmd+wheel·+/−로 확대/축소, 전체 맞춤/100% 보기를 제공한다. 일반 wheel은 페이지 스크롤을 유지한다. 터치에서는 빈 공간 이동과 확대/축소 버튼을 사용하며 pinch는 이번 범위 밖이다. 키보드로 노드에 도달하면 viewport 안으로 이동시키고 정확한 revision을 연다. 관계 목록은 렌더러와 독립적으로 유지한다.

## 확장 계약

- [graph-model.ts](../apps/web/src/graph-model.ts): 공통 GraphModel. key는 entity/revision 조합, 정확한 Reference·한도·역사/외부 표시. catalog와 분리된 표시 데이터를 만든다.
- [graph-engines.tsx](../apps/web/src/graph-engines.tsx): 안정 ID·도움말 key·View와 GraphEngineProps registry. 선택 옵션과 normalization/fallback은 registry에서 얻는다. 미구현 후보는 등록하지 않는다.
- [graph-layout.ts](../apps/web/src/graph-layout.ts): 두 내장 layout, DOM/API와 독립된 위치/군집/연결 수 계산.
- [GraphCanvas.tsx](../apps/web/src/GraphCanvas.tsx): 내장 공통 viewport/입력/노드 렌더링. 외부 Canvas/WebGL View는 같은 props 계약으로 교체할 수 있다.
- [Graph.tsx](../apps/web/src/Graph.tsx): 필터·공통 설명·한도·텍스트 관계 목록. renderer 선택을 데이터 조회·정본과 분리한다.

외부 adapter는 GraphModel을 library 전용 데이터로 복제해 시뮬레이션의 좌표/링크 객체 치환을 격리해야 한다. 내부 ID를 exact entity/revision으로 되돌리고 source/target·다중 참조·self edge·pin을 보존한다. 테마·언어·폰트·컨테이너 크기 변경, unmount 시 worker/animation/WebGL 자원 해제, 실패/미지원 시 내장 fallback과 사용자 알림, keyboard/list 계약을 검증한 뒤 registry에 등록한다. 기본 선택을 사용자의 동의 없이 외부 엔진으로 바꾸지 않는다.

엔진 선택은 기존 version 1 브라우저 개인 설정에 선택 필드를 추가한다. 옛 설정/알 수 없는·제거된 ID는 기본 내장 엔진으로 복구하며 다른 설정은 보존한다. viewport·자동 군집·위치는 정본/semantic digest가 아니고 이번에는 재접속 위치 저장도 하지 않는다. 런타임 JS URL 설치·사용자 제공 실행 코드 로딩은 제공하지 않는다.

외부 엔진 실제 도입·성능 비교, 깊은 관계 펼치기·노드 고정/수동 배치·위치 저장·export·pinch·전체 화면·대형 그래프 가상화는 별도 후속 범위다. 단계 5 초안 검토에서 멈추며 AI 실행/상태 평가 단계는 시작하지 않는다.
