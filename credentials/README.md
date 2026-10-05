# Google credentials

OAuth files live here (mounted into containers at `/app/credentials/`):

| Path | Purpose |
|------|---------|
| `client_secret.json` | OAuth 2.0 Client ID downloaded from the Google Cloud Console. Must be a **Web application** client. |
| `tokens/` | One token per user, written when they connect their Google Classroom account in the web UI. Do not edit by hand. |
| `token.json` | Only on deployments upgraded from the single-account version: the original token, now the first admin's connection. |

**Do not commit these files to Git.** They are also never included in backup archives.

## OAuth client setup

Everyone signs in to the web UI with Google, and each user then connects their own
Google Classroom account. Both use the same OAuth client:

1. In the Google Cloud Console create an OAuth client of type **Web application**.
2. Add `<web origin>/api/auth/google/callback` as an authorized redirect URI, once for
   every origin the web UI is opened from (for local development,
   `http://localhost:5173/api/auth/google/callback`). Google only accepts `http` for
   `localhost`; anything else must be `https`.
3. Download the client as `credentials/client_secret.json`.
4. List the same origins in `API_CORS_ORIGINS` and set `ADMIN_EMAILS` in `.env`.

Classroom and Drive are sensitive scopes: while the OAuth consent screen is in
*Testing*, only the listed test users can connect and their tokens expire after about
a week. Check Google's current verification requirements before inviting others.

## Connecting a Classroom account

Sign in to the web UI, open **Settings**, and press **Authorize**. To pick up a newly
added scope (for example Drive for attachments), press **Re-authorize**.

The host-side script (`./scripts/setup-google-auth.sh`) still writes
`credentials/token.json`, which only the first admin's connection uses, and only until
they re-authorize in the web UI.

## Verify

**Settings** shows the connection status and which Google account is connected.
