# Messaging authentication and rollout

The login page sends `login` with `email` and `password` to the messaging web-app `/exec` URL. Any valid email address can be a username. `Code.gs` also accepts `username` as an alias for `email`; when both are supplied they must identify the same account. Email addresses are trimmed and lowercased; passwords are preserved exactly.

The backend stores salted password hashes in `Users` and hashed session tokens in `Sessions`. Users must be active. Five failed password attempts lock an account for 15 minutes. Successful authentication returns a session valid for 12 hours. All workspace, messaging, and push requests require that session. Anyone can register using their name, any valid email, and a password of at least 10 characters. Registration creates a member account and returns a session immediately; it cannot grant administrator access.

## Update the existing deployment

1. Open the **messaging** Apps Script project associated with the configured `VITE_APPS_SCRIPT_URL`. Copy the updated `Code.gs` and `appsscript.json` into it. Preserve any additional project files.
2. Keep the existing `MESSAGING_SPREADSHEET_ID` Script Property. If connecting an existing messaging Sheet for the first time, set this property to that Sheet's ID.
3. Run `setupMessaging()` in the editor. It creates missing empty tables and preserves existing accounts and messages. It does not create example people, messages, or channels.
4. Confirm an active account exists in `Users`. Existing accounts work without changing their hashes. For a first administrator, follow the steps below.
5. Choose **Deploy > Manage deployments**, edit the existing messaging web-app deployment, select **New version**, and deploy. Execute as **Me** with access **Anyone**. Updating the existing deployment keeps the same `/exec` URL. Saving editor code alone does not publish it.
6. Open the `/exec` URL. It should report version `6`, `configured: true`, and `registrationMode: "open"`. These are public status fields and do not expose Sheet data or secrets.
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
| Messages | Id, ConversationId, AuthorEmail, AuthorName, Body, CreatedAt, UpdatedAt, Deleted, ParentId, ReactionsJson, ClientId |
| ReadReceipts | Email, ConversationId, ReadThrough |

`Active` is the Boolean value `TRUE`; `Role` is `admin` or `member`. Create accounts through the signup page or editor helper so salts and password hashes are generated correctly. Optional push tabs are managed by `setupPushMessaging()` separately.

## Open registration

Version `5` and later always allow registration with any valid email address. Previous `REGISTRATION_MODE`, `REGISTRATION_CODE`, and `REGISTRATION_EMAIL_DOMAINS` properties are ignored and may be removed. No invitation or domain approval is needed. Existing accounts and their password hashes remain compatible. The frontend sends only name, email, and password for signup.

## Message sending reports `enqueuePush_ is not defined`

Replace the entire deployed `Code.gs` with this repository's file, including the optional notification helpers at the end, then publish a **New version** of the existing deployment. Version `6` returns a successful send after saving a message even if the optional notification helper is missing or throws. Push setup is not required to send messages or thread replies. Spreadsheet write failures still return errors and retain the draft.

The latest October 6 live endpoint supplied after publishing was checked and reports version `6` with the `optional-push-on-send` feature. For future updates, preserve `MESSAGING_SPREADSHEET_ID` and publish a new version of the existing deployment to retain its URL; saving editor code alone does not publish it. Retry a retained draft normally: the app reuses its message identifier and the backend returns the saved message without adding a duplicate.
