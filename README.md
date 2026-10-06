# Hays + Sons Team Messaging

React, TypeScript and Vite workspace for channels, direct and group messages, search, threads, reactions, unread counts, and message editing/deletion. The backend is a separate Google Apps Script project with its own Google spreadsheet. Company email is the username; Apps Script checks the password against the `Users` sheet and issues a 12-hour session. The app requires a company account and loads only that account's workspace data. Passwords are never stored in the frontend.

## Run locally

```powershell
npm install
npm run dev
```

Open http://localhost:3001 and sign in with your company email address and messaging password. If you do not have an account, choose the **Create account** button below Sign in and use your administrator's company invite code. This button is always visible, including while account settings are loading or unavailable. Apps Script enforces the company's registration settings when the form is submitted. The supplied Apps Script URL is configured in the ignored `.env.local` file. Restart Vite after changing environment variables. The URL is public frontend configuration; never put passwords, invite codes, or admin secrets in `VITE_*` variables. An unconfigured app shows a disabled sign-in form and an administrator contact message.

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

The **Notifications** control explicitly opts a device in or out. Background delivery uses native encrypted Web Push, a separate Node sender, and an Apps Script queue/one-minute trigger. Browser polling is not used to send background alerts. Conversation membership, read receipts, active accounts, and session ownership are checked by the backend; alerts contain generic text, not message bodies. Follow [push-service/README.md](push-service/README.md) to configure the relay and update the dedicated messaging deployment. The supplied version-1 backend has not been modified, so live push remains unavailable until this setup is completed. The control reports that state rather than pretending notifications are enabled.

On iPhone/iPad, push requires an installed Home Screen app on iOS/iPadOS 16.4 or later and a direct user opt-in. The existing company sessions expire after 12 hours; notifications stop after session expiry/sign-out, and enabling them after signing in reconnects the device. OS settings and background restrictions can affect delivery. See [Apple's Web Push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).

## Checks

```powershell
npm run build
npm run lint
npm test
npm run test:browser
```

`lint` checks TypeScript. Backend tests run the actual `apps-script/Code.gs` with in-memory Google service doubles; root `npm test` also runs push queue and relay tests. Root `npm install` installs the push-service workspace dependency. Authentication and messaging browser tests route requests through the same `Code.gs` using isolated accounts and spreadsheets. They cover rejected passwords, email normalization, invite registration, sign-out, session expiry, old preview cleanup, empty workspace onboarding, and desktop/mobile messaging. PWA tests cover manifest/icons/install criteria, offline shell and saved messages, private-cache cleanup, explicit subscription controls, native service-worker notification display, notification navigation, and iPhone installation guidance. Tests do not create company accounts or send messages/notifications to real users. The browser configuration uses installed Microsoft Edge; change `channel` in `playwright.config.ts` if using another browser. Physical iPhone installation and provider-to-device push delivery still require verification on the published HTTPS app.

## Connect or update the messaging backend

1. Use a **separate messaging Apps Script project**, not the document app's project. Copy `apps-script/Code.gs` and `apps-script/appsscript.json` into that project.
2. Run `setupMessaging()` from the editor and approve its spreadsheet permissions. To use an existing messaging spreadsheet, set `MESSAGING_SPREADSHEET_ID` in Script Properties before running setup. Setup creates missing empty tables and preserves existing accounts, conversations, and messages; it never adds sample data. The spreadsheet ID and generated invite code are saved in Script Properties.
3. To provision the first administrator, temporarily add an editor-only wrapper calling `createUser('your-company-email', 'Your name', 'your-chosen-password', 'admin')`, run the wrapper, then remove it. Use at least 10 password characters. `createUser` is not available through HTTP requests.
4. Deploy a web app executing as **Me**, accessible to **Anyone**. App sessions control access to conversations. For an existing deployment, select **Manage deployments**, edit the messaging deployment, select a **new version**, and deploy to keep the same `/exec` URL. Editor changes alone do not update the deployed app.
5. Set `VITE_APPS_SCRIPT_URL` in `.env.local` to the `/exec` URL. Copy `.env.example` if configuring a new checkout. Restart `npm run dev`, or rebuild for hosting.
6. Confirm the public URL returns `Hays + Sons Team Messaging`, version `4`, `configured: true`, and `usernameType: email`. Sign in using a provisioned account, or create a member account with the invite code from Script Properties. For a fresh spreadsheet, create your first channel from the workspace welcome screen.

See [apps-script/README.md](apps-script/README.md) for the Users schema, first administrator setup, password resets, and a rollout checklist. Existing password hashes and account rows are compatible with this update. No new column or password migration is required.

Optional Script Properties:

| Property | Purpose |
| --- | --- |
| `REGISTRATION_MODE` | `invite` by default; `off` disables registration; `open` removes the invite requirement. |
| `REGISTRATION_CODE` | Invite code for new member accounts. |
| `REGISTRATION_EMAIL_DOMAINS` | Comma-separated approved email domains; blank allows any domain with a valid invite. |

The updated live URL supplied on October 6, 2026 is configured in `.env.local` and `.env.example`. Public status and registration checks confirm backend version `4`, `configured: true`, `usernameType: email`, and invite-only registration. The frontend is connected to that deployment, and the production build embeds that URL. Set the same `VITE_APPS_SCRIPT_URL` in your hosting project's environment and rebuild when publishing. Authenticated live flows require a company account or invite code.

## Operation

Open conversations refresh every 8 seconds and workspace/unread information every 15 seconds. Background notification delivery uses the separate Web Push queue described above. Failed sends retain their drafts and reuse their message identifier on retry. Drafts persist in the tab's session storage when switching conversations or reloading. Search applies to the selected conversation and includes thread replies. Channels are visible to all active teammates; direct and group conversations are restricted to their members, including when the user is an administrator.

For larger teams or high message volume, replace the spreadsheet backend with a database and subscription service. No external deployment or company data mutations are performed by the test suite.
