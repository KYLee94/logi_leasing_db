# 현재 docs 구현 대비 기준 대시보드 차이표

생성일: 2026-05-12T02:19:44.401Z

현재 `docs/assets/app.js`는 기존 `Client.html`의 컴포넌트를 1:1로 옮긴 것이 아니라, snapshot 기반으로 재구성되어 있습니다. 아래 항목은 우선 복원 backlog입니다.

| 탭 | 누락 점수 | 누락 섹션 | 누락 액션/버튼 | 누락 표/행 클릭 | 누락 차트 | 누락 지도 | 누락 팝업/상세 | 상태 |
|---|---:|---|---|---|---|---|---|---|
| 주간 업무 | 13 | - | `assetRows`<br>`assetName`<br>`mainIssue` | - | - | - | `주간 업무 리포트 수정` | 미복원 |
| Home | 13 | - | `asset-panel`<br>`cost`<br>`area` | - | - | `openPortfolioMapModal_`<br>`renderPortfolioMapPreview_` | - | 미복원 |
| Asset | 11 | - | - | - | - | `openPortfolioMapModal_`<br>`renderPortfolioMapPreview_` | `임차인별 월 임관리비` | 미복원 |
| Company | 9 | - | `company`<br>`area` | - | - | `renderPortfolioMapPreview_`<br>`openPortfolioMapModal_` | - | 미복원 |
| Sector | 4 | - | - | - | - | - | - | 미복원 |
| Analysis Tools | 16 | `비교 벤치마크` | `assets`<br>`companies` | - | - | - | - | 미복원 |
| Data Playground | 9 | `Metric Library` | - | - | - | - | - | 미복원 |
| Data Quality | 11 | - | `true` | - | - | - | - | 미복원 |
| Admin | 3 | - | - | - | - | - | `관리자 실행 오류`<br>`클라이언트 성능 로그` | 미복원 |

## 즉시 조치 기준

1. 누락 점수가 큰 탭부터 기존 함수의 화면 구조와 상호작용을 `docs/`로 이식합니다.
2. 지도는 현재 정적 marker panel이므로 기존 Naver/OSM/fallback 흐름과 별도 비교 QA가 필요합니다.
3. Admin은 read-only preview가 아니라 로그인/권한 기반 통합 화면으로 재구성합니다.
