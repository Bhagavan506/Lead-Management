# Push notifications

Employees get browser push notifications instead of (or as well as) WhatsApp messages: the daily follow-up reminder, and a notice when the admin assigns them leads. No third-party account is needed.

## Set up

1. Create a key pair (once; keep the private key secret):
   ```
   pnpm --filter @leadbook/api push:keys
   ```
2. Put the three lines it prints in `.env`, and set `VAPID_SUBJECT` to a real contact address (`mailto:...`).
3. Set `WHATSAPP_PROVIDER=push` to deliver the daily reminder by push. (Leave it `mock` to only get "lead assigned" notices; they work whenever the keys are set.)
4. Restart the API.

Changing the keys later invalidates every registered device: employees have to turn notifications on again.

## How an employee turns it on

Follow-ups screen, **Notifications** panel, **Turn on notifications**, then allow the browser prompt. Use **Send me a test** to check it. This registers that browser only; use the same button on each phone or laptop.

- **Android / desktop Chrome, Edge, Firefox:** works in the browser.
- **iPhone / iPad (iOS 16.4+):** Safari only delivers pushes to a web app added to the Home Screen (Share, then Add to Home Screen). Open it from there and turn notifications on.
- The site must be on HTTPS (or `localhost` while developing).

## What gets sent

| When                                                  | Title                                             | Opens      |
| ----------------------------------------------------- | ------------------------------------------------- | ---------- |
| Daily, at the admin's reminder time                   | "Follow-ups due: N follow-ups", names in the body | Follow-ups |
| Admin assigns, uploads with an owner, or auto-assigns | "New lead assigned" / "N new leads assigned"      | My leads   |

Admins do not receive pushes. Notifications are kept by the push service for up to 12 hours if the device is off.

## Behaviour to know

- An employee with a follow-up due but **no registered device** is skipped and reported ("No device with notifications on") without using up their reminder for the day, so turning it on later the same day still works.
- At most one scheduled reminder per employee per day, as before. A failed send is recorded as FAILED; the admin can press **Send all due now**.
- A device the push service reports as gone (404/410) is removed automatically.
- "Lead assigned" notices are best effort: if one cannot be sent, the assignment still succeeds and nothing is retried.
- There are no delivery or read receipts, only "accepted by the push service".
