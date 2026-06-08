# Flight Post-Sale Workflows

Use this reference for cancellation, refund, and change operations. These are business-sensitive write flows and require explicit confirmation before write calls.

## Shared Rules

- Start from `get_order(order_id)` whenever possible.
- Use returned `passengers[].id` and `journeys[].segments[].id` internally for refund/change.
- Never show PNR or ticket numbers in ordinary user-facing replies.
- Ask the user which passengers and segments to affect using names, dates, routes, and flight numbers, not raw IDs.
- Reasons are strings in this OpenAPI. Preserve user wording in `reasonDetail` when helpful.
- If a supporting document is needed for schedule change, illness, death, or other special handling, collect `fileList` URLs before the write request.

## Fare Rule Presentation

When presenting `fareRules.refund` and `fareRules.change`, use the API map's
time-key mapping. Do not guess from the literal signs `<0` / `>0`.

- Fixed table columns: `规则 | 起飞前 | 起飞后`
- `refund[">0"]` is 起飞前退票费; `refund["<0"]` is 起飞后退票费.
- `change[">0"]` is 起飞前改签费; `change["<0"]` is 起飞后改签费.
- If a field is missing, show only the value returned by the API and do not
  invent an amount.
- `canVoid` means whether voiding is permitted. Do not merge it into refund or
  change fee rows.

## Cancellation

Cancellation is for an existing order, commonly before final ticketing or when cancellation is permitted.

1. Query order detail.
2. Check returned status, `isVoidPermitted`, and `lastVoidTime` if present.
3. Confirm the cancellation action with the user.
4. Call `cancel_order(order_id)`.
5. Query or summarize returned order status.

## Refund Availability and Amount

Optional APIs may not be mounted:

- `refund_change_availability`
- `refund_money_search`

Use them when available. If they fail due to route-not-found, fall back to order detail and fare rules if returned, and state that the API did not return a refund quote.

## Create Refund Order

1. Query order detail.
2. Identify passengers and segments to refund.
3. Optionally call `refund_money_search` with `passengerIds`, `segmentIds`, `reason`, and `reasonDetail`.
4. Show any returned refund amount, refund fee, service fee, and currency.
5. Confirm the refund request with the user.
6. Build the create-refund body with `passengerIds`, `segmentIds`, and
   `reasonType`. `reasonType` must be `voluntary` or `involuntary`. Do not use
   `reason` in create-refund requests. Put user-facing explanation text in
   `reasonDetail` when provided.
7. Call `create_refund_order(order_id, body)`.
8. Summarize returned refund order status.

## Confirm Refund Order

Use when the refund flow requires a second confirmation after review.

1. Query the refund order detail if available.
2. Confirm the exact refund confirmation action with the user.
3. Call `confirm_refund_order(order_id)`.
4. Summarize returned status.

## Change Search

1. Query the original order.
2. Identify passenger(s), original segment, preferred new date, and cabin.
3. Call `change_search(order_id, body)`.
4. Present user-safe change options using the Flight Time Presentation rules from `flight-workflows.md`: route, departure, arrival, duration, cabin, price difference and service fee when returned.
5. Keep `solutionId` internal. Filter out any change-search option whose
   `solutionId` is missing, `null`, or an empty string. Only options with a
   non-empty string `solutionId` may be shown as selectable change options.
   Invalid options may be summarized as diagnostics, but the user must not be
   allowed to select them for change creation.

## Create Change Order

1. User selects a change option from change search.
2. Build `solutionIds` from the selected internal option. `solutionIds` must be
   a non-empty array, and every value must be a non-empty string. Do not call
   `create_change_order` when there is no valid `solutionId`; tell the user that
   no change order was created because the API did not return a valid change
   option ID, and suggest backend/API support or refund/cancel plus new booking
   when that fallback is available.
3. Build `passengerIds` from selected passengers.
4. Build the body with the documented fields only: `solutionIds`, `passengerIds`,
   `reason`, optional `oldJourneyIndex`, `fileList`, `reasonDetail`, and contact
   fields when available. Do not invent alternate field names or retry with
   speculative payload shapes.
5. Confirm the change request, including any price difference, service fee, affected passengers, and new itinerary.
6. Call `create_change_order(order_id, body)` once with the confirmed payload.
7. If the API returns `Parameters error`, missing business fields, or repeated
   parameter validation failures after a documented payload, stop retrying
   speculative variants. Explain that the API did not accept the documented
   change-order payload, keep internal IDs hidden, and offer the user a safe
   fallback such as refund/cancel plus new booking when refund/cancel is allowed.
8. Summarize returned change order status if successful.

## Change Failure Fallback

When change search can find options but create change order is not accepted by
the API, do not present the result as a completed change. Summarize:

- The selected original order and new itinerary in user-safe terms.
- The returned business error message, such as `Parameters error`.
- That no change order was created.
- The fallback choices available from read data: try another change option,
  request backend/API support, or refund/cancel and create a new booking after
  explicit confirmation.

Only recommend refund/cancel plus new booking when the API returned refund or
cancel permissibility, refund quote, or other evidence that the fallback is
available. Do not execute refund, cancel, or new booking without the separate
write-operation confirmations required by this skill.

## Fare Rules

`fare_rules` is optional because it is marked as not mounted. Prefer fare rules returned by shopping, pricing, verification, or order detail. Call the standalone fare-rules endpoint only when needed and degrade gracefully if unavailable.
