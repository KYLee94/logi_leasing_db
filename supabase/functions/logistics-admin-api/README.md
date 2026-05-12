# logistics-admin-api

Supabase Edge Function for server-only logistics leasing admin integrations.

This function keeps secret keys out of GitHub Pages. Public frontend code must not contain OpenDART, building-register, or Supabase service-role keys.

## Routes

| Route | Purpose | Secret used |
|---|---|---|
| `GET /health` | Confirms function and secret presence without exposing values | none returned |
| `POST /opendart/company` | Calls OpenDART financial statement API | `OPENDART_API_KEY` |
| `POST /building-register/summary` | Calls a provided HTTPS building-register endpoint | `BUILDING_REGISTER_API_KEY_ENCODED` or `BUILDING_REGISTER_API_KEY` |
| `POST /snapshot-refresh` | Reserved for approved snapshot refresh job | Supabase service role later |
| `POST /cache-clear` | Reserved cache clear endpoint for admin workflow | none |
| `POST /edits/submit` | Reserved ll_* edit submission endpoint | Supabase service role later |
| `POST /edits/approve` | Reserved ll_* edit approval endpoint | Supabase service role later |
| `POST /worklogs` | Reserved work-log endpoint for the work platform | Supabase service role later |

All non-health routes require a Supabase user JWT. Access is allowed when the user email is listed in `LL_ADMIN_EMAILS` or `app_metadata.role` is `admin` / `logistics_admin`.
The function body performs its own authorization for non-health routes, so deployment can use `verify_jwt=false` only for the public health check and CORS preflight path.

## Required secrets

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LL_ADMIN_EMAILS`
- `LL_ALLOWED_ORIGINS`
- `OPENDART_API_KEY`
- `BUILDING_REGISTER_API_KEY_ENCODED` or `BUILDING_REGISTER_API_KEY`

Do not commit `.env` files. They are ignored by `.gitignore`.
