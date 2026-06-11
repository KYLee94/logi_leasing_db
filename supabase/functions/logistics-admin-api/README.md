# logistics-admin-api

Supabase Edge Function for server-only logistics leasing admin integrations.

This function keeps secret keys out of GitHub Pages. Public frontend code must not contain OpenDART, building-register, or Supabase service-role keys.

## Routes

| Route | Purpose | Secret used |
|---|---|---|
| `GET /health` | Confirms function and secret presence without exposing values | none returned |
| `POST /opendart/company` | Calls OpenDART financial statement API | `OPENDART_API_KEY` |
| `POST /building-register/summary` | Calls the fixed building-register title endpoint from the server only | `BUILDING_REGISTER_API_KEY_ENCODED` or `BUILDING_REGISTER_API_KEY` |
| `POST /login-history/list` | Reads recent `ll_login_history` rows for the admin screen | `SUPABASE_SERVICE_ROLE_KEY` |
| `POST /login-history/record` | Writes a login/admin event to `ll_audit_events`; `ll_login_history` is the read view | `SUPABASE_SERVICE_ROLE_KEY` |
| `POST /snapshot-refresh` | Reserved for approved snapshot refresh job | Supabase service role later |
| `POST /cache-clear` | Reserved cache clear endpoint for admin workflow | none |
| `POST /edits/submit` | Reserved ll_* edit submission endpoint | Supabase service role later |
| `POST /edits/approve` | Reserved ll_* edit approval endpoint | Supabase service role later |
| `POST /worklogs` | Reserved work-log endpoint for the work platform | Supabase service role later |

All routes are deployed with Supabase Gateway JWT verification enabled. The function body also performs its own authorization for non-health routes. Access is allowed when the user email is listed in `LL_ADMIN_EMAILS` or `app_metadata.role` is `admin` / `logistics_admin`.

## Required secrets

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LL_ADMIN_EMAILS`
- `LL_ALLOWED_ORIGINS`
- `OPENDART_API_KEY`
- `BUILDING_REGISTER_API_KEY_ENCODED` or `BUILDING_REGISTER_API_KEY`

Do not commit `.env` files. They are ignored by `.gitignore`.
