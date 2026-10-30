## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

### Model reasoning

```text
I need to read PLAN.md in the current working directory and summarize it in exactly three bullets. I should not ask the user anything.
```

- tool `read` PLAN.md

### Model reasoning

```text
The PLAN.md is short and clear. I need to summarize it in exactly three bullets. Key points:
1. Problem: one customer's script created 40,000 orders in 10 minutes, slowing others. Goal: add rate limiting to src/server.ts this week.
2. Current setup: 3 instances behind round-robin LB, Redis 7 cluster available, POST /orders is expensive, GET is cheap, enterprise customers legitimately burst.
3. Open decisions: key (x-customer-id/IP), algorithm, counter store, fallback behavior, enterprise limit process, rejection response, rollout strategy.

I should keep it to exactly three bullets, concise, no questions.
```

### Model reply

- **Goal:** Add rate limiting to `src/server.ts` and ship this week after one customer created 40,000 orders in ten minutes and degraded service for everyone else.  
- **Context:** Three server instances sit behind a round-robin load balancer; `POST /orders` is the expensive Postgres write, `GET /orders` is cheap, a Redis 7 cluster is available for shared state, and about 20 enterprise customers have legitimate scripted bursts.  
- **Open questions:** Limit key (`x-customer-id`, IP, or both), algorithm, counter storage, behavior when the store is unreachable, enterprise limit assignment/ownership, client-facing rejection format, and rollout plan.

