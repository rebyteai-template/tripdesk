# Simplifly Flight OpenAPI Map

Use this reference to choose Simplifly Flight OpenAPI endpoints and understand field handoffs.

## Authentication

All endpoints use bearer-token headers:

- `Content-Type`: `application/json`
- `Accept`: `application/json`
- `Authorization`: `Bearer ${SIMPLIFLY_AUTH_TOKEN}`
- `Accept-Language`: default `zh-Hans`
- `X-SF-Mode`: `buyer` or `seller`, default `buyer`

Read `SIMPLIFLY_AUTH_TOKEN` only from environment variables or a secret store,
and never print it. Do not use `code`, `timestamp`, or `signature` headers. Do
not add `X-Org-Id`; the current system has not enabled it.

Build URLs as `${SIMPLIFLY_BASE_URL}` plus the endpoint path. `SIMPLIFLY_BASE_URL` must be the gateway root and must not include endpoint paths.

The standard response envelope is:

- `code`: success is normally `0`
- `message`: public status message
- `realMessage`: backend detail when present
- `data`: endpoint payload

## Mounted Core Endpoints

| Group | Method | Path | Operation | Data returned |
|---|---|---|---|---|
| Search | POST | `/openapi/v3/flight/shopping` | Flight search | `FlightResponseOpenAPIShoppingResp` |
| Search | POST | `/openapi/v3/flight/pricing` | Exact pricing for known flights | array of `FlightResponseOpenAPIPricingResp` |
| Search | POST | `/openapi/v3/flight/solutions/{solutionId}/verification` | Real-time solution verification | `FlightResponseOpenAPIVerificationResp` |
| Search | POST | `/openapi/v3/flight/baggage-transit` | Baggage through-check / transit query | `FlightResponseOpenAPIBaggageTransitResp` |
| Order | POST | `/openapi/v3/flight/orders` | Create original flight order | `FlightResponseOpenAPIOrderResp` |
| Order | GET | `/openapi/v3/flight/orders/{orderID}` | Get order detail | `FlightResponseOpenAPIOrderResp` |
| Order | DELETE | `/openapi/v3/flight/orders/{orderID}` | Cancel order | `FlightResponseOpenAPIOrderResp` |
| Order | GET | `/openapi/v3/flight/external/{externalOrderID}` | Get order by external order ID | `FlightResponseOpenAPIOrderResp` |
| Payment | POST | `/openapi/v3/flight/orders/{orderID}/payment` | Pay order | `FlightResponseOpenAPIOrderResp` |
| Change | POST | `/openapi/v3/flight/orders/{orderID}/change/search` | Change search / repricing | `FlightResponseOpenAPIChangeSearchResp` |
| Change | POST | `/openapi/v3/flight/orders/{orderID}/change` | Create change order | `FlightResponseOpenAPIOrderResp` |
| Refund | POST | `/openapi/v3/flight/orders/{orderID}/refund` | Create refund order | `FlightResponseOpenAPIOrderResp` |
| Refund | POST | `/openapi/v3/flight/orders/{orderID}/confirmation` | Confirm refund order | `FlightResponseOpenAPIOrderResp` |
| Account | GET | `/openapi/v3/flight/balance` | Query flight account balance | object |

## Optional / Unmounted Endpoints

These appeared in the generated OpenAPI with `x-backend-router-registered: false`. Try them only when useful, and degrade gracefully on route-not-found.

| Group | Method | Path | Operation |
|---|---|---|---|
| Search | POST | `/openapi/v3/flight/fare-rules` | Query fare, refund/change, and baggage rules |
| Order | GET | `/openapi/v3/flight/orders` | Query order list |
| Order | POST | `/openapi/v3/flight/ticket-status` | Query ticket status |
| Order | POST | `/openapi/v3/flight/pnr-parse` | Parse PNR content |
| Refund | POST | `/openapi/v3/flight/orders/{orderID}/refund-money-search` | Search refundable amount |
| Refund | POST | `/openapi/v3/flight/orders/refund-change-availability` | Query refund/change availability |

## Explicitly Excluded

- All `Train/V3` and `Train/V4` endpoints.

## Key Requests

### Shopping

`FlightRequestShoppingReq` fields:

- `journeys`: array of `{ origin, destination, departureDate }`
- `cabinClass`: cabin class full-name string. Default to `economy` when the user does not specify a cabin, and map "economy cabin" / "经济舱" to `economy`. Do not send fare bucket or cabin-code shortcuts such as `Y`, `E`, `L`, or `P` as `cabinClass`; response fields such as `cabinCode` and `subCabinCode` are display/result data, not request values.
- `passengers`: `{ adult, child, infant }`
- Optional filters: `excludeAirlines`, `includeAirlines`, `alliances`, `mustHaveBag`, `maxPrice`, `maxDuration`, `maxSegments`, `maxResultCount`
- Optional requirements: `freeBaggage`, `changeable`, `refundable`, `noCodeShare`, `noOverNight`, `noVirtualInterline`, `noMultiAirport`, `onlyCorporateFares`

Default search request behavior:

- For ordinary one-way search, include `maxResultCount: 50` unless the user explicitly needs a broader search.
- If the user asks for nonstop / direct flights, include `maxSegments: 1`.
- If the user provides price, airline, baggage, or duration preferences, send matching request filters before local ranking: `maxPrice`, `includeAirlines`, `excludeAirlines`, `mustHaveBag`, and `maxDuration`.

### Known-Flight Pricing

`FlightRequestFlightPricingReq` fields:

- Required by schema: `segments`
- `segments[]`: `{ departure, arrival, departureDate, cabinClass, flightNo, journeyIndex }`; use the same `cabinClass` full-name rule as shopping, defaulting to `economy` and not fare bucket shortcuts such as `Y`, `E`, `L`, or `P`.
- `passengers`: `{ adult, child, infant }`
- Optional: `mustHaveBag`, `maxPrice`, `accountCode`, `itineraryRequired`, `maxWaitTime`

### Verification

`POST /openapi/v3/flight/solutions/{solutionId}/verification`

Body fields:

- `solutionId`: same selected solution ID
- `passengerCount`: `{ adult, child, infant }`

Use returned `orderKey` for order creation.

### Create Original Order

`FlightRequestCreateFlightOriginOrderRequest` fields:

- Required by schema: `orderKey`, `passengers`, `currency`
- **Important**: Must also include `passengerCount: { adult, child, infant }` matching the passenger array, otherwise the API returns "Passanger count error" (code 1300038).
- Contact: collect `contactName`, `contactRegion`, and `contactPhone`; include optional `contactEmail` when available
- `externalOrderID`: buyer-side idempotency key
- `requireReview`, `manualRemark`
- `passengers[]`: `surname`, `givenNames`, `gender`, `birthday`, `travelDocument`, `travelDocumentNumber`, `travelDocumentExpireDate`, `type`, `nationality`, `region`, `phone`, optional `email` when available, `cardNo`, `airline`

### Change Search

`FlightHandleropenAPIChangeSearchReq` fields:

- `segmentId`, `cabinClass`, `departureDate`
- `passengers`, `ticketInfo`
- `journeys[]`: original or replacement journey shape
- Optional shopping filters mirror shopping request fields
- Returned `solutions[].solutionId` is required for create-change. Missing,
  `null`, or empty string `solutionId` means that option cannot be used to
  create a change order.

### Create Change Order

`FlightRequestCreateFlightChangeOrderRequest` fields:

- Required by schema: `reason`
- Business-required: `solutionIds`, `passengerIds`
- Optional: `oldJourneyIndex`, `fileList`, `reasonDetail`, contact fields
- `solutionIds` must be built only from non-empty `solutions[].solutionId`
  values returned by change search. Do not substitute `searchKey`, `orderKey`,
  segment IDs, or any other field for `solutionIds`.
- If the API returns `Parameters error` for a documented payload, do not keep
  retrying speculative field combinations. Treat change creation as not accepted
  by the API for that order/option and use the post-sale fallback rules.

### Refund

`FlightRequestCreateFlightRefundOrderRequest` fields:

- Required by schema: `passengerIds`, `segmentIds`, `reasonType`（值为 `voluntary` 或 `involuntary`）
- Optional: `fileList`, `reasonDetail`, contact fields
- Generated OpenAPI may still show `reason` for refund creation, but the actual
  refund-create API uses `reasonType`. Do not use `reason` in create-refund
  requests.

`FlightHandleropenAPIRefundMoneySearchReq` fields:

- `passengerIds`, `segmentIds`, `reason`, `reasonDetail`

### Balance

`GET /openapi/v3/flight/balance` has no request body. Use the standard bearer-token headers.

The response `data` is an object. Interpret only fields returned by the API; do not invent currency, available balance, credit limit, or frozen amount fields when they are absent. Use this endpoint only for explicit balance, account funds, credit, or balance diagnostics requests.

## Key Responses

Shopping, pricing, verification, and change search return solution objects:

- `solutionId`: internal, use for verification/change creation only
- `orderKey`: internal, use for order creation only
- `priceDetail`: public-safe after summarization
- `journeys`: public-safe after summarization
- `fareRules`: public-safe after summarization when present
- `requiredPassengerInfos`: collect only after verification and user intent to book

Fare rule time-key mapping:

- `refund[">0"]` -> 起飞前退票费
- `refund["<0"]` -> 起飞后退票费
- `change[">0"]` -> 起飞前改签费
- `change["<0"]` -> 起飞后改签费
- Do not infer timing from the literal sign direction of `<0` / `>0`; use the
  mapping above.
- `canVoid` means whether voiding is permitted. Do not present it as the
  refund/change fee or as refund/change availability.

For search display prices, compute each solution's total with this priority:

- Prefer the sum of `priceDetail.priceList[].salePrice * num`.
- If `salePrice` is missing, use `(price + tax) * num`.
- If itemized price fields are absent, use `priceDetail.priceTotal` when present.

When multiple solutions have the same flight combination, route, departure time,
and arrival time, treat them as fare options for the same itinerary and display
the lowest computed total unless the user explicitly asks to compare fare
products. The displayed price, internal `solutionId`, `orderKey`, and later
verification must all refer to that same lowest fare solution.

Fare product fields such as `brandCode`, `productName`, `productType`, and
`productFlag` describe fare product information. They are not `cabinClass` and
are not cabin or fare-bucket codes. Do not pass `BAS`, `FLE`, or other fare
brand codes as request `cabinClass`; use full cabin values such as `economy`.
`brandCode` 不是 `cabinClass`，也不是舱位代码。
When explaining fare products, base the explanation on returned price, baggage,
refund/change, and product fields.

When displaying options, store `solutionId` with the final displayed option
number and summary. Do not rely only on the raw `solutions` array index after
sorting, filtering, grouping, or deduplication.

For large shopping responses, first normalize the response to compact display
options before summarizing. Keep only flight numbers, route/times, duration,
transfer count, cabin, baggage summary, computed total price, and the private
`solutionId` / `orderKey` mapping. Do not ask the model to inspect or summarize
the full raw response payload.

Order responses return:

- `id`: `orderID`, internal unless developer context
- `status`, `orderType`, `externalOrderId`, contact fields
- `journeys[].segments[].id`: segment IDs for refund/change
- `passengers[].id`: passenger IDs for refund/change
- `passengers[].tickets[]`: contains ticket numbers and PNR; do not show to ordinary users
- `priceDetail.priceTotal`, `priceDetail.transactionFee`, `priceDetail.priceList`
