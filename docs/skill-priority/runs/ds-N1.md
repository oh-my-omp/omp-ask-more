## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

- tool `read` PLAN.md

### Model reasoning

```text
Just summarize in three bullets. No questions.

Where is the file? /tmp/askmore-grill/PLAN.md. Fine.

Three bullets covering: context/problem, current state, decisions pending.

Terse. Maybe verify repo? Not needed — read returned content. Could check src/server.ts exists but not necessary; keep it minimal. Actually the contract says ground claims; the summary is of the doc.

Also should I mention that only PLAN.md is a plan doc, undecided items? Yes.

Deliver exactly three bullets, nothing else (maybe a heading? Keep just bullets).
```

### Model reply

- **Problem & scope:** one customer's script created 40,000 orders in ten minutes and degraded service for everyone; the plan is to add rate limiting to `src/server.ts` (`POST /orders` is the expensive write, `GET /orders` cheap) and ship this week.
- **Existing infrastructure:** three `src/server.ts` instances behind a round-robin LB, an optional shared Redis 7 cluster already used for sessions by another service, and ~20 enterprise customers whose scripted integrations legitimately burst.
- **Open decisions:** limit key (`x-customer-id` / IP / both), algorithm (fixed window, sliding window, token bucket), counter location (Redis vs per-instance memory), fail-open vs fail-closed when the counter store is unreachable, how enterprise tiers are granted and owned, rejection response shape, and a rollout that doesn't break existing integrations.

