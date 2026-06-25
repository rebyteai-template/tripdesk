#!/usr/bin/env python3
"""Call documented Simplifly Flight OpenAPI operations.

This script is the generic direct-HTTP executor used by runtime tools for
order, payment, refund, change, account, and optional diagnostic endpoints.
It intentionally reuses the configuration and HTTP policy from flight_search.py
so all TravelKit Pro scripts share one auth/runtime contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import flight_search  # noqa: E402


OPERATIONS: dict[str, dict[str, Any]] = {
    "pricing": {"method": "POST", "path": "/openapi/v3/flight/pricing", "body": True},
    "verify_solution": {
        "method": "POST",
        "path": "/openapi/v3/flight/solutions/{solutionId}/verification",
        "body": True,
        "path_params": ["solutionId"],
    },
    "baggage_transit": {"method": "POST", "path": "/openapi/v3/flight/baggage-transit", "body": True},
    "create_order": {"method": "POST", "path": "/openapi/v3/flight/orders", "body": True},
    "get_order": {"method": "GET", "path": "/openapi/v3/flight/orders/{orderID}", "path_params": ["orderID"]},
    "cancel_order": {"method": "DELETE", "path": "/openapi/v3/flight/orders/{orderID}", "path_params": ["orderID"]},
    "get_order_by_external_id": {
        "method": "GET",
        "path": "/openapi/v3/flight/external/{externalOrderID}",
        "path_params": ["externalOrderID"],
    },
    "pay_order": {
        "method": "POST",
        "path": "/openapi/v3/flight/orders/{orderID}/payment",
        "path_params": ["orderID"],
    },
    "change_search": {
        "method": "POST",
        "path": "/openapi/v3/flight/orders/{orderID}/change/search",
        "body": True,
        "path_params": ["orderID"],
    },
    "create_change_order": {
        "method": "POST",
        "path": "/openapi/v3/flight/orders/{orderID}/change",
        "body": True,
        "path_params": ["orderID"],
    },
    "create_refund_order": {
        "method": "POST",
        "path": "/openapi/v3/flight/orders/{orderID}/refund",
        "body": True,
        "path_params": ["orderID"],
    },
    "confirm_refund_order": {
        "method": "POST",
        "path": "/openapi/v3/flight/orders/{orderID}/confirmation",
        "path_params": ["orderID"],
    },
    "balance": {"method": "GET", "path": "/openapi/v3/flight/balance"},
    "fare_rules": {"method": "POST", "path": "/openapi/v3/flight/fare-rules", "body": True, "optional": True},
    "list_orders": {"method": "GET", "path": "/openapi/v3/flight/orders", "optional": True},
    "ticket_status": {"method": "POST", "path": "/openapi/v3/flight/ticket-status", "body": True, "optional": True},
    "parse_pnr": {"method": "POST", "path": "/openapi/v3/flight/pnr-parse", "body": True, "optional": True},
    "refund_money_search": {
        "method": "POST",
        "path": "/openapi/v3/flight/orders/{orderID}/refund-money-search",
        "body": True,
        "path_params": ["orderID"],
        "optional": True,
    },
    "refund_change_availability": {
        "method": "POST",
        "path": "/openapi/v3/flight/orders/refund-change-availability",
        "body": True,
        "optional": True,
    },
}


class OpenApiError(Exception):
    pass


BIRTHDAY_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
PASSENGER_COUNT_KEYS = ("adult", "child", "infant")
CREATE_ORDER_REQUIRED_TOP_LEVEL = ("orderKey", "passengers", "currency", "passengerCount")
CREATE_ORDER_REQUIRED_CONTACT = ("contactName", "contactRegion", "contactPhone")
CREATE_ORDER_REQUIRED_PASSENGER = (
    "surname",
    "givenNames",
    "gender",
    "birthday",
    "travelDocument",
    "travelDocumentNumber",
    "type",
    "nationality",
    "region",
    "phone",
)
CREATE_ORDER_ALLOWED_GENDERS = {"male", "female"}
CREATE_ORDER_ALLOWED_PASSENGER_TYPES = set(PASSENGER_COUNT_KEYS)
CREATE_ORDER_ALLOWED_TRAVEL_DOCUMENTS = {
    "passport",
    "tphm",
    "tptw",
    "rphmt",
    "idcard",
    "fpidcard",
    "eep",
    "ttpmr",
    "hhr",
}
CREATE_ORDER_LEGACY_TOP_LEVEL_FIELDS = {
    "totalPrice": "Do not send totalPrice in create_order; use verified pricing only for user confirmation.",
    "contact": "Use top-level contactName/contactRegion/contactPhone/contactEmail fields.",
    "externalOrderId": "Use externalOrderID with uppercase ID.",
    "external_order_id": "Use externalOrderID with uppercase ID.",
}
CREATE_ORDER_LEGACY_PASSENGER_FIELDS = {
    "name": "Split the document name into surname and givenNames.",
    "ageType": "Use type with one of adult/child/infant.",
    "passengerType": "Use type with one of adult/child/infant.",
    "credentialType": "Use travelDocument.",
    "credentialNo": "Use travelDocumentNumber.",
    "credentialA": "Use travelDocumentNumber.",
    "documentType": "Use travelDocument.",
    "documentNumber": "Use travelDocumentNumber.",
}


def main() -> int:
    args = parse_args()
    try:
        operation = OPERATIONS.get(args.operation)
        if not operation:
            raise OpenApiError(f"Unsupported operation: {args.operation}")
        body = read_body(args.body_file)
        path_params = parse_key_values(args.path_param)
        query_params = parse_key_values(args.query_param)
        validate_operation(args.operation, operation, body, path_params)
        result = call_operation(args.operation, operation, body, path_params, query_params)
        print_json(result, Path(args.output) if args.output else None)
        return 0
    except (
        OpenApiError,
        flight_search.ConfigError,
        flight_search.NetworkError,
        flight_search.ResponseParseError,
    ) as exc:
        print_json({"ok": False, "errorType": "flight_openapi_error", "message": flight_search.sanitize_text(str(exc))}, None)
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Call a documented Simplifly Flight OpenAPI operation.")
    parser.add_argument("--operation", required=True, choices=sorted(OPERATIONS))
    parser.add_argument("--body-file", help="JSON request body file for operations that require or accept a body.")
    parser.add_argument("--path-param", action="append", default=[], help="Path parameter as key=value. Repeat as needed.")
    parser.add_argument("--query-param", action="append", default=[], help="Query parameter as key=value. Repeat as needed.")
    parser.add_argument("--output", help="Optional output JSON path. Defaults to stdout.")
    return parser.parse_args()


def read_body(path_value: str | None) -> Any:
    if not path_value:
        return None
    path = Path(path_value)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise OpenApiError(f"Cannot read request body: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise OpenApiError(f"Request body is not valid JSON: {exc.msg}") from exc
    if not isinstance(value, (dict, list)):
        raise OpenApiError("Request body JSON must be an object or array.")
    return value


def parse_key_values(values: list[str]) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise OpenApiError(f"Expected key=value parameter, got: {value}")
        key, raw = value.split("=", 1)
        key = key.strip()
        raw = raw.strip()
        if not key:
            raise OpenApiError("Parameter key must not be empty.")
        parsed[key] = raw
    return parsed


def validate_operation(operation_name: str, operation: dict[str, Any], body: Any, path_params: dict[str, str]) -> None:
    missing_path = [key for key in operation.get("path_params", []) if not path_params.get(key)]
    if missing_path:
        raise OpenApiError(f"Missing path parameter(s) for {operation_name}: {', '.join(missing_path)}")
    if operation.get("body") and body is None:
        raise OpenApiError(f"Operation {operation_name} requires --body-file.")


def call_operation(
    operation_name: str,
    operation: dict[str, Any],
    body: Any,
    path_params: dict[str, str],
    query_params: dict[str, str],
) -> dict[str, Any]:
    endpoint = build_endpoint(operation["path"], path_params, query_params)
    body = prepare_operation_body(operation_name, body)
    if operation_name == "create_order":
        validation_errors = validate_create_order_body(body)
        if validation_errors:
            return build_create_order_validation_result(endpoint, body, path_params, validation_errors)

    config = flight_search.load_config()
    payload, http_status = request_json(config, operation["method"], endpoint, body)
    response_code = payload.get("code") if isinstance(payload, dict) else None
    message = payload.get("message") or payload.get("realMessage") or "" if isinstance(payload, dict) else ""

    safe_payload = redact_api_value(payload)
    data = safe_payload.get("data") if isinstance(safe_payload, dict) else None
    order_references = build_order_references(operation_name, data, body, path_params)
    return {
        "ok": response_code == 0,
        "operation": operation_name,
        "optional": bool(operation.get("optional")),
        "endpoint": endpoint,
        "httpStatus": http_status,
        "responseCode": response_code,
        "message": flight_search.sanitize_text(message),
        "data": data,
        "orderReferences": order_references,
        "rawResponse": safe_payload,
    }


def prepare_operation_body(operation_name: str, body: Any) -> Any:
    if operation_name != "create_order" or not isinstance(body, dict):
        return body
    prepared = dict(body)
    existing_external = first_value_from_mapping(
        prepared,
        ("externalOrderID", "externalOrderId", "external_order_id"),
    )
    if not existing_external:
        prepared["externalOrderID"] = generate_external_order_id(prepared)
    return prepared


def validate_create_order_body(body: Any) -> list[dict[str, str]]:
    errors: list[dict[str, str]] = []
    if not isinstance(body, dict):
        return [
            create_validation_error(
                "body",
                "create_order request body must be a JSON object.",
                "Send an object with orderKey, passengers, currency, passengerCount, and contact fields.",
            )
        ]

    for field in CREATE_ORDER_REQUIRED_TOP_LEVEL:
        if is_blank_value(body.get(field)):
            errors.append(create_validation_error(field, "Required create_order field is missing.", required_field_fix(field)))

    for field in CREATE_ORDER_REQUIRED_CONTACT:
        if is_blank_value(body.get(field)):
            errors.append(create_validation_error(field, "Required contact field is missing.", "Use confirmed contact data."))

    for field, fix in CREATE_ORDER_LEGACY_TOP_LEVEL_FIELDS.items():
        if field in body:
            errors.append(create_validation_error(field, "Legacy create_order field is not accepted.", fix))

    currency = body.get("currency")
    if not is_blank_value(currency) and not isinstance(currency, str):
        errors.append(create_validation_error("currency", "currency must be a string.", "Use the currency returned by verification, e.g. CNY."))

    passengers = body.get("passengers")
    passenger_type_counts = dict.fromkeys(PASSENGER_COUNT_KEYS, 0)
    passengers_valid_for_count = False
    if not isinstance(passengers, list):
        errors.append(create_validation_error("passengers", "passengers must be an array.", "Send one passenger object per traveler."))
    elif not passengers:
        errors.append(create_validation_error("passengers", "passengers must not be empty.", "Send one passenger object per traveler."))
    else:
        passengers_valid_for_count = True
        for index, passenger in enumerate(passengers):
            field_prefix = f"passengers[{index}]"
            if not isinstance(passenger, dict):
                errors.append(create_validation_error(field_prefix, "Passenger entry must be an object.", "Send a passenger object with documented create_order fields."))
                passengers_valid_for_count = False
                continue

            for field, fix in CREATE_ORDER_LEGACY_PASSENGER_FIELDS.items():
                if field in passenger:
                    errors.append(create_validation_error(f"{field_prefix}.{field}", "Legacy passenger field is not accepted.", fix))

            for field in CREATE_ORDER_REQUIRED_PASSENGER:
                if is_blank_value(passenger.get(field)):
                    errors.append(create_validation_error(f"{field_prefix}.{field}", "Required passenger field is missing.", required_passenger_field_fix(field)))

            gender = passenger.get("gender")
            if not is_blank_value(gender) and gender not in CREATE_ORDER_ALLOWED_GENDERS:
                errors.append(create_validation_error(f"{field_prefix}.gender", "gender must be male or female.", "Normalize 男/M to male and 女/F to female."))

            passenger_type = passenger.get("type")
            if is_blank_value(passenger_type):
                passengers_valid_for_count = False
            elif passenger_type not in CREATE_ORDER_ALLOWED_PASSENGER_TYPES:
                errors.append(create_validation_error(f"{field_prefix}.type", "type must be adult, child, or infant.", "Normalize ADT/成人 to adult, CHD/儿童 to child, INF/婴儿 to infant."))
                passengers_valid_for_count = False
            else:
                passenger_type_counts[passenger_type] += 1

            birthday = passenger.get("birthday")
            if not is_blank_value(birthday):
                if not isinstance(birthday, str) or not BIRTHDAY_PATTERN.match(birthday):
                    errors.append(create_validation_error(f"{field_prefix}.birthday", "birthday must use YYYY-MM-DD format.", "Use 1979-04-29, not 19790429."))

            travel_document = passenger.get("travelDocument")
            if not is_blank_value(travel_document) and travel_document not in CREATE_ORDER_ALLOWED_TRAVEL_DOCUMENTS:
                errors.append(create_validation_error(f"{field_prefix}.travelDocument", "Unsupported travelDocument value.", "Use one of passport, tphm, tptw, rphmt, idcard, fpidcard, eep, ttpmr, hhr."))

    passenger_count = body.get("passengerCount")
    passenger_count_valid = False
    if not isinstance(passenger_count, dict):
        errors.append(create_validation_error("passengerCount", "passengerCount must be an object.", "Send passengerCount: { adult, child, infant }."))
    else:
        passenger_count_valid = True
        for key in PASSENGER_COUNT_KEYS:
            value = passenger_count.get(key)
            if not is_non_negative_int(value):
                errors.append(create_validation_error(f"passengerCount.{key}", "passengerCount values must be non-negative integers.", "Send explicit adult, child, and infant counts, using 0 when absent."))
                passenger_count_valid = False
        if passenger_count_valid and passengers_valid_for_count:
            expected_counts = {key: passenger_count[key] for key in PASSENGER_COUNT_KEYS}
            if expected_counts != passenger_type_counts:
                errors.append(
                    create_validation_error(
                        "passengerCount",
                        "passengerCount does not match passengers[].type counts.",
                        "Count passengers by type and send matching passengerCount; priceList.num is not passenger count.",
                    )
                )

    return errors


def build_create_order_validation_result(
    endpoint: str,
    body: Any,
    path_params: dict[str, str],
    validation_errors: list[dict[str, str]],
) -> dict[str, Any]:
    return {
        "ok": False,
        "operation": "create_order",
        "optional": False,
        "endpoint": endpoint,
        "httpStatus": None,
        "responseCode": None,
        "message": "Create-order payload failed local validation.",
        "errorType": "create_order_validation_error",
        "validationErrors": validation_errors,
        "data": None,
        "orderReferences": build_order_references("create_order", None, body, path_params),
    }


def create_validation_error(field: str, message: str, fix: str) -> dict[str, str]:
    return {"field": field, "message": message, "fix": fix}


def is_blank_value(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def is_non_negative_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def required_field_fix(field: str) -> str:
    fixes = {
        "orderKey": "Use the latest orderKey returned by verification; if stale, verify the selected solution again.",
        "passengers": "Send passengers[] using surname/givenNames/travelDocument/travelDocumentNumber/type.",
        "currency": "Use the currency returned by verification/pricing, e.g. CNY.",
        "passengerCount": "Send passengerCount: { adult, child, infant } matching passengers[].type.",
    }
    return fixes.get(field, "Provide this field before calling create_order.")


def required_passenger_field_fix(field: str) -> str:
    fixes = {
        "surname": "Use the passenger surname exactly as on the travel document.",
        "givenNames": "Use the passenger given name(s) exactly as on the travel document.",
        "gender": "Use male or female.",
        "birthday": "Use YYYY-MM-DD format.",
        "travelDocument": "Use the documented document enum such as idcard or passport.",
        "travelDocumentNumber": "Use the passenger document number.",
        "type": "Use adult, child, or infant.",
        "nationality": "Use an ISO-style uppercase country code, e.g. CN.",
        "region": "Use the passenger phone country/region code, e.g. 86.",
        "phone": "Use the passenger phone number.",
    }
    return fixes.get(field, "Provide this passenger field before calling create_order.")


def generate_external_order_id(body: dict[str, Any]) -> str:
    stable_source = {
        "orderKey": body.get("orderKey"),
        "passengers": body.get("passengers"),
        "passengerCount": body.get("passengerCount"),
        "currency": body.get("currency"),
        "contactName": body.get("contactName"),
        "contactPhone": body.get("contactPhone"),
    }
    digest = hashlib.sha256(json.dumps(stable_source, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()
    timestamp = time.strftime("%Y%m%d%H%M%S", time.gmtime())
    return f"TK{timestamp}{digest[:10]}"


def build_endpoint(path_template: str, path_params: dict[str, str], query_params: dict[str, str]) -> str:
    endpoint = path_template
    for key, value in path_params.items():
        endpoint = endpoint.replace("{" + key + "}", urllib.parse.quote(value, safe=""))
    if query_params:
        endpoint = f"{endpoint}?{urllib.parse.urlencode(query_params)}"
    return endpoint


def request_json(config: dict[str, str], method: str, endpoint: str, body: Any) -> tuple[dict[str, Any], int]:
    url = f"{config['base_url']}{endpoint}"
    encoded_body = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Authorization": f"Bearer {config['auth_token']}",
        "Accept-Language": config["accept_language"],
        "X-SF-Mode": config["sf_mode"],
    }
    if encoded_body is not None:
        headers["Content-Type"] = "application/json"

    request = urllib.request.Request(url, data=encoded_body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            response_body = response.read()
            status = response.status
    except urllib.error.HTTPError as exc:
        response_body = exc.read()
        status = exc.code
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise flight_search.NetworkError(flight_search.sanitize_text(str(exc))) from exc

    try:
        parsed = json.loads(response_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise flight_search.ResponseParseError("API response was not valid JSON.") from exc
    if not isinstance(parsed, dict):
        raise flight_search.ResponseParseError("API response JSON was not an object.")
    return parsed, status


def build_order_references(
    operation_name: str,
    data: Any,
    body: Any,
    path_params: dict[str, str],
) -> dict[str, Any]:
    """Extract user-safe order references into a small, unambiguous object."""

    external_from_response, platform_from_response = extract_order_reference_values(data)
    submitted_external = first_value_from_mapping(body, ("externalOrderID", "externalOrderId", "external_order_id"))
    path_external = first_value_from_mapping(path_params, ("externalOrderID", "externalOrderId", "external_order_id"))
    path_order = first_value_from_mapping(path_params, ("orderID", "orderId", "order_id"))

    external_order_id = external_from_response or path_external or submitted_external
    platform_order_id = platform_from_response or path_order
    display_number = external_order_id or platform_order_id
    display_label = "订单号" if external_order_id else "平台订单号" if platform_order_id else None

    references: dict[str, Any] = {
        "available": bool(display_number),
        "operation": operation_name,
    }
    if display_number:
        references["displayOrderNumber"] = display_number
    if display_label:
        references["displayOrderNumberLabel"] = display_label
    if external_order_id:
        references["externalOrderID"] = external_order_id
    if platform_order_id:
        references["platformOrderID"] = platform_order_id
    if submitted_external and submitted_external != external_from_response:
        references["submittedExternalOrderID"] = submitted_external
    if path_external and path_external != external_from_response:
        references["pathExternalOrderID"] = path_external
    if path_order and path_order != platform_from_response:
        references["pathOrderID"] = path_order
    return references


def extract_order_reference_values(value: Any) -> tuple[str | None, str | None]:
    if isinstance(value, list):
        for item in value:
            external_order_id, platform_order_id = extract_order_reference_values(item)
            if external_order_id or platform_order_id:
                return external_order_id, platform_order_id
        return None, None
    if not isinstance(value, dict):
        return None, None

    external_order_id = first_value_from_mapping(
        value,
        (
            "externalOrderID",
            "externalOrderId",
            "external_order_id",
            "externalOrderNo",
            "externalOrderNumber",
            "customerOrderID",
            "customerOrderId",
            "clientOrderID",
            "clientOrderId",
        ),
    )
    platform_order_id = first_value_from_mapping(value, ("orderID", "orderId", "order_id"))
    if not platform_order_id and looks_like_order_object(value):
        platform_order_id = safe_reference_text(value.get("id"))
    if external_order_id or platform_order_id:
        return external_order_id, platform_order_id

    for key in ("order", "orderInfo", "orderDetail", "flightOrder", "result", "record", "item"):
        external_order_id, platform_order_id = extract_order_reference_values(value.get(key))
        if external_order_id or platform_order_id:
            return external_order_id, platform_order_id
    return None, None


def looks_like_order_object(value: dict[str, Any]) -> bool:
    keys = set(value)
    order_markers = {
        "externalOrderID",
        "externalOrderId",
        "external_order_id",
        "orderType",
        "lastActionTime",
        "lastTicketingTime",
        "lastVoidTime",
        "passengers",
        "segments",
        "contactName",
        "contactPhone",
        "contactEmail",
        "contactRegion",
    }
    return "id" in keys and bool(keys & order_markers)


def first_value_from_mapping(value: Any, keys: tuple[str, ...]) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in keys:
        text = safe_reference_text(value.get(key))
        if text:
            return text
    return None


def safe_reference_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        text = str(value)
    elif isinstance(value, str):
        text = value
    else:
        return None
    text = flight_search.sanitize_text(text).strip()
    if not text or text == "[redacted]":
        return None
    return text


def redact_api_value(value: Any, key: str = "") -> Any:
    key_lower = key.lower()
    if key_lower in {"pnr", "airlinepnr"} or ("pnr" in key_lower and key_lower not in {"pnrparse"}):
        return "[redacted]"
    if key_lower in {"tickets", "ticketno", "ticketnumber", "ticketnum", "ticketnumbers"}:
        return "[redacted]"
    if isinstance(value, dict):
        return {item_key: redact_api_value(item_value, item_key) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [redact_api_value(item, key) for item in value]
    if isinstance(value, str):
        return flight_search.sanitize_text(value)
    return value


def print_json(value: dict[str, Any], output_path: Path | None) -> None:
    text = json.dumps(value, ensure_ascii=False, indent=2)
    if output_path:
        output_path.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)


if __name__ == "__main__":
    raise SystemExit(main())
