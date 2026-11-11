# 포함 글꼴

앱은 아래 글꼴을 로컬 정적 자산으로 제공한다. 외부 폰트 CDN과 OS 설치를 사용하지 않는다.

| 글꼴 | 정확한 패키지 | 라이선스 |
|---|---|---|
| Noto Sans KR Variable | @fontsource-variable/noto-sans-kr 5.3.1 | [SIL OFL](../apps/web/public/licenses/NotoSansKR-OFL.txt) |
| Inter Variable | @fontsource-variable/inter 5.3.0 | [SIL OFL](../apps/web/public/licenses/Inter-OFL.txt) |

Vite는 public/licenses를 build에도 복사한다. 사용자의 설치 글꼴 목록은 사용자가 요청하고 브라우저가 허용했을 때 UI에서만 읽는다. 이름을 직접 입력한 글꼴이 없으면 권장 글꼴로 fallback한다. [설계/지원 경계](adr/013-workspace-navigation-and-preferences.md)를 따른다.
