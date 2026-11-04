# Seshlly API — tests

| Folder | What | Needs a database? |
|---|---|---|
| `tests/unit` | pure functions (URL rules, paging, gym data mapping, notification types) | no |
| `tests/integration` | real HTTP requests against the Express app + a real MySQL test DB (auth, matching, sessions & invites, proofs/XP, challenges, feed, chat, gym map, privacy, abuse/pen-test cases) | **yes** |

## Run

```bash
# 1. one-time: an EMPTY database whose name contains "test"
mysql -uroot -e "CREATE DATABASE seshlly_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
DATABASE_URL="mysql://root:pass@localhost:3306/seshlly_test" npx prisma db push

# 2. run (re-run step 1's db push whenever schema.prisma changes)
export DATABASE_URL_TEST="mysql://root:pass@localhost:3306/seshlly_test"
npm test                 # everything
npm run test:unit        # fast, no DB
npm run test:integration
```

Safety: tests delete all rows between cases, so `tests/setup/env.js` refuses to
start unless `DATABASE_URL_TEST` points to a database with **test** in its name.
Your real `DATABASE_URL` in `.env` is never used. External services (Google,
OpenStreetMap, email, Firebase, Hive) are switched off or mocked.

Rule we follow (TDD): every bug fix starts with a test that fails on the old
code, then the fix makes it pass. Keep it that way — add the test first.
