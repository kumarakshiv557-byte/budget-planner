# Setting up Revolut sync

The app reads your Revolut spending through [Enable Banking](https://enablebanking.com), an EU open-banking provider. Its free "restricted" mode lets you read accounts you link yourself. A small Supabase Edge Function (`supabase/functions/revolut-sync`) holds the Enable Banking key so it never sits inside the app.

Never paste the key or the passphrase into a chat, an issue or the code.

## 1. Register an Enable Banking application

1. Sign in at <https://enablebanking.com/sign-in/> with your email.
2. Open **Applications** (<https://enablebanking.com/cp/applications>) and click **Add a new application**.
3. Fill in:
   - **Environment:** Production
   - **Name:** Budget planner
   - **Allowed redirect URLs:** `https://lyfztzgubetxreowrylh.supabase.co/functions/v1/revolut-sync/callback`
   - **Description:** Personal budget app reading my own Revolut account
   - **Data protection email:** your email
   - **Privacy policy and terms URLs:** `https://github.com/kumarakshiv557-byte/budget-planner`
   - Keep **Generate in the browser** for the key.
4. Submit. A `.pem` file downloads. Its file name (without `.pem`) is your **Application ID**.
5. On the new application, click **Activate by linking accounts**, choose **Revolut** in **Portugal**, and approve in the Revolut app. The application becomes active in restricted mode.

## 2. Add three secrets in Supabase

Open <https://supabase.com/dashboard/project/lyfztzgubetxreowrylh/functions/secrets> and add:

| Name | Value |
|---|---|
| `EB_APP_ID` | the Application ID |
| `EB_PRIVATE_KEY` | the whole `.pem` file, opened in a text editor, including the `-----BEGIN` and `-----END` lines |
| `SYNC_SECRET` | a passphrase you make up, at least 12 characters |

## 3. Connect from the app

1. In the app, open **Settings → Revolut sync** and type the same passphrase. The server URL is already filled in.
2. Press **Connect Revolut** and approve in Revolut. You'll see "Revolut connected ✓".
3. Back in the app, press **Check connection**, then **Sync now**.

**From a phone (or any browser) instead:** open <https://lyfztzgubetxreowrylh.supabase.co/functions/v1/revolut-sync/start>, approve in Revolut, and you'll see "Revolut connected ✓". Starting this link needs no passphrase, because it only asks Revolut for permission. Reading your data still needs the passphrase from the app.

After that the app syncs on its own when you open it, if it has been 6 hours. Revolut access lasts about 90 days; when it runs out, press **Connect Revolut** again.

## What gets imported

Booked money going out of your account. Salary, refunds, top-ups, pending card payments and transfers between your own Revolut accounts are skipped. Each transaction is sorted by the same rules as CSV import, and re-syncing never duplicates.
