## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

### Model reasoning

```text
The user wants me to summarize PLAN.md in exactly three bullets. I need to read the file first.
```

- tool `read` PLAN.md

### Model reply

- **Problem:** one customer's script fired 40,000 orders in ten minutes, degrading every other customer; fix is rate limiting in `src/server.ts`, shipping this week.
- **Existing setup:** 3 round-robin instances behind a load balancer, a shared Redis 7 session cluster available for use, `POST /orders` as the costly Postgres write vs. a cheap `GET /orders`, and ~20 enterprise integrations that legitimately burst.
- **Open decisions:** limiter key (`x-customer-id`, IP, or both), algorithm (fixed/sliding window vs. token bucket), counter storage (Redis vs. per-instance memory), fail-open vs. fail-closed on store outage, enterprise limit tiers and their owner, rejection response shape, and a rollout that doesn't break those integrations.

