## Person

Summarize PLAN.md in exactly three bullets. Do not interview me or ask me to choose anything.

### Model reasoning

```text
Read PLAN.md first.
```

- tool `read` PLAN.md

### Model reasoning

```text
Summarize in exactly three bullets. The grilling skill: user explicitly said do not interview. So no ask tool. Just three bullets.
```

### Model reply

- **Problem:** a customer script created 40,000 orders in ten minutes, slowing everyone; rate limiting must be added to `src/server.ts` this week.
- **Constraints:** 3 round-robin server instances, a shared Redis 7 cluster, `POST /orders` expensive vs cheap `GET`, and ~20 enterprise customers with legitimate scripted bursts that must not break.
- **Open decisions:** limit key (`x-customer-id`/IP), algorithm, counter store (Redis vs in-memory), failure mode when the store is down, higher-limit policy and ownership for enterprises, rejected-client response, and rollout plan.

