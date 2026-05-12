#!/usr/bin/env python
"""Build public.ll_* dataset JSON from a cell-level source extract."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_INPUT = ROOT / "qa-artifacts" / "source-diff" / "xlsx-extract.json"
DEFAULT_OUT = ROOT / "qa-artifacts" / "supabase" / "ll-dataset-xlsx-source.json"
AREA_SQM_PER_PY = 3.305785


def make_hash(payload: Any) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def id_part(value: Any) -> str:
    value = text(value).lower()
    value = re.sub(r"[^a-z0-9가-힣]+", "_", value).strip("_")
    return value[:80] or make_hash(value)[:12]


def num(value: Any) -> Optional[float]:
    raw = text(value).replace(",", "").replace("%", "")
    if not raw or raw == "-":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def date_value(value: Any) -> Optional[str]:
    raw = text(value)
    if not raw or raw == "-":
        return None
    m = re.match(r"^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$", raw)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return raw[:30]


def source_base(source_table: str, row_number: int, row_payload: Dict[str, Any], pk: str) -> Dict[str, Any]:
    return {
        "source_system": "google_sheets",
        "source_table": source_table,
        "source_pk": pk,
        "source_ref": f"{source_table}!{row_number}",
        "source_row_hash": make_hash(row_payload),
        "source_payload": {
            "source": {"system": "google_sheets", "table": source_table, "pk": pk},
            "raw": row_payload,
        },
    }


def static_key(page: str, entity_id: str = "default") -> str:
    def norm(value: str) -> str:
        value = re.sub(r"[^A-Za-z0-9]+", "_", value.upper()).strip("_")
        return value or "DEFAULT"

    return f"STATIC_{norm(page)}_PAYLOAD_{norm(entity_id)}_JSON"


def rows_for_sheet(extract: Dict[str, Any], sheet_name: str) -> List[Dict[str, Any]]:
    sheet = next((s for s in extract["sheets"] if s["sheet_name"] == sheet_name), None)
    if not sheet:
        return []
    header_row = int(sheet["header_row"])
    data_start = int(sheet["data_start_row"])
    cells = [c for c in extract["cells"] if c["sheet_name"] == sheet_name]
    by_row: Dict[int, Dict[int, Dict[str, Any]]] = {}
    for cell in cells:
        by_row.setdefault(int(cell["row_number"]), {})[int(cell["column_index"])] = cell
    headers = {
        col: text(cell.get("display_value")) or f"col_{col}"
        for col, cell in by_row.get(header_row, {}).items()
    }
    rows = []
    for row_number in sorted(by_row):
        if row_number < data_start:
            continue
        raw_by_col = by_row[row_number]
        if not any(not raw_by_col[col].get("is_blank") for col in raw_by_col):
            continue
        obj: Dict[str, Any] = {"_rowNumber": row_number}
        seen: Dict[str, int] = {}
        for col, header in headers.items():
            key = header
            seen[key] = seen.get(key, 0) + 1
            if seen[key] > 1:
                key = f"{key}__{seen[key]}"
            obj[key] = text(raw_by_col.get(col, {}).get("display_value"))
        rows.append(obj)
    return rows


def pick(row: Dict[str, Any], names: List[str]) -> str:
    for name in names:
        value = text(row.get(name))
        if value:
            return value
    return ""


def build_dataset(extract: Dict[str, Any]) -> Dict[str, Any]:
    now = datetime.utcnow().replace(microsecond=0).isoformat() + "Z"
    run_id = "ll_xlsx_source_" + re.sub(r"[^0-9]", "", now)[:14]
    tables: Dict[str, List[Dict[str, Any]]] = {name: [] for name in [
        "ll_source_imports", "ll_source_sheets", "ll_source_columns", "ll_source_rows", "ll_source_cells", "ll_source_diffs",
        "ll_etl_runs", "ll_funds", "ll_assets", "ll_tenants", "ll_leases", "ll_lease_spaces", "ll_area_breakdowns",
        "ll_rent_history", "ll_asset_managers", "ll_field_dictionary", "ll_issues", "ll_quality_checks",
        "ll_normalization_links", "ll_payload_snapshots",
    ]}

    summary = extract["summary"]
    tables["ll_source_imports"].append({
        "import_id": run_id,
        "source_system": "google_sheets",
        "source_kind": extract.get("source_kind", "xlsx"),
        "source_name": extract.get("source_name", ""),
        "started_at": extract.get("extracted_at") or now,
        "finished_at": now,
        "status": "prepared",
        "row_counts": summary,
        "diff_summary": {},
        "metadata": {"source_path": extract.get("source_path", ""), "note": "xlsx logistics source extract"},
    })
    for sheet in extract["sheets"]:
        row = dict(sheet)
        row.update({
            "import_id": run_id,
            "source_system": "google_sheets",
            "header_hash": sheet.get("source_hash", ""),
            "data_hash": sheet.get("source_hash", ""),
            "source_payload": {"source_kind": extract.get("source_kind", "xlsx")},
            "last_etl_run_id": run_id,
        })
        tables["ll_source_sheets"].append(row)
    for col in extract["columns"]:
        sheet = next((s for s in extract["sheets"] if s["sheet_id"] == col["sheet_id"]), {})
        tables["ll_source_columns"].append({
            "column_uid": col["column_id"],
            "column_id": col["column_id"],
            "sheet_id": col["sheet_id"],
            "source_system": "google_sheets",
            "sheet_name": sheet.get("sheet_name", ""),
            "column_index": col["column_index"],
            "column_letter": col["column_letter"],
            "header_name": col.get("header_value", ""),
            "header_value": col.get("header_value", ""),
            "normalized_header": col.get("normalized_header", ""),
            "column_role": col.get("column_role", ""),
            "value_type_guess": "text",
            "is_blank_header": not bool(col.get("header_value")),
            "sample_values": [],
            "source_ref": f"{sheet.get('sheet_name', '')}!{col['column_letter']}1",
            "source_payload": {},
            "last_etl_run_id": run_id,
        })
    for row in extract["rows"]:
        sheet = next((s for s in extract["sheets"] if s["sheet_id"] == row["sheet_id"]), {})
        row_number = int(row["row_number"])
        tables["ll_source_rows"].append({
            "row_uid": row["row_id"],
            "row_id": row["row_id"],
            "sheet_id": row["sheet_id"],
            "source_system": "google_sheets",
            "sheet_name": sheet.get("sheet_name", ""),
            "row_index": row_number,
            "row_number": row_number,
            "source_ref": f"{sheet.get('sheet_name', '')}!{row_number}:{row_number}",
            "source_row_hash": row["row_hash"],
            "row_hash": row["row_hash"],
            "non_empty_cell_count": row["non_empty_cell_count"],
            "row_values": [],
            "raw_row_payload": {},
            "source_payload": {},
            "last_etl_run_id": run_id,
        })
    tables["ll_source_cells"] = [
        {
            "cell_id": c["cell_id"],
            "row_id": c["row_id"],
            "column_id": c["column_id"],
            "sheet_name": c["sheet_name"],
            "row_number": c["row_number"],
            "column_index": c["column_index"],
            "column_letter": c["column_letter"],
            "a1_ref": c["a1_ref"],
            "display_value": c["display_value"],
            "raw_value": c["raw_value"],
            "formula": c["formula"],
            "is_blank": c["is_blank"],
            "number_format": c["number_format"],
            "note": c["note"],
            "value_type": c["value_type"],
            "source_hash": c["source_hash"],
            "source_payload": {},
        }
        for c in extract["cells"]
    ]

    funds: Dict[str, Dict[str, Any]] = {}
    assets: Dict[str, Dict[str, Any]] = {}
    tenants: Dict[str, Dict[str, Any]] = {}
    leases: Dict[str, Dict[str, Any]] = {}
    lease_spaces: List[Dict[str, Any]] = []
    lease_space_index: Dict[str, Dict[str, str]] = {}

    for row in rows_for_sheet(extract, "DB_일반"):
        rn = int(row["_rowNumber"])
        fund_code = pick(row, ["펀드코드"])
        fund_name = pick(row, ["펀드명"])
        if fund_code or fund_name:
            fund_id = "fund_" + id_part(fund_code or fund_name)
            funds.setdefault(fund_id, {
                "fund_id": fund_id, "fund_code": fund_code or None, "fund_name": fund_name or None,
                "raw_fund_name": fund_name or None, "sector": pick(row, ["섹터"]) or None,
                "is_active": True, "review_status": "ok", "last_etl_run_id": run_id,
                **source_base("DB_일반", rn, row, str(rn)),
            })
        asset_name = pick(row, ["자산명"])
        if not asset_name:
            continue
        asset_code = pick(row, ["자산코드"])
        asset_id = "asset_" + id_part(asset_code or asset_name)
        tenant_name = pick(row, ["임차인명"])
        tenant_brn = re.sub(r"[^0-9]", "", pick(row, ["임차인 사업자번호"]))
        tenant_id = ("tenant_brn_" + tenant_brn) if tenant_brn else ("tenant_name_" + id_part(tenant_name))
        assets.setdefault(asset_id, {
            "asset_id": asset_id, "asset_code": asset_code or None, "asset_name": asset_name, "raw_asset_name": asset_name,
            "fund_id": ("fund_" + id_part(fund_code or fund_name)) if (fund_code or fund_name) else None,
            "sector": pick(row, ["섹터"]) or "물류센터", "gross_floor_area_sqm": num(pick(row, ["전체 연면적"])),
            "is_active": True, "review_status": "ok", "last_etl_run_id": run_id,
            **source_base("DB_일반", rn, row, str(rn)),
        })
        if tenant_name:
            tenants.setdefault(tenant_id, {
                "tenant_id": tenant_id, "tenant_master_name": tenant_name, "raw_tenant_name": tenant_name,
                "business_registration_no": pick(row, ["임차인 사업자번호"]) or None,
                "match_status": "from_xlsx_source", "is_active": True, "review_status": "ok", "last_etl_run_id": run_id,
                **source_base("DB_일반", rn, row, str(rn)),
            })
        lease_id = f"{asset_id}|{tenant_id}|{date_value(pick(row, ['현재 계약개시일'])) or ''}|{date_value(pick(row, ['현재 계약만기일'])) or ''}"
        leases.setdefault(lease_id, {
            "lease_id": lease_id, "asset_id": asset_id, "tenant_id": tenant_id,
            "lease_status": pick(row, ["계약 상태"]) or None,
            "start_date": date_value(pick(row, ["현재 계약개시일"])),
            "end_date": date_value(pick(row, ["현재 계약만기일"])),
            "contract_years": num(pick(row, ["현재 계약기간"])),
            "rf_months": num(pick(row, ["RF"])), "fo_months": num(pick(row, ["FO"])), "ti_amount": num(pick(row, ["TI"])),
            "deposit_amount": num(pick(row, ["임대보증금"])), "renewal_option": pick(row, ["갱신 옵션"]) or None,
            "early_termination_right": pick(row, ["중도해지권"]) or None,
            "special_terms": " | ".join([v for v in [pick(row, ["보험 관련 특수 계약 조건"]), pick(row, ["기타 각종 특수 계약 조건"])] if v]) or None,
            "is_active": pick(row, ["계약 상태"]) != "N", "review_status": "ok", "last_etl_run_id": run_id,
            **source_base("DB_일반", rn, row, str(rn)),
        })
        lease_space_id = f"{lease_id}|{pick(row, ['임차 층'])}|{pick(row, ['임차 세부 구역']) or 'na'}|row{rn}"
        space = {
            "lease_space_id": lease_space_id, "lease_id": lease_id, "asset_id": asset_id, "tenant_id": tenant_id,
            "floor_label": pick(row, ["임차 층"]) or None, "detail_area_label": pick(row, ["임차 세부 구역"]) or None,
            "temperature_type": pick(row, ["저온창고 여부"]) or None,
            "leased_area_sqm": num(pick(row, ["임대면적"])), "exclusive_area_sqm": num(pick(row, ["전용면적"])),
            "exclusive_ratio": num(pick(row, ["전용률"])), "is_active": pick(row, ["계약 상태"]) != "N",
            "review_status": "ok", "last_etl_run_id": run_id,
            **source_base("DB_일반", rn, row, str(rn)),
        }
        lease_spaces.append(space)
        lease_space_index[f"{asset_code}|{tenant_name}|{pick(row, ['임차 층'])}|{pick(row, ['임차 세부 구역'])}"] = {
            "lease_space_id": lease_space_id, "lease_id": lease_id, "asset_id": asset_id, "tenant_id": tenant_id
        }

    for space in lease_spaces:
        for area_type, col in [("leased_area", "leased_area_sqm"), ("exclusive_area", "exclusive_area_sqm")]:
            value = space.get(col)
            if value is None:
                continue
            tables["ll_area_breakdowns"].append({
                "area_breakdown_id": f"area_{area_type}_{make_hash(space['lease_space_id'])[:16]}",
                "lease_space_id": space["lease_space_id"], "lease_id": space["lease_id"], "asset_id": space["asset_id"], "tenant_id": space["tenant_id"],
                "area_type": area_type, "area_label": space.get("detail_area_label") or space.get("floor_label") or area_type,
                "area_sqm": value, "area_py": value / AREA_SQM_PER_PY,
                **{k: space[k] for k in ["source_system", "source_table", "source_pk", "source_ref", "source_row_hash", "source_payload"]},
                "last_etl_run_id": run_id,
            })

    for row in rows_for_sheet(extract, "DB_히스토리 누적"):
        rn = int(row["_rowNumber"])
        asset_code = pick(row, ["자산코드"]); tenant_name = pick(row, ["임차인명"])
        linked = lease_space_index.get(f"{asset_code}|{tenant_name}|{pick(row, ['임차 층'])}|{pick(row, ['임차 세부 구역'])}", {})
        history_id = f"hist_{make_hash([rn, row])[:24]}"
        tables["ll_rent_history"].append({
            "history_event_id": history_id,
            "lease_space_id": linked.get("lease_space_id"), "lease_id": linked.get("lease_id"),
            "asset_id": linked.get("asset_id"), "tenant_id": linked.get("tenant_id"),
            "effective_date": date_value(pick(row, ["기준일자"])),
            "leased_area_sqm": num(pick(row, ["임대면적"])), "rent_per_py": num(pick(row, ["평당 월임대료"])),
            "mf_per_py": num(pick(row, ["평당 월관리비"])), "monthly_rent_total": num(pick(row, ["월임대료 총액"])),
            "monthly_mf_total": num(pick(row, ["월관리비 총액"])), "is_latest": False,
            "review_status": "ok", "last_etl_run_id": run_id,
            **source_base("DB_히스토리 누적", rn, row, str(rn)),
        })

    for row in rows_for_sheet(extract, "자산_담당자 연결"):
        rn = int(row["_rowNumber"])
        asset_code = pick(row, ["자산코드"]); asset_name = pick(row, ["자산명"])
        tables["ll_asset_managers"].append({
            "asset_manager_id": "asset_mgr_" + make_hash(row)[:20],
            "asset_id": "asset_" + id_part(asset_code or asset_name), "asset_code": asset_code or None, "asset_name": asset_name or None,
            "fund_id": ("fund_" + id_part(pick(row, ["펀드코드"]))) if pick(row, ["펀드코드"]) else None,
            "fund_code": pick(row, ["펀드코드"]) or None, "fund_name": pick(row, ["펀드명"]) or None,
            "manager_name": pick(row, ["담당자"]) or None, "organization": pick(row, ["소속"]) or None, "email": pick(row, ["이메일 주소"]) or None,
            "last_etl_run_id": run_id,
            **source_base("자산_담당자 연결", rn, row, str(rn)),
        })

    for row in rows_for_sheet(extract, "Meta_데이터 항목 설명"):
        rn = int(row["_rowNumber"]); field_name = pick(row, ["항목"])
        if not field_name:
            continue
        tables["ll_field_dictionary"].append({
            "field_id": "field_" + make_hash([rn, field_name])[:20],
            "field_no": pick(row, ["항목 번호"]) or None, "field_name": field_name,
            "data_type": pick(row, ["Data Type"]) or None, "unit": pick(row, ["단위"]) or None,
            "is_time_series": pick(row, ["시계열 누적"]) or None, "sample_value": pick(row, ["샘플 데이터"]) or None,
            "description": pick(row, ["항목별 설명 및 고려사항 (특이사항 빨간색으로 표기)"]) or None,
            "last_etl_run_id": run_id,
            **source_base("Meta_데이터 항목 설명", rn, row, str(rn)),
        })

    for row in rows_for_sheet(extract, "Log"):
        rn = int(row["_rowNumber"])
        for prefix in ["", "__2"]:
            content = pick(row, [f"내용{prefix}"])
            if not content:
                continue
            tables["ll_issues"].append({
                "issue_id": "issue_" + make_hash([rn, prefix, content])[:20],
                "entity_type": pick(row, [f"시트{prefix}"]) or "source_log",
                "entity_id": None, "asset_id": None, "tenant_id": None,
                "issue_type": "source_log", "severity": "review", "title": content[:120],
                "description": content, "status": "open", "owner": None,
                "last_etl_run_id": run_id,
                **source_base("Log", rn, row, f"{rn}{prefix}"),
            })

    tables["ll_funds"] = list(funds.values())
    tables["ll_assets"] = list(assets.values())
    tables["ll_tenants"] = list(tenants.values())
    tables["ll_leases"] = list(leases.values())
    tables["ll_lease_spaces"] = lease_spaces

    for table_name, pk in [
        ("ll_funds", "fund_id"), ("ll_assets", "asset_id"), ("ll_tenants", "tenant_id"), ("ll_leases", "lease_id"),
        ("ll_lease_spaces", "lease_space_id"), ("ll_area_breakdowns", "area_breakdown_id"), ("ll_rent_history", "history_event_id"),
        ("ll_asset_managers", "asset_manager_id"), ("ll_field_dictionary", "field_id"), ("ll_issues", "issue_id"),
    ]:
        for row in tables[table_name]:
            tables["ll_normalization_links"].append({
                "link_id": "link_" + make_hash([row.get("source_ref"), table_name, row.get(pk)])[:24],
                "source_system": "google_sheets", "source_sheet_name": row.get("source_table"), "source_ref": row.get("source_ref"),
                "source_row_uid": None, "target_table": table_name, "target_pk": str(row.get(pk)), "target_column": None,
                "link_type": "row_to_entity", "confidence": 1, "rule_version": "xlsx_source_v1", "last_etl_run_id": run_id,
            })

    asset_options = [{"assetId": r["asset_id"], "assetName": r["asset_name"], "monthlyCostTotal": 0, "vacancyRate": 0, "uniqueTenantCount": 0, "fetchedAt": now} for r in tables["ll_assets"]]
    company_options = [{"tenantId": r["tenant_id"], "tenantMasterName": r["tenant_master_name"], "assetCount": 0, "monthlyCostTotal": 0, "latestExpiry": "", "exposureAvailable": True} for r in tables["ll_tenants"]]
    home = {"generatedAt": now, "schemaVersion": "github_pages_home_v1", "kpis": [
        {"key": "operating_asset_count", "label": "운영 자산", "value": len(tables["ll_assets"])},
        {"key": "tenant_count", "label": "임차인", "value": len(tables["ll_tenants"])},
        {"key": "lease_count", "label": "계약", "value": len(tables["ll_leases"])},
        {"key": "lease_space_count", "label": "공간", "value": len(tables["ll_lease_spaces"])},
        {"key": "rent_history_count", "label": "이력", "value": len(tables["ll_rent_history"])},
    ], "topTenants": company_options[:12], "rentTrend": [], "occupancy": [], "tenantSummary": []}
    bootstrap = {"appName": "Logistics Leasing Dashboard", "generatedAt": now, "dataVersion": run_id, "assetOptions": asset_options, "companyOptions": company_options, "defaults": {"assetId": asset_options[0]["assetId"] if asset_options else "", "tenantId": company_options[0]["tenantId"] if company_options else ""}, "homeLiteKpis": home["kpis"][:4]}
    pages = {"bootstrap": bootstrap, "home": home, "weekly": {"generatedAt": now, "sections": []}, "sector": {"generatedAt": now, "kpis": home["kpis"], "rankings": {}, "expiryRows": []}, "tools": {"generatedAt": now, "filters": []}, "playground": {"generatedAt": now, "summaryCards": home["kpis"], "rows": []}}
    for page, payload in pages.items():
        entity = "shell" if page == "bootstrap" else "default"
        tables["ll_payload_snapshots"].append({"snapshot_key": static_key(page, entity), "page": page, "entity_id": entity, "payload": payload, "user_safe": True, "generated_at": now, "schema_version": "dashboard_payload_v1", "source": "google_sheets_xlsx_snapshot", "source_system": "google_sheets"})
    for asset in asset_options[:200]:
        payload = {"generatedAt": now, "meta": {"selection": asset}, "overview": asset, "kpis": [], "rows": []}
        tables["ll_payload_snapshots"].append({"snapshot_key": static_key("asset", asset["assetId"]), "page": "asset", "entity_id": asset["assetId"], "payload": payload, "user_safe": True, "generated_at": now, "schema_version": "dashboard_payload_v1", "source": "google_sheets_xlsx_snapshot", "source_system": "google_sheets"})
    for tenant in company_options[:300]:
        payload = {"generatedAt": now, "profile": tenant, "financials": {}, "operations": {"exposure": {"byAsset": []}}}
        tables["ll_payload_snapshots"].append({"snapshot_key": static_key("company", tenant["tenantId"]), "page": "company", "entity_id": tenant["tenantId"], "payload": payload, "user_safe": True, "generated_at": now, "schema_version": "dashboard_payload_v1", "source": "google_sheets_xlsx_snapshot", "source_system": "google_sheets"})

    tables["ll_etl_runs"].append({"run_id": run_id, "source_system": "google_sheets", "run_type": "xlsx_source_to_supabase", "status": "prepared", "started_at": now, "finished_at": now, "row_counts": {k: len(v) for k, v in tables.items()}, "metadata": {"source_name": extract.get("source_name")}})
    return {"generatedAt": now, "syncRunId": run_id, "tables": tables}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(DEFAULT_INPUT))
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()
    extract = json.loads(Path(args.input).read_text(encoding="utf-8"))
    dataset = build_dataset(extract)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"out": str(out), "counts": {k: len(v) for k, v in dataset["tables"].items()}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
