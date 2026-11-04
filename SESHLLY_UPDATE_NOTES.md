# Seshlly — Update Notes (Round 2)

Covers: Chat 24h/Normal mode · Language hidden · Feed fixes + Story view ·
Proof camera-only + AI check · Buddy proof confirm (reminders, 2h auto-close) ·
Push notifications · Solo XP fix.

---

## 1. Backend (social-api) — deploy steps

```bash
npm install                 # no new packages (firebase-admin already in package.json)
npx prisma db push          # applies the new columns (or run prisma/migrations_manual/*.sql)
npx prisma generate
npm start
```

**New DB columns** (all have defaults, existing rows are safe):

| Table | Column | Purpose |
|---|---|---|
| `chats` | `disappearing` (bool, default `false`) | chat is in 24h mode |
| `messages` | `expiresAt` (nullable) | set only for messages sent in 24h mode |
| `workout_sessions` | `proofUploadedBy`, `confirmedAt`, `confirmTimedOut`, `confirmReminders` | buddy confirm flow |

**.env additions** (already added to `.env` and `.env.example` — just fill the value)

```
HIVE_API_KEY=xxxxx                          # AI fake-proof check. Not set → check skipped
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json   # optional, this is the default
```

**Firebase service account** → Firebase Console → Project Settings → Service Accounts →
*Generate new private key* → save as `firebase-service-account.json` in the API root.
Without it the API still runs; push is skipped (logged as `push disabled`).
Do **not** commit this file.

**New / changed endpoints**

| Method | Path | Notes |
|---|---|---|
| `PATCH` | `/chat/:chatId/mode` | `{ disappearing: true/false }` — either member; posts a system message; socket `chat:mode` |
| `GET` | `/chat/:chatId/messages` | now also returns `disappearing`; expired messages hidden |
| `GET` | `/sessions/pending-confirm` | proofs waiting for *my* confirmation |
| `POST` | `/sessions/:id/confirm` | now the **other** person confirms (creator or buddy) |
| `POST` | `/sessions/:id/proof` | Hive check · solo XP really awarded · proof card in chat · notifies buddy |
| `POST` | `/feed` | accepts `sessionId`; XP comes from the session (client value ignored); challenge must exist |
| `GET` | `/users/:id/profile` | adds `confirmRate` (% on-time confirms, `null` if no history) |

**Cron jobs (scheduler.js)**
- `#9` every 10 min — deletes only messages whose `expiresAt` passed (Normal chats keep messages).
- `#10` every 5 min — buddy proof confirm: reminder at 1h, reminder at 1h45m (15 min left),
  at 2h → session **completed** for uploader (session XP + Trust +2 + 1 token),
  confirmer gets **Trust −2** and loses their XP share.

---

## 2. Flutter app — setup

```bash
flutter pub get             # firebase_core + firebase_messaging enabled in pubspec
cd ios && pod install       # iOS deployment target raised to 15.0 (Firebase requirement)
```

**Android push** → put `google-services.json` in `android/app/`.
The Google Services Gradle plugin is applied **only if that file exists**, so the app builds without it.
`minSdk` is now `max(flutter.minSdkVersion, 23)`.

**iOS push**
1. Add `GoogleService-Info.plist` to `Runner` in Xcode (Copy items if needed).
2. Signing & Capabilities → add **Push Notifications** and **Background Modes → Remote notifications**.
3. Firebase Console → Cloud Messaging → upload the **APNs Auth Key**.
4. `permission_handler` on iOS needs the camera macro in `ios/Podfile` (inside `post_install`):
   ```ruby
   target.build_configurations.each do |config|
     config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] ||= ['$(inherited)', 'PERMISSION_CAMERA=1']
   end
   ```

Without the config files `Firebase.initializeApp()` fails silently → push disabled, everything else works.

---

## 3. Test checklist

**Chat mode**
- [ ] New chat opens in Normal (no banner). ⏱ icon → choose *24 hours* → banner + system line appears for both users.
- [ ] Message sent in 24h mode disappears after 24h; messages sent before switching stay.

**Buddy proof confirm**
- [ ] User A uploads proof (buddy session) → B gets push + chat proof card + home banner.
- [ ] B taps **Confirm** (card / banner / push) → both get XP, card shows ✅.
- [ ] A cannot confirm own proof.
- [ ] Don't confirm: reminder at ~1h and ~1h45m; at 2h A's session completes, B gets "missed" + Trust −2.
- [ ] Waiting session is no longer marked *missed* after 3h (old bug).

**Proof**
- [ ] Upload screen: only camera (no gallery); photo has the SESHLLY date/time strip.
- [ ] Solo session → XP total actually increases by 50.
- [ ] With `HIVE_API_KEY`: AI/stock image is rejected with a message.

**Feed / Stories**
- [ ] Normal session → no "Post to Feed?" sheet. Challenge session → sheet appears, post succeeds.
- [ ] Challenges screen shows story row; tap → full screen viewer (tap, hold, swipe down).
- [ ] Viewed stories get a grey ring.

**Other**
- [ ] Settings no longer shows *Language*.
- [ ] Chat realtime works (socket URL fixed to `api.seshlly.com`).

---

## 4. Launch readiness (scaling fixes)

**Discover (match.controller.js)** — location filter now runs in the database
(bounding box on the indexed `latitude/longitude`), then the exact 10 km circle.
Already-swiped users are excluded inside the query (no huge `NOT IN` list).
Recently active users come first (new index `users.lastActiveAt`).
Before: 20 random users were fetched and filtered afterwards → empty Discover
once users are spread across cities.

**Rate limiting (middleware.js + server.js)** — ⚠️ was a launch blocker:
- Limit was **100 requests / 15 min per IP**. Jio/Airtel mobile data, college and
  office Wi-Fi put many users behind one IP → they'd all share 100 requests and
  get "Too many requests".
- Behind nginx / a load balancer without `trust proxy`, **every user** looked like
  the same IP → whole app limited to 100 requests / 15 min.
- Now: limit is **per logged-in user** (from the JWT), IP only for logged-out calls;
  `RATE_LIMIT_MAX=600` (≈40/min per user); `app.set('trust proxy', TRUST_PROXY)`.
- `.env`: `TRUST_PROXY=1` if the API is behind nginx/LB (normal), `0` if exposed directly.

**Trust decay cron** — only loads users inactive 8+ days (was: every user, daily).

**Load test** — `scripts/load-test.js` (k6, read-only calls). Run on staging:
```bash
k6 run -e BASE_URL=https://<staging>/api/v1 -e TOKEN=<test user access token> scripts/load-test.js
```
Ramps to 500 virtual users. Keep `http_req_failed < 1%` and `p95 < 800ms`.
Tip: for the test, raise `RATE_LIMIT_MAX` on staging (all virtual users share one token).

**Before going live — infra checklist**
- [ ] API behind nginx/LB with HTTPS; WebSocket upgrade enabled for `/socket.io/`
- [ ] Run **one** API process (Socket.io + cron jobs are single-instance; for multiple
      instances add the Socket.io Redis adapter and run crons on one instance only)
- [ ] MySQL: daily backups; `DATABASE_URL` with `?connection_limit=20`
- [ ] `NODE_ENV=production`, PM2 or Docker restart policy
- [ ] Run the load test once and note the limit

---

## 5. Round 3 — Retention, Safety, Leaderboard, Gym Map

### Keys / config to add
| Where | Key | For |
|---|---|---|
| API `.env` | `GOOGLE_MAPS_API_KEY` | Gym list (Google **Places API (New)** enabled, server key) |
| `android/local.properties` | `MAPS_API_KEY=...` | Map on Android (**Maps SDK for Android**) |
| `ios/Runner/Info.plist` | `GMSApiKey` (replace `YOUR_IOS_GOOGLE_MAPS_KEY`) | Map on iOS (**Maps SDK for iOS**) |
| Firebase Console | enable **Crashlytics** + **Analytics** | crash reports & retention numbers |

Restrict each Google key (Android package + SHA-1, iOS bundle id, server IP). Without
`GOOGLE_MAPS_API_KEY` the map shows "setup ho raha hai" instead of crashing.

Optional `.env`: `PUSH_DAILY_CAP=8`, `PUSH_QUIET_START_HOUR=22`, `PUSH_QUIET_END_HOUR=8` (IST).

### What changed
**Leaderboard**
- Weekly / Monthly tabs now rank by `weeklyXp` / `monthlyXp` (before: all tabs used all-time XP → identical lists).
- Your own rank is shown even outside the top 100.
- Per-challenge leaderboard `GET /leaderboard` was never mounted (404) — now mounted; city filter runs in the DB.

**Safety — Block & Report** (new tables `user_blocks`, `user_reports`)
- ⋮ menu on chat, buddy profile and buddy view → *Report* (7 reasons + details, blocks by default) or *Block*.
- Blocked = invisible both ways: Discover, chats, profile, messages, gym map, notifications.
- Settings › Privacy › **Blocked Users** (unblock).
- Admin panel → **🚩 Safety Reports** (MODERATOR+): Ban user / Warned / Dismiss; 3+ reports in 7 days flagged.

**Notifications that don't annoy**
- Quiet hours 10 PM–8 AM IST (in-app only), max 8 pushes/day. Proof-confirm & session reminders always go.
- One lock-screen notification per chat (newer replaces older).
- ⏰ "Session 1 ghante mein — Rahul wait karega" to everyone in the session.
- Win-back at 7 PM IST for users inactive exactly 3 / 7 / 14 days (once each).
- `lastActiveAt` now updates on any app use (was: only when chatting) — fixes trust decay, Discover order, win-back.

**Crashlytics + Analytics** — crashes auto-reported (release builds); screen views + events:
`proof_uploaded, proof_confirmed, flash_sent, super_like, boost_activated, chat_mode, gym_checkin, user_reported, user_blocked`.
Firebase Console → Analytics → Retention shows Day-1/7/30.

**Gym Map** (Discover → 🗺 icon)
- All gyms around you from Google (search by name, "Search this area").
- 📍 *Check in* at a gym → your **buddies only** see you there for **2 hours** (+ a push to them).
- Orange pin = buddies training there now; bottom strip lists them. Directions → Google Maps.
- Privacy: no live tracking, gym-level location only, auto-expires, blocked users never see you.
- Google results cached 6h per ~1 km area to keep API cost low.

### Test checklist (round 3)
- [ ] Leaderboard: This Week / This Month / All-time show different orders; my rank visible.
- [ ] Challenge detail leaderboard loads (no 404).
- [ ] Report someone from chat → they disappear from chats & Discover; report shows in admin panel.
- [ ] Ban from admin → that user is logged out.
- [ ] Settings › Blocked Users → unblock works.
- [ ] Session scheduled 1h ahead → both get the reminder once.
- [ ] Send 10 chats at 11 PM → no phone pushes (in-app only).
- [ ] Gym map: gyms load, search works, check in → buddy sees orange pin + push; End removes it.
- [ ] Force a crash in a release build → appears in Crashlytics.

---

## 6. Round 4 — Bug fixes (photos, map, forgot password, challenges)

### Deploy
```bash
cd social-api
npm install            # adds nodemailer
npx prisma db push     # adds password_resets table (SQL also in prisma/migrations_manual, section 8)
pm2 restart all
```
Fill in `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`.
Gmail needs an App Password. Without SMTP the reset code only appears in the server log, so users won't receive it.

App:
```bash
flutter pub get && flutter analyze   # send us the output if anything shows up
```

### What was broken → what was fixed
| Area | Bug | Fix |
|---|---|---|
| Profile photos | API never sent `photos`, so swiping showed only 1 photo | `photos` are now included in every user/buddy response (main photo first) |
| Profile photos | Gradient overlay blocked taps/swipes on the buddy profile | Overlay no longer blocks touches; tap left/right = previous/next photo, tap middle = full-screen gallery (pinch to zoom) |
| Profile photos | No way to change the main photo | Edit Profile → tap a photo → **Make main photo** (new API `PUT /users/me/photos/:id/main`) |
| Profile photos | Deleting the main photo left a broken avatar | The next photo automatically becomes the main photo |
| Gym Map | Entry point was a tiny grey icon | Full-width **Gym Map** banner at the top of Discover |
| Forgot password | Backend routes didn't exist | `/auth/forgot-password`, `/auth/verify-otp`, `/auth/reset-password`: 6-digit email code, valid 10 min, 5 attempts, 1 code/min, logs out other devices |
| Challenges | No way to complete a station after joining | **📸 Complete Station N** button (live camera) → XP → "Share to Challenge Feed" |
| Challenges | `/challenges/:id/proof` and `/collab` routes were missing | Added, with station order, buddy-required and end-date checks, and a Hive AI photo check |
| Challenges | Trust-gated challenges were always locked (server read trust from the token) | Level/trust are read from the DB |
| Challenges | After joining, the station list disappeared until reload | Detail reloads from the server after joining |
| Challenges | "Invite Buddy" was a user-ID text box that did nothing | Pick from your buddies list; a buddy can also be added after joining solo (unlocks buddy stations); the buddy gets a notification |
| Challenges | A completed challenge showed "Join" again | Shows 🏆 Challenge complete with total XP; the list shows "Completed" |

### Test checklist (round 4)
- [ ] Add 3 photos → open your profile from another account → swipe/tap through all 3, tap middle → gallery opens
- [ ] Edit Profile → tap photo 3 → Make main photo → avatar changes everywhere
- [ ] Delete the main photo → the next photo becomes the avatar
- [ ] Discover → Gym Map banner opens the map (needs `MAPS_API_KEY` in local.properties + server `GOOGLE_MAPS_API_KEY`)
- [ ] Login → Forgot password → email arrives → code → new password → login works
- [ ] Join challenge solo → Complete Station 1 → camera → XP snackbar → share → post appears in feed
- [ ] Buddy-required station → "Invite a Buddy to Continue" → pick buddy → station unlocks
- [ ] Finish the last station → 🏆 bar shows, list shows "Completed"

---

## 7. Round 5 (30 Oct) — tester bugs, full QA pass, pen-test

### Deploy (backend first, then the app)
```bash
cd social-api
npm install
npx prisma db push        # new columns/enum (SQL also in migrations_manual, section 9)
pm2 restart all
```
Optional `.env`:
- `SOLO_SESSIONS_PER_DAY` (default 2)
- `CHECKIN_MAX_DISTANCE_M` (default 500)
- `OVERPASS_URL` (default is the public OpenStreetMap server)
- `ALLOWED_MEDIA_HOSTS` (default `res.cloudinary.com`)
- `APP_TZ_OFFSET_MIN` (default 330 = IST)

**Security:** `.env` contains real JWT and Cloudinary secrets. If this folder was ever shared or committed, rotate them. A `.gitignore` has been added.

### Tests (new)
- **Backend:** 133 automated tests in `social-api/tests`. They run on a real MySQL test database; see `tests/README.md`.
  ```bash
  DATABASE_URL_TEST=mysql://…/seshlly_test npm test
  ```
- **App:** Flutter tests in `seshlly/test/features/...`. Run with `flutter test`.
  - The default `widget_test.dart` was removed. It tested a counter screen the app doesn't have, so it always failed.

### Bugs reported by the tester → fixed
| # | Bug | Cause | Fix |
|---|---|---|---|
| 1 | A session invite could be confirmed days after the session time | No time check on the server; the card status lived only on the phone | Answering is allowed only before the start time and only once. Invites nobody answered expire automatically (session cancelled, no penalty). The card shows **Invite expired**. |
| 1b | Inviter's card stuck on "Waiting for <own name>…" | The card never got the answer, and showed the wrong name | The server updates the card and pushes it live (`message:updated`). Text now reads "Waiting for <buddy> to confirm…" |
| 1c | Chat showed 15/10 above 9/10; with >30 messages the newest never loaded | The server sent the oldest 30 and the app reversed them | Newest page first, displayed oldest → newest. Scrolling up loads older messages. |
| 2 | Bottom menu frozen after saving Edit Profile | Screen popped twice (once in `build()` as well) | Pops exactly once |
| 3 | Other people's photos not swipeable | The chat header opened the profile with the CHAT id. Older server builds don't send `photos`. | Correct id. Server tests confirm all 5 photos arrive (Discover, profile, buddies). **Deploy the new API.** |
| 4 | Map shows no gyms | Google key missing → "coming soon" | Free OpenStreetMap fallback, List view, Directions, distance. Opens from the Discover banner and the 🗺️ icon on Sessions. |

### Found in the QA pass (all fixed)
- **Notifications:** no "someone liked you", "new match", "level up", "Flash" or "token low" notification was ever delivered (invalid notification types failed silently).
- **Matches & chat**
  - Match Requests tab was always empty (app parsing error).
  - After a new match / accept, "Send message" opened "Chat not found" (wrong id).
  - The profile **Message** button went to a 404 page.
  - Flash was sent with a user id instead of a match id.
- **Crashes & stuck screens**
  - Tapping **Upload Proof** crashed the app.
  - New users were sent back to onboarding after tapping Finish.
  - Offline app start → stuck on the splash screen, and the user got logged out.
  - After a failed token refresh, the app stayed broken until restart.
  - Sign out sometimes did nothing.
- **Times:** session, notification and chat times were shown in UTC (5:30 h off).
- **Discover**
  - Skipped unseen profiles.
  - Likes failed silently at the daily limit.
- **Chat screen**
  - Jumped to the bottom while reading.
  - "typing…" got stuck on.
  - A failed send lost the typed text.
  - Android back on the Flash camera left the chat.
- **Lists & counts**
  - Chats tab badge was always 0.
  - Lists didn't refresh after scheduling or uploading.
  - Buddies list included removed/blocked buddies.
- **Privacy settings:** only saved on the phone. Now enforced on the server: hidden from Discover, distance hidden, online dot hidden.
- **Payments**
  - Token packs never credited (500 error).
  - Pro plans never expired.
  - A user could verify someone else's order.

### Pen-test fixes (abuse / security)
- **XP farming**
  - Collab bonus claimable in a loop.
  - Double-tap races on proofs and stations.
  - Reused proof photos.
  - Unlimited solo sessions.
- **Proof photos:** must be **your own upload from the last 24 h**, from our Cloudinary account, used only once. Chat image messages follow the same rule.
- **Chat:** users can no longer post fake "proof" or "session invite" cards.
- **Feed posts:** XP, station, photo and collab partner all come from the server.
- **Referral farming:** works only in the first week, pays once (unique + atomic).
- **Influencer paywall:** bypass via like and super-like closed. Elite likes on influencers no longer crash.
- **Location:** distance rounded to whole km (no triangulation). Gym check-in needs you to be within 500 m of a gym we know (gym data is never taken from the client). Check-ins limited to one per 10 minutes.
- **Streaks:** Flash and Strike streaks go up at most once per day, and only between real buddies.
- **Accounts**
  - Refresh tokens are now unique and revoked on logout.
  - Forgot-password works with Gmail addresses containing dots/capitals.
  - OTP attempts are atomic.
  - No account enumeration through the 429 response or the "banned" message.
- **Admin & CMS**
  - Revoked CMS members are locked out, and CMS role escalation is blocked.
  - Admin login is rate-limited.
  - Admin passwords are no longer written to the audit log.
  - Draft blog posts are no longer public.
  - The hard-coded CMS secret is removed.
  - Waitlist CSV is safe against formula injection.
- **Sockets:** typing events only reach chats you've joined. Global online/offline broadcast removed. Banned users are disconnected instantly.
- **Input:** bad page/limit values no longer cause 500s, and other input validation was added.

---

## 8. Round 6 — Pen-test 2 (31 Oct)

36 new attack tests were run live (`tests/integration/pentest2-*.test.js`). All the holes they found are fixed, and the tests now pass (169 backend tests in total). Deploy with `npx prisma db push` (SQL is in section 10 of the migration file).

| Severity | Hole | Fix |
|---|---|---|
| High | Challenge station proof: sending any `sessionId` skipped the photo check → free XP | Photo must always be your own fresh upload; a session can only be reused if it's yours, completed and less than 24 h old |
| High | Discover as a location tracker (radius 50 m + fake probe point) | Minimum radius 2 km. Probe point must be within 25 km of your saved location. Positions are snapped to a ~1 km grid (~5 km if location sharing is off). |
| High | Profile photo, avatar or ID document could be someone else's photo (catfishing, fake verified badge) | Must be a file **you** uploaded |
| High | CMS editor / SUPPORT could read revenue, emails and audit logs from the dashboard | Role check; audit logs only for ADMIN |
| Medium | Boost / super-like / chat tokens: parallel taps → charged several times, or limit bypassed, or negative balance | Atomic checks |
| Medium | Remove buddy did nothing half the time; remove + like again farmed match XP | Deletes both directions plus the likes |
| Medium | Moderator "unban" restored a deleted account; deleted accounts could still log in | Blocked |
| Medium | Hidden or blocking users appeared on leaderboards and in the feed; banned influencer pages were still served | Filtered |
| Medium | A verified influencer could swap their Instagram handle | Locked |
| Medium | Referral tokens farmed with fake sign-ups | Reward (50 + 50) now paid after the new user's **first completed workout** |
| Medium | Login rate limit reset with a fake `X-Forwarded-For` | Limit is per account (email), not per IP |
| Medium | Unlimited uploads (Cloudinary cost); loose file-type check | 40 uploads/hour per user; strict jpg/png/webp |
| Medium | 15 session invites to one buddy | Max 3 pending per buddy, up to 30 days ahead |
| Low | Admin list: sort by passwordHash, limit=1,000,000 | Allowed sort list; max 100 per page on **every** list |
| Low | Last SUPER_ADMIN could lock everyone out; unknown admin roles accepted | Blocked |
| Low | Old admin tokens kept working after a password change | Tokens carry a password version |
| Low | Passwords over 72 characters silently cut | Rejected |
| Low | Inputs too long → 500 errors showing Prisma internals; a 50 000-item array took 9 s to check | Length limits; cheap validation; 500 errors never show internals |
| Low | One user could inflate brand-ad clicks; blocked users could still join a chat room via socket | Fixed |

**Android:**
- Release builds were signed with the **debug key**, which the Play Store rejects. Create `android/key.properties` with:
  ```
  storeFile=../../jks/seshlly_jks
  storePassword=…
  keyAlias=…
  keyPassword=…
  ```
- Removed the unused microphone permission.

**Admin panel:** changing the password now keeps you logged in (new token). The new password needs at least 10 characters, one capital letter and one number.

## 9. Round 7 (1 Nov) — security hardening + 10 product features

All new logic is covered by tests written first (TDD): **205 backend tests pass** (28 suites, real MariaDB). New Flutter unit tests: `test/features/session/workout_session_test.dart`, `test/core/offline_cache_test.dart`. Deploy with `npx prisma db push` (or run sections 10–12 of `prisma/migrations_manual/2026_10_chat_mode_proof_confirm.sql`).

### Security

| # | What | How it works |
|---|---|---|
| 1 | **Email verification (OTP)** | A 6-digit code is emailed at sign-up (`POST /auth/email/send-code` to resend, max 1/min). `POST /auth/email/verify {otp}` (5 tries, 15 min). Only a hash is stored; codes for reset and verify can't be swapped. App: "Verify your email" card on the Profile screen. Referral rewards need a verified email. *Phone OTP needs an SMS provider (MSG91 / Twilio) — not added.* |
| 2 | **Admin 2-factor login (TOTP)** | Admin panel → Profile → "Two-factor login": add the key to Google Authenticator / Authy, enter a code to turn it on. Login then asks for the 6-digit code. The secret is stored encrypted (AES-256-GCM, key `ADMIN_2FA_KEY`). |
| 3 | **Weak secrets block production start** | In `NODE_ENV=production` the server refuses to start if JWT / admin secrets are missing, short (< 32 chars) or the example values. Seed creates a random admin password (or `SEED_ADMIN_PASSWORD`). |
| 4 | **nginx / Cloudflare** | `deploy/nginx.conf`: HTTPS, rate limits, websocket, real client IP. Set `TRUST_PROXY=1` (nginx only) or `2` (Cloudflare + nginx). |
| 5 | **Proof photo timing** | Session proof must be uploaded with the in-app camera **after** the session starts (10 min grace). Station proof must be uploaded after joining the challenge. Old gallery photos are rejected. |
| 6 | **security.txt** | `GET /.well-known/security.txt` (contact = `SECURITY_CONTACT`). |

### Product

| # | Feature | Logic |
|---|---|---|
| 1 | New-user boost | People who joined < 48 h ago are shown right after paid boosts in Discover, with a **NEW** badge. |
| 2 | Plan from the Gym Map | Gym sheet → **Plan a session here** opens Schedule with the gym filled in. |
| 3 | **On my way** | Button on the session card from 90 min before the start until the end. Once per person; host or confirmed people only. Buddy gets a push and a line in the chat. `POST /sessions/:id/on-my-way` |
| 4 | Weekly recap | Sunday 7 PM IST push: "3 sessions · 240 XP · #4 in Noida". Only people who earned XP that week. |
| 5 | Streaks that really break + streak freeze | 9 PM IST reminder now uses the IST day and shows the streak length. At 00:05 IST a streak that missed a whole day resets to 0 (both told). Pro/Elite pairs get **one free streak freeze every 30 days**. |
| 6 | Group session chat | Group chats (3+ people) now open: list, read, send, socket, push to every member. Declining the invite removes you from the group. No Flash / block / profile tap in groups. |
| 7 | Share my session | **Share** button on upcoming session cards (WhatsApp, SMS, anything) with the Play Store link. |
| 8 | Funnel analytics | First-time events: `funnel_sign_up`, `funnel_first_match`, `funnel_first_session`, `funnel_first_proof`, `funnel_first_completed`, plus `on_my_way`, `session_shared`, `plan_from_map`, `rating_prompt`. See the drop-off in Firebase → Analytics → Funnels. |
| 9 | Offline cache | Chat list, latest messages of each chat and the Discover deck are saved; with no internet the last copy is shown instead of an error. Real server errors are never hidden. Cleared on logout. |
| 10 | Rating prompt | Once, after the first completed session: **Rate us** → Play Store, **Not really** → support email (so unhappy users talk to you, not a 1-star review). |

### You must do these (can't be done from code)

1. **Change every admin password** that is still `Admin@123456`, then turn on 2-factor login for every admin.
2. **New secrets**: generate with `openssl rand -hex 48` for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_JWT_SECRET`, `ADMIN_2FA_KEY`. Keep them in your host's secret manager (AWS Secrets Manager / Render / Railway env), not in git. Changing JWT secrets logs everyone out once.
3. **Cloudflare**: add the domain, DNS proxied (orange cloud), SSL mode *Full (strict)*, turn on Bot Fight Mode and a rate-limit rule for `/api/v1/auth/*`. In `deploy/nginx.conf` uncomment the `set_real_ip_from` Cloudflare ranges. Set `TRUST_PROXY=2`.
4. **SMTP** must be set (`SMTP_HOST` …) or users never get the verify / reset codes.
5. **External pen-test / bug bounty** before or soon after launch (e.g. a local CERT-In empanelled firm, or a small program on HackerOne / Intigriti). The `security.txt` contact must be a real mailbox.
6. Optional: AI photo checks (Hive / Sightengine) for nudity and "photo of a screen" if fake proofs show up.

**Not done:** the admin token is still stored in the browser's localStorage (not an httpOnly cookie). With 2FA, short tokens and password-version checks the risk is low; moving to cookies needs a CSRF layer and same-site hosting of admin + API — worth doing once the admin domain is fixed.

**Known limit:** in group chats the "read" tick is shared (one member opening the chat marks messages read for all).

## 10. Load test — 1000 users at once (1 Nov)

**How:** the real API + MariaDB, 1000 virtual users, each with its own IP and login, all doing every step **at the same moment** (a spike much harder than real launch traffic). Tool: `scripts/loadtest/sim.js` (run it on staging: `LOADTEST_CONFIRM=yes BASE_URL=… DATABASE_URL=… npm run loadtest:flows`).

**Flows tested (in order):** sign up → onboarding profile → `/auth/me` → socket connect → Discover (2 pages) → likes (pairs + groups of 3) → match → chat list → join chat rooms → 3 messages each → read → schedule session (450: pairs + groups) → invitee confirms → "On my way" → proof photo → buddy confirms → every tab (leaderboards, feed, notifications, Flash, challenges, referral, strikes, boost, buddies, requests, ads, gyms) → 60 s of mixed traffic. Then every background job on the 1000-user data.

### What broke, and the fix (all with tests first)

| # | What broke under load | Fix |
|---|---|---|
| 1 | **Sign-up froze the server**: only **53 of 1000** sign-ups finished in 30 s; every other request waited. Password hashing (bcryptjs cost 12) is pure JS on the main thread. | Built-in **scrypt** (runs off the main thread). 1000/1000 sign-ups succeed. Old bcrypt passwords still work and are upgraded on next login — nobody has to reset. |
| 2 | **Database connections ran out** (Prisma default = 5 on 2 vCPU) → likes and messages failed ("Unable to start a transaction") — 240 errors. | `connection_limit=20&pool_timeout=20` in `DATABASE_URL` (see `.env.example`) + writes wait 10 s for a connection instead of 2 s. |
| 3 | Two people liking each other **at the same moment** → 500 error, match half-made. | Second request sees the match and returns "matched" with the chat. |
| 4 | Both people typing at once → **deadlock** on the chat → message lost (500). | Message saved first; the "last message" preview updated separately. 20 parallel messages: all saved. |
| 5 | Group "On my way": 3 taps at once → "Please try again". | Retries automatically. |
| 6 | Counts (buddies, sessions, unread badge) scanned the **whole** matches / sessions / messages tables on every `/auth/me`, Discover, buddies and chat list. Bug too: buddy count missed half your buddies. | Counted only for the people / chats on screen. Buddy count now correct. |
| 7 | Chat list and "My sessions" read the whole chats / sessions table (OR + EXISTS). | Three small indexed lookups each. |
| 8 | Session-invite / proof cards found by scanning JSON of all messages. | New indexed `messages.sessionId` (migration backfills old cards). |
| 9 | Leaderboard: everyone re-sorted all users (p95 28 s, time-outs). | Top list cached 30 s; blocks / hidden / **your own row** still live. |
| 10 | Gym map: **1300 opens = 1300 calls** to the free Overpass API; when it's slow, everyone waits 15 s. | One shared call per area; a failure is remembered for 1 min; last good list served if the API fails. |
| 11 | Notifications table grows forever (10 000 rows/hour at 1000 active users). | Daily clean-up: read > 30 days, all > 90 days. Indexes for the list + badge. |
| 12 | Weekly recap: one query per user (6.7 s / 1000 users). | Grouped queries (3.5 s, mostly the pushes). |

**Result after fixes:** 45 000 requests, **0 server errors** (was 240), all 1000 sign-ups, 675 matches, 450/450 sessions completed end-to-end, 1000 sockets connected, 10 836 live chat events delivered. All background jobs < 0.1 s except the weekly recap (3.5 s).

### Capacity — what this means for launch

- The test box had **2 vCPU** and ran the API **and** the database **and** the 1000 simulated phones together, using a slower sandbox database client — so the absolute times (seconds) are much worse than your real server will see. App code was < 2 % of CPU; the rest was database client, JSON and sockets.
- One 2-vCPU API instance handled **~130 requests/second** steady here. 1000 people *online at the same minute* ≈ 200–350 req/s at peak → plan **2 API instances** (or 4 vCPU) for launch day, and a **separate managed MySQL**.
- Memory peaked at **~760 MB** with 1000 open sockets → give each API instance **at least 1 GB RAM** (512 MB plans will crash).
- **Before running 2+ instances** you must add: Socket.IO Redis adapter (`@socket.io/redis-adapter`, else chat messages don't reach people connected to the other instance) and a shared rate-limit store (Redis). Not added yet — new packages; tell me when you pick the host.
- Gym map: the free Overpass API is shared and rate-limited. For launch set `GOOGLE_MAPS_API_KEY` (results are cached 6 h per ~1 km area, so cost stays low) or host your own Overpass.
- Run `scripts/loadtest/sim.js` once on staging (same machine size as production) before launch — that gives your real numbers.

## 11. Architecture round (1 Nov) — idempotency, multi-server safety, indexes

Full write-up with the architecture diagram: the "Seshlly System Architecture" doc (shared in chat). Short version:

- **Idempotency keys** (`src/middleware/idempotency.js`, table `idempotency_keys`): the app sends `Idempotency-Key` on every action that must happen once (messages, bookings, proof, confirm, payments, tokens, likes, Strike/Flash, reports, check-in …). A retry with the same key gets the first answer back; nothing runs twice. The app re-sends automatically on timeout / no internet / 502–504 / "still working" (max 2, same key). Old app versions without the header work as before.
- **Cron jobs run on one server** (`src/schedulers/jobLock.js`, table `job_runs`): safe to run 2+ API servers; no weekly recap / streak warning twice.
- **Razorpay webhook** `POST /api/v1/subscriptions/webhook` (`RAZORPAY_WEBHOOK_SECRET`): paid but app closed → plan / tokens still credited, exactly once (table `webhook_events`).
- **Indexes measured on 50k users / 1M messages / 1M notifications**: weekly recap 649 → 89 ms, notification clean-up 218 → 10 ms, missed-session cron 12,588 → 1 row read, My sessions / Who liked me without sorting. A Discover geo-grid was tried and dropped (no measurable gain).
- Deploy: `npx prisma db push` or section 13 of the manual SQL file (checked: old schema + file = new schema).

## 12. User manual + fixes found while writing it (1 Nov)

The full user manual (App guide, Admin guide, Rules and limits, Test checklist) is the "Seshlly User Manual" doc shared in chat. Writing it step by step against the code found these, now fixed with tests (250 backend tests pass):

| Found | Fix |
|---|---|
| Two level tables: sessions used 0/500/1,500… ("Grinder"), the app and matches 0/100/300… ("Rookie") → level-up push and profile disagreed | One table everywhere (the app's). Run section 14 of the manual SQL once to re-compute existing users' levels. |
| Match XP didn't count for weekly / monthly leaderboards; two XP awards at once could lose one | All XP goes through one atomic path |
| Like limit 5 a day, but a super-like checked 10 (same counter); the day reset at 5:30 AM IST | One rule: 5 a day incl. super-likes (Free), reset at midnight IST; counted atomically |
| "Upload proof" push every 30 min for 8 h (up to 16), starting mid-workout, host only; text said "8 hours" | One push when the session ends, to everyone who can upload; text says 3 hours (the real window). App walkthrough text fixed too. |
| A second, older "missed session" job charged 2 tokens (could go below 0) next to the real rule | Removed; one rule: Trust −5, 1 token, 3 h after the end |
| Admin panel still said "FitConnect" (tab title, dashboard, broadcast preview) | "Seshlly" |

Not built in v1 (documented in the manual): the app has no referral screen (server is ready), solo sessions can't be booked from the app, and admin Broadcast shows in the bell list without a phone push.

## 13. Fixes found while writing the PDF user guide

| Problem | Now |
|---|---|
| Creating an admin accepted any 10-character password (own password change needed a capital and a number) | Same rule everywhere: 10+ characters, a capital and a number (test in `pentest2-admin-auth.test.js`) |
| App and seed plan texts promised more than v1 does (e.g. "unlimited super-likes", "100 tokens") | Texts match the real limits: Free 5 likes a day incl. 1 super-like; Pro unlimited likes, 5 super-likes a day, up to 50 tokens a month, 1 streak freeze every 30 days; Elite everything in Pro + influencers (3 sessions a month each) |
| Elite users got no monthly 50 tokens and had the Free token cap (50) for session rewards | Elite = Pro: +50 tokens on the 1st, cap 200 (`tests/integration/token-refill.test.js`) |

**Do once after deploy:** plans already in the database keep their old feature text (the seed only fills a new database). Edit Free, Pro and Elite in admin → Plans to match the list above.

The complete user guide is `Seshlly_User_Guide.pdf` (34 pages: App, Admin, Reference, test checklist, known v1 gaps).
