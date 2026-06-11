# API/보안 상태

생성: 2026-05-12 KST  
갱신: 2026-06-11 KST

## Supabase Edge Function

| 항목 | 값 |
|---|---|
| 프로젝트 | `qvegpozwrcmspdvjokiz` |
| Function | `logistics-admin-api` |
| 배포 상태 | ACTIVE |
| 최근 확인 version | 18 |
| function id | `6a10d450-463b-4312-8a27-094c1f47cda6` |
| verify_jwt | true |

## Route 상태

| Route | 상태 | 비고 |
|---|---|---|
| `/health` | 인증 필요 | Supabase Gateway JWT 검사를 켠 상태라 인증 없이 401 반환 |
| `/opendart/company` | route 배포 | OpenDART API key는 Edge Function secret에서만 읽음 |
| `/building-register/summary` | route 배포 | 건축물대장 API key는 Edge Function secret에서만 읽음 |
| `/login-history/list` | route 배포 | `ll_login_history` view read, 관리자 JWT 필요 |
| `/login-history/record` | route 배포 | `ll_audit_events`에 `auth_login` 이벤트 저장, 관리자 JWT 필요 |
| `/snapshot-refresh` | placeholder | write contract 확정 후 연결 |
| `/cache-clear` | route 배포 | 서버 mutable cache 없음 |
| `/edits/submit` | placeholder | `ll_*` allowlist 검증만 반영 |
| `/edits/approve` | placeholder | `ll_*` allowlist 검증만 반영 |
| `/worklogs` | placeholder | 업무 로그 schema 확정 후 연결 |

## Secret readback

2026-06-11 배포 전 health readback에서 secret 존재 여부는 값 노출 없이 다음처럼 확인했습니다.

```json
{
  "ok": true,
  "service": "logistics-admin-api",
  "secrets": {
    "opendart": true,
    "buildingRegister": true,
    "supabase": true
  }
}
```

현재 배포는 `verify_jwt=true`라 공개 health 호출도 인증 없이 401로 차단됩니다. 프론트엔드에는 OpenDART, 건축물대장, Supabase service-role secret 값을 넣지 않습니다.

## 공개 번들 스캔

`npm run qa:secret-scan`으로 공개될 수 있는 텍스트 파일을 검사합니다. Supabase `sb_publishable_*`는 public client key라 허용하지만, `sb_secret_*`, service-role key, JWT-like token, Google/OpenAI/GitHub token, private key block은 실패로 처리합니다.
