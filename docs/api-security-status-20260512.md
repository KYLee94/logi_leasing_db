# API/보안 상태

생성일: 2026-05-12 KST

## Supabase Edge Function

| 항목 | 값 |
|---|---|
| 프로젝트 | `qvegpozwrcmspdvjokiz` |
| Function | `logistics-admin-api` |
| 배포 상태 | ACTIVE |
| version | 1 |
| function id | `6a10d450-463b-4312-8a27-094c1f47cda6` |
| verify_jwt | false |
| 판단 | health/CORS 공개 확인을 위해 gateway JWT는 끄고, non-health route는 함수 내부에서 Supabase JWT와 관리자 role/email을 검사 |

## Route 상태

| Route | 상태 | 비고 |
|---|---|---|
| `/health` | 응답 확인 | secret 존재 여부만 boolean으로 반환, 값 노출 없음 |
| `/opendart/company` | route 배포 | `OPENDART_API_KEY` secret 필요 |
| `/building-register/summary` | route 배포 | `BUILDING_REGISTER_API_KEY_ENCODED` 또는 `BUILDING_REGISTER_API_KEY` 필요 |
| `/snapshot-refresh` | route 배포 | write contract 확정 전 placeholder |
| `/cache-clear` | route 배포 | 서버 캐시 없음, 프론트 캐시 클리어용으로 연결 예정 |
| `/edits/submit` | route 배포 | `ll_*` table allowlist 검증만 반영, 저장은 edit schema 확정 후 |
| `/edits/approve` | route 배포 | `ll_*` table allowlist 검증만 반영, 저장은 edit schema 확정 후 |
| `/worklogs` | route 배포 | 업무 로그 schema 확정 후 연결 |

## Health readback

```json
{
  "ok": true,
  "service": "logistics-admin-api",
  "secrets": {
    "opendart": false,
    "buildingRegister": false,
    "supabase": true
  }
}
```

판정: Supabase service key는 서버에 존재하지만, OpenDART/건축물대장 secret은 아직 Supabase Edge Function 환경에 설정되어 있지 않습니다. 프론트에는 어떤 비밀키도 넣지 않습니다.

## non-ll_* RLS 경고

Supabase advisor가 public schema의 여러 non-`ll_*` 테이블 RLS 미적용을 경고했습니다. 사용자 지시에 따라 이번 작업에서는 non-`ll_*` 테이블의 RLS/정책/데이터를 변경하지 않고, 보안 리스크로만 기록합니다.
