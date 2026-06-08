# Flight Booking Workflows

Use this reference for the booking lifecycle: search or exact pricing, verify, create order, pay, and look up orders.

## Search Workflow

1. Collect only route, departure date, passenger counts, cabin, and search preferences.
   For complex or ambiguous natural-language requests, first normalize the user's intent with [requirement-analysis](requirement-analysis.md), then call shopping or pricing.
   If the user does not specify a cabin, default `cabinClass` to `economy`; map "economy cabin" / "经济舱" to `economy`, not fare bucket shortcuts such as `Y`.
2. Call `shopping` with `journeys`, `passengers`, `cabinClass`, default `maxResultCount: 50`, and applicable optional filters. Send `maxSegments: 1` for nonstop/direct requests, and prefer API filters such as `maxPrice`, `includeAirlines`, `excludeAirlines`, `mustHaveBag`, and `maxDuration` when the user gives those preferences.
3. Normalize the returned solutions before summarizing. Read only the compact fields needed for display and verification: flight numbers, route, departure/arrival dates and times, duration, transfer count, cabin, baggage summary, computed total price, and private `solutionId` / `orderKey`. Deduplicate identical itineraries to the lowest computed fare, and keep a private display-number mapping to that exact `solutionId` / `orderKey`.
4. Rank search results by the Search Ranking and Lowest Fare rules, then present user-safe flight options using the Flight Time Presentation rules. For ordinary one-way searches, use the Ordinary Search Output Format, display Top 5 by default, and never more than Top 10 in one reply. For complex, multi-date, round-trip, or multi-route searches, use the Complex Search Output Format.
5. Do not pass the full raw `data` / `solutions` payload into user-facing generation. Do not show full fare rules, full baggage rules, or refund/change rules in first search results; defer them until the user selects an option or asks for details.
6. Keep `solutionId` and `orderKey` internal.
7. When the user selects an option, proceed to verification.

## Ordinary Search Output Format

Use this fixed table format for ordinary one-way or ordinary single-search
results. Do not use this section for round trips, flexible date searches,
multi-route comparisons, or local combination across multiple shopping calls;
use the Complex Search Output Format for those cases.

Required table columns:

`方案 | 航班 | 航司 | 路线 | 起飞 | 到达 | 时长 | 经停/中转 | 舱位 | 价格`

Field rules:

- `起飞` only contains departure date/time and departure airport or terminal, for
  example `6/21 07:45 大兴(PKX)`.
- `到达` only contains arrival date/time and arrival airport or terminal, for
  example `6/21 10:05 浦东T1`.
- `时长` 只放 flight or total itinerary duration, for example `2h20m`.
- `价格` 只放 total displayed price, for example `¥620`.
- `经停/中转` contains nonstop, stop count, transfer count, or transfer airport
  summary when returned.
- `舱位` contains the display cabin, for example `经济舱`; do not put fare-bucket
  shortcuts here unless the user asks for fare-code detail.
- Do not put price in `时长`; do not put duration in `到达`; do not leave `价格`
  empty when a displayed price is derivable.
- Keep option numbers stable and bound to the private `solutionId` / `orderKey`
  mapping used for verification.

## Complex Search Intent

For complex search requests, normalize the user's intent with [requirement-analysis](requirement-analysis.md) before calling APIs.

Handle these patterns:

- Round trip: create outbound and return journeys, or run separate outbound and return searches and combine locally, when the user gives a return date, stay length, or phrases such as "待一周再回来".
- Date range or flexible dates: run one shopping request per candidate date, then compare returned options.
- City with multiple airports: use the city code first when provided; if no results, try common airport-code combinations and summarize which routes were tried.
- Time preferences: filter or rank returned journeys by departure/arrival time after results return, for example morning departure, afternoon arrival, or early return.
- Ranking preferences:
  - cheapest: sort by computed total price.
  - fastest: sort by total duration.
  - nonstop: prefer `transferNum = 0`.
  - fewer stops: sort by `transferNum`.
  - baggage required: prefer options with returned checked baggage.
- If the user does not specify a cabin, use `cabinClass: economy`.
- If the user does not specify passenger count, use 1 adult.

When multiple shopping calls are needed, summarize:

- request assumptions
- number of routes/dates searched
- best 3-5 options
- why each option is recommended
- any dates/routes that returned no results

## Complex Search Output Format

Use this fixed output structure for complex search results that require multiple
shopping calls, local combination, or comparison across dates/routes.

Output sections in this order:

1. `查询请求`
   - State passenger count, cabin, searched date range, route/city assumptions,
     and user preferences such as morning departure, afternoon arrival, shortest
     duration, nonstop, baggage, or lowest price.
2. `推荐方案`
   - Show the best 3-5 combinations in one table.
   - Columns: `方案`, `去程`, `回程`, `往返总价`, `推荐理由`.
   - For one-way complex searches, replace `回程` with `-`.
3. `方案详情`
   - Expand each recommended option with outbound and return details.
   - Use flight numbers, route, departure, arrival, total duration, transfer
     count, itinerary price, and checked baggage if returned.
   - Use the Flight Time Presentation rules; do not collapse times into strings
     such as `02:40-06:10→10:35-11:50`.
4. `候选摘要`
   - When date/routing expansion was used, show separate outbound and return
     candidate summaries, up to 5 rows each.
   - Include date, route, lowest price, option count, and best matching reason.
5. `未返回结果`
   - List any searched dates/routes that returned no results. Omit this section
     if every searched route/date returned options.
6. `下一步`
   - Ask the user to reply with a displayed option number for verification.

Rules:

- Keep option numbers stable across `推荐方案` and `方案详情`.
- Every displayed option number must map to the exact lowest-fare `solutionId`
  used for that displayed price.
- Default recommendation is lowest total price unless the user states a stronger
  preference; when a stronger preference exists, rank by that preference first
  and keep the lowest fare for the same itinerary.
- Do not expose `solutionId`, `orderKey`, raw API responses, signatures, or
  credentials.

## Search Ranking and Lowest Fare

- If the user does not state a stronger preference, default to lowest total price first.
- If the user states a clear preference such as shortest duration, nonstop, morning departure, afternoon arrival, airport, airline, baggage, or max price, filter/rank by that preference first.
- For large result sets, sort and deduplicate compact normalized options rather than raw solution payloads.
- Regardless of ranking goal, when the same flight combination, route, departure time, and arrival time is returned with multiple fare options, display only the lowest sellable fare option for that itinerary.
- Keep the displayed price and internal `solutionId` / `orderKey` bound to that lowest fare option. Do not use a higher-priced duplicate because it appeared earlier in raw `solutions` or because a grouped itinerary reused the wrong index.
- Show multiple fare options for the same itinerary only when the user explicitly asks to compare fare products, rules, or cabin/fare-code differences.

## Fare Brand Presentation

Use this section when the API returns fare product fields such as `brandCode` or
when the user explicitly asks to compare fare products, fare rules, or the
difference between multiple prices for the same itinerary.

- Display `brandCode` as `票价产品`, not only as `品牌`.
- Display known fare brand codes as readable product labels:
  - `BAS` -> `BAS（基础产品）`
  - `FLE` -> `FLE（灵活产品）`
- If the meaning of a fare brand code is not confirmed, show the code and say
  benefits are based on the returned baggage, refund/change, and price fields.
  Do not invent benefits.
- For the same flight and same cabin with multiple fare products, highlight the
  real returned differences: price, checked baggage, refund/change rules, or
  other returned benefits.
- Ordinary lowest-price search still displays only the lowest fare for an
  itinerary. Show multiple fare products for the same itinerary only when the
  user explicitly asks to compare fare products, fare rules, cabin/fare-code
  differences, or a screenshot shows multiple product choices.
- Recommended comparison columns:
  `方案 | 票价产品 | 航班 | 舱位 | 价格 | 托运行李 | 主要差异`

## Large Result Handling

- Ordinary search must request `maxResultCount: 50` by default and show Top 5 results. If the user asks for more, show the next compact batch, up to 10 options per reply.
- Complex searches such as round trips, date ranges, and multi-airport expansion must apply `maxResultCount` to every shopping request, keep only each request's local Top 3-5 compact options, then merge those compact candidates.
- If more normalized candidates exist after the displayed list, say that more options are available and invite filtering or the next batch.
- Preserve the private mapping from displayed option number to the exact compact option's `solutionId`, `orderKey`, route, flights, and price.

## Selected Option Tracking

Every displayed option number must stay bound to the same internal solution object
that produced the displayed route, times, cabin, and price.

- If options are sorted, filtered, grouped, or deduplicated before display, build a
  `displayOptionNumber -> solutionId -> route/time/price` mapping from the final
  displayed list.
- When the user selects an option, verify only the `solutionId` from that display
  mapping. Do not use the original raw `solutions[index]` after the list has been
  reordered or filtered.
- Before verification, restate the selected displayed option using flight numbers,
  route, times, transfer count, and search price. Keep `solutionId` hidden.
- If verification returns details that match a different displayed option, stop and
  re-verify using the correct display mapping before continuing.

## Flight Time Presentation

When presenting flight search, pricing, verification, order confirmation, or
change options, show departure, arrival, and duration as separate readable values.

- Write departure and arrival with dates, for example `6/10 02:35 出发 -> 6/10 21:35 到达`.
- If arrival is on a later date, show the full arrival date and add `次日` when appropriate, for example `6/16 19:25 出发 -> 6/17 13:30 到达（次日）`.
- Show total duration separately, for example `总时长 18h05m`.
- Do not use `+1` as the only cross-day indicator.
- Do not use time-only ranges such as `02:35-21:35` when dates are available.
- In tables, must use separate columns for `起飞`, `到达`, and `时长`.
- Do not merge departure and arrival into a single `出发` column in tables. Only
  use a combined `起飞 -> 到达` phrase in prose paragraphs, not tabular output.

## Known-Flight Pricing Workflow

Use when the user supplies known flight numbers instead of asking for general search.

1. Collect flight number, origin, destination, date, cabin, journey index, and passenger counts.
   If the user does not specify a cabin, default `cabinClass` to `economy`; map "economy cabin" / "经济舱" to `economy`, not fare bucket shortcuts such as `Y`.
2. Call `pricing`.
3. Present priced options using the Flight Time Presentation rules.
4. Keep returned `solutionId` internal and verify before booking.

## Verification Workflow

Verification is mandatory before collecting passenger identity details or creating an order.

1. Call `POST /openapi/v3/flight/solutions/{solutionId}/verification` with the
   selected displayed option's `solutionId` in the path and this body shape:
   `{"solutionId":"...","passengerCount":{"adult":1,"child":0,"infant":0}}`.
   Always use `passengerCount: { adult, child, infant }`; explicitly pass
   `child: 0` and `infant: 0` when the user did not specify children or
   infants. Do not use `passengers` in verification requests. `passengers`
   belongs to shopping/create-order style payloads, not verification.
2. Compare returned route, times, cabin, and price against the selected displayed option, not the original raw array index. Use the Flight Time Presentation rules when describing any differences.
3. If changed materially, ask the user to accept the new option and price before proceeding.
4. Store the returned `orderKey` as the only order key to use for creation.
5. Collect passenger and contact details only after the user confirms they want to book.

## Passenger Collection

Collect fields required by the chosen fare and create-order schema:

- Passenger: surname, given names, gender, birthday, passenger type, nationality
- Document: travel document type, number, and expiry date when applicable
- Contact: region/country code and phone; email when available
- Optional frequent flyer: airline and card number

Do not collect identity details during search-only conversations.

## International Passenger Collection Template

For international flights, collect passenger and contact details with this fixed
template only after verification succeeds and the user confirms they want to
book. Passenger phone and passenger email are optional. Contact name, contact
email, and contact phone are required before creating the order.

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

## Create Original Order

Before calling create order, show a concise confirmation:

- Flight route/date/time and passenger count
- Total price/currency if returned
- Contact name/phone, and email when required by the collection template or provided
- Statement that the order will be created

After explicit confirmation:

1. Build `externalOrderID` if the user has not supplied one, using a deterministic prefix plus timestamp.
2. Call `create_order` with verified `orderKey`, passengers, contact fields, `externalOrderID`, and `currency`.
3. Summarize order status and payment deadline if returned.
4. Keep `orderID` internal but store it for payment and lookup.

## Payment

The generated OpenAPI defines `POST /openapi/v3/flight/orders/{orderID}/payment` without a request body.

Before payment, confirm:

- Which order will be paid
- Total amount/currency if returned by order detail
- That the user explicitly wants to pay now

After explicit confirmation:

1. Call `pay_order(order_id)` with no body unless newer production docs require one.
2. Call `get_order(order_id)` to confirm status.
3. Summarize payment/order status without exposing ticket numbers or PNR.

## Order Lookup

Use `get_order(order_id)` when an internal order ID is known.

Use `get_order_by_external_id(external_order_id)` when resuming from a buyer-side idempotency key.

Use `list_orders` only as an optional fallback because the generated OpenAPI marks it as not currently mounted.

## Error Handling

- If the envelope `code` is not `0`, summarize `message` or `realMessage` without dumping raw JSON.
- If verification fails, return to search/pricing.
- If order creation fails after verification, do not reuse stale `orderKey`; verify again before retrying.
- If payment fails, query order detail before telling the user whether the order remains unpaid, pending, or changed.
