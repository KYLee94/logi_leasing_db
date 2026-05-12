# 컴포넌트 Gap 재분류

생성일: 2026-05-12 KST

자동 추출 gap은 문자열 기반이라 실제 누락과 false positive가 섞입니다. 아래 표를 현재 backlog 기준으로 사용합니다.

## 실제 기능 gap

| 영역 | gap | 판단 | 다음 작업 |
|---|---|---|---|
| 지도 | Home/Asset/Company의 기존 `openPortfolioMapModal_`, `renderPortfolioMapPreview_` 수준 미달 | 현재는 CSS 정적 marker panel과 drawer 중심 | 지도 SDK/서버 키 구조 확정 전까지 preview로 표시하고, marker 클릭 QA는 계속 유지 |
| 차트 | 기존 Chart.js 기반 차트와 축/상호작용이 완전히 같지 않음 | 현재는 CSS bar chart 중심 | Home rent, Sector trend, Company exposure, Playground result부터 chart 복원 후보 |
| Playground | `playground-detail`, `데이터 분석 원본 표` 동작이 약함 | 원본의 분석 조건 적용/원본 표 modal이 필요 | `집계 적용`과 `데이터 분석 원본 표` drawer를 별도 동작으로 추가 |
| Admin 서버 액션 | OpenDART, 건축물대장, snapshot refresh, cache clear 실행 미연결 | Edge Function route는 배포, secret/실행 계약 필요 | Supabase Auth/JWT 및 secret 설정 후 실제 실행 QA |
| Weekly/Data Quality 쓰기 | 주간 업무 수정, 품질 셀 수정 미연결 | 정적 프론트에서는 저장하면 안 됨 | `ll_*` edit schema 확정 후 Edge Function write 연결 |

## false positive 또는 명칭 차이

| 자동 gap | 재분류 사유 |
|---|---|
| Weekly `assetRows`, `assetName`, `mainIssue` | 데이터 key가 action으로 잡힌 항목입니다. 화면에는 주간 요약/자산현황/이슈 상세가 있습니다. |
| Asset `임차인별 월 임관리비` | 현재 섹션, 차트, 상세 테이블이 존재합니다. |
| Company `company`, `area` | action명 추출 노이즈입니다. 회사 노출 기준과 상세 버튼은 존재합니다. |
| Data Quality `true` | boolean 속성이 action처럼 추출된 노이즈입니다. |
| Admin `관리자 실행 오류`, `클라이언트 성능 로그` | 섹션과 상세 버튼은 존재합니다. 운영 실행 연결은 실제 gap으로 별도 분류합니다. |

## 이번 패치에서 반영한 보강

| 항목 | 반영 |
|---|---|
| Company 노출 기준 | 면적/금액/만기 버튼이 drawer만 열지 않고 화면 상태를 바꾸도록 분리 |
| Analysis Tools 적용/기본값 | 선택 자산/기업을 화면 상태에 반영하고 drawer로 현재 조건 표시 |
| Data Playground 집계 적용 | 선택 조건 기준으로 원본 행을 다시 집계해 `데이터 분석 원본 표` drawer 표시 |
| 한글 라벨 | KPI/상세 제목에서 `Expiry Within12Months`, `Monthly Rent Min` 같은 불필요한 영어 노출을 줄임 |
| QA | `scripts/qa/static-parity-smoke.cjs`로 전 탭, 상세 drawer, HTTP 4xx/5xx, 콘솔 오류를 반복 검증 |
