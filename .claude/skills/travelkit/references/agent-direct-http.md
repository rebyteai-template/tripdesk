# Agent Direct HTTP Usage

This is a lightweight internal pure-skill integration. Agents read the skill documents for workflow guidance and call Simplifly flight APIs directly. This is not a public MCP capability package.

## Working Directory

No fixed working directory is required. Read this skill's reference files from
the installed skill directory, and call Simplifly OpenAPI directly using
environment variables.

## Required Runtime

The agent runtime must be able to send HTTPS requests with bearer-token authentication.

Build request URLs as `${SIMPLIFLY_BASE_URL}${endpoint_path}`.

Endpoint paths stay in the API map, for example:

```text
/openapi/v3/flight/shopping
```

Do not include endpoint paths in `SIMPLIFLY_BASE_URL`.

## Secrets

Read credentials only from environment variables:

- `SIMPLIFLY_BASE_URL`
- `SIMPLIFLY_AUTH_TOKEN`
- Optional `SIMPLIFLY_ACCEPT_LANGUAGE`, default `zh-Hans`
- Optional `SIMPLIFLY_SF_MODE`, default `buyer`; allowed values are `buyer` or `seller`

Do not print these values. Do not include headers, JWT tokens, or secrets in user-facing replies.

`SIMPLIFLY_BASE_URL` must come from runtime configuration, a secret store, `.env.local`, or manual shell environment. Do not hardcode environment-specific gateways in this skill.

Set the base URL to the gateway root only:

```bash
SIMPLIFLY_BASE_URL=https://<your-openapi-gateway>
```

Do not include endpoint paths in `SIMPLIFLY_BASE_URL`; for example, do not set it to `/openapi/v3/flight/shopping`.

## Allowed Read Operations

These may be called when the user intent and required inputs are clear:

- `shopping`
- `pricing`
- `verify_solution`
- `get_order`
- `get_order_by_external_id`
- `baggage_transit`
- `fare_rules`
- `balance`
- Optional/degraded: `list_orders`, `ticket_status`, `parse_pnr`, `refund_money_search`, `refund_change_availability`

Optional/degraded operations may not be mounted by the backend. If route-not-found or 404 is returned, explain that the API did not return that capability and continue with mounted endpoints where possible.

`balance` is read-only and does not require write-operation confirmation. Call it only when the user explicitly asks about balance, account funds, credit, or balance diagnostics.

## Direct HTTP Rules

Every request must include:

- `Content-Type: application/json`
- `Accept: application/json`
- `Authorization: Bearer ${SIMPLIFLY_AUTH_TOKEN}`
- `Accept-Language`: value of `SIMPLIFLY_ACCEPT_LANGUAGE`, default `zh-Hans`
- `X-SF-Mode`: value of `SIMPLIFLY_SF_MODE`, default `buyer`; must be `buyer` or `seller`

Do not implement `/org/login` in this skill. JWT tokens must be provided by an
external login flow via environment variables or a secret store. Do not add
`X-Org-Id`; the current system has not enabled that request header.

Treat response envelope `code == 0` as success. If `code != 0`, summarize `message` or `realMessage` safely and do not dump raw secrets, headers, or tokens.

## Write Operations Require Confirmation

Before these operations, first summarize the exact business action and wait for explicit user confirmation:

- `create_order`
- `pay_order`
- `cancel_order`
- `create_refund_order`
- `confirm_refund_order`
- `create_change_order`

Confirmation must be about the business action, not just permission to run a command. Include the route/order context and amount/fee when returned by prior API calls.

## HTTP Examples

Search request shape:

```text
POST ${SIMPLIFLY_BASE_URL}/openapi/v3/flight/shopping
Headers: Content-Type, Accept, Authorization, Accept-Language, X-SF-Mode
Body: FlightRequestShoppingReq JSON
```

For ordinary search, include `maxResultCount: 50` by default. Apply available
request-side filters before local ranking: `maxSegments: 1` for nonstop/direct
requests, `maxPrice`, `includeAirlines`, `excludeAirlines`, `mustHaveBag`, and
`maxDuration` when the user gives those preferences. After the response returns,
normalize it to compact display options before summarizing; do not feed the full
raw response into user-facing generation.

Verify request shape:

```text
POST ${SIMPLIFLY_BASE_URL}/openapi/v3/flight/solutions/{solutionId}/verification
Headers: Content-Type, Accept, Authorization, Accept-Language, X-SF-Mode
Body: {"solutionId":"...", "passengerCount":{"adult":1,"child":0,"infant":0}}
```

Get order request shape:

```text
GET ${SIMPLIFLY_BASE_URL}/openapi/v3/flight/orders/{orderID}
Headers: Accept, Authorization, Accept-Language, X-SF-Mode
```

Pay after explicit confirmation:

```text
POST ${SIMPLIFLY_BASE_URL}/openapi/v3/flight/orders/{orderID}/payment
Headers: Content-Type, Accept, Authorization, Accept-Language, X-SF-Mode
```

## User-Facing Redaction

Do not expose these fields in ordinary user replies:

- `solutionId`
- `orderKey`
- PNR / `pnr` / `airlinePnr`
- ticket numbers / `ticketNo`
- JWT token or secret
- passenger IDs and segment IDs unless the user is doing developer diagnostics

## Exclusions

Do not call or implement:

- Any Train/V3 or Train/V4 endpoint

## Smoke Test

Before enabling this in an agent runtime, run a direct HTTP smoke test with dummy credentials. The expected result is not 404; dummy credentials may return access denied.
