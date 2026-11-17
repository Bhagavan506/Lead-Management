# WhatsApp reminders

> **Status: the Meta provider has NOT been verified against the live WhatsApp Cloud API.** It is tested against a local simulation (`apps/api/src/test/fake-meta.ts`). Use the mock provider until you complete the go-live checklist below.

## Providers

`WHATSAPP_PROVIDER=mock` (default) records messages in the reminder log without sending anything. `meta` sends through the WhatsApp Cloud API.

## Message template

Reminders are sent outside the 24-hour customer window, so Meta requires an approved **template**. Create a utility template with one body and three variables:

```
Hi {{1}}, you have {{2}} due today or overdue: {{3}}. Open Leadbook to update them.
```

- `{{1}}` employee first name, `{{2}}` count (e.g. "3 leads"), `{{3}}` up to 5 lead names then "and N more" (names cut at 40 characters, single line, no phone numbers).
- Template name goes in `WHATSAPP_TEMPLATE_NAME`; language in `WHATSAPP_TEMPLATE_LANG` (default `en`) and it must match the approved language.

## Environment

| Variable                                            | Purpose                                                        |
| --------------------------------------------------- | -------------------------------------------------------------- |
| `WHATSAPP_PHONE_NUMBER_ID`                          | Sender phone number id                                         |
| `WHATSAPP_ACCESS_TOKEN`                             | Permanent system-user token with `whatsapp_business_messaging` |
| `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG` | Approved template                                              |
| `WHATSAPP_APP_SECRET`                               | Meta app secret, used to verify webhook signatures             |
| `WHATSAPP_VERIFY_TOKEN`                             | Any random string you choose; entered in Meta's webhook setup  |
| `WHATSAPP_API_BASE`                                 | Defaults to `https://graph.facebook.com/v21.0`                 |

With `meta`, the app refuses to start unless the five credentials are set.

## Delivery webhook

Callback URL: `https://<your-api-host>/webhooks/whatsapp`, with the verify token above, subscribed to the `messages` field. Requests are accepted only with a valid `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with the app secret). Statuses only move forward (sent, delivered, read); `failed` applies only to messages not yet delivered. The route does not exist when either secret is unset.

## Behaviour to know

- Each send is attempted once; failures are logged as FAILED and the scheduled job does not retry them that day.
- At most one scheduled reminder per employee per day; manual "Send now" has a 60 s per-employee cooldown.
- The reason for a failed send appears only in server logs.
- Employees without a valid phone number are skipped and counted as `noPhone`.

## Go-live checklist (all unverified)

1. Template approved in WhatsApp Manager, name/language match env.
2. Send one reminder to your own number via Admin, Reminders, Send now. Confirm it arrives and the log shows SENT.
3. Webhook verified in Meta (handshake succeeds), then confirm the log moves to DELIVERED/READ.
4. Confirm a deliberately bad token produces a FAILED row and a server log line, not a crash.
5. Check Meta's rate and tier limits against your team size.
