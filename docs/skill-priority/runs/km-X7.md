## Person: `/skill:grilling Stress-test the rate limiting plan in PLAN.md.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user invoked the "grilling" skill and wants me to stress-test the rate limiting plan in PLAN.md. First, I need to read the skill directory and PLAN.md to understand what we're dealing with.

Let me read the relevant files first.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
Now I have PLAN.md. I need to read the grilling skill instructions.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I need to look for additional relevant files in the repo: src/server.ts, any existing rate limiting code, configs, etc. The skill says facts from environment are my job. I should explore the filesystem to understand the codebase. Let me check the working directory structure.
```

### Model reply

.

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
I need to read the source files to understand the current implementation. This is a fact-finding task, so I should do this before asking questions.
```

### Model reply

.

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Now I have enough context. Let me build the design tree based on PLAN.md and the source.

Key decisions from PLAN.md:
1. Key the limit on: x-customer-id, client IP, or both
2. Algorithm: fixed window, sliding window, or token bucket
3. Where counters live: Redis, or in each instance's memory
4. What happens if the counter store is unreachable: let requests through or reject them
5. How enterprise customers get higher limits, and who owns those numbers
6. What a rejected client sees
7. How to roll it out without breaking the enterprise integrations

These are all independent except possibly #5 depends on #1 (if keyed on customer-id, we can tier by customer; if keyed on IP, harder). And #7 might depend on #6 (what errors look like) and #5 (who gets higher limits).

The frontier for round 1 would be the independent decisions. Actually all 7 are somewhat independent since the user hasn't decided any of them yet, but some have dependencies:
- #5 (enterprise higher limits) depends partly on #1 (key). If keyed by IP, enterprise tiering is harder. But we can still ask it now since it's a decision to make.
- #7 (rollout) depends on #5 (who gets higher limits) and #6 (response format).

Wait, the instructions say: "A question whose answer depends on another question still open in this round belongs to a later round." So I should ask only the frontier - decisions that don't depend on other open questions.

Frontier (Round 1):
- Q1: What to key the limit on (x-customer-id, client IP, or both)
- Q2: Algorithm
- Q3: Where counters live
- Q4: Counter store unreachable behavior
- Q5: Response format for rejected clients
- Q6: How enterprise customers get higher limits (but this might depend on Q1)

Actually, the enterprise higher limits question is somewhat independent of keying. We can still ask "will there be a tiered limit system" without knowing the key. But the implementation depends on the key. However, the *decision* to have tiers or not can be made now. Let me think.

The design tree should be:
- Root: Add rate limiting to orders API
  - Branch A: Key selection (x-customer-id / IP / both) → affects rollout and enterprise tiers
  - Branch B: Algorithm selection → affects accuracy/performance
  - Branch C: Counter store selection → affects store-unreachable behavior and deployment
  - Branch D: Store failure behavior → depends on C being chosen (which store)
  - Branch E: Enterprise tiering → depends on A (key) somewhat
  - Branch F: Rejected client response → independent
  - Branch G: Rollout strategy → depends on A, E, F

So frontier for Round 1: A, B, C, F. 
D depends on C. E depends on A. G depends on A, E, F.

But wait - we can ask E in round 1 if we frame it as "will there be enterprise tiers" independent of key. Actually the key affects how we implement it but the business decision ("should enterprise customers get higher limits?") can be asked now. However, if they choose IP-based keying, the follow-up would be "how do you identify enterprise IPs?". So maybe E has sub-decisions.

Let me be more careful. The skill says to map as design tree and ask frontier. I should identify truly independent decisions.

Round 1 frontier (no prerequisites among them):
1. Key: x-customer-id vs IP vs both
2. Algorithm: fixed vs sliding vs token bucket
3. Counter store: Redis vs in-memory
4. Rejected response format: 429 with Retry-After vs 503 vs custom JSON

Then Round 2 (depends on Round 1):
5. Store unreachable behavior (depends on store choice): if Redis, fail-open or fail-close
6. Enterprise tiering (depends on key): if x-customer-id, tiers by customer; if IP, by IP whitelist; if both, both
7. Rollout strategy (depends on all above): shadow mode, canary, etc.

Actually, store-unreachable behavior can also be asked now because it's a policy decision, though the implementation differs. But the *decision* is independent.

Hmm, let me think about dependencies more carefully:
- "What happens if counter store is unreachable" - this is a policy decision. We can ask it regardless of what store is chosen. The store choice affects feasibility but the policy is independent.
- "How enterprise customers get higher limits" - depends on key choice. If we key by IP, we need to know how enterprise is identified (static IP whitelist?). If by customer-id, we need limit table. So this is downstream of key.
- "Rollout" - depends on having answers for key, limits, response format.

So Round 1 frontier: Q1 key, Q2 algorithm, Q3 counter store, Q4 store failure behavior, Q5 rejected response format.
Round 2 frontier: Q6 enterprise tiering (depends on key), Q7 rollout (depends on enterprise tiering, response format, key).

Actually, enterprise tiering could be partially independent - we can ask "should enterprise customers have higher limits?" now. But the "how" depends on key. Let me split:
- Q6a: Should enterprise customers get higher limits? (independent)
- Q6b: How are limits assigned per customer? (depends on key and Q6a)

But PLAN.md lumps these as "How enterprise customers get higher limits, and who owns those numbers."

I think the cleanest frontier:
Round 1:
1. Key
2. Algorithm  
3. Counter store
4. Store unreachable behavior
5. Rejected client response

Round 2 (after Round 1 answers):
6. Enterprise tiering scheme (depends on key)
7. Rollout plan (depends on all)

Let me now formulate questions. Need recommendations for each.

Q1 - Limit key:
Recommended: x-customer-id. Reasons: server already requires it; customer is the natural billing/account boundary; IP can change/shared NATs. Both is more complex.
Choices: x-customer-id only, client IP only, both.

Q2 - Algorithm:
Recommended: token bucket. Reasons: allows legitimate bursts (enterprise scripts), smooths traffic, well-understood. Fixed window can have thundering herd at window boundaries. Sliding window is more accurate but more complex/expensive.
Choices: fixed window, sliding window, token bucket.

Q3 - Counter store:
Recommended: Redis. Reasons: 3 instances behind LB, in-memory counters would be 3x too permissive unless sticky sessions. Redis cluster already exists and used by another service.
Choices: Redis cluster, in-memory per instance.

Q4 - Store unreachable behavior:
Recommended: fail-open (let requests through) with alert/metric. Reasons: avoid complete outage if Redis has trouble; but need monitoring. Fail-close protects the database but breaks all traffic.
Choices: fail-open, fail-close.

Q5 - Rejected client response:
Recommended: HTTP 429 Too Many Requests with JSON body including retry-after and maybe limit headers. Reasons: standard, clients can back off. Need to preserve enterprise integration contracts.
Choices: 429 with Retry-After header, 429 with custom JSON, 503 Service Unavailable.

Now I need to format using the ask tool. The skill says any question MUST go through ask tool. Also the format example shows a specific markdown style. But the ask tool has its own JSON schema. I need to convert the questions into the ask tool format.

The ask tool takes:
- i: string
- questions: array of objects with id, brief {what, where, how}, options array, header, recommended

I should map each question to the schema. Let me create 5 questions.

For each option:
- label
- tradeoff
- description (optional)
- preview (optional)
- holds_when (optional)
- cost (optional)
- demo (optional)

I should include evidence where relevant. The evidence is in the source files and PLAN.md.

Let me write these.
```

### ask call

```json
{"questions":[{"id":"key","question":"Should the rate limit key be `x-customer-id`, client IP, or both?","options":[{"label":"x-customer-id only","tradeoff":"Simple, aligns with customer accounts and existing auth; ignores IP spoofing/rotation but trusts the header the server already requires.","description":"Use the `x-customer-id` header as the sole rate-limit key."},{"label":"client IP only","tradeoff":"Protects network-level abuse but breaks customers behind NATs/shared egress and ignores account identity.","description":"Use the connecting client IP as the sole rate-limit key."},{"label":"both (customer AND IP)","tradeoff":"Tighter containment but doubles counter cardinality and complexity; a customer with multiple IPs gets multiple budgets.","description":"Maintain separate counters for each `x-customer-id` × IP combination."}],"brief":{"where":"PLAN.md lists this as undecided; `src/server.ts:7-8` already requires `x-customer-id` and rejects requests without it.","what":"Pick the dimension that defines a rate-limit bucket. This gates how enterprise tiers are expressed and whether NATs/shared IPs matter.","how":"After this choice, we can decide how enterprise customers get higher limits and how the rollout avoids breaking their integrations.","evidence":[{"path":"src/server.ts","start":6,"end":9,"note":"Server already authenticates via x-customer-id header."},{"path":"PLAN.md","start":13,"end":15,"note":"Key choice is explicitly listed as not decided yet."}]},"header":"Rate-limit key","recommended":0},{"id":"algorithm","question":"Should the algorithm be fixed window, sliding window, or token bucket?","options":[{"label":"token bucket","tradeoff":"Allows scripted bursts and smooths sustained load; slightly more state to maintain per key but fits the enterprise-burst use case.","description":"Each key gets a bucket that refills at a steady rate and permits bursts up to a capacity."},{"label":"sliding window","tradeoff":"Prevents window-edge bursts and is fairer; more Redis operations and slightly higher implementation complexity.","description":"Count requests in a rolling time window (e.g., last 60 seconds)."},{"label":"fixed window","tradeoff":"Simplest and cheapest but creates thundering-herd spikes at window boundaries, which could recreate the 40k-in-ten-minutes pattern.","description":"Count requests in non-overlapping time windows (e.g., per minute)."}],"brief":{"where":"PLAN.md lists algorithm as undecided and notes enterprise scripts legitimately burst.","what":"Pick the algorithm that defines when a request is allowed or rejected.","how":"This determines counter update logic and Lua/script complexity, independent of where counters live.","evidence":[{"path":"PLAN.md","start":15,"end":16,"note":"Algorithm choice is undecided."},{"path":"PLAN.md","start":9,"end":10,"note":"Enterprise customers have scripted integrations that legitimately burst."}]},"header":"Rate-limit algorithm","recommended":0},{"id":"store","question":"Should counters live in the existing Redis cluster or in each instance's memory?","options":[{"label":"existing Redis cluster","tradeoff":"Accurate global limits across all 3 load-balanced instances; adds a dependency and latency on the Redis cluster already used for sessions.","description":"Store counters in the shared Redis 7 cluster mentioned in PLAN.md."},{"label":"in-memory per instance","tradeoff":"No extra dependency or network latency, but a round-robin LB gives each instance only ~1/3 of a customer's traffic, making the effective limit 3× higher unless sticky sessions are added.","description":"Each `src/server.ts` instance keeps its own counters."}],"brief":{"where":"PLAN.md says 3 instances sit behind a round-robin load balancer and a Redis 7 cluster is already used for sessions.","what":"Pick where the counters are stored. This affects global accuracy, failover behavior, and deployment dependencies.","how":"This decision unblocks the 'counter store unreachable' question and informs rollout risk.","evidence":[{"path":"PLAN.md","start":6,"end":8,"note":"3 instances behind round-robin LB, Redis 7 cluster exists."},{"path":"PLAN.md","start":16,"end":17,"note":"Counter store location is undecided."}]},"header":"Counter store","recommended":0},{"id":"store-failure","question":"If the counter store becomes unreachable, should requests be allowed through (fail-open) or rejected (fail-close)?","options":[{"label":"fail-open (allow through)","tradeoff":"Avoids a total outage when Redis is down, but an abusive customer could again hammer `POST /orders` during the incident.","description":"Treat a missing/errored counter lookup as 'not yet limited' and continue to the route handler."},{"label":"fail-close (reject)","tradeoff":"Protects Postgres from abuse during Redis outages but turns every customer away, including legitimate enterprise traffic.","description":"Return the configured rejection response when the counter store cannot be reached."}],"brief":{"where":"PLAN.md lists store-unreachable behavior as undecided.","what":"Pick the safety posture when the rate-limit infrastructure itself fails.","how":"This is a policy decision; implementation differs slightly by store choice but does not depend on it.","evidence":[{"path":"PLAN.md","start":17,"end":18,"note":"Counter-store failure behavior is undecided."}]},"header":"Store failure behavior","recommended":0},{"id":"response","question":"What should a rejected client receive: 429 with a Retry-After header, 429 with a structured JSON body, or 503 Service Unavailable?","options":[{"label":"429 with Retry-After header","tradeoff":"HTTP-standard, easy for scripts to parse and back off; less room for per-customer detail than JSON.","description":"Return HTTP 429 Too Many Requests and include a `Retry-After` header (seconds or HTTP-date)."},{"label":"429 with structured JSON body","tradeoff":"Gives clients a clear machine-readable reason, but existing scripts may not parse JSON bodies on error.","description":"Return HTTP 429 with JSON containing `error`, `retryAfter`, and optionally limit details."},{"label":"503 Service Unavailable","tradeoff":"Discourages retries and may map cleanly to existing client handling, but it is semantically wrong for a rate limit and lacks backoff signaling.","description":"Return HTTP 503 when the limit is exceeded."}],"brief":{"where":"PLAN.md lists 'what a rejected client sees' as undecided; `src/server.ts` currently returns plain strings for errors.","what":"Pick the contract every client will see when rate limited. This must be documented before rollout so enterprise scripts can adapt.","how":"This unblocks the rollout plan, since integration breakage depends on how clients detect and retry after rejection.","evidence":[{"path":"src/server.ts","start":7,"end":18,"note":"Current error responses are plain strings; no structured error format exists."},{"path":"PLAN.md","start":20,"end":21,"note":"Rejected-client response is undecided."}]},"header":"Rejection response format","recommended":0}]}
```

### ask result

```text
User answers:
key: (cancelled)
algorithm: (cancelled)
store: (cancelled)
store-failure: (cancelled)
response: (cancelled)
```

