# IGIS Logistics Leasing Dashboard v1

Google Sheets를 운영 DB로 쓰는 Google Apps Script 기반 물류 리싱 대시보드입니다. 현재 데이터가 불완전하다는 전제를 유지하면서도 `missing`, `suspected_error`, `review_required` 상태를 노출하고 화면이 깨지지 않게 설계했습니다.

## 파일 구성

- `appsscript.json`: Apps Script 프로젝트 설정
- `Config.gs`: 스프레드시트 ID, 시트명, 공통 상수
- `Utils.gs`: 파싱/정규화/집계 유틸리티
- `DataRepository.gs`: 시트 읽기, 행 정규화, 히스토리 연결, E.NOC 계산 입력 준비
- `Metrics.gs`: Home / Asset / Company / Sector / Tools / Playground payload 생성
- `SchemaSync.gs`: v1 스키마 설치, helper 컬럼/시스템 시트 생성, `DB_계산` 갱신
- `ApiScaffold.gs`: OpenDART / Building HUB 연동 준비 함수
- `Server.gs`: 웹앱 엔드포인트와 `google.script.run` 서버 함수
- `Index.html`, `Stylesheet.html`, `Client.html`: 웹 UI

## 배포 절차

1. Google Drive에서 새 **Standalone Apps Script** 프로젝트를 만드십시오.
2. 이 폴더의 파일을 프로젝트에 업로드하십시오.
   - `clasp`를 쓰는 경우 프로젝트 루트를 그대로 연결하면 됩니다.
3. Script Properties를 설정하십시오.
   - `SPREADSHEET_ID=1powCa2TV7Pkqi3Un3mz3clJPwJ9xw7lMr1bZ0eLMqVA`
   - `FORMULA_VERSION=E.NOC_v2`
   - `OPENDART_API_KEY`는 실제 연동 시에만 추가
   - `BUILDING_HUB_API_KEY`는 실제 연동 시에만 추가
   - `ENABLE_SERVER_GEOCODING=false`
4. Apps Script 편집기에서 `installV1()`를 1회 실행하십시오.
   - helper 컬럼, `SYS_*`, `LOG_*`, `DB_계산`, `meta_DB_일반` 사전이 세팅됩니다.
5. `refreshCalculationSheet()`를 실행해 계산 테이블을 초기화하십시오.
6. `Deploy > New deployment > Web app`으로 배포하십시오.
   - Execute as: `User accessing the web app` 또는 운영정책에 맞는 계정
   - Access: 조직 내부 사용자 기준으로 제한하십시오.
7. 시트 수동 수정이 잦으면 트리거를 권장합니다.
   - `refreshCalculationSheet`: 매일 1회
   - 향후 API 연동 시 `installV1` 대신 별도 sync 함수 추가 권장

## 운영 메모

- 클라이언트 코드에는 외부 API 키를 넣지 않았습니다.
- OpenDART / Building HUB는 Script Properties 기반으로만 준비했습니다.
- `DB_일반`과 `DB_히스토리 누적`은 원본 값을 자동 정정하지 않고 helper 컬럼으로 상태만 표시합니다.
- `E. NOC`는 출력 단위가 `원/평`이므로, 현재 시트 면적 단위가 `㎡`인 점을 감안해 TI 상각 항목에서만 내부적으로 `평` 환산을 적용했습니다.
  - 이 부분은 v1 운영을 위한 구현 추론이며, 면적 정의 표준화 이후 재검토가 필요합니다.
