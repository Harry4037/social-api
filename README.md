# FitConnect Backend API

Node.js · Express · MySQL · Prisma · Socket.io · Razorpay

---

## Quick Start

```bash
# 1 — Install dependencies
npm install

# 2 — Copy env and fill in your values
cp .env.example .env

# 3 — Push schema to MySQL
npm run db:push

# 4 — Seed demo data
npm run db:seed

# 5 — Start dev server
npm run dev
```

Server: `http://localhost:5000`  
Health: `http://localhost:5000/health`

---

## Project Structure

```
src/
├── config/
│   ├── db.js               — Prisma singleton
│   └── logger.js           — Winston + daily rotate
├── controllers/
│   ├── auth.controller.js
│   ├── user.controller.js
│   ├── match.controller.js
│   ├── session.controller.js
│   ├── chat.controller.js
│   ├── notification.controller.js
│   ├── subscription.controller.js
│   └── upload.controller.js
├── middleware/
│   ├── auth.js             — JWT authenticate, requireToken, requirePro
│   ├── middleware.js       — validate, errorHandler, rateLimiters
│   └── upload.js           — multer config
├── routes/
│   ├── auth.routes.js
│   └── index.js            — all other routers
├── services/
│   ├── notification.service.js
│   └── xp.service.js
├── socket/
│   └── socket.js           — Socket.io rooms + typing
├── jobs/
│   └── scheduler.js        — missed session cron, proof reminders
├── utils/
│   ├── response.js         — success / error / paginated helpers
│   ├── jwt.js              — sign / verify tokens
│   ├── xp.js               — level thresholds + rewards
│   ├── compatibility.js    — Haversine + score algorithm
│   └── formatUser.js       — safe serialisers
└── server.js               — entry point
```

---

## API Reference

Base URL: `http://localhost:5000/api/v1`

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/auth/register` | — | Register new user |
| POST | `/auth/login` | — | Login, receive token pair |
| POST | `/auth/refresh` | — | Refresh access token |
| POST | `/auth/logout` | ✅ | Revoke refresh token |
| GET  | `/auth/me` | ✅ | Get current user |

**Register / Login response shape:**
```json
{
  "success": true,
  "data": {
    "user": { ...UserModel },
    "accessToken":  "eyJ...",
    "refreshToken": "eyJ..."
  }
}
```

### Users / Profile

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| PUT  | `/users/me` | ✅ | Update profile |
| GET  | `/users/:id/profile` | ✅ | Get buddy's public profile |

### Match / Discover

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET    | `/match/discover` | ✅ | Discover profiles (filtered, paginated) |
| POST   | `/match/like` | ✅ | Swipe right on a user |
| POST   | `/match/skip` | ✅ | Swipe left on a user |
| GET    | `/match/buddies` | ✅ | Get all matched buddies |
| DELETE | `/match/buddies/:buddyId` | ✅ | Remove a buddy |

**Discover query params:** `activity`, `level`, `lat`, `lng`, `maxDistance`, `page`, `limit`

**Like response (mutual match):**
```json
{ "data": { "matched": true, "matchId": "uuid" } }
```

### Sessions

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/sessions` | ✅ | Schedule a session |
| GET  | `/sessions/my` | ✅ | Get my sessions |
| POST | `/sessions/:id/proof` | ✅ | Upload proof, mark completed |

**Sessions query params:** `status` (`scheduled` / `completed` / `missed`), `page`, `limit`

### Chat

| Method | Endpoint | Auth | Tokens | Description |
|--------|----------|------|--------|-------------|
| GET   | `/chat` | ✅ | — | List all chats with unread counts |
| GET   | `/chat/:chatId/messages` | ✅ | — | Paginated messages |
| POST  | `/chat/:chatId/messages` | ✅ | **-1** | Send message |
| PATCH | `/chat/:chatId/read` | ✅ | — | Mark chat as read |

### Notifications

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET   | `/notifications` | ✅ | Paginated notifications |
| PATCH | `/notifications/read-all` | ✅ | Mark all read |
| PATCH | `/notifications/:id/read` | ✅ | Mark one read |

### Subscriptions & Payments

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/subscriptions/plans` | — | List plans |
| POST | `/subscriptions/order` | ✅ | Create Razorpay order for a plan |
| POST | `/subscriptions/verify-payment` | ✅ | Verify payment + activate plan |
| POST | `/tokens/buy` | ✅ | Create order for token pack (10/20/50) |

### Upload

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/upload` | ✅ | Upload image (multipart/form-data) |

**Form fields:** `file` (image), `folder` (`avatars` / `proofs` / `covers`)

---

## Standard Response Envelope

```json
{
  "success": true,
  "message": "...",
  "data": { ... }
}
```

**Paginated:**
```json
{
  "success": true,
  "data": [ ... ],
  "pagination": { "page": 1, "limit": 20, "total": 100, "totalPages": 5, "hasMore": true }
}
```

**Error:**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [{ "field": "email", "message": "Valid email required" }]
}
```

---

## Socket.io Events

Connect: `io('http://localhost:5000', { auth: { token: 'Bearer ...' } })`

| Direction | Event | Payload | Description |
|-----------|-------|---------|-------------|
| Client → Server | `chat:join` | `{ chatId }` | Join a chat room |
| Client → Server | `chat:leave` | `{ chatId }` | Leave a chat room |
| Client → Server | `typing:start` | `{ chatId }` | Start typing |
| Client → Server | `typing:stop` | `{ chatId }` | Stop typing |
| Server → Client | `message:new` | `Message` | New message in room |
| Server → Client | `typing:start` | `{ userId, chatId }` | Buddy typing |
| Server → Client | `typing:stop` | `{ userId, chatId }` | Buddy stopped |
| Server → Client | `user:online` | `{ userId }` | User came online |
| Server → Client | `user:offline` | `{ userId }` | User went offline |

---

## Background Jobs (node-cron)

| Schedule | Job | Description |
|----------|-----|-------------|
| Every 5 min | `markMissedSessions` | Marks overdue sessions as `missed`, deducts 2 tokens |
| Every 30 min | `proofReminders` | Sends push notifications to users who haven't uploaded proof |

---

## Environment Variables

See `.env.example` for the full list. Critical ones:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | MySQL connection string |
| `JWT_ACCESS_SECRET` | ≥32 char random string |
| `JWT_REFRESH_SECRET` | ≥32 char random string |
| `RAZORPAY_KEY_ID` | From Razorpay dashboard |
| `RAZORPAY_KEY_SECRET` | From Razorpay dashboard |

---

## Demo Credentials (after `npm run db:seed`)

| Email | Password | Plan |
|-------|----------|------|
| alex@demo.com | Test@1234 | Pro |
| priya@demo.com | Test@1234 | Free |
| rahul@demo.com | Test@1234 | Elite |
