# Flight Booking

Use this reference for verification, passenger collection, original order creation, and order lookup. Search and pricing live in `flight-search.md`; API fields live in `api-map.md`; payment lives in `flight-pay.md`; user-facing formatting and redaction live in `output-rules.md`.

## Verification Workflow

Verification is mandatory before collecting passenger identity details or creating an order.

1. For ordinary shopping results displayed from `flight_search.py` + `flight_search_compact.py`, call `scripts/flight_verify_selected.py --compact-file <compact-json> --option <number>` and let the script read the selected displayed option's private `solutionId`. Keep verification on the same direct-HTTP channel as the displayed search results.
2. The script calls `verify_solution` via `POST /openapi/v3/flight/solutions/{solutionId}/verification` with body:
   `{"solutionId":"...","passengerCount":{"adult":1,"child":0,"infant":0}}`.
3. Always use `passengerCount: { adult, child, infant }`; explicitly pass `child: 0` and `infant: 0` when the user did not specify them.
4. Do not use `passengers` in verification requests. `passengers` belongs to shopping/create-order style payloads, not verification.
5. Compare returned route, times, cabin, price, and baggage against the selected displayed option, not the original raw array index.
6. If the verified itinerary, price, cabin, or baggage changed materially, ask the user to accept the verified option before proceeding.
7. Store the returned `orderKey` as the only key to use for original order creation.
8. Collect passenger and contact details only after verification succeeds and the user confirms they want to book.

If verification fails with an expired-search error such as `207013`, re-run the same `flight_search.py -> flight_search_compact.py` flow, present the refreshed options, and ask the user to choose again. Do not silently auto-select the old option number from refreshed results, and do not switch to another search/verification channel. If a later order creation retry is needed, verify again instead of reusing a stale `orderKey`.

## Passenger Collection

Collect only fields required by the chosen fare and create-order schema:

- Passenger: surname, given names, gender, birthday, passenger type, nationality
- Document: travel document type, number, and expiry date when applicable
- Contact: region/country code and phone; email when available
- Optional frequent flyer: airline and card number

Use `requiredPassengerInfos` returned by shopping or verification, when present, to decide which passenger details are required for the selected fare. Also apply returned passenger limits before order creation:

- `allowedTravelDocuments`: only collect and send one of the returned document types.
- `nationalityAllows` / `nationalityForbids`: accept or reject the passenger nationality before calling create order.
- `agePairs`: use birthday and passenger type to catch obvious age-range mismatches before calling create order.

Do not collect identity details during search-only conversations.

For international flights, collect passenger and contact details with this template only after verification succeeds and the user confirms they want to book:

```text
国籍：
证件类型：
姓：
名：
性别：
出生日期：
证件号码：
证件有效期：
乘客电话（可选）：
乘客邮箱（可选）：
常用旅客卡（可选）：

联系人姓名：
联系人邮箱：
联系人手机：
```

Field mapping:

- 国籍 -> passenger `nationality`
- 证件类型 -> passenger `travelDocument`
- 姓 -> passenger `surname`
- 名 -> passenger `givenNames`
- 性别 -> passenger `gender`
- 出生日期 -> passenger `birthday`
- 证件号码 -> passenger `travelDocumentNumber`
- 证件有效期 -> passenger `travelDocumentExpireDate`
- 乘客电话（可选） -> passenger `region` + `phone` when provided
- 乘客邮箱（可选） -> passenger `email` when provided
- 常用旅客卡（可选） -> passenger `airline` + `cardNo` when provided
- 联系人姓名 -> `contactName`
- 联系人邮箱 -> `contactEmail`
- 联系人手机 -> `contactRegion` + `contactPhone`

When Portal-provided `contact_defaults` are available, use them only to fill missing create-order contact fields:

- `contactName`: from authenticated user profile name
- `contactEmail`: from authenticated user profile email
- `contactPhone`: from authenticated user profile mobile
- `contactRegion`: from authenticated user profile region

Contact precedence is fixed: explicit user input in the current turn, then previously confirmed conversation contact values, then `contact_defaults`, then ask the user for missing fields. Never overwrite a user-provided contact field with a default. Never use `contact_defaults` as passenger identity, document, passenger phone, or passenger email data.

When collecting booking details, display contact fields together with their defaults so the user can change them. Use Chinese labels such as:

- `联系人姓名：默认 X，可修改`
- `联系人邮箱：默认 X，可修改`
- `联系区号：默认 X，可修改`
- `联系电话：默认 X，可修改`

If the user confirms without changing a defaulted contact field, use the default. If a required contact field has no user value and no default, show that field as still required and do not create the order until it is provided.

If the user replies `默认`, `使用默认`, `可以`, `确认`, or otherwise accepts the defaults, treat all defaulted contact fields as confirmed. After that, do not ask again for 联系人姓名, 联系人邮箱, 联系电话, 联系区号, contact phone, or contact email.

Passenger booking fields are still mandatory and cannot come from contact defaults. Before any create-order/submission action, collect at least `乘机人姓名（非联系人姓名，与证件一致）`, `证件类型（身份证/护照等）`, and `证件号码`. If the user only provides a passenger name, ask next for `证件类型` and `证件号码`. Do not say that you are submitting, creating, or generating an order while passenger document type or document number is missing.

Normalize common passenger inputs before building the create-order payload:

- Gender: `男`, `M`, `male` -> `male`; `女`, `F`, `female` -> `female`
- Passenger type: `ADT`, `成人`, `adult` -> `adult`; `CHD`, `儿童`, `child` -> `child`; `INF`, `婴儿`, `infant` -> `infant`
- Travel document: `身份证`, `idcard` -> `idcard`; `护照`, `passport` -> `passport`
- Nationality: `中国`, `中国大陆`, `CN` -> `CN`

Valid create-order passenger enum values are:

- `gender`: `male`, `female`
- `type`: `adult`, `child`, `infant`
- `travelDocument`: `passport`, `tphm`, `tptw`, `rphmt`, `idcard`, `fpidcard`, `eep`, `ttpmr`, `hhr`

Use ISO-style uppercase country codes for `nationality`, such as `CN`. The Apifox-generated OpenAPI does not provide a full `currency` enum; use the currency returned by verification/pricing, with `CNY` as the known common value.

## Create Original Order

Create order is a write operation. Before calling it, summarize the exact business action and wait for explicit user confirmation.

Confirmation must include:

- Flight route/date/time and passenger count
- Total price/currency if returned
- Contact name, region, phone, and email when required by the collection template, provided by the user, or filled from `contact_defaults`
- Statement that the order will be created

After explicit confirmation:

1. Build `externalOrderID` if the user has not supplied one, using a deterministic prefix plus timestamp. The direct-HTTP tool also auto-fills `externalOrderID` before calling Simplifly when the model omits it; still include it explicitly when preparing the create-order body.
2. Validate required schema fields (`orderKey`, `passengers`, `currency`) and business-required `passengerCount` before calling the API. The bundled direct-HTTP script performs this preflight validation locally and returns `errorType: create_order_validation_error` instead of calling Simplifly when known-invalid fields are present.
3. Validate `passengerCount` matches the passenger array by total and by passenger `type`; omitting or mismatching it can produce "Passanger count error" (`1300038`). Do not derive passenger count from `priceList.num`; count actual passenger objects by `type`.
4. Validate enum fields and birthday format after alias normalization. Create order uses `birthday: YYYY-MM-DD` such as `1979-04-29`; do not send compact dates such as `19790429`.
5. Call `create_order` with the latest verified `orderKey`, `passengers`, `passengerCount`, contact fields, direct-HTTP `externalOrderID`, and `currency`.
6. Summarize order status, order references, and deadlines if returned. Show `externalOrderID` / `externalOrderId` as `订单号`. If no external order reference is returned, or if the user asks for the order number, show returned `id` / `orderID` as `平台订单号`. For `orderType: origin`, show returned `lastActionTime` as `最晚支付时间`; show `lastTicketingTime` as `最晚出票时间` and `lastVoidTime` as `废票截止时间` only when returned.
7. Store `orderID` for payment and lookup. It may be shown as `平台订单号` when needed, but do not expose passenger IDs, segment IDs, PNR, or ticket numbers.

Create-order request shape:

- Top level: `orderKey`, `externalOrderID`, `currency`, `passengerCount`, `passengers`, `contactName`, `contactRegion`, `contactPhone`; include `contactEmail` when available.
- `passengerCount`: object with explicit integer keys `{ "adult": n, "child": n, "infant": n }`.
- `passengers[]`: `surname`, `givenNames`, `gender`, `birthday`, `travelDocument`, `travelDocumentNumber`, `type`, `nationality`, `region`, `phone`; include `travelDocumentExpireDate`, `email`, `airline`, `cardNo` only when applicable.
- Never send legacy top-level `totalPrice`, `externalOrderId`, or `external_order_id` in create-order requests.
- Never send legacy passenger fields `name`, `ageType`, `passengerType`, `credentialType`, `credentialNo`, `credentialA`, `documentType`, or `documentNumber`. Map them to `surname`/`givenNames`, `type`, `travelDocument`, and `travelDocumentNumber` before calling the tool.

Create-order recovery matrix:

| API signal | Likely cause | Recovery |
|---|---|---|
| `101001` / `参数错误` | Missing `currency`, missing `passengerCount`, wrong field names, or malformed create-order body | Fix the documented payload locally, then retry once. Do not keep resubmitting the same body. |
| `1300070` / invalid order key / expired key | The `orderKey` is stale or from a previous verification/search context | Re-run verification for the selected solution and rebuild create-order body with the new `orderKey`. |
| `1300036` / `Birthday error` | Birthday format or age/type mismatch | Use `YYYY-MM-DD` and verify passenger `type` fits the selected fare's age rules. |
| `1300038` / `Passanger count error` | `passengerCount` missing or not matching `passengers[].type` | Recount actual passengers by `type` and send matching `{ adult, child, infant }`. |

## Order Lookup

Use `get_order(order_id)` when an internal order ID is known.

Use `get_order_by_external_id(external_order_id)` when resuming from a buyer-side idempotency key.

Use `list_orders` only as an optional fallback because generated OpenAPI marks it as not currently mounted.

Order lookup is read-only. Show returned `externalOrderId` / `externalOrderID` as `订单号`, and show returned `id` / `orderID` as `平台订单号` when requested or when no external order reference exists. Do not expose ticket numbers, PNR, internal passenger IDs, or internal segment IDs in ordinary user replies.

## Balance Lookup

Use `balance` only when the user explicitly asks about account balance, account funds, credit, or balance diagnostics. It is read-only and does not require write-operation confirmation. Interpret only fields returned by the API; do not invent currency, available balance, credit limit, or frozen amount fields.

## Error Handling

- If the envelope `code` is not `0`, summarize `message` or `realMessage` without dumping raw JSON.
- If order creation fails after verification, do not reuse stale `orderKey`; verify again before retrying.
- If required passenger fields are missing, ask only for the missing fields needed to build the documented request.
- If the direct-HTTP tool returns `errorType: create_order_validation_error`, fix the listed `validationErrors` before retrying; the API has not been called yet.
