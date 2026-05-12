# 권한 매트릭스

생성일: 2026-05-12 KST

최종 구조는 User/Admin 별도 페이지가 아니라 하나의 GitHub Pages 앱에서 로그인 후 권한별로 메뉴와 버튼을 다르게 보여주는 방식입니다. 현재 `docs/` 구현은 임시 관리자 미리보기이며, 실제 인증은 Supabase Auth 연결 단계에서 확정합니다.

| 권한 | 메뉴 노출 | 읽기 | 쓰기 | 수정 | 삭제 | 관리 기능 | 비고 |
|---|---|---|---|---|---|---|---|
| Reader | Weekly, Home, Asset, Company, Sector, Analysis Tools, Data Playground, Data Quality | 가능 | 불가 | 불가 | 불가 | 불가 | 기본 공개 조회 역할 |
| Editor | Reader 메뉴 + 허용 자산/펀드 수정 화면 | 가능 | 제한 가능 | 제한 가능 | 삭제 요청만 | 불가 | 자산/펀드 scope 필요 |
| Manager | Editor 메뉴 + 팀/섹터 업무 관리 | 가능 | 가능 | 가능 | 삭제 승인 요청 | 일부 가능 | 업무 로그/승인 흐름 담당 |
| Admin | 전체 메뉴 + Admin/Admin Data | 가능 | 가능 | 가능 | soft delete 승인 | snapshot/API/cache/품질 관리 | Edge Function JWT 필요 |
| System Admin | 전체 메뉴 + schema/API 운영 | 가능 | 가능 | 가능 | 가능 | Edge Function/schema/RLS 관리 | 프론트 DOM에 직접 노출하지 않음 |

## UI 노출 원칙

| 기능 | Reader | Editor | Manager | Admin | System Admin |
|---|---|---|---|---|---|
| 탭 조회 | 노출 | 노출 | 노출 | 노출 | 노출 |
| KPI/표/지도/차트 상세 drawer | 노출 | 노출 | 노출 | 노출 | 노출 |
| 원본 행 확인 | 노출 | 노출 | 노출 | 노출 | 노출 |
| 원본 값 수정 | 숨김 | 허용 scope만 노출 | 허용 scope만 노출 | 노출 | 노출 |
| 삭제 | 숨김 | 삭제 요청만 | 승인 요청/soft delete | soft delete | hard delete는 별도 운영툴 |
| OpenDART/건축물대장 sync | 숨김 | 숨김 | 숨김 | 노출 | 노출 |
| snapshot refresh/cache clear | 숨김 | 숨김 | 숨김 | 노출 | 노출 |
| 권한 관리 | 숨김 | 숨김 | 숨김 | 제한 노출 | 노출 |

## 현재 구현 상태

| 항목 | 상태 | 남은 작업 |
|---|---|---|
| 단일 앱 구조 | 반영 중 | `?page=admin`은 gate overlay만 열고 별도 화면 런타임으로 쓰지 않음 |
| 관리자 DOM 숨김 | 부분 반영 | 미인증 상태에서 Admin nav/view 제거 |
| 실제 Supabase Auth | 미구현 | Auth 세션, JWT, role/scope table 연결 필요 |
| Edge Function 권한 검사 | 파일 반영 | 배포 후 JWT/이메일/app_metadata 검증 필요 |
| ll_* write allowlist | 파일 반영 | 실제 edit schema 확정 후 persistence 연결 필요 |
