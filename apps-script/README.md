# Messaging authentication and rollout

The login page sends `login` with `email` and `password` to the messaging web-app `/exec` URL. The username is the full company email address. `Code.gs` also accepts `username` as an alias for `email`; when both are supplied they must identify the same account. Email addresses are trimmed and lowercased; passwords are preserved exactly.

The backend stores salted password hashes in `Users` and hashed session tokens in `Sessions`. Users must be active. Five failed password attempts lock an account for 15 minutes. Successful authentication returns a session valid for 12 hours. All workspace, messaging, and push requests require that session. Invite registration creates a member account; it cannot grant administrator access.

## Update the existing deployment

1. Open the **messaging** Apps Script project associated with the configured `VITE_APPS_SCRIPT_URL`. Copy the updated `Code.gs` and `appsscript.json` into it. Preserve any additional project files.
2. Keep the existing `MESSAGING_SPREADSHEET_ID` Script Property. If connecting an existing messaging Sheet for the first time, set this property to that Sheet's ID.
3. Run `setupMessaging()` in the editor. It creates missing empty tables and preserves existing accounts and messages. It does not create example people, messages, or channels.
4. Confirm an active account exists in `Users`. Existing accounts work without changing their hashes. For a first administrator, follow the steps below.
5. Choose **Deploy > Manage deployments**, edit the existing messaging web-app deployment, select **New version**, and deploy. Execute as **Me** with access **Anyone**. Updating the existing deployment keeps the same `/exec` URL. Saving editor code alone does not publish it.
6. Open the `/exec` URL. It should report version `4`, `configured: true`, and `usernameType: "email"`. These are public status fields and do not expose Sheet data or secrets.
7. Open the updated frontend and sign in with a provisioned company email/password, or choose **Create account** with the `REGISTRATION_CODE` from Script Properties. Create a channel if the Sheet is new. Verify sending and receiving with two actual accounts.

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

`Active` is the Boolean value `TRUE`; `Role` is `admin` or `member`. Provision accounts through the editor helper or invite registration so salts and password hashes are generated correctly. Optional push tabs are managed by `setupPushMessaging()` separately.

## Registration settings

`REGISTRATION_MODE` supports `invite` (default), `off`, and `open`. Unknown settings disable registration. `REGISTRATION_CODE` controls invite access. `REGISTRATION_EMAIL_DOMAINS` optionally restricts registration to comma-separated company domains. None of these secrets belong in frontend environment variables.
