## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

### Model reasoning

```text
The user wants me to summarize PLAN.md in exactly three bullets. I should read the file first. No need to ask questions since the instruction says don't interview or ask to choose.
```

- tool `read` PLAN.md

### Model reasoning

```text
The user wants a 3 bullet summary. The plan is about adding rate limiting to orders API. I need to summarize the key points in exactly 3 bullets. No questions.
```

### Model reply

- Goal: add rate limiting to `src/server.ts` for `POST /orders` this week, after one customer created 40,000 orders in ten minutes and degraded performance for everyone else.
- Current environment: three server instances behind a round-robin load balancer; Redis 7 cluster is available; `POST /orders` is expensive, `GET /orders` is cheap; about 20 enterprise customers rely on scripted integrations that burst.
- Open decisions: key strategy (`x-customer-id`, IP, or both), algorithm, counter storage, behavior when the store is unreachable, enterprise limits/ownership, rejection response, and rollout plan.

