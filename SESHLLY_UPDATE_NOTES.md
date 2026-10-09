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
