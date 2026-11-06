# Hays + Sons Team Messaging

React, TypeScript and Vite workspace for channels, direct and group messages, search, threads, reactions, unread counts, and message editing/deletion. The backend is a separate Google Apps Script project with its own Google spreadsheet. Any valid email address can be used as a username; Apps Script checks the password against the `Users` sheet and issues a 12-hour session. Anyone can create an account with their name, email, and password and enter the shared company workspace immediately. Passwords are never stored in the frontend.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3001 and sign in with your email address and messaging password. If you do not have an account, choose **Create account**, enter your name, any valid email, and a password of at least 10 characters, and submit. Signup immediately signs you in. The app connects to the supplied Apps Script URL by default, including in a production build without `.env.local` or a hosting environment variable. A valid `VITE_APPS_SCRIPT_URL` can override that default for another deployment; missing, blank, malformed, or known retired company deployment overrides use the latest supplied URL. This is public connection information. Never put passwords or admin secrets in `VITE_*` variables.

Local preview accounts, messages, banners, and the preview entry point have been removed. Existing preview sessions, data, and drafts are cleared when the updated app opens. A newly initialized backend starts with empty tables: create your first channel after signing in. Existing Sheet accounts and conversations remain available.

## Chat spaces (local backend version 8.3)

Use **Add chat space** to create a channel for a project, crew, or topic. The same dialog offers private group messages and direct messages. Channels are shared with the whole workspace; group messages include only the selected teammates.

Open a space and choose **Manage** (the information button on mobile). Its creator or an administrator with access can choose **Delete chat space** and confirm **Delete for everyone**. Other group members can choose **Leave group**. Direct messages cannot be deleted for another person. Failed actions keep the space open and explain the error.

Deleting a channel or group removes it from navigation, message reads, search, unread counts, and queued push delivery for everyone. Existing history stays in the spreadsheet for retention, marked by the trailing `Conversations.DeletedAt` column. A deleted channel name can be reused; the replacement gets a new identifier and empty history. Leaving a group removes only the leaving member. Connected clients reconcile changes on the next workspace refresh; clients that are completely offline cannot receive remote deletions until reconnecting. Saved reads on a device are removed after a successful delete/leave or a workspace refresh that revokes access.

Publish the complete updated `apps-script/Code.gs` as a **new version of the existing messaging deployment** before using deletion with company data. Version 8.3 advertises `chat-space-management`. Seven-column conversation sheets upgrade without removing existing rows. These local changes do not update the live backend automatically. Older backends display an update-required error if deletion is attempted.

Outgoing messages and thread replies appear immediately with **Sending…**, and remain visible while switching conversations or closing/reopening a thread. You can continue composing while requests finish. Polling reconciles saved messages by author and client identifier so an early read cannot duplicate the pending bubble. A failed message stays visible with **Not sent** and **Retry sending**; retries reuse its identifier. Delivery state lasts for the signed-in workspace session; this is not a service-worker outbox that continues after the tab closes. Draft recovery remains available through session storage.

## Install on desktop or mobile

For Vercel hosting, follow [VERCEL.md](VERCEL.md). The same project can host the frontend and `/api/push`; the standalone Node relay is optional.

The production build is a Progressive Web App with a standalone manifest, desktop/Android PNG and maskable icons, an opaque Apple home-screen icon, and a service worker that saves the complete app shell. The **Install app** control appears on sign-in and in workspace navigation. Desktop Chrome/Edge and Android can use the native install prompt. On iPhone/iPad, open the HTTPS app in Safari and use **Share > Add to Home Screen**, then launch its home-screen icon.

Use a production build to test installation and offline support:

```powershell
npm run build
npm run preview
```

Open http://localhost:4174. Localhost is a development secure-context exception. For phone installation, publish the `dist` directory at a public **HTTPS** address; a plain LAN IP served by `npm run dev` does not enable service workers or push on phones. Host at the origin root, serve `/sw.js` as JavaScript with revalidation/no-cache, and serve the manifest with a webmanifest/JSON content type. Keep Vite's hashed assets immutable; retain old build assets during rollout for existing clients. No hosting deployment is performed automatically.

Updates are offered through an **Update app** banner and reload only after confirmation. Drafts remain in session storage. Safe-area padding, dynamic viewport heights, and responsive navigation support desktop, portrait/landscape phones, and tablets.

## Offline behavior and notifications

An installed or previously loaded production app can reload offline. IndexedDB saves only previously fetched workspace/message/thread reads, partitioned by backend and account. Successful edits/deletions/reactions update those saved reads. Offline access displays a clear banner; signing in, sending, and account changes require connectivity, and failed sends preserve their drafts. Sign-out or session expiry clears the account's saved reads. Session tokens are not saved in the offline database or service-worker cache.

The **Notifications** control includes message sounds, a **Test sound** button, and a separate opt-in for background notifications. Message sounds default on and unlock after a click or keypress; they chime when polling finds incoming messages while the app is running, including other conversations and thread replies. Initial history, your own messages, edits, and repeated polls stay quiet. Mute preferences are saved per account and backend on this device. Sounds work without a push relay, but cannot run after the browser closes or suspends the app.

Incoming messages also show an on-screen pop-up while signed in. Messages fetched for an open conversation include the sender and a short text preview; updates detected in other conversations show the conversation name and an unread notice. **Open conversation** takes you there without losing the draft in your previous chat. Pop-ups stay until opened or dismissed, keep only the newest alert per conversation, and show at most three conversations at once. They work independently of sound mute and do not require a browser notification permission or push relay. Previously loaded history, your own messages, repeated reads, and saved offline responses do not generate new pop-ups.

Background delivery uses native encrypted Web Push, a separate Node sender, and an Apps Script queue/one-minute trigger. Browser polling is not used to send background alerts. Conversation membership, read receipts, active accounts, and session ownership are checked by the backend; alerts contain generic text, not message bodies. Follow [push-service/README.md](push-service/README.md) to configure the relay. The current backend supports push, but its version alone does not confirm that sender credentials, tables, triggers, or provider delivery are configured. The notification settings show the backend's specific readiness reason and let you recheck it. **Test device alert**, available after opt-in, checks the device's notification display independently of the sender. System alerts request sound and vibration; the browser and OS decide what plays.

On iPhone/iPad, push requires an installed Home Screen app on iOS/iPadOS 16.4 or later and a direct user opt-in. The existing company sessions expire after 12 hours; notifications stop after session expiry/sign-out, and enabling them after signing in reconnects the device. OS settings and background restrictions can affect delivery. See [Apple's Web Push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

## Checks

```powershell
npm run build
npm run lint
npm test
npm run test:browser
```

`lint` checks TypeScript. Backend tests run the actual `apps-script/Code.gs` with in-memory Google service doubles; root `npm test` also runs push queue and relay tests. Root `npm install` installs the push-service workspace dependency. Authentication and messaging browser tests route requests through the same `Code.gs` using isolated accounts and spreadsheets. They cover signup with an empty frontend environment variable, any-email registration, immediate sign-in, duplicate accounts, rejected passwords, email normalization, sign-out, session expiry, old preview cleanup, empty workspace onboarding, and desktop/mobile messaging. PWA tests cover manifest/icons/install criteria, offline shell and saved messages, private-cache cleanup, explicit subscription controls, native service-worker notification display, notification navigation, and iPhone installation guidance. Tests do not create company accounts or send messages/notifications to real users. The browser configuration uses installed Microsoft Edge; change `channel` in `playwright.config.ts` if using another browser. Physical iPhone installation and provider-to-device push delivery still require verification on the published HTTPS app.

## Connect or update the messaging backend

1. Use a **separate messaging Apps Script project**, not the document app's project. Copy `apps-script/Code.gs` and `apps-script/appsscript.json` into that project.
2. Run `setupMessaging()` from the editor and approve its spreadsheet permissions. To use an existing messaging spreadsheet, set `MESSAGING_SPREADSHEET_ID` in Script Properties before running setup. Setup creates missing empty tables and preserves existing accounts, conversations, and messages; it never adds sample data. The spreadsheet ID is saved in Script Properties.
3. To provision the first administrator, temporarily add an editor-only wrapper calling `createUser('your-company-email', 'Your name', 'your-chosen-password', 'admin')`, run the wrapper, then remove it. Use at least 10 password characters. `createUser` is not available through HTTP requests.
4. Deploy a web app executing as **Me**, accessible to **Anyone**. App sessions control access to conversations. For an existing deployment, select **Manage deployments**, edit the messaging deployment, select a **new version**, and deploy to keep the same `/exec` URL. Editor changes alone do not update the deployed app.
5. The frontend already defaults to the supplied `/exec` URL. If you deploy to another URL, update `VITE_APPS_SCRIPT_URL` and restart development or rebuild for hosting.
6. Confirm the public URL returns `Hays + Sons Team Messaging`, version `8.2`, and `configured: true`. Create an account using any valid email address. For a fresh spreadsheet, create your first channel from the workspace welcome screen.

The local 8.2 backend caches database and sheet handles within each request, scans message metadata in batches for accurate unread counts across the full history, and flushes spreadsheet writes before releasing mutation locks. Read-receipt writes remain locked to prevent duplicate rows and backwards read markers during concurrent requests. Uploads and presence heartbeats remain outside the spreadsheet mutation lock. Existing table schemas, accounts, sessions, sales reporting, and push APIs are preserved. Publish a new Apps Script deployment version to use these changes; updating the local file does not update the live backend. Bootstrap still scans all message metadata, so its work grows with message history.

See [apps-script/README.md](apps-script/README.md) for the Users schema, first administrator setup, password resets, and a rollout checklist. Existing password hashes and account rows are compatible with this update. Messages gained a trailing `AttachmentJson` column; existing rows without it read as having no attachment, and new messages extend the sheet automatically. No password migration is required.

If Google returns HTML instead of JSON, the app identifies authorization pages, missing deployments, rate limits, and temporary service failures. Unknown responses include the action, HTTP status, and connected workspace URL without displaying Google's HTML or request credentials. Reads retry once for temporary or malformed responses; writes and sign-in never replay automatically. A failed send retains the draft and its identifier for a manual retry without duplicate messages. Google authorization pages require the deployment owner to check access and script authorization; changing the frontend cannot grant those permissions. A successful public status check alone does not establish authenticated workspace access.

Registration is open by default in backend version `8`. Set `REGISTRATION_MODE` in Script Properties to `disabled` to close signup, or to `invite` to advertise invite-only signup to clients; any value other than `disabled` keeps the register endpoint open. The older registration code and domain settings remain ignored. Existing accounts remain compatible.

The latest live URL supplied on October 6, 2026 was checked and reports backend version `8.2` with the `sales-aggregations`, `realtime-presence`, `drive-attachments`, `global-search`, `batch-pruning`, and `web-push-relay` features. Its registration endpoint confirms signup is enabled and advertises invite mode. The frontend source, local environment, environment example, and production build all use that updated URL. The default connection works even when hosting omits the environment variable. Publish the updated frontend build if your hosted app still uses a previous URL or shows the connection warning.

Backend version `6` fixes `enqueuePush_ is not defined` when sending messages. Optional notification failures cannot turn a saved message into a failed send; retries remain idempotent. The user-published live deployment now reports this version and feature. Sending checks use isolated test accounts and spreadsheets; they do not create messages in the company Sheet.

## Sales dashboard

The job list shows a three-line preview of each latest journal note, with **Read full note** opening the complete entry at the top of the job detail dialog. Search includes the readable note text. **Pending without notes** finds pending jobs with an empty or formatting-only note and follows the same estimator, date, and other filters. A missing note describes the source report; it does not prove that a customer has not been contacted. Paragraphs and common exported email entities display as plain text, and embedded markup is never executed.

Estimator/status and estimate/received details share columns so notes have more room. On phones and tablets, each row becomes a compact card with the note immediately below the customer. The four summary metrics remain visible; **Estimator & received trends** is collapsed below the job list until opened. This uses the existing latest-note field and requires no backend or spreadsheet changes. It does not add a communications history or note editing.

Choose **Sales dashboard** in the sidebar after signing in. It reads the supplied [estimator sales report](https://docs.google.com/spreadsheets/d/1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/edit) through the authenticated messaging Apps Script. The latest user-published backend reports version `8.2` with this feature, including server-side summaries and pagination, and the app uses its updated URL. The app explains the required update if it reaches an older backend. No separate Apps Script project or URL is required. The deployment owner needs read access to the source sheet; public status does not establish a successful authenticated report read.

The page keeps four headline metrics: pending jobs (with their entered estimate value), known estimate value (with the average entered estimate), missing estimates (with amount coverage), and pending jobs received 30+ days ago. **Quick view** narrows every metric and the job list to missing estimates, aging pending jobs, or unassigned jobs. Closed jobs are excluded from the aging follow-up count; the 30-day threshold measures age since receipt, not an overdue deadline.

Search, estimator, and received-date presets stay visible. **More filters** reveals division, actual job status, estimate availability, and custom received dates; its badge identifies active filters even when collapsed. Select an estimator summary or a month in **Jobs received** to filter the same view. The six-month chart counts received dates in the current report snapshot, with the current month only through the report date; it does not reconstruct historical pipeline or revenue. Estimator summaries include job counts, missing amounts, and aging pending jobs. Job details include the latest journal note and a link to its source row. **Refresh** reads current Sheet values and retains filters. Missing amounts are distinct from entered zeroes, which count toward coverage and the average. Only actual report statuses are used; the report does not supply close dates or a basis for revenue, win rate, quota attainment, or sales-cycle metrics.

The focused layout follows [HubSpot's sales dashboard guidance](https://www.hubspot.com/resources/templates/sales-dashboard) on keeping a small KPI set and [Salesforce's dashboard guidance](https://help.salesforce.com/s/articleView?id=sales.sales_insights_dashboard.htm&language=en_US&type=5) on trends, team performance, and opportunities needing attention, adapted to the fields this report actually provides.

The source sheet is never changed by the dashboard, and company sales rows are not bundled in the frontend or stored in the offline cache. Optional Script Properties `SALES_SPREADSHEET_ID` and `SALES_SHEET_NAME` select another sales source without changing the messaging database. See [apps-script/README.md](apps-script/README.md#sales-dashboard-version-81) for rollout and schema details.

If sales reports `unknown_action`, the backend reached by that page did not recognize `salesDashboard`. The error shows the actual connected workspace URL. A hosting environment or installed app may still be using a previous deployment even when the latest URL reports version 8.2. Current builds automatically replace the six retired company URLs supplied earlier in this conversation with the latest URL; unrelated intentional overrides remain supported. Publish the updated frontend and accept **Update app** if an installed copy is waiting for a new version. Sessions tied to a previous URL require signing in again. If the error comes from the latest URL, publish the complete `apps-script/Code.gs` to that deployment: the public version label alone cannot verify an authenticated sales read.

## Operation

Visible conversations and threads target a refresh every 2 seconds; workspace/unread information targets every 5 seconds. Request time counts toward that window rather than adding the entire interval after each response. Read receipts run separately so a slow acknowledgement cannot hold up receiving the next message, and locally confirmed read markers prevent an older workspace snapshot from restoring unread counts. These are refresh targets, not a delivery guarantee: Apps Script execution and network latency still apply.

Each poll runs only one request at a time. Hidden tabs slow to 15 seconds for open conversations and 30 seconds for workspace information. Failures and saved-read fallbacks back off up to 30 seconds; returning to the app or reconnecting requests an immediate refresh. Initially offline sessions can still load their saved reads. These changes require an updated frontend, with no new Apps Script action or deployment version. Closed-app background notification delivery continues to use the separate Web Push queue described above.

Failed sends retain their drafts and reuse their message identifier on retry. Drafts persist in the tab's session storage when switching conversations or reloading. Search applies to the selected conversation and includes thread replies. Channels are visible to all active teammates; direct and group conversations are restricted to their members, including when the user is an administrator.

For larger teams or high message volume, replace the spreadsheet backend with a database and subscription service. No external deployment or company data mutations are performed by the test suite.
