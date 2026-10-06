# Hays + Sons Team Messaging

React, TypeScript and Vite workspace for channels, direct and group messages, search, threads, reactions, unread counts, and message editing/deletion. The backend is a separate Google Apps Script project with its own Google spreadsheet. Any valid email address can be used as a username; Apps Script checks the password against the `Users` sheet and issues a 12-hour session. Anyone can create an account with their name, email, and password and enter the shared company workspace immediately. Passwords are never stored in the frontend.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3001 and sign in with your email address and messaging password. If you do not have an account, choose **Create account**, enter your name, any valid email, and a password of at least 10 characters, and submit. Signup immediately signs you in. The app connects to the supplied Apps Script URL by default, including in a production build without `.env.local` or a hosting environment variable. A valid `VITE_APPS_SCRIPT_URL` can override that default for another deployment; missing, blank, malformed, or known retired company deployment overrides use the latest supplied URL. This is public connection information. Never put passwords or admin secrets in `VITE_*` variables.

Local preview accounts, messages, banners, and the preview entry point have been removed. Existing preview sessions, data, and drafts are cleared when the updated app opens. A newly initialized backend starts with empty tables: create your first channel after signing in. Existing Sheet accounts and conversations remain available.

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
6. Confirm the public URL returns `Hays + Sons Team Messaging`, version `7`, `configured: true`, and `registrationMode: open`. Create an account using any valid email address. For a fresh spreadsheet, create your first channel from the workspace welcome screen.

See [apps-script/README.md](apps-script/README.md) for the Users schema, first administrator setup, password resets, and a rollout checklist. Existing password hashes and account rows are compatible with this update. No new column or password migration is required.

Registration is always open in backend version `5` and later. Previous registration mode, code, and domain settings are ignored. Existing accounts remain compatible.

The latest live URL supplied on October 6, 2026 was checked and reports backend version `7`, `configured: true`, and `registrationMode: open`, including the `sales-dashboard` and `optional-push-on-send` features. Its registration endpoint confirms signup is enabled without invitations. The frontend source, local environment, environment example, and production build all use that updated URL. The default connection works even when hosting omits the environment variable. Publish the updated frontend build if your hosted app still uses a previous URL or shows the connection warning.

Backend version `6` fixes `enqueuePush_ is not defined` when sending messages. Optional notification failures cannot turn a saved message into a failed send; retries remain idempotent. The user-published live deployment now reports this version and feature. Sending checks use isolated test accounts and spreadsheets; they do not create messages in the company Sheet.

## Sales dashboard

Choose **Sales dashboard** in the sidebar after signing in. It reads the supplied [estimator sales report](https://docs.google.com/spreadsheets/d/1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/edit) through the authenticated messaging Apps Script. The latest user-published backend reports version `7` with this feature, and the app uses its updated URL. The app explains the required update if it reaches an older backend. No separate Apps Script project or URL is required. The deployment owner needs read access to the source sheet; public status does not establish a successful authenticated report read.

The page shows pending jobs, known estimate value, missing estimates, job aging, estimator totals, and a paginated job table. Filter by estimator, division, status, received dates, entered/missing estimate, or job/customer/carrier text. Job details include the latest journal note and a link to its source row. **Refresh** reads current Sheet values. Missing amounts are not treated as entered zeroes, and estimate totals are not booked revenue. Only the Sheet's actual statuses are used; the report does not supply close dates or a basis for a conversion rate.

The source sheet is never changed by the dashboard, and company sales rows are not bundled in the frontend or stored in the offline cache. Optional Script Properties `SALES_SPREADSHEET_ID` and `SALES_SHEET_NAME` select another sales source without changing the messaging database. See [apps-script/README.md](apps-script/README.md#sales-dashboard-version-7) for rollout and schema details.

If sales reports `unknown_action`, the backend reached by that page did not recognize `salesDashboard`. The error shows the actual connected workspace URL. A hosting environment or installed app may still be using a previous deployment even when the latest URL reports version 7. Current builds automatically replace the three retired company URLs supplied earlier in this conversation with the latest URL; unrelated intentional overrides remain supported. Publish the updated frontend and accept **Update app** if an installed copy is waiting for a new version. Sessions tied to a previous URL require signing in again. If the error comes from the latest URL, publish the complete `apps-script/Code.gs` to that deployment: the public version label alone cannot verify an authenticated sales read.

## Operation

Open conversations refresh every 8 seconds and workspace/unread information every 15 seconds. Background notification delivery uses the separate Web Push queue described above. Failed sends retain their drafts and reuse their message identifier on retry. Drafts persist in the tab's session storage when switching conversations or reloading. Search applies to the selected conversation and includes thread replies. Channels are visible to all active teammates; direct and group conversations are restricted to their members, including when the user is an administrator.

For larger teams or high message volume, replace the spreadsheet backend with a database and subscription service. No external deployment or company data mutations are performed by the test suite.
