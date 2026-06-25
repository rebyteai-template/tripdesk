# Flight Payment

Use this reference for paying an existing Simplifly flight order. Order creation and lookup live in `flight-booking.md`; endpoint details live in `api-map.md`; user-facing redaction lives in `output-rules.md`.

## Payment Preconditions

- Payment is a write operation and requires explicit user confirmation.
- Use order detail when available before payment so the confirmation can include current status, amount, currency, and deadline if returned.
- For `origin` and `change` orders, treat returned `lastActionTime` as the payment deadline. If it is missing, say the latest payment time was not returned.
- Show `externalOrderId` / `externalOrderID` as `订单号` when returned. If no external order reference is returned, or if the user explicitly asks for the order number needed for payment/support, show `orderID` as `平台订单号`.
- Do not expose ticket numbers or PNR before or after payment.

## Payment Workflow

The generated OpenAPI defines `POST /openapi/v3/flight/orders/{orderID}/payment` without a request body.

1. Query or use the latest known order detail.
2. Confirm which order will be paid, total amount/currency if returned, payment deadline from `lastActionTime` for origin/change orders when returned, and that the user explicitly wants to pay now.
3. After explicit confirmation, call `pay_order(order_id)` with no body unless newer production docs require one.
4. Call `get_order(order_id)` after payment to confirm status.
5. Summarize payment/order status in user-safe wording.

## Payment Failure Handling

- A failed `pay_order` tool result is still valid current-turn evidence. If the response says payment failed, balance is insufficient, or 扣款未完成, report `支付失败` with the safe returned reason instead of asking the user to resend the payment request.
- Do not call `balance` automatically after payment failure unless the user explicitly asks for balance/account diagnostics. The `pay_order` failure result is enough to tell the user payment did not complete.
- Keep the failure reply narrow: show payment result, safe reason/message, and returned order reference if already present. Do not add order status/details unless `get_order` returned them in the same turn.
- If payment fails, query order detail before telling the user whether the order remains unpaid, pending, expired, cancelled, or changed.
- If the API response lacks payment status, deadline, or ticketing data, say it was not returned.
- Do not retry payment automatically after an ambiguous response without asking for explicit confirmation again.
