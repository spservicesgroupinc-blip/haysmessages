# Deploy Hays Messages to Vercel

The repository is prepared for one Vercel project containing the installable Vite frontend and a Node.js Web Push function at `/api/push`. No project has been linked or deployed, and no sender secrets have been configured in Vercel.

## Project settings

Import this repository with the **repository root** as Root Directory, not `push-service`:

This workspace currently has no Git repository. You can first put the prepared source in your chosen repository for dashboard import, or use the Vercel CLI from this folder when you are ready to deploy. Linking/uploading a project has not been performed during preparation.

| Setting | Value |
| --- | --- |
| Framework preset | Vite |
| Node.js | 22.x |
| Install command | `npm ci --include=dev` |
| Build command | `npm run build` |
| Output directory | `dist` |

`vercel.json` sets these build commands, the push function's 60-second maximum duration, manifest content type, service-worker scope/revalidation, and immutable caching for hashed assets. The app uses root URLs plus query parameters, so there is no catch-all rewrite that could send API calls or JavaScript asset requests to `index.html`.

## Environment variables

Set these under Vercel Project > Settings > Environment Variables. Apply them to the deployment environments you will use, and rebuild after changing the frontend URL.

The frontend now defaults to the supplied messaging URL in [.env.example](.env.example), so a missing or blank `VITE_APPS_SCRIPT_URL` does not disable signup or sign-in. Set that variable only to override the endpoint. The updated connected backend reports version `8` with the sales dashboard (including server summaries, filters, and a 25,000-row guard), profile management, search, presence, attachments, and optional notifications that cannot fail saved messages. If your existing Vercel project has a previous `VITE_APPS_SCRIPT_URL`, replace it with the current URL below before publishing the updated build.

The current build also migrates the four known retired company deployment overrides (including the previous version 7 default) to the latest URL. This prevents a stale hosting setting from sending login and sales to an older backend after a frontend update. New intentional deployment overrides are preserved. Publish the updated frontend to apply this behavior; an already published bundle is unchanged by editing local files. The sales error displays the connected URL for checking which deployment answered.

| Variable | Value / handling |
| --- | --- |
| `VITE_APPS_SCRIPT_URL` | `https://script.google.com/macros/s/AKfycby6iwIDQQ9GvqdH_RC4HejRZCu-nU2WUiDyxjhMFFwNrCsuDiD4WLgcWqFJqdMkftdNtA/exec` |
| `VAPID_PUBLIC_KEY` | Public Web Push key; same key in Apps Script. |
| `VAPID_PRIVATE_KEY` | Private sender key; server environment only. |
| `VAPID_SUBJECT` | A real contact such as `mailto:administrator@your-company.com`. |
| `PUSH_RELAY_SECRET` | Strong shared secret, same value in Apps Script. |

Generate a persistent key pair and shared secret locally with `npm run keys --workspace=push-service`. It writes an ignored `push-service/.env` file without printing secrets and refuses to overwrite existing keys. Open it privately to copy values into Vercel; change the example contact before deployment. Never prefix the private key or shared secret with `VITE_`. Local `.env.local` and `push-service/.env` files are excluded from deployment uploads.

The frontend can deploy and install without sender secrets, but background push remains disabled until the sender and Apps Script are configured. The function's `GET /api/push` health response exposes readiness and the public key only. `POST /api/push` requires the shared Bearer secret and sends encrypted Web Push with generic notification text. It is called by Apps Script, not by the browser.

## Apps Script configuration after deployment

1. Copy the local `apps-script/Code.gs` and `apps-script/appsscript.json` into the **dedicated messaging project**, preserving `MESSAGING_SPREADSHEET_ID`.
2. Set Script Properties `VAPID_PUBLIC_KEY`, `PUSH_RELAY_SECRET`, and `PUSH_RELAY_URL=https://YOUR-STABLE-DOMAIN/api/push`.
3. Run `setupPushMessaging()` in the Apps Script editor and authorize the added scopes. It creates the optional push tables and one background minute trigger without resetting messages or accounts.
4. Update the messaging deployment to a **new version** after backend changes. The local backend and the latest connected endpoint checked on October 6 report version `8` with the sales dashboard (including server summaries and a 25,000-row guard), profile management, search, presence, attachments, and relayed web push. Version `6` and later keep message sending successful when optional notification code is missing or fails. Publishing a new version of an existing deployment retains its URL; if creating a separate deployment, update the frontend endpoint too.

The sales dashboard uses the same `VITE_APPS_SCRIPT_URL`, so no second frontend environment variable is required. Publish local `Code.gs` version `8` and give its deployment owner read access to the supplied sales Sheet. Keep `MESSAGING_SPREADSHEET_ID` pointed at the messaging database. Optional `SALES_SPREADSHEET_ID` and `SALES_SHEET_NAME` belong in Apps Script properties; their supplied defaults already target the sales report. See [apps-script/README.md](apps-script/README.md#sales-dashboard-version-8).
5. Confirm `GET https://YOUR-STABLE-DOMAIN/api/push` reports `enabled: true`, and Apps Script Triggers/Executions show successful queue delivery.

Use a stable deployment domain for installation and subscriptions. Preview domains can be protected by Vercel authentication; Apps Script and installed apps must be able to reach the chosen domain. Configure deployment protection appropriately for the intended public application endpoint. The relay still requires its own secret for every delivery request. Keep the VAPID keys unchanged across deployments; rotating them requires devices to subscribe again.

## Verify before rollout

```powershell
npm ci
npm run build
npm run lint
npm test
npm run test:browser
```

Local checks cover service-worker offline reloads, saved edits and draft recovery, private-cache clearing, update confirmation/draft preservation, desktop installability, real PNG icon dimensions, desktop/mobile messaging, subscription controls, push-display/navigation, backend queue filtering/retries, and the Vercel function adapter. The desktop install audit uses a normal isolated browser profile, not a private/incognito context.

After publishing, install from desktop Chrome/Edge, Android, and iPhone/iPad Safari. iOS/iPadOS 16.4+ notifications require a Home Screen app and explicit opt-in. Test with two company accounts: enable recipient notifications, close the app, send a message from the other account, and allow the one-minute trigger to run. Confirm the notification opens the correct conversation. Repeat while reading the conversation and after sign-out to confirm suppression. Existing account sessions expire after 12 hours; sign in and reconnect notifications after expiry. Native OS installation and provider-to-device delivery require these real-device checks; local tests do not establish live delivery.

References: [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [Vercel project configuration](https://vercel.com/docs/project-configuration/vercel-json), [Apple Web Push requirements](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers).
