## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to first read the skill directory and the PLAN.md file to understand the context. I should read the grilling skill and the PLAN.md file in parallel since they're independent.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
I need to read the grilling skill SKILL.md to understand the protocol, then analyze PLAN.md to build a design tree. Let me read the skill first.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I need to build the design tree. I have the PLAN.md with 6 unresolved decisions. Let me think about the dependencies:

1. Keying strategy (x-customer-id, client IP, or both) - this is foundational, affects later decisions
2. Algorithm (fixed window, sliding window, token bucket) - foundational, independent of keying mostly
3. Counter location (Redis vs in-memory) - somewhat independent, but affects failure behavior
4. Counter-store unreachable behavior (let through vs reject) - depends on counter location; only relevant if using Redis
5. Enterprise customer higher limits and ownership - depends on keying (need customer identity to have customer-specific limits)
6. Rejected client experience - depends on having a reject path; independent of keying
7. Rollout strategy - depends on enterprise limits; independent of other things

Round 1 frontier = decisions with no prerequisites:
- Q1: Keying strategy
- Q2: Algorithm
- Q3: Counter location
- Q4: Rejected client experience (depends only on rejecting being a possibility, which is already known)
- Actually, rejected client experience depends on whether we reject at all, but the plan says rate limiting will reject. Still, the choice of reject vs let-through when store unreachable is separate.

Wait, let me reconsider dependencies:
- Failure behavior (unreachable store): only matters if store is external (Redis). If in-memory, store is always local. So depends on Q3.
- Enterprise higher limits: depends on keying strategy - if you key by IP, you can't have enterprise limits by customer. So depends on Q1.
- Rollout: depends on enterprise limits (Q5) and maybe keying.

So Round 1 frontier:
- Q1: Keying strategy (x-customer-id/IP/both)
- Q2: Algorithm (fixed/sliding/token bucket)
- Q3: Counter location (Redis vs in-memory)
- Q4: What rejected clients see (status code, headers, retry-after?) - this is partly independent
- Actually, Q4's answer may depend on whether enterprise/customer distinction exists, but the basic rejection format can be decided.

Hmm, but rejected client experience could be influenced by whether we have different limits for enterprise. But the basic format (429 + Retry-After) is standard.

Also, "who owns those numbers" for enterprise limits is a separate org decision.

Let me structure Round 1 to ask only truly independent questions. I'll include:
- Q1: Keying
- Q2: Algorithm
- Q3: Counter store location
- Q4: Client rejection response

The failure behavior depends on counter store location (Redis), so it's Round 2.
Enterprise limits depend on keying, so Round 2.
Rollout depends on enterprise limits, so Round 3.

I should also look for any files in the project that might inform facts. Let me explore the filesystem with a sub-agent or read tool. Actually, the plan mentions src/server.ts - I should look at it to understand the current state. This is a fact-finding job, so I should dispatch a sub-agent or read it myself. But I can read it directly. Let me check the project structure.
```

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
I should read the source files to ground my grilling in facts. These are independent reads, so I can do them in parallel.
```

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Now I have the facts. Current state:
- Bun.serve with x-customer-id header auth
- POST /orders is the expensive write
- GET /orders is cheap read
- Already requires x-customer-id, so customer identity is available
- No Redis client currently in server.ts
- 3 instances behind LB
- Redis 7 cluster exists for sessions

Now build Round 1 frontier. The truly independent decisions:
1. Keying: x-customer-id (recommended, since it's already required and the problem is per-customer abuse), IP, or both
2. Algorithm: fixed window (simple, cheap), sliding window (fairer, more Redis ops), token bucket (allows bursts, more complex)
3. Counter store: Redis cluster (recommended, shared across 3 instances) vs per-instance memory
4. Rejection response: status code, headers, body format

Wait, the rejection response might depend on whether we choose to reject at all. But rate limiting by definition rejects. The "what happens if counter store unreachable" is a separate decision that only applies if using Redis.

Also, should I ask about GET /orders being limited? The plan says POST is expensive, GET is cheap. But we should confirm whether GET should be exempt or have a separate/higher limit. That's actually a decision worth asking. It could be Round 1 since it's about scope.

Actually, let me re-read the "Not decided yet" list. It says:
- What to key the limit on
- Algorithm
- Where counters live
- What happens if counter store unreachable
- How enterprise customers get higher limits, and who owns those numbers
- What a rejected client sees
- How to roll it out

I should stick to these but can add scope clarification if needed. The fact that GET is cheap is stated as fact, so maybe we don't question it, but we could ask if GET should be exempt entirely or have its own limit. That's a valid unresolved decision not explicitly listed. But the user asked to grill on unresolved decisions in PLAN.md. I should focus on the listed ones but can probe deeper if something is ambiguous.

Actually, "What a rejected client sees" is independent. Let me also consider: the current server returns plain text errors ("missing x-customer-id", "not found"). Should rejection be JSON? That's part of the response decision.

Round 1 questions (frontier):
Q1. Keying strategy
Q2. Algorithm
Q3. Counter store location
Q4. Rejected client response format

Then Round 2 (after answers):
- If Redis chosen: failure behavior (fail-open vs fail-closed)
- If x-customer-id or both chosen: enterprise customer higher limits + ownership

Round 3:
- Rollout strategy (depends on enterprise limits existing or not)

Let me draft Round 1 in the required format. I need to give recommended answers and word so "yes" accepts.

For Q1: key on x-customer-id. Reason: it's already required, maps to business entity, and the incident was one customer. IP is brittle behind NAT/proxies and doesn't distinguish customers.
For Q2: token bucket or sliding window? Token bucket is good for bursts (enterprise). Sliding window is fairer. Fixed window is simplest but has thundering herd at window boundaries. Given "enterprise customers legitimately burst", token bucket is best. But token bucket is more complex. Sliding window log is fair but more Redis ops. I'd recommend token bucket to allow bursts. Actually, given "ship this week", maybe fixed window is simplest. Hmm. The recommendation should balance. I'll recommend token bucket because it directly supports the stated burst requirement. But I should note fixed window is simpler/faster.
For Q3: Redis cluster. In-memory doesn't work across 3 instances behind round-robin LB.
For Q4: 429 Too Many Requests with `Retry-After` header and JSON body matching existing error style. Since current errors are plain text, but JSON is more conventional for APIs. Actually current server returns plain text. We could match existing style or adopt JSON. I'll recommend JSON since it's an API.

Wait, current errors are plain text. Should we match? The plan doesn't specify. Let me recommend JSON body `{"error":"rate_limit_exceeded","retry_after":N}` with `Retry-After` header. But consistency matters. I'll note both options.

Actually the skill says "word each question so 'yes' accepts your recommended answer". So the question should be framed as "Should we ...?" and the recommended answer is yes.

Format:
```
❓ **Q1** - **Key the rate limit on customer identity**: Should we key the rate limit on the existing `x-customer-id` header rather than client IP or a combination? Keying on `x-customer-id` matches the abuse case (one customer, 40k orders), works behind the LB, and uses the auth header you already require. IP-based keying would split a single customer across instances and break customers behind NATs or proxies.

➡️ **Yes** — key on `x-customer-id`.
```

Wait, the format example shows options with multiple choices. The user instructions say "including multiple choices". But also says "word each question so 'yes' accepts your recommended answer". So I can include multiple choices but recommend one. The "yes" refers to accepting the recommended answer.

Actually, re-reading: "number each question and give your recommended answer. ... Word each question so 'yes' accepts your recommended answer." So the recommended answer is given as "➡️". The user can answer yes/no or choose from options. I should include options in the question body.

Let me structure each Q with choices A/B/C and then the recommended answer.

Q1 options:
A) `x-customer-id` only (recommended)
B) client IP only
C) both, with separate limits

Q2 options:
A) fixed window (simplest, but burst at boundary)
B) sliding window (fairer, more Redis ops)
C) token bucket (recommended, supports legitimate bursts)

Q3 options:
A) Redis cluster (recommended, works across 3 instances)
B) per-instance memory

Q4 options:
A) 429 + `Retry-After` + JSON body `{"error":"rate_limit_exceeded","retry_after":N}` (recommended)
B) 429 + `Retry-After` + plain text matching current error style
C) 503 Service Unavailable

Actually, I should also ask about GET /orders being exempt or limited separately. The plan says it's cheap, but is it exempt? This affects implementation. It's an unresolved decision. I could add Q5 to Round 1.

Wait, the user said "Grill me on the unresolved decisions in PLAN.md". The plan explicitly lists the unresolved decisions. GET exemption is implicitly resolved (cheap = maybe no limit or higher limit). But to be thorough, I could ask. However, the frontier should only include decisions whose prerequisites are settled. GET scope is settled by the plan's statement. I'll skip it for now unless it becomes relevant.

Actually, I'll include it as Q5 because the plan says "POST /orders ... is the expensive call; GET /orders is cheap." That doesn't explicitly say GET is unrate-limited. It could have a higher limit. This is an ambiguity. But the user listed specific unresolved decisions. Hmm.

I think I should stick closely to the listed unresolved decisions. But I can frame Q4 to cover both POST and GET if needed. Actually no, I'll keep to the 4 Round 1 decisions and the dependent ones.

Wait, I count 7 listed unresolved decisions. I can group some:
- Keying (Q1)
- Algorithm (Q2)
- Counter location (Q3)
- Store unreachable behavior (Q4, depends on Redis)
- Enterprise limits & ownership (Q5, depends on keying)
- Rejected client sees (Q6)
- Rollout (Q7, depends on enterprise limits)

Q6 (rejected client sees) is independent of keying/algorithm/counter. So it can be Round 1.
Q4 (store unreachable) depends on counter location. If counter is in-memory, this question is moot. So Round 2.
Q5 depends on keying (if IP-only, can't have enterprise customer limits). Round 2.
Q7 depends on Q5. Round 3.

So Round 1 has 4 questions: Q1 keying, Q2 algorithm, Q3 counter store, Q6 rejection response.

Let me draft.

Actually, wait: if Q1 answer is "IP only", then Q5 (enterprise limits) is moot. If Q1 is "both", Q5 still applies to the customer-id dimension. So Q5 depends on Q1 not being IP-only.

Also, Q4 (failure behavior) depends on Q3 being Redis. If Q3 is in-memory, Q4 is moot.

I'll need to handle conditional questions in later rounds.

Let me write Round 1 now.
```

### Model reply

I read `PLAN.md` and the current code. The server already requires `x-customer-id`, runs on Bun, and sits behind a round-robin load balancer with no shared state today. Here is the first frontier of decisions that don't depend on each other.

---

❓ **Q1 - Key the limit on customer identity**: Should we key the rate limit on the existing `x-customer-id` header? The other options are client IP only, or both with separate limits. `x-customer-id` matches the incident (one customer created 40k orders), works across the three instances behind the load balancer, and uses the auth header you already require. IP keying would split a single customer across instances and break customers behind NATs or proxies.

➡️ **Yes** — key on `x-customer-id`.

---

❓ **Q2 - Use a token-bucket algorithm**: Should we use a token bucket rather than fixed-window or sliding-window counting? Token bucket naturally allows the bursts the enterprise integrations need while still capping sustained rate. Fixed window is cheapest but lets clients slam the boundary between windows; sliding window is fairer but costs more Redis operations per request.

➡️ **Yes** — use token bucket.

---

❓ **Q3 - Store counters in the existing Redis cluster**: Should the counters live in the Redis 7 cluster you already run for sessions? Per-instance memory won't work behind a round-robin load balancer because each instance would maintain its own independent count, giving a 3× effective allowance and letting a customer still overwhelm the database.

➡️ **Yes** — use Redis.

---

❓ **Q4 - Return 429 + Retry-After on rejection**: Should a rejected client receive HTTP `429 Too Many Requests` with a `Retry-After` header and a JSON body like `{"error":"rate_limit_exceeded","retry_after":3}`? The current code returns plain text errors, but this is an API endpoint and JSON gives scripted integrations something they can parse and back off from.

➡️ **Yes** — return `429` with `Retry-After` and JSON body.

