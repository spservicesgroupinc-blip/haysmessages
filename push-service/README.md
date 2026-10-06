# Hays + Sons background notifications

This optional Node service sends encrypted native Web Push notifications using `web-push`. The messaging Apps Script stores subscriptions and a durable delivery queue in its own spreadsheet. A one-minute Apps Script trigger calls this service. No browser tab needs to remain open, subject to browser/device support and operating-system notification settings.

The frontend and relay require HTTPS in production. The relay should run behind HTTPS on a Node 22+ host. No deployment is performed by this repository.

For **Vercel**, use the repository-root project and the included `api/push.mjs` function. Follow [VERCEL.md](../VERCEL.md), set the same environment variables in Vercel, and set the Apps Script relay URL to `https://YOUR-STABLE-DOMAIN/api/push`. `GET /api/push` is its health endpoint; no long-running Node server or separate hosting project is needed. The standalone server below remains available for other hosts.

## Configure the relay

From `push-service`:

```powershell
npm ci
npm run keys
```

The key generator creates a private, ignored `.env` file and refuses to overwrite existing keys. It does not print secrets. Open that file privately, replace `VAPID_SUBJECT` with a real administrator contact (`mailto:you@company.com`), and configure its four variables in the server's secret/environment settings:

| Variable | Purpose |
| --- | --- |
| `VAPID_PUBLIC_KEY` | Browser application server key; also set in Apps Script |
| `VAPID_PRIVATE_KEY` | Relay only; never put in frontend or Apps Script properties |
| `VAPID_SUBJECT` | Real administrator `mailto:` contact |
| `PUSH_RELAY_SECRET` | Shared relay authentication secret; also set in Apps Script |
| `PORT` | Optional listening port, defaults to `3002` |

Start with `npm start`. Expose the service through HTTPS. `GET /health` returns readiness and the public key only. `POST /push` accepts authenticated batches from Apps Script; it has no browser-facing API and needs no CORS permissions. Keep the same VAPID keys across deployments. Rotating the public key requires each device to enable notifications again.

## Configure the messaging Apps Script

1. Update only the dedicated messaging Apps Script project using this repository's `apps-script/Code.gs` and `apps-script/appsscript.json`. The manifest adds `script.external_request` and `script.scriptapp` scopes to permit relay calls and trigger installation.
2. In Project Settings > Script Properties, set `VAPID_PUBLIC_KEY`, `PUSH_RELAY_SECRET`, and `PUSH_RELAY_URL` (the relay's full HTTPS URL ending in `/push`). Keep `MESSAGING_SPREADSHEET_ID` pointed at the messaging database.
3. Run `setupPushMessaging()` in the Apps Script editor and authorize its added scopes. It creates `PushSubscriptions` and `PushQueue` and exactly one `deliverPushQueue` minute trigger. Running it again preserves data and does not add duplicate triggers.
4. Update the existing messaging web app deployment to use the new version, retaining the frontend's existing Apps Script URL. Check Triggers/Executions to confirm `deliverPushQueue` runs successfully.
5. Sign in on the device and use the app's notifications control. On iPhone/iPad use the installed Home Screen app on iOS/iPadOS 16.4 or newer, and grant permission through that control. On desktop/Android grant permission in a supported browser.

The UI reports notifications as unavailable until configuration, optional tables, and the trigger exist. This setup never modifies another app's database or Apps Script project.

## Diagnose missing or silent alerts

1. Open **Notifications > Test sound** in the app. This tests the chime while the app is open and works even if the background service is not configured. Check device volume and browser tab mute if the test is silent. Message sound preferences are separate from background opt-in.
2. Read the **Background notifications** status in the same dialog. It reports the actual backend readiness reason. Missing credentials require the relay configuration above; missing tables or a trigger require `setupPushMessaging()`. Use **Check background delivery again** after correcting setup.
3. After enabling notifications, choose **Test device alert**. This verifies the device's notification permission and display; it does not send through Apps Script or the relay. The app requests audible alerts, but OS notification sound permissions, Focus/Do Not Disturb, and device volume still control sound.
4. If that test works but closed-app messages never arrive, verify `GET /api/push` (Vercel) or `GET /health` (standalone) reports `enabled: true` and its public key matches Apps Script. Check the `deliverPushQueue` trigger's Executions for authorization/relay failures. Use two signed-in accounts, enable the recipient's device, close its app, send from the other account, and allow at least one minute for delivery. Sessions expire after 12 hours and must reconnect after signing in again.

The source and automated checks cannot confirm a particular live device or relay without its hosted app address and access to its configuration. No company accounts or notifications are created by automated tests.

## Delivery and security

- Subscriptions are bound to a user and the current authenticated messaging session. The existing sessions last **12 hours**. After expiry, sign in again and enable/reconnect notifications. Logout revokes that session's subscriptions. This service does not lengthen account access.
- New messages queue notifications only for subscribed conversation members, excluding the sender. Channel subscriptions can receive all company channel messages. Threads also notify conversation members. Deleted messages, read receipts, inactive users, expired/revoked sessions, replaced device ownership, and changed public keys suppress pending notifications.
- Delivery starts on the next minute trigger, so expect roughly a minute of delay, sometimes longer due to Apps Script/browser scheduling or retries. A run attempts at most 50 device deliveries. Transient errors retry with exponential backoff for at most five attempts per device; jobs expire after 24 hours. Successful recipients are removed from the queue and expired endpoints (`404`/`410`) are removed from subscriptions. A transport timeout after provider acceptance can cause an additional delivery; notifications share a conversation tag and Web Push topic to collapse updates.
- Notification text is always “You have a new team message.” Only conversation/message identifiers are attached. Message bodies, author names, passwords, and app session tokens are never sent to the relay or notification provider.
- The relay authenticates the shared secret with a constant-time digest comparison. Outbound endpoints are limited to official Google, Mozilla, Apple, and Microsoft push-provider hosts, with HTTPS, valid subscription key shapes, request limits, bounded concurrency, and timeouts. Private keys and secrets are never printed by the service.
- A subscription limit of 10 devices per user prevents uncontrolled device registration. Delivery and Apps Script URL-fetch/trigger quotas still apply. Review the dedicated project's execution history and quotas as usage grows.
- Browser permission is requested only from the user's explicit action. The operating system may delay or suppress delivery, and some browsers require background operation to be enabled.

## Verify before rollout

```powershell
npm test
```

From the repository root, `node --test scripts/push-backend.test.cjs` verifies optional setup, authenticated subscription ownership, session cleanup, conversation filtering, read/delete suppression, retry idempotency, and endpoint pruning. Relay tests exercise authentication, confidentiality, provider restrictions, bounds, and delivery classification using an injected sender.

After deployment, use two real accounts/devices: enable notifications for the recipient, close the app, send a new message from the other account, and wait for the minute trigger. Confirm the notification opens the intended conversation after sign-in. Repeat while actively reading the conversation (suppressed), after logout (suppressed), and on a Home Screen iPhone/iPad. These real-device checks require a configured HTTPS deployment and real browser push subscriptions; unit tests do not demonstrate live delivery.

References: [Node Web Push library](https://github.com/web-push-libs/web-push), [Google Apps Script installable triggers](https://developers.google.com/apps-script/guides/triggers/installable), [Apple Web Push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
