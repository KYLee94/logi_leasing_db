# 2026-05-12 Implementation Status

## Scope

- Target repo: `KYLee94/logi_leasing_db`
- Frontend target: `docs/` GitHub Pages static site
- Database target: Supabase `public.ll_*` only
- Non-`ll_*` tables: no mutation
- Reference repos/pages: IOTA and IFPDP are UI/UX references only, not implementation targets

## Source Preservation

| Source | Result |
|---|---:|
| xlsx sheets | 5 |
| xlsx rows | 388 |
| xlsx columns | 169 |
| xlsx cells preserved in `ll_source_cells` | 13,752 |
| non-empty xlsx cells | 8,627 |
| xlsx SHA256 | `AE31E860C409B50D6246E5B9CECE16BEE18DEB57A95BB00787EB6C91A889BCD2` |

The source xlsx is intentionally not committed. Only the manifest hash is tracked in `docs/source-file-manifest-20260512.md`.

## Supabase Readback

| Table | Rows |
|---|---:|
| `ll_asset_managers` | 17 |
| `ll_assets` | 17 |
| `ll_data_quality_findings` | 44+ |
| `ll_import_runs` | 2 |
| `ll_issues` | 42 |
| `ll_lease_spaces` | 59 |
| `ll_leases` | 45 |
| `ll_payload_snapshots` | 107 |
| `ll_rent_history` | 163 |
| `ll_sheet_rows` | 347 |
| `ll_source_cells` | 13,752 |
| `ll_tenants` | 36 |

`ll_payload_snapshots` read policy is restricted to `user_safe = true`; anon/authenticated write grants were removed from that table.

## Rent History Backfill

| Field | Before | After |
|---|---:|---:|
| `ll_rent_history.lease_id` null | 90 | 6 |
| `ll_rent_history.lease_space_id` null | 90 | 6 |
| `ll_rent_history.exclusive_area_sqm` null | 51 | 1 |
| `ll_rent_history.match_status` null | 163 | 0 |
| orphan `lease_id` / `lease_space_id` | 0 | 0 |

Only single-candidate matches were written. Remaining unmatched rows are left for review because they contain source errors such as `#VALUE!` or `#N/A`, or require manual judgment.

## Frontend Preservation Matrix

| Tab | Restored Interaction Surface |
|---|---|
| Weekly | project detail, maturity/issue review, raw metadata, edit-request drawer |
| Home | map detail, rent trend detail, expiry/vacancy detail, tenant sort controls |
| Asset | stacking/detail drawer, E.NOC detail, expiry detail |
| Company | exposure mode controls, map detail, contract detail, DART/financial request drawer |
| Sector | asset ranking, tenant expiry, maturity bucket detail |
| Analysis Tools | asset/company selectors, apply/default buttons, asset/company detail buttons |
| Data Playground | dimension/column/filter controls, apply drawer |
| Data Quality | refresh check, critical issue, edit queue, quality row detail |

## QA Evidence

| QA | Result | Artifact |
|---|---|---|
| Data contract | pass 22 / review 2 | `qa-artifacts/data-contract/2026-05-12T00-47-18-840Z` |
| UX storyline | pass 22 / review 0 | `qa-artifacts/ux-storyline/2026-05-12T00-56-00-850Z` |
| Local interactions | pass | `qa-artifacts/local-static-interactions/2026-05-12T00-50-47-538Z` |
| Local deep interactions | pass, failure 0 | `qa-artifacts/github-pages-deep-interactions/2026-05-12T00-59-22-924Z` |
| Local perf | pass, blocker 0 | `qa-artifacts/perf/2026-05-12T00-57-40-local-docs` |
| Local exhaustive scroll | pass, failure 0 | `qa-artifacts/exhaustive-scroll/2026-05-12T01-18-local-user-dark` |

Local browser access to Supabase REST was blocked by the sandbox browser network policy, so Supabase source was verified through Supabase readback. GitHub Pages live source must be checked after push.

