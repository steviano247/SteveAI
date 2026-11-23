# SteveAI — your all-in-one AI companion (Powered by STEVEXA)

Android app (APK built on GitHub) + backend on Google Apps Script using **your** Gemini API key.
The key lives only in Apps Script — it is never inside the APK.

```
apps-script/Code.gs      -> backend (paste into Apps Script)
www/                     -> the app (splash, sign-up, chat, plans, update check)
assets/                  -> S icon + native splash (used when building)
.github/workflows/       -> builds SteveAI.apk and publishes a Release
signing/steveai.keystore -> default signing key (see "Signing")
```

## 1) Backend (10 minutes)
1. Create a new **Google Sheet** (name it "SteveAI Database").
2. **Extensions → Apps Script**. Delete the sample code, paste all of `apps-script/Code.gs`.
   (Project Settings → tick "Show appsscript.json" and paste `apps-script/appsscript.json` too.)
3. Get Gemini keys from https://aistudio.google.com/apikey. After step 4, open the **ApiKeys** sheet and paste **one key per row in column A** (as many as you like).
   The app rotates between them, rests a key for 60 s when it hits a rate limit, and marks a rejected key `INVALID`. Set a row's status to `OFF` to pause it.
   (Optional fallback: Script property `GEMINI_API_KEY`.) Keep this Google Sheet private — it holds your keys.
4. Select function **`setup`** → Run → authorise. It creates the sheets **Users, Payments, Config, ApiKeys**.
5. **Deploy → New deployment → Web app** → Execute as: **Me** → Who has access: **Anyone** → Deploy.
   Copy the Web App URL (ends with `/exec`).
   After any later code change use **Deploy → Manage deployments → Edit → New version**.

## 2) Connect the app
Edit `www/js/config.js`:
```js
API_URL: 'https://script.google.com/macros/s/XXXX/exec',
GITHUB_REPO: 'yourusername/SteveAI',
```

## 3) Build the APK on GitHub
1. Create a **public** GitHub repo (public is required for auto-update; see "Public or private?" below) `SteveAI`, upload everything in this folder (keep the `.github` folder).
2. Open the **Actions** tab → "Build SteveAI APK" runs automatically (or **Run workflow**).
3. ~6–8 minutes later: **Releases → SteveAI v1.0.0 → SteveAI.apk**. Install it on your phone
   (allow "install unknown apps" for your browser). App name = **SteveAI**, icon = the **S** logo,
   splash = your artwork for **5 seconds**, then a real loading indicator while it waits for answers.

## 4) Release an update (auto-update)
1. Change `"version"` in `package.json` (e.g. `1.0.0` → `1.1.0`) and describe changes in `RELEASE_NOTES.md`.
2. Commit. GitHub builds and publishes the new Release.
3. Users get an **"Update available"** popup on app start (checked every 12 h) or via
   **Settings ⚙️ → Check for updates**. Android always asks the user to tap *Install* — that cannot be skipped.

## 5) Sign-up, plans and payments
- Sign-up = **Gmail + username + password**. Everyone starts **Free: 5 prompts per 5 hours** (counted only for answered prompts).
- **Settings ⚙️ → Upgrade plan** → Go ($10) or Pro ($20). The app shows your payment details and the user's
  **Gmail as the payment reference/remark**.
- User taps **"I have paid"** → a PENDING row appears in the **Payments** sheet (and you get an email).
  Search your bank alert for that Gmail, then set **Status = APPROVED** in that row →
  the plan is activated automatically for 30 days (a user who is already paid gets +30 days on renewal).
  User taps **Settings → Refresh my plan** (also refreshes on app open).
- Everything is editable in the **Config** sheet without touching code: prompts per plan, prices,
  payment details/link, Gemini model per plan, system prompt, maintenance switch.
  Defaults: Free 5, Go 40, Pro 150 prompts per 5 h; Free/Go use `gemini-2.5-flash`, Pro uses `gemini-2.5-pro`.
- Menu **SteveAI** in the Sheet: activate a payment row, reset a user's quota, create promo codes.

## 6) Short code
Every user gets a personal **invite code** (like `STV-K7Q2M`) in Settings with a Share button.
New users can enter it at sign-up (stored in the `invitedBy` column). For giveaways, use menu
**SteveAI → Generate invite code**.

## Signing (important)
Updates only install over an old version if both were signed with the **same key**.
The repo includes a default key so it works immediately. Because it is public in your repo, for real
production use your own private key: run
`keytool -genkeypair -keystore my.keystore -alias steveai -keyalg RSA -keysize 2048 -validity 36500`,
then in GitHub → Settings → Secrets → Actions add `KEYSTORE_BASE64` (base64 of the file),
`KEYSTORE_PASSWORD`, `KEY_ALIAS`. The workflow uses them automatically. (Changing key later means
users must uninstall and reinstall once.)

## Limits to know
- Apps Script free quota: ~20,000 external fetches/day and 100 emails/day; Gemini free keys have their own rate limits.
- Passwords are salted + SHA-256 hashed; the sheet never stores plain passwords. Keep the Sheet private.
- No payment gateway is wired in (as requested: manual confirmation by Gmail remark). Paystack/Flutterwave can be added later.

## Public or private repo?
- **Public** is needed for the in-app update check: the app reads `api.github.com/.../releases/latest` and downloads the APK from the Release without logging in. A private repo still builds fine, but users get "Could not check for updates" and cannot download.
- Nothing secret is in the repo: Gemini keys live only in your Google Sheet, never in GitHub or the APK.
- The default signing keystore IS in the repo, so in a public repo add your own key via GitHub Secrets (see "Signing").
- If you prefer a private repo: keep it private, download `SteveAI.apk` from the Actions run yourself and host it elsewhere (e.g. Google Drive), then update the app's update-check to point there.
