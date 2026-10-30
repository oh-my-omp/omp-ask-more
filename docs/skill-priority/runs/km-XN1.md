## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

### Model reasoning

```text
The user wants a summary of PLAN.md in exactly three bullets. I should read the file first.
```

- tool `read` PLAN.md

### Model reasoning

```text
PLAN.md is short. I need exactly three bullets summarizing it. The plan is about adding rate limiting to the orders API due to one customer creating 40K orders in 10 minutes. Key points:
1. Goal/context: add rate limiting to POST /orders in src/server.ts to prevent one customer from monopolizing resources.
2. Current infra constraints: 3 server instances behind LB, existing Redis 7 cluster, expensive POST vs cheap GET, enterprise customers burst legitimately.
3. Open decisions: key (customer ID/IP/ both), algorithm, counter store, failure mode, enterprise limits, rejection response, rollout strategy.

Need exactly three bullets. No interview. No questions.
```

### Model reply

- Add rate limiting to `POST /orders` in `src/server.ts` this week after one customer scripted 40,000 orders in ten minutes and degraded service for everyone else.
- Operate from a three-instance round-robin deployment with an available Redis 7 cluster, while treating `POST /orders` as expensive and `GET /orders` as cheap, and preserving legitimate burst traffic from ~20 enterprise scripted integrations.
- Still undecided: the rate-limit key, algorithm, counter store and its failure mode, enterprise-limit ownership, the rejected-client response, and the rollout plan.

