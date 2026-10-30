## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to:
1. Read the grilling skill first
2. Read PLAN.md
3. Interview relentlessly about unresolved decisions
4. Map as design tree
5. Work in rounds, asking whole frontier at once
6. Don't implement

Let me start by reading the skill and PLAN.md.
```

- tool `read` skill://grilling

- tool `read` PLAN.md

### Model reasoning

```text
I have the skill and PLAN.md. I need to interview the user about unresolved decisions. The plan has several unresolved decisions:

1. What to key the limit on: x-customer-id, client IP, or both
2. Algorithm: fixed window, sliding window, or token bucket
3. Where counters live: Redis, or in each instance's memory
4. What happens if counter store is unreachable: let through or reject
5. How enterprise customers get higher limits, and who owns those numbers
6. What a rejected client sees
7. How to roll out without breaking enterprise integrations

I need to map these as a design tree and work in rounds. The frontier would be the decisions whose prerequisites are already settled. Since we don't know much about constraints/requirements, many of these could be asked in parallel. But some depend on others. Let me think about dependencies:

- Key choice (customer-id vs IP vs both) is independent
- Algorithm is somewhat independent but may depend on key choice and rollout
- Counter store (Redis vs memory) depends on whether we need shared state across instances (if keying by customer-id and we have 3 instances behind LB, memory-only won't work unless sticky sessions or customer always hits same instance - but round-robin means need shared state for customer-id). Also depends on whether we already use Redis.
- Failure mode depends on counter store choice
- Enterprise higher limits depends on key choice (need customer-id key to have per-customer limits)
- Rejected client UX is relatively independent
- Rollout depends on algorithm, enterprise limits, failure mode, etc.

For round 1, I should ask the root decisions - those without prerequisites. The most fundamental are probably:
1. Key choice (customer-id vs IP vs both)
2. Algorithm
3. Counter store location
4. Failure mode
5. Enterprise higher limits
6. Rejected client UX
7. Rollout

But I should avoid asking things where answers depend on each other in the same round. Let me think...

Actually, the key choice and enterprise limits are somewhat related. If keying by IP, per-customer enterprise limits are harder. But I can still ask both and let the user reconcile.

Counter store choice has a strong dependency on key choice: if key is customer-id, memory-only with round-robin is broken. If key is IP and we have sticky sessions, memory could work but round-robin means not.

Algorithm is mostly independent.

Failure mode depends on store choice.

So round 1 frontier might be:
- Q1: Key on customer-id?
- Q2: Algorithm choice
- Q3: Counter store (but this depends on key choice...)
- Q4: Enterprise higher limits (depends on key choice too)
- Q5: Rejected client UX (independent)
- Q6: Rollout strategy (depends on many)

Hmm, but the user explicitly listed all these as "not decided yet". The skill says the frontier is decisions whose prerequisites are already settled. Many of these have factual constraints from the plan itself. For example:
- 3 instances behind round-robin LB
- Redis 7 cluster exists
- POST /orders is expensive; GET is cheap
- 20 enterprise customers have scripted integrations that burst

So some decisions have factual prerequisites settled. But the decisions themselves need to be made.

I think I can ask most of these in parallel in round 1, because they're all high-level design choices that the user needs to make. The dependencies will emerge. But I should be careful not to ask questions that assume answers to other open questions.

Actually, re-reading the skill: "The frontier is every decision whose prerequisites are already settled: the questions you can ask now without guessing at answers you haven't heard yet."

So I can ask any decision where I don't need to assume another decision's answer. The factual context (3 instances, Redis exists, etc.) is already known from PLAN.md.

Let me identify which questions can be asked now:
- Key choice: yes, factual context is sufficient
- Algorithm: yes, factual context sufficient (though maybe depends on burst behavior of enterprise, but that's part of deciding)
- Counter store: yes, factual context tells us 3 instances + round-robin + Redis exists. But the answer may depend on key choice. However, I can ask it now and present tradeoffs that mention the dependency.
- Failure mode: depends on counter store choice. So this should wait until store choice is settled.
- Enterprise higher limits: depends on key choice (need customer-id for per-customer limits). But I can ask it now with conditional framing.
- Rejected client UX: yes, independent
- Rollout: depends on many. Should wait.

Actually, the skill says "A question whose answer depends on another question still open in this round belongs to a later round, not this one." So I should put counter store, enterprise limits, failure mode, rollout in later rounds if they depend on open questions.

But all of these are open. So round 1 frontier should only include independent root decisions. Which are:
- Key choice
- Algorithm
- Rejected client UX

Wait, is algorithm truly independent? It could depend on key choice, but I think it's mostly independent. Fixed window is simpler; token bucket is better for bursts; sliding window is more accurate. The enterprise burst requirement affects it.

Counter store depends on key choice because:
- If key by customer-id across 3 round-robin instances, memory-only requires sticky sessions or per-instance limits that don't aggregate. So Redis would be needed.
- If key by IP and customers have static IPs, memory still doesn't work across round-robin.

So counter store strongly depends on key choice. Wait, unless we use a different strategy. With round-robin, memory counters are per-instance, so a customer could do 3x the intended rate by hitting different instances. So memory only works if limits are intentionally per-instance or if there's some affinity. Given 3 instances round-robin, memory-only seems broken for global customer limits. But it could be acceptable if we're okay with per-instance limits.

So counter store depends on key choice.

Enterprise higher limits depends on key choice:
- If key is customer-id, easy per-customer limits
- If key is IP, enterprise customers need their IP ranges registered
- If both, more complex

Failure mode depends on counter store choice.

Rollout depends on everything.

So round 1 frontier = {key choice, algorithm, rejected client UX}

But wait - the user might want to see all the questions and have a holistic view. The skill is specific though: ask the frontier only.

Let me also think: should I dispatch a sub-agent to find facts? The plan gives us facts. But maybe I should explore the codebase? The plan mentions `src/server.ts`, Redis, Postgres. I should probably look at the code to understand the actual structure, because that will help ground the questions. The skill says "Finding facts is your job, never the user's."

So I should explore the repo. Let me dispatch a sub-agent to inspect src/server.ts and related files to understand the current setup. But actually, I can just read the files myself with the read tool. The skill says "dispatch a sub-agent with a fresh context window" for facts, but I can also use tools directly. Either is fine. Since it's a small repo likely, I'll read directly.

Wait, but I should not block on it. The skill says "Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now."

So I can start reading the repo while preparing round 1. But round 1 questions don't depend heavily on code details - they depend on the plan which is already stated. However, knowing the code might help refine questions (e.g., how x-customer-id is currently passed, what frameworks are used, etc.).

Let me explore the repo structure first.
```

- tool `read` .

### Model reasoning

```text
Small repo. Let me read the source files to understand the actual code.
```

### Model reply

.

- tool `read` src/server.ts

- tool `read` src/orders.ts

- tool `read` src/db.ts

### Model reasoning

```text
Now I have the code. Bun.serve, simple API. x-customer-id header is already required. No rate limiting currently.

Now I need to design the grilling rounds. The design tree:

Root decisions (frontier 1):
- D1: Key choice (customer-id, IP, both)
- D2: Algorithm (fixed window, sliding window, token bucket)
- D3: Rejected client UX (status code, body, headers like Retry-After)

Downstream decisions:
- D4: Counter store (depends on D1 - because round-robin + customer-id needs shared state)
- D5: Enterprise higher limits (depends on D1 - need customer-id for per-customer; depends on D2 maybe)
- D6: Failure mode when store unreachable (depends on D4)
- D7: Rollout strategy (depends on D1-D6)

Wait, but algorithm and enterprise limits might interact. Also, counter store and algorithm interact slightly (token bucket is easier in Redis with Lua; sliding window needs sorted sets). But these are cross-cutting, not strict dependencies.

For round 1, I'll ask D1, D2, D3.

Actually, I think I should also ask about the counter store in round 1 because the factual constraints (3 instances round-robin, Redis exists) are already known. The dependency on D1 is that the choice changes, but I can present the tradeoffs conditional on D1. However, the strict reading says if it depends on an open question, it goes to later round. So I'll follow that.

But wait - the user might be annoyed if I only ask 3 questions and then wait. The skill says "Ask the whole frontier in one round" - it's about thoroughness, not quantity. So 3 questions is fine.

Let me think about each question wording so "yes" accepts my recommended answer.

Q1 - Key choice:
Recommended: x-customer-id only (since it's already required, identifies the customer, allows per-customer enterprise limits; IP is brittle due to NAT, VPNs, dynamic IPs, and doesn't identify the customer well). "Both" adds complexity without clear benefit if customer-id is present.
Question: "Should we key the rate limit on `x-customer-id` only, rather than client IP or a combination?" Yes accepts.

Q2 - Algorithm:
Recommended: token bucket (handles bursts gracefully, which enterprise integrations need; natural fit for Redis; simpler than sliding window log). Fixed window is simpler but has thundering herd at window boundaries. Sliding window is more accurate but more complex.
Question: "Should we use a token bucket algorithm so scripted integrations can burst within an allowance instead of a fixed or sliding window?" Yes accepts.

Q3 - Rejected client UX:
Recommended: 429 Too Many Requests with JSON body { error, retryAfter } and Retry-After header. This is standard and machine-readable.
Question: "Should rejected clients receive HTTP 429 with a JSON error body and a Retry-After header?" Yes accepts.

Then round 2 will depend on answers. Let me prepare for possible branches.

If D1 = customer-id:
- D4: Redis is basically required because 3 instances round-robin. Memory-only means a customer can do 3x rate. Unless we accept per-instance limits. But plan says "3 instances behind round-robin" and "one customer's script created 40,000 orders" - this implies global customer behavior across instances, so memory-only won't prevent it. Recommended: Redis.
- D5: Enterprise higher limits: config mapping customer-id to limit. Who owns numbers? Probably SRE/ops owns defaults, customer success owns enterprise overrides.
- D7: Rollout: maybe dark-launch/monitor, then enforce with high limits, then lower, with enterprise allowlist.

If D1 = IP:
- D4: Still need Redis for global IP counting across instances.
- D5: Enterprise higher limits via IP allowlist/range mappings. More operational burden.
- D7: Same.

If D1 = both:
- More complex.

Actually, given the code already requires x-customer-id and the problem is about customer behavior, customer-id is clearly the right key. IP is a worse choice.

For algorithm, token bucket is good for bursts. The user mentioned "enterprise customers have scripted integrations that legitimately burst." So token bucket matches.

OK, I'll do round 1 with 3 questions. But I want to make sure I'm covering the whole frontier. Is there any other root decision?

"What happens if counter store is unreachable" - depends on store choice.
"How enterprise customers get higher limits" - depends on key choice.
"Where counters live" - depends on key choice.
"Rollout" - depends on all.

So frontier is exactly D1, D2, D3.

Wait, I should also consider: should rate limiting apply to GET /orders too? The plan says "POST /orders writes to Postgres and is the expensive call; GET /orders is cheap." The plan scope says "add rate limiting to src/server.ts". It could mean all endpoints or just POST. This is an unresolved decision not explicitly listed! Should I include it? The user said "Grill me on the unresolved decisions in PLAN.md." The plan lists specific unresolved items. But the scope of which endpoints to rate-limit is also undecided. Hmm.

Actually, the plan says "POST /orders writes to Postgres and is the expensive call; GET /orders is cheap." This strongly implies we only need to limit POST. But it's not explicitly decided. I think I can include it as a frontier question because the facts are settled. But maybe it's too obvious? The user might consider it decided. The skill says grill on unresolved decisions in PLAN.md. The listed ones are explicit. But a good grilling might surface hidden assumptions.

I think I'll include it as Q4 because it's a real decision: should we rate-limit GET at all, perhaps with a much higher/ separate limit? Some designs limit all endpoints to prevent abuse. But given GET is cheap, maybe no. Recommended: limit only POST.

Actually, if I ask this, it might be seen as pedantic. But the skill says "relentlessly" and "nothing left silently assumed." So I'll include it.

Hmm, but if I include too many questions, the user might get overwhelmed. 3-4 is good. Let me include 4.

Q4: Should rate limiting apply only to POST /orders, leaving GET /orders unrestricted? Yes accepts.

Actually, maybe GET should have a separate, generous limit to prevent accidental abuse but not block normal use. But the simplest and recommended is: only POST. I'll phrase it carefully.

Wait, but does Q4 depend on anything? No. It's independent. So it can be in round 1.

OK, round 1: 4 questions.

Now I need to format exactly as specified. Each question has title, body, recommended answer. Use "---" between questions.

Let me write this out.
```

### Model reply

I read `PLAN.md` and the code in `src/`. The current server is a Bun app that already requires `x-customer-id`, has no rate limiting, and runs three instances behind a round-robin load balancer with an existing Redis 7 cluster.

Round 1 covers the decisions that can be made now without assuming other open choices.

---

❓ **Q1 - Rate-limit key**: Should we key the limit on `x-customer-id` only, rather than client IP or a combination of both?

`x-customer-id` is already required by `src/server.ts`, so every legitimate request carries it. IP is brittle behind NAT, VPNs, and dynamic allocations, and it does not identify the customer paying for the burst. Combining both adds complexity without a clear benefit here.

➡️ **Yes — key on `x-customer-id` only.**

---

❓ **Q2 - Algorithm**: Should we use a token bucket so enterprise scripts can burst within an allowance, instead of a fixed or sliding window?

Token bucket naturally supports the "legitimate burst" behavior you mentioned for enterprise integrations. Fixed windows create thundering-herd spikes at window boundaries; sliding windows are more accurate but more complex to implement and reason about.

➡️ **Yes — use a token bucket.**

---

❓ **Q3 - Scope of enforcement**: Should rate limiting apply only to `POST /orders`, leaving `GET /orders` unrestricted?

The plan states `POST /orders` is the expensive, abuse-prone call and `GET /orders` is cheap. Limiting only `POST` targets the exact incident (40,000 creates in ten minutes) and avoids adding failure modes to read traffic.

➡️ **Yes — limit only `POST /orders`.**

---

❓ **Q4 - Rejection response**: Should rejected clients receive HTTP `429 Too Many Requests` with a JSON error body and a `Retry-After` header?

This is the standard, machine-readable contract for rate limiting. Scripts can back off using `Retry-After`, and humans get a clear status code.

➡️ **Yes — return `429` with JSON `{ error, retryAfter }` and a `Retry-After` header.**

---

Waiting for your answers before computing the next frontier.

## Person

Yes to all your recommendations.

### Model reasoning

```text
All 4 recommendations accepted. Now I need to compute the new frontier.

Decisions settled:
- D1: key = x-customer-id only
- D2: algorithm = token bucket
- D3: rejected client UX = 429 + JSON + Retry-After
- D4 (new): scope = POST only

Now downstream decisions:
- D5: Where counters live (Redis vs memory)
- D6: Enterprise higher limits & ownership
- D7: Failure mode when store unreachable
- D8: Rollout

Dependencies:
- D5 (store) now depends only on settled facts: 3 instances, round-robin, key = customer-id. With customer-id key and round-robin, memory-only is broken unless we accept per-instance limits (3x effective rate). Redis cluster already exists. So recommended: Redis.
- D6 (enterprise limits) depends on key = customer-id (settled). We can now ask: how to map customer-id to higher limits, and who owns the numbers.
- D7 (failure mode) depends on D5 (store). So D7 must wait until D5 is settled.
- D8 (rollout) depends on D5, D6, D7. So wait.

Frontier = {D5, D6}

Wait, is D6 independent of D5? Yes, we can decide who owns enterprise limits and how they're configured without deciding Redis vs memory. But practically, if Redis, limits might live as config files/env or in Redis itself. Hmm.

Actually, D6 has two parts:
1. How enterprise customers get higher limits (config file, env var, database table, Redis hash, etc.)
2. Who owns those numbers (engineering, customer success, sales, ops)

Part 1 could depend on store choice if we store limits in Redis. But we could store limits in config/env/DB independent of counter store. So we can ask the conceptual decision now, with tradeoffs.

But maybe it's better to settle D5 first, then D6, because if counters are in Redis, putting limits in Redis too is natural. However, the skill says frontier is decisions whose prerequisites are settled. D6's prerequisites (key choice) are settled. So D6 is in frontier.

Let me ask both D5 and D6 in round 2.

Q5 - Counter store:
"Given three round-robin instances and a customer-id key, should the token-bucket counters live in the existing Redis 7 cluster rather than in each instance's memory?"
Recommended: Redis.
Tradeoff: memory is faster/simpler but a customer can do 3x the intended rate by rotating through instances; Redis adds a network hop and a dependency but gives a true global limit.

Q6 - Enterprise limits:
"Should higher limits for enterprise customers be configured by mapping `x-customer-id` to a custom bucket size/refill rate in a config file or environment variable, with Customer Success owning the numbers and Engineering owning the schema/validation?"
Recommended: config file/env mapping, Customer Success owns values.
Alternative: hard-coded allowlist, database table, Redis hash, etc.
Who owns: customer success / account management is typical.

Wait, I need to word it so "yes" accepts. "Should enterprise limits be a customer-id → rate mapping in config, owned by Customer Success?" Yes accepts.

But this might depend on how deployment works. If config file requires code deploy to change limits, that's slow. Maybe a database table is better for operational agility. Or Redis config that can be updated without deploy.

Tradeoff: config file is simple, version-controlled, code review for changes; but changing a limit requires a deploy. Database/Redis table allows instant updates but needs an admin UI or CLI and audit trail.

Given "ship it this week", simple config might be right. But enterprise customers likely need fast limit adjustments. Hmm.

Actually, I should present options. The format requires multiple choices. Let me re-read the format:

"Word each question so 'yes' accepts your recommended answer."

So I should ask a yes/no question essentially, where yes means the recommended option. But I can mention alternatives in the body.

For Q6, recommended: config file/env mapping, Customer Success owns the values, Engineering owns the schema/validation. Let me phrase: "Should higher enterprise limits be a customer-id-to-rate mapping in config/env, owned by Customer Success?"

But maybe better to separate "how" and "who". The plan lists "How enterprise customers get higher limits, and who owns those numbers" as one decision. So I can ask it as one.

Actually, I could ask two questions if they are independent:
- Q6a: How enterprise customers get higher limits
- Q6b: Who owns those numbers

Are they independent? Yes, mostly. We can decide the mechanism and owner separately. But the plan bundles them. I'll bundle to keep round manageable, or split if clearer.

I think splitting is cleaner because they're different dimensions. But the plan says "and" - one item. I'll ask as one question with both parts.

Let me also think about whether D7 (failure mode) is now in frontier. It depends on D5. D5 is open in this round, so D7 must wait until next round. Correct.

So Round 2 frontier = {D5, D6}.

Now let me write the questions.
```

### Model reply

All four recommendations accepted. That settles the key, algorithm, rejection contract, and scope.

Round 2 covers the decisions now unblocked by those answers.

---

❓ **Q5 - Counter store**: Given a customer-id key and three round-robin instances, should the token-bucket counters live in the existing Redis 7 cluster rather than in each instance's memory?

Per-instance memory is faster and simpler, but a single customer can do roughly 3× the intended rate by rotating through the load balancer. Redis adds a network hop and a new runtime dependency for the rate-limit path, but it is the only way to enforce a true global limit with the current architecture.

➡️ **Yes — store counters in the existing Redis cluster.**

---

❓ **Q6 - Enterprise limits and ownership**: Should higher limits for enterprise customers be configured as a `customer-id → { bucketSize, refillRate }` mapping in config or environment variables, with Customer Success owning the values and Engineering owning the schema and validation?

A config/env mapping keeps the change version-controlled and reviewable, which is good for "ship this week." The downside is that raising a limit requires a deploy. A database or Redis-backed mapping avoids deploys but needs an admin path and audit trail from day one.

➡️ **Yes — config/env mapping, Customer Success owns the numbers.**

---

Waiting for your answers before the next frontier.

