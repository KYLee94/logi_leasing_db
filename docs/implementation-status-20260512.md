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
| `ll_data_quality_findings` | 47 |
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

## 2026-05-12 KST Continuation

| Area | Result |
|---|---|
| GitHub Pages fallback JSON | Re-exported from `ll_payload_snapshots` 107 user-safe rows into `docs/data` plus `initial.json` |
| Static shell Korean labels | Fixed corrupted Korean labels in `docs/index.html` |
| Local smoke QA | Passed: `qa-artifacts/parity-smoke/2026-05-12T02-42-58-868Z` |
| Live Google Sheets cell extraction | Direct Sheets API blocked by Google API 403; Apps Script Execution API blocked by 403 for current OAuth user |
| Current live Sheets preservation gap | `ll_source_cells` still has xlsx cells only; live Sheets 17-tab cell-by-cell import is pending until an authorized extraction path is available |

The fallback export reads only `public.ll_payload_snapshots` where `source = 'supabase_snapshot'` and `user_safe = true`.
No non-`ll_*` Supabase table was mutated.

Confirmed remaining frontend parity gaps:

- Home/Asset/Company map is still a static marker panel, not the original map SDK/fallback modal.
- Chart surfaces are compact CSS bars, not full Chart.js-equivalent charts.
- Weekly edit, Data Quality edit, and Admin sync/API actions need server write execution through the approved Supabase-only backend path.

## 2026-05-12 KST Parity Rebuild Continuation

| Area | Result |
|---|---|
| Checkpoint | Created and pushed `checkpoint/logi-before-component-parity-20260512-1150-KST` at commit `6f66429` |
| Component audit | Re-ran `node scripts/audit/build-component-parity-audit.cjs`; latest gap score remains `89` because it is a structural backlog, not a completion signal |
| Supabase readback | Confirmed `ll_payload_snapshots` 107 rows, all `source='supabase_snapshot'` and `user_safe=true`; confirmed xlsx `ll_source_cells` 13,752 cells |
| Google Sheets read | Google Drive connector can read row samples from live `DB_일반`; script/API extraction is still blocked for full automated 17-tab cell-level preservation |
| Frontend selector hooks | Added legacy Weekly section hooks, table ids/test ids, and action button test ids without changing data or calculations |
| Local QA | Passed `node scripts/qa/static-parity-smoke.cjs`; artifact `qa-artifacts/parity-smoke/2026-05-12T03-55-59-545Z` |
| QA selector gate | Weekly legacy selectors now checked in `scripts/qa/static-parity-smoke.cjs`; all 7 checks passed locally |
| Live Pages QA | First run had transient shell-ready overrun, second run passed with failure 0; artifact `qa-artifacts/github-pages-static/2026-05-12T03-59-17-781Z` |
| Execution manual | Added `docs/component-parity-execution-manual-20260512.md` as the current 1:1 restoration control document |
| Home surface split | Local QA now verifies map/rent/KPI buttons plus tenant row, vacancy row, map marker surface types; artifact `qa-artifacts/parity-smoke/2026-05-12T04-12-40-667Z` |
| Home data QA | Inserted 3 `ll_data_quality_findings` rows for `docs_home_default` snapshot vs current `ll_*` KPI differences |
| Live Pages QA after Home row checks | Passed with failure 0; artifact `qa-artifacts/github-pages-static/2026-05-12T04-16-10-754Z` |
| Asset/Company/Sector surface split | Local QA now verifies entity row/detail routing: Asset tenant row/map/expiry, Company asset row/map/exposure, Sector asset row/tenant row/expiry; artifact `qa-artifacts/parity-smoke/2026-05-12T04-20-12-570Z` |
| Live Pages QA after entity routing | First run had only shell-ready delay; rerun passed with failure 0, console error 0, HTTP problem 0; artifact `qa-artifacts/github-pages-static/2026-05-12T04-27-34-041Z` |

Newly confirmed remaining blockers:

- Live Google Sheets 17-tab cell-level preservation is still not complete.
- `ll_rent_history` has 6 `unmatched_review_required` rows with null `lease_id`/`lease_space_id`.
- Map, chart, edit, and Admin execution flows remain parity gaps even though the static screen smoke test passes.
