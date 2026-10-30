## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

- tool `read` PLAN.md

### Model reply

- One customer’s script created 40,000 orders in ten minutes, slowing other customers; the plan is to add rate limiting to `src/server.ts` and ship this week.
- The service has three server instances behind a round-robin load balancer; `POST /orders` is expensive, `GET /orders` is cheap, and about 20 enterprise customers may legitimately burst.
- Keying, algorithm, counter storage, behavior during store outages, enterprise limit ownership, rejection response, and rollout strategy are still undecided.

