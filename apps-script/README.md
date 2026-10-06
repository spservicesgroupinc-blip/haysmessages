# Messaging authentication and rollout

The login page sends `login` with `email` and `password` to the messaging web-app `/exec` URL. Any valid email address can be a username. `Code.gs` also accepts `username` as an alias for `email`; when both are supplied they must identify the same account. Email addresses are trimmed and lowercased; passwords are preserved exactly.

The backend stores salted password hashes in `Users` and hashed session tokens in `Sessions`. Users must be active. Five failed password attempts lock an account for 15 minutes. Successful authentication returns a session valid for 12 hours. All workspace, messaging, and push requests require that session. Anyone can register using their name, any valid email, and a password of at least 10 characters. Registration creates a member account and returns a session immediately; it cannot grant administrator access.

## Update the existing deployment

1. Open the **messaging** Apps Script project associated with the configured `VITE_APPS_SCRIPT_URL`. Copy the updated `Code.gs` and `appsscript.json` into it. Preserve any additional project files.
2. Keep the existing `MESSAGING_SPREADSHEET_ID` Script Property. If connecting an existing messaging Sheet for the first time, set this property to that Sheet's ID.
3. Run `setupMessaging()` in the editor. It creates missing empty tables and preserves existing accounts and messages. It does not create example people, messages, or channels.
4. Confirm an active account exists in `Users`. Existing accounts work without changing their hashes. For a first administrator, follow the steps below.
5. Choose **Deploy > Manage deployments**, edit the existing messaging web-app deployment, select **New version**, and deploy. Execute as **Me** with access **Anyone**. Updating the existing deployment keeps the same `/exec` URL. Saving editor code alone does not publish it.
6. Open the `/exec` URL. It should report version `8.2` and `configured: true`. These are public status fields and do not expose Sheet data or secrets; the signup mode is read separately through the `registrationInfo` action.
7. Publish the updated frontend build. It uses the supplied `/exec` URL even without a frontend environment variable. Open it and choose **Create account** with your name, any valid email, and a password. Create a channel if the Sheet is new. Verify sending and receiving with two actual accounts.

See Google's [web-app deployment guide](https://developers.google.com/apps-script/guides/web) and [versioned deployment guide](https://developers.google.com/apps-script/concepts/deployments#versioned_deployments).

## First administrator

Run `setupMessaging()` first. Add a temporary editor-only wrapper that calls `createUser(companyEmail, displayName, chosenPassword, 'admin')` with your actual values. Use a password of at least 10 characters. Run the wrapper from the editor, then remove it so the password does not remain in project source. Do not add passwords to `.env` or frontend code.

An example wrapper signature without any stored credentials:

```javascript
function provisionAdministrator() {
  // Temporarily call createUser here with your actual email, name, and password.
  // Remove this wrapper after running it once.
}
```

`createUser` and `resetUserPassword` are editor-only helpers and are never available through HTTP actions.

## Password resets

An administrator with Apps Script editor access can use a temporary wrapper calling `resetUserPassword(companyEmail, newPassword)`. Use at least 10 characters and remove the wrapper after it runs. The reset changes the password hash, clears the lockout counter, and revokes every session and push subscription for that account. Other accounts retain their access. The person then signs in with the new password.

## Sheet columns

Keep these column names and their order. Do not put plaintext passwords in the Sheet.

| Tab | Columns |
| --- | --- |
| Users | Email, Name, Role, Salt, PasswordHash, Active, FailedAttempts, LockedUntil |
| Sessions | TokenHash, Email, ExpiresAt |
| Conversations | Id, Name, Description, Kind, MembersJson, CreatedBy, CreatedAt |
| Messages | Id, ConversationId, AuthorEmail, AuthorName, Body, CreatedAt, UpdatedAt, Deleted, ParentId, ReactionsJson, ClientId, AttachmentJson |
| ReadReceipts | Email, ConversationId, ReadThrough |

`Active` is the Boolean value `TRUE`; `Role` is `admin` or `member`. Create accounts through the signup page or editor helper so salts and password hashes are generated correctly. Version `8` appends an optional `AttachmentJson` column to Messages. Existing sheets without it keep working; new messages extend the sheet automatically. Optional push tabs are managed by `setupPushMessaging()` separately.

## Registration mode

Version `8` allows registration with any valid email address by default. Set `REGISTRATION_MODE` in Script Properties to `disabled` to close signup, or to `invite` to advertise invite-only signup in the public `registrationInfo` response; any other value keeps the register endpoint open. The older `REGISTRATION_CODE` and `REGISTRATION_EMAIL_DOMAINS` properties remain ignored and may be removed. Existing accounts and their password hashes remain compatible. The frontend sends only name, email, and password for signup.

## Message sending reports `enqueuePush_ is not defined`

Replace the entire deployed `Code.gs` with this repository's file, including the optional notification helpers at the end, then publish a **New version** of the existing deployment. Version `6` returns a successful send after saving a message even if the optional notification helper is missing or throws. Push setup is not required to send messages or thread replies. Spreadsheet write failures still return errors and retain the draft.

The latest October 6 live endpoint supplied after publishing was checked and reports version `8.2` with the `sales-aggregations`, `realtime-presence`, `drive-attachments`, `global-search`, `batch-pruning`, and `web-push-relay` features. For future updates, preserve `MESSAGING_SPREADSHEET_ID` and publish a new version of the existing deployment to retain its URL; saving editor code alone does not publish it. Retry a retained draft normally: the app reuses its message identifier and the backend returns the saved message without adding a duplicate.

## Sales dashboard (version 8.1)

The dashboard reads the supplied [sales spreadsheet](https://docs.google.com/spreadsheets/d/1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/edit) through this same messaging deployment. `salesDashboard` requires an active messaging session before reading any report data. It is available to signed-in workspace members. The sales sheet is read-only: this action does not create tables, change cells, or alter sharing. No second URL or separate sign-in is needed.

1. Copy the **complete** updated `Code.gs` into the existing messaging project. Keep `MESSAGING_SPREADSHEET_ID` unchanged; it still identifies the messaging database, not the sales spreadsheet.
2. Ensure the account that owns/deploys the Apps Script can read the sales spreadsheet.
3. The supplied spreadsheet ID and `Estimator_Sales_Report.xls (6).csv` tab are already defaults. Optional Script Properties `SALES_SPREADSHEET_ID` and `SALES_SHEET_NAME` override them if the source changes. Do not put these values in `MESSAGING_SPREADSHEET_ID`.
4. Choose **Deploy > Manage deployments > Edit > New version > Deploy**. Updating the existing deployment keeps the current URL. Confirm `/exec` reports version `8.2` and feature `sales-dashboard`.
5. Publish the new frontend build, sign in, and choose **Sales dashboard** in the sidebar. Use **Refresh** after editing or replacing the source report's rows.

The required columns are `Job Number`, `Customer`, `Estimator`, `Date Received`, `Division`, `Total Estimates`, and `Job Status`. Column order can change. Optional report fields appear in job details, including insurance/referral/inspection data and the last journal note. Dates use the spreadsheet timezone; numeric Sheet dates and exported US date strings are supported. Source text is displayed as text, never executable HTML. Missing and unreadable estimates remain `null`; an entered zero remains a real zero. Known estimate value is not booked revenue, and age since received does not imply a due date. Header/access issues and reports above 25,000 rows return explicit errors rather than incomplete totals.

The local implementation and latest user-published live endpoint report version `8.2`. Google Drive access allowed inspecting the source, but this workspace has no Google Apps Script editor credentials to publish backend changes automatically. Public version status does not verify authenticated access to the sales sheet. Tests use fictional isolated report rows and do not embed a snapshot of company sales data in the app.

If the app says the sales action is unknown after deployment, check the **Connected workspace** URL shown beside that error. The latest supplied address reports version 8.2, but an older hosted bundle or environment override can still use a prior address. Update the frontend to the latest build; current builds migrate the known retired company overrides. If the request is already reaching the latest deployment, replace its entire `Code.gs` and publish a new version. In `handle_`, the authenticated switch must include `case 'salesDashboard':return salesDashboard_();`. Updating only the public version number or saving editor changes does not add the deployed action.
