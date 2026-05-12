# QA 체크표

생성일: 2026-05-12 KST

이 체크표는 "비슷하게 보임"이 아니라 기존 정상 Apps Script 대시보드와 기능·클릭·값이 같은지를 확인하기 위한 기준입니다.

## 탭별 체크

| 탭 | 기존 컴포넌트 존재 | 클릭 동작 | drawer/modal | 값/텍스트 동일성 | 현재 QA 증거 | 상태 |
|---|---|---|---|---|---|---|
| Weekly | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/weekly.png` | 진행 중 |
| Home | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/home.png` | 진행 중 |
| Asset | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/asset.png` | 진행 중 |
| Company | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/company.png` | 진행 중 |
| Sector | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/sector.png` | 진행 중 |
| Analysis Tools | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/tools.png` | 진행 중 |
| Data Playground | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/playground.png` | 진행 중 |
| Data Quality | 부분 복원 | smoke 통과 | drawer 동작 | 추가 대조 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/quality.png` | 진행 중 |
| Admin/권한 | 통합 미리보기 | smoke 통과 | drawer 동작 | 실제 Auth 필요 | `qa-artifacts/parity-smoke/2026-05-12T02-20-15-216Z/admin-unified.png` | 진행 중 |

## 공통 게이트

| 게이트 | 기준 | 현재 상태 | 남은 작업 |
|---|---|---|---|
| 콘솔 오류 | 0건 | parity smoke 0건 | live Pages 재검증 필요 |
| HTTP 4xx/5xx | 0건 | 로컬 smoke 0건 / live Pages 0건 | 없음 |
| `[object Object]` | 0건 | smoke 기준 0건 | full scroll scan 필요 |
| `undefined` / `NaN` | 0건 | smoke 기준 0건 | full scroll scan 필요 |
| 가로 overflow | 0건 | 미검증 | Playwright viewport별 검사 필요 |
| 지도 | 기존 위치/목록/상세 동작 | 정적 marker panel | 기존 지도 SDK/fallback 수준 비교 필요 |
| 차트 | 기존 차트와 축/값 일치 | CSS bar chart | Chart.js 동일성 또는 정적 chart 허용 여부 결정 필요 |
| 비밀키 | 프론트 노출 0건 | publishable key만 사용 | secret scan 필요 |
| Supabase source | `supabase_snapshot` 우선 | live Pages source gate 통과 | 없음 |

## 다음 QA 명령

1. `node --check docs/assets/app.js`
2. `node scripts/audit/build-component-parity-audit.cjs`
3. `node scripts/qa/static-parity-smoke.cjs` - 2026-05-12T02-20-15-216Z 통과
4. 공개 `docs/` secret scan
5. `npm run qa:smoke:pages` - 2026-05-12T02-25-17-102Z 통과

## Live QA 증거

| 항목 | 값 |
|---|---|
| URL | `https://kylee94.github.io/logi_leasing_db/?page=user` |
| 산출물 | `qa-artifacts/github-pages-static/2026-05-12T02-25-17-102Z` |
| 탭 캡처 | 36 |
| 스크린샷 | 428 |
| 실패 | 0 |
| 콘솔 오류 | 0 |
| HTTP 문제 | 0 |
| 요청 실패 | 0 |
