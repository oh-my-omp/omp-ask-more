## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to read PLAN.md first, and also read the grilling skill instructions. Let me do both in parallel.
```

- tool `read` PLAN.md

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

### Model reasoning

```text
I need to read the grilling SKILL.md to follow instructions, then examine the project context to understand what exists.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
I should read the source files to understand the current implementation. This is factual groundwork I can do myself.
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Now I have enough context. Let me map the design tree from PLAN.md:

Root decisions from "Not decided yet":
1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if the counter store is unreachable: let requests through or reject them.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll it out without breaking the enterprise integrations.

But some decisions depend on others. Let me think about dependencies:
- Algorithm and where counters live are somewhat independent, but Redis makes token bucket easier; memory-only across 3 instances would need sticky sessions or per-IP averaging.
- What happens if counter store unreachable depends on where counters live (only relevant if Redis).
- Enterprise higher limits depends on what key is used (if keyed on customerId, then per-customer limits; if IP, then per-IP limits).
- Rollout depends on algorithm, keys, limits.
- Rejected client response is fairly independent.

Round 1 frontier (no prerequisites needed):
Q1: Key dimension (x-customer-id, IP, both)
Q2: Counter location (Redis, in-memory)
Q3: Algorithm (fixed window, sliding window, token bucket)
Q4: Rejected client response (status code, body, headers)

Wait, but algorithm and counter location are not fully independent. Memory counters with 3 instances behind round-robin means each instance only sees a fraction of requests. For customerId-based limiting, this would under-limit (each instance allows full rate). So if user chooses in-memory, the key choice matters. But these are still independent decisions at this level - they just have consequences.

Actually, the frontier should include decisions I can ask now without guessing. I can ask all the top-level ones now. The dependency is about consequences, not about whether I can ask the question.

But per the skill instructions, "A question whose answer depends on another question still open in this round belongs to a later round, not this round." So I should only ask questions whose answers don't depend on other currently-open questions.

The "not decided yet" list is the frontier. I can ask all of them as round 1? Some have dependencies between them. Let me think:

- Key dimension: prerequisite: none
- Counter location: prerequisite: none (but affects algorithm feasibility)
- Algorithm: prerequisite: none (but if memory-only, fixed window is weird across instances)
- Failure mode (counter store unreachable): depends on counter location (only relevant if Redis)
- Enterprise limits: depends on key dimension (higher limits keyed by same thing)
- Rejected client response: depends on nothing strongly
- Rollout: depends on key, counter location, algorithm, limits

So frontier round 1: Q1 key, Q2 counter location, Q3 algorithm, Q4 rejected client response.

Actually, the failure mode question only matters if Redis is chosen. So I should hold it for round 2. Enterprise limits depend on key choice, so hold for round 2. Rollout depends on many things, hold for later.

So Round 1:
Q1: Key on x-customer-id? (recommended: yes, since plan mentions customer-id header exists and the problem is one customer)
Q2: Use Redis for counters? (recommended: yes, because 3 instances behind round-robin; memory-only would under-limit by 3x for customer-keyed)
Q3: Token bucket algorithm? (recommended: yes, allows bursts for enterprise)
Q4: Reject with 429 Too Many Requests with Retry-After? (recommended: yes)

I need to phrase each so "yes" accepts my recommendation. Let me draft:

Q1 - Limit key: Should we key the rate limit on `x-customer-id` only, rather than client IP or a combination?
Recommended: Yes. The header is already required and authenticated (401 if missing), the incident was one customer, and enterprise integrations are identified by customer. IP is unreliable behind the load balancer and would split a customer's traffic across limits.

Q2 - Counter store: Should counters live in the existing Redis 7 cluster rather than in each instance's memory?
Recommended: Yes. With 3 round-robin instances, in-memory counters would let each instance grant its own full allowance, so a single customer could issue 3x the intended limit. Redis also lets us share enterprise-tier limits and rollout configuration centrally.

Q3 - Algorithm: Should we use a token bucket rather than fixed or sliding window?
Recommended: Yes. Token bucket naturally supports the legitimate bursts from enterprise scripts while still capping sustained rate. Fixed window creates spike-at-window-edge behavior; sliding window is more complex for similar gain.

Q4 - Rejection contract: Should rejected clients receive HTTP 429 with a `Retry-After` header and a JSON body explaining the limit?
Recommended: Yes. 429 is the standard status for rate limiting; `Retry-After` lets scripts back off deterministically; a JSON body (`{error, retryAfter, limit}`) makes debugging easier for enterprise customers.

That's round 1. I'll present these and wait.
```

### Model reply

I read `PLAN.md` and the current code. `src/server.ts` already requires and validates `x-customer-id`, there are 3 stateless instances behind a round-robin load balancer, and the Redis 7 cluster is already running for sessions.

Here is the first frontier of decisions we can settle now; later decisions (failure mode, enterprise limits, rollout) depend on these.

---

❓ **Q1 - Rate-limit key**: Should we key the rate limit on `x-customer-id` only, rather than client IP or a combination?

The server already returns 401 when the header is missing, so it is effectively authenticated. The incident was one customer issuing 40,000 orders, and the enterprise integrations are also identified by customer. IP is unreliable behind a load balancer and would split a single customer's traffic across different limits.

➡️ **Yes** — key on `x-customer-id` only.

---

❓ **Q2 - Counter store**: Should counters live in the existing Redis 7 cluster rather than in each instance's memory?

With 3 round-robin instances, per-instance memory counters would each grant the full allowance, so one customer could consume roughly 3× the intended limit. Redis also gives us one place to store per-customer enterprise limits and rollout configuration.

➡️ **Yes** — use the Redis 7 cluster for counters.

---

❓ **Q3 - Rate-limit algorithm**: Should we use a token bucket rather than fixed or sliding window?

Token bucket naturally accommodates the legitimate bursts from enterprise scripts while still capping sustained rate. Fixed window causes burst-at-window-edge behavior; sliding window is more complex without much gain here.

➡️ **Yes** — use token bucket.

---

❓ **Q4 - Rejection contract**: Should rejected clients receive HTTP 429 with a `Retry-After` header and a JSON body explaining the limit?

`429 Too Many Requests` is the standard signal; `Retry-After` lets scripted integrations back off deterministically; a small JSON body (`{error, retryAfter, limit}`) makes debugging easier for enterprise customers.

➡️ **Yes** — return 429 with `Retry-After` and a JSON error body.

## Person

Yes to all your recommendations.

### Model reasoning

```text
Great, round 1 is settled. Now I need to recompute the frontier.

Settled:
- Key: x-customer-id only
- Counter store: Redis 7 cluster
- Algorithm: token bucket
- Rejection contract: 429 + Retry-After + JSON body

Now the remaining open decisions:
- What happens if Redis is unreachable: let requests through or reject them.
- How enterprise customers get higher limits, and who owns those numbers.
- How to roll it out without breaking the enterprise integrations.

Dependencies:
- Enterprise higher limits: now that key is customer-id, we can ask how to assign different limits. This is independent of Redis failure mode and rollout.
- Redis failure mode: independent of other decisions. Can ask now.
- Rollout: depends on knowing enterprise limits (so we know what to rollout), and on failure mode (whether we can safely test). So rollout should be later.

Wait, but rollout also depends on the general approach. Can we ask some aspects of rollout now? The skill says if a question's answer depends on another open question, it belongs to a later round. Since enterprise limits are still open and rollout is affected by what those limits are, I should hold rollout.

So Round 2 frontier:
Q5: Redis failure mode - fail-open or fail-closed?
Q6: Enterprise customer limits - how are they determined and who owns the numbers?

Let me think about the Redis failure mode. The recommendation depends on the business context. If Redis is down and we reject all orders, we have a hard outage for order creation. If we fail open, a single bad actor can hammer us during a Redis outage. Given the Redis cluster is already used for sessions by another service, it's presumably considered reliable. But fail-closed (reject) means orders stop during Redis issues. Fail-open (let through) maintains availability but loses protection.

I think the safer default for an orders API is fail-open with logging/alerting, because availability of order creation is usually more important than rate limiting during infra issues. But there's a risk. Let me recommend fail-open.

For enterprise limits: The plan says "About 20 enterprise customers have scripted integrations that legitimately burst." So we need a way to give them higher limits. Options:
- Per-customer tier in a config/DB table (e.g., enterprise tier has 10x limit)
- Hardcoded list in config/env
- Self-serve via admin API
- Manually managed in Redis

Recommended: Store per-customer limits in Redis or a config table, with a default tier. Engineering owns the numbers initially, but customer success/sales should own assignment. Or maybe: default tier from env, override per customerId in Redis; customer success owns assignment via a simple admin endpoint or direct Redis update.

Actually, I should ask this as a single question or split into two? The original undecided item combines "how enterprise customers get higher limits" and "who owns those numbers." I can ask it as one question with a recommendation that covers both.

Let me phrase so yes accepts recommendation:

Q5 - Redis unreachable behavior: Should we fail open (allow requests through) if Redis is unreachable, rather than rejecting all requests with 429?

If Redis is down, rejecting every order creates a hard outage for order creation, which is usually worse than temporarily losing rate-limit protection. We can mitigate the risk by logging/alerting heavily and possibly adding a secondary circuit-breaker. The Redis cluster is already used for sessions, so it's expected to be reliable.

➡️ Yes — fail open when Redis is unreachable.

Q6 - Enterprise tier limits: Should enterprise customers get higher limits through a per-customer override in Redis (keyed by customerId), with a default limit for everyone else, and should Customer Success own the override values?

This keeps the limit data colocated with the counters, lets us adjust a single customer without redeploying, and makes ownership clear: engineering sets the default algorithm/values; Customer Success/account managers set per-customer overrides based on contracts.

➡️ Yes — per-customer override in Redis, default limit from config, Customer Success owns overrides.

These two are independent, so they can be in the same round. After these are answered, rollout can be round 3.
```

### Model reply

All four first-round decisions are settled: `x-customer-id` key, Redis counters, token bucket, and 429 + `Retry-After`.

The next frontier has two decisions that no longer depend on each other.

---

❓ **Q5 - Redis outage behavior**: Should we **fail open** (allow requests through) if Redis is unreachable, rather than rejecting every request with 429?

If the Redis cluster becomes unreachable, rejecting all `POST /orders` would create a hard outage for order creation. That is usually worse than temporarily losing rate-limit protection. We can mitigate the risk by logging/alerting heavily when operating without Redis, and the cluster is already relied on for sessions, so it is expected to be reasonably stable.

➡️ **Yes** — fail open when Redis is unreachable.

---

❓ **Q6 - Enterprise limit overrides**: Should enterprise customers get higher limits through a **per-customer override stored in Redis** (keyed by `customerId`), with a single default limit for everyone else, and should **Customer Success own the override values**?

This colocates limit data with the counters, lets us

