## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to:
1. Read the grilling skill first (required by workflow)
2. Read PLAN.md
3. Ask frontier questions in rounds

Let me start by reading the skill and PLAN.md.
```

- tool `read` skill://grilling

- tool `read` PLAN.md

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to work through the design tree in rounds.

The plan lists these undecided items:
1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if the counter store is unreachable: let requests through or reject them.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll it out without breaking the enterprise integrations.

Some of these have dependencies:
- Algorithm and counter store are somewhat independent, but some algorithms need shared state
- Counter store unreachable depends on where counters live
- Enterprise higher limits depends on keying decision (if keyed on customer-id, then customer-specific limits are easy)
- Rollout depends on keying and algorithm decisions

Frontier for round 1 - questions with no prerequisites:
- Q1: Key the limit on x-customer-id (recommended since enterprise customers have scripted integrations, and the incident was caused by one customer)
- Q2: Algorithm - token bucket (recommended for bursty enterprise traffic)
- Q3: Where counters live - Redis (recommended for 3 instances behind LB)
- Q4: Counter store unreachable behavior - fail open (recommended to avoid outage)
- Q5: Enterprise customer limits - per-customer limits owned by customer success/account management
- Q6: What a rejected client sees
- Q7: Rollout strategy

Actually, Q6 and Q7 don't depend on other decisions fundamentally. Q5 depends on Q1 (if keyed on IP, per-customer limits don't make sense). So Q5 should be later if Q1 isn't settled.

Wait - Q1 and Q3 are related. If counters are in memory, keying by x-customer-id across instances won't aggregate correctly. But I can still ask both as independent decisions since each has rationale.

Actually, let me think about dependencies more carefully:
- Q1 (key) is independent
- Q2 (algorithm) is independent
- Q3 (counter store) is independent but constrained by Q1 and Q2
- Q4 (unreachable behavior) depends on Q3
- Q5 (enterprise limits) depends on Q1
- Q6 (rejected response) is mostly independent
- Q7 (rollout) depends on Q1, Q2, Q3, Q5, Q6

So round 1 frontier: Q1, Q2, Q3, Q6
Round 2 would include Q4, Q5, Q7 after Q1 and Q3 are answered.

Wait, Q5 depends on Q1. If Q1 is answered in round 1, Q5 can be in round 2.
Q4 depends on Q3. If Q3 is answered in round 1, Q4 can be in round 2.
Q7 depends on several. So round 3.

But I should ask the whole frontier now. Frontier = decisions whose prerequisites are settled. Currently none are settled, so frontier is Q1, Q2, Q3, Q6.

Let me also check if there are facts I should look up. The skill says finding facts is my job. What facts might be relevant? I could look at the codebase to understand src/server.ts, existing middleware, deployment config, etc. But the user asked specifically about PLAN.md decisions. I think the main facts are in the plan itself. However, I could explore the repo structure to inform questions. Let me dispatch a sub-agent to look at the repo, but not block on it.

Actually, looking at the environment - I should explore to understand the codebase. This might inform better questions. But the user just wants me to grill on PLAN.md. The plan already states facts. I don't necessarily need more.

But the skill says "When a frontier question needs a fact from the environment... dispatch a sub-agent." Do my questions need facts? Maybe I should look at src/server.ts to understand the current structure, which could affect where rate limiting fits. But the user explicitly said "Do not implement the plan." They want grilling on decisions. The plan itself gives enough context.

I think I can proceed with round 1 based on the plan. But let me also do a quick read of the repo to see if there's additional context that matters. Actually, I can do that in parallel with asking questions? No, I should only ask questions now. If I need facts for questions, I get them first. But I don't think I need them for the frontier.

Wait, actually - I should be thorough. Let me read the project structure to understand what's there. This is a fact-finding step that might inform my questions but doesn't need to block the round. But the skill says "a running exploration is an unsettled prerequisite, so only the questions downstream of it wait." Since I don't have downstream questions that depend on repo structure yet, I can ask the frontier now and explore in parallel.

Actually, I can read the directory. Let me do that quickly.
```

- tool `read` .

- tool `read` src

### Model reasoning

```text
Good, I have the repo structure. Now let me read the actual source files to understand the current implementation. This will help me ask better questions.
```

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Now I have full context. Let me formulate the frontier questions for round 1.

The undecided items and their dependencies:

1. **Key**: x-customer-id, client IP, or both - independent
2. **Algorithm**: fixed window, sliding window, token bucket - independent
3. **Counter store**: Redis or in-memory - independent (though constrained by key and algorithm)
4. **Unreachable store behavior**: let through or reject - depends on counter store
5. **Enterprise limits**: how and who owns - depends on key
6. **Rejected client response**: independent
7. **Rollout**: depends on key, algorithm, counter store, enterprise limits, rejected response

Round 1 frontier: Q1 (key), Q2 (algorithm), Q3 (counter store), Q6 (rejected response)

For each question, I need to give a recommended answer and word it so "yes" accepts it.

Q1: Key on x-customer-id
- The incident was one customer creating 40k orders. IP can change, be shared via NAT, and doesn't map to customer identity. x-customer-id is already required by the API.
- Recommended: x-customer-id only

Q2: Algorithm
- Token bucket handles bursts well, which enterprise customers need. Fixed window can allow burst at window boundaries. Sliding window is more complex.
- Recommended: token bucket

Q3: Counter store
- 3 instances behind LB, so in-memory counters would be inconsistent (each instance allows its own limit, effectively 3x the rate). Redis cluster is available.
- Recommended: Redis cluster

Q6: Rejected client response
- Should be a 429 Too Many Requests with Retry-After header. This is standard and helps clients back off.
- Recommended: 429 with Retry-After header

Let me write these out.
```

### ask call

```json
{"questions":[{"id":"Q1","question":"Should we key the rate limit on `x-customer-id` only, rather than client IP or a combination of both?","options":[{"label":"Yes, use x-customer-id only","tradeoff":"Maps directly to the customer entity, avoids NAT/shared-IP false positives, and matches the existing auth header. Cannot limit a single customer that spreads across many IPs or rotates headers, but the incident was one customer, not one IP.","description":"Key rate-limit counters on the x-customer-id header.","preview":"`key = sha256(x-customer-id)`","holds_when":"Customers are the unit of fairness and abuse; IP is not a reliable customer proxy."},{"label":"Use client IP only","tradeoff":"Protects against header forgery/spoofing, but breaks when multiple customers share a NAT, a customer rotates IPs, or the load balancer masks the source IP.","description":"Key counters on the connecting client IP."},{"label":"Use both, requiring both to pass","tradeoff":"Most restrictive; a burst from a new IP for a known customer still gets blocked, but doubles the state and can lock out legitimate customers that move between IPs or datacenters.","description":"Require both x-customer-id and IP to be under limit."}],"brief":{"where":"PLAN.md says the incident was one customer's script creating 40,000 orders in ten minutes, and the API already requires `x-customer-id`.","what":"Decide the identity axis for rate-limit counters.","how":"This choice determines whether enterprise limits can be per-customer and whether shared IPs or header rotation become false positives."},"recommended":0},{"id":"Q2","question":"Should we use a token-bucket algorithm for the rate limiter?","options":[{"label":"Yes, token bucket","tradeoff":"Allows legitimate enterprise bursts up to a bucket size while bounding sustained rate; slightly more state than fixed window but fits the 'scripted integrations that legitimately burst' requirement.","description":"Use token bucket with a refill rate and max capacity.","preview":"`capacity = burst; tokens += refill_rate * Δt`","holds_when":"Traffic is bursty but long-term rate must be capped."},{"label":"Use fixed window","tradeoff":"Simplest to implement and reason about, but allows 2x the target rate at window boundaries and penalizes bursty legitimate traffic at the start of each window.","description":"Count requests in discrete time windows."},{"label":"Use sliding window","tradeoff":"Smoothest boundary behavior and no burst-doubling, but requires storing per-request timestamps or approximations and is more complex/expensive in Redis.","description":"Use a sliding-window count of recent requests."}],"brief":{"where":"PLAN.md notes ~20 enterprise customers have scripted integrations that legitimately burst.","what":"Pick the rate-limiting algorithm that trades off burst tolerance against implementation complexity.","how":"This affects how enterprise traffic behaves near the limit and how much Redis/memory state we maintain."},"recommended":0},{"id":"Q3","question":"Should counters live in the existing Redis 7 cluster, shared across all three server instances?","options":[{"label":"Yes, Redis cluster","tradeoff":"Correctly enforces a global per-customer limit across all three load-balanced instances; adds a network hop and a new failure mode, but Redis is already operated for sessions.","description":"Store counters in the shared Redis 7 cluster.","preview":"`INCR rate:x-customer-id:window` or Redis Lua token-bucket script","holds_when":"Multiple instances serve the same customers and the limit must be global."},{"label":"No, keep counters in each instance's memory","tradeoff":"No added dependency or latency, but with 3 round-robin instances the effective limit is ~3x the configured value and one instance can still be overwhelmed if the LB is not perfectly uniform.","description":"Maintain independent counters in each server's process memory."}],"brief":{"where":"PLAN.md states there are 3 instances behind a round-robin load balancer and a Redis 7 cluster is already used for sessions.","what":"Decide where rate-limit counters live.","how":"This determines whether the limit is global or per-instance and what happens during a Redis outage."},"recommended":0},{"id":"Q6","question":"Should an over-limit request receive HTTP 429 Too Many Requests with a `Retry-After` header?","options":[{"label":"Yes, 429 with Retry-After","tradeoff":"Standard HTTP behavior lets well-behaved clients back off; adds a small response header.","description":"Return 429 and include Retry-After in seconds.","preview":"`HTTP/1.1 429 Too Many Requests\\nRetry-After: 12`","holds_when":"Clients are expected to honor HTTP semantics."},{"label":"Return 429 without Retry-After","tradeoff":"Still signals rate limiting but leaves clients to guess backoff timing, increasing retry storms.","description":"Return 429 with an empty or absent Retry-After."},{"label":"Return 503 Service Unavailable","tradeoff":"May be treated as a server outage by some clients/monitors; misleading because the service is healthy.","description":"Use 503 instead of 429."}],"brief":{"where":"PLAN.md lists 'What a rejected client sees' as undecided.","what":"Choose the HTTP response for rejected requests.","how":"This is the contract enterprise scripts will have to handle and what operators will see in logs/alerts."},"recommended":0}]}
```

### ask result

```text
User answers:
Q1: (cancelled)
Q2: (cancelled)
Q3: (cancelled)
Q6: (cancelled)
```

