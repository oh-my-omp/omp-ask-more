## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to:
1. Read the grilling skill first (per workflow rules)
2. Read PLAN.md
3. Identify unresolved decisions and map them as a design tree
4. Ask the whole frontier in one round with recommended answers
5. Wait for user answers before next round

Let me start by reading the skill and PLAN.md.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
Now let me read the grilling skill instructions.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I need to understand the project context better. The PLAN.md mentions `src/server.ts` and Redis/Postgres. I should explore the filesystem to understand the codebase before grilling, since finding facts is my job. Let me look at the project structure and relevant files.

I need to dispatch a sub-agent for environment facts, or I can read the files directly since I have the read tool. The skill says "When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it". But I can also use read tool myself. Let me read the relevant files directly to understand the current setup.
```

- tool `read` /tmp/askmore-grill

- tool `read` /tmp/askmore-grill/src/server.ts

### Model reasoning

```text
Let me also read the other source files to get a complete picture.
```

### Model reply

.

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Now I have enough context. Let me build the design tree from the unresolved decisions in PLAN.md.

Unresolved decisions from PLAN.md:
1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if the counter store is unreachable: let requests through or reject them.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll it out without breaking the enterprise integrations.

Now I need to map these as a design tree. Some decisions depend on others:
- What happens if counter store is unreachable depends on where counters live (only relevant if Redis).
- How enterprise customers get higher limits may depend on what we key the limit on.
- Rollout depends on what the limits are and how enterprise gets higher limits.
- Algorithm and keying are independent.

First-round frontier (no prerequisites):
- Q1: What to key the limit on
- Q2: Algorithm
- Q3: Where counters live

These three are independent and can be asked in round 1.

Dependent decisions (later rounds):
- Q4: Counter store unreachable → depends on Q3 (if Redis)
- Q5: Enterprise higher limits → could depend on Q1 (if keyed by customer-id, easier; if IP, harder)
- Q6: Rejected client response → independent of most, but might depend on algorithm? Not really. Could be asked in round 1.
- Q7: Rollout → depends on Q1, Q2, Q3, Q5

Wait, I should think more carefully. The rejected client response is independent - it doesn't depend on other rate limiter decisions. So it can be in round 1.

Enterprise higher limits: this is somewhat independent, but the "how" may be affected by keying choice. However, I can ask the policy question now and drill into mechanism later. Actually, "how enterprise customers get higher limits, and who owns those numbers" is a compound decision. I could ask it as one question in round 1.

Let me structure the tree:

Round 1 frontier:
- Key dimension: x-customer-id, IP, or both
- Algorithm: fixed window, sliding window, token bucket
- Counter store: Redis or instance memory
- Rejected client response
- Enterprise higher limits policy

Round 2 (after round 1 answers):
- If Redis chosen: failure mode (fail-open vs fail-closed)
- Mechanism for enterprise limits (config file, DB table, Redis hash, etc.) - if not settled
- Rollout strategy (depends on all above)

Round 3:
- Any remaining details

Actually, I should be careful not to ask too much at once. The skill says "Ask the whole frontier in one round". Frontier = decisions whose prerequisites are settled. The first round has the most independent decisions.

Let me formulate 5 questions for round 1:
Q1: Key the limit on x-customer-id (recommended)
Q2: Token bucket algorithm (recommended)
Q3: Counters in Redis (recommended)
Q4: Rejected clients get 429 with Retry-After (recommended)
Q5: Enterprise limits live in a config table/file owned by customer-success (recommended)

Then Q6: If Redis is unreachable, fail open (recommended) - this depends on Q3, so round 2.
Q7: Rollout - shadow mode, then enforce with warnings - depends on all, round 2 or 3.

Wait, but if I ask Q1-Q5 in round 1, and the user answers all, then in round 2 I can ask Redis failure mode and rollout. That's good.

But I need to make sure each question is worded so "yes" accepts the recommended answer.

Let me draft:

Q1 - **Rate-limit key**: Should we key the rate limit on `x-customer-id` alone, treating missing headers as 401 and ignoring client IP?
➡️ Yes, key on `x-customer-id` only.

Q2 - **Algorithm**: Should we use a token-bucket algorithm so enterprise scripts can burst up to a bucket size while still having a sustainable request rate?
➡️ Yes, use token bucket.

Q3 - **Counter store**: Should counters live in the existing Redis 7 cluster so all three instances share one consistent state?
➡️ Yes, use Redis.

Q4 - **Rejected response**: Should rejected requests return HTTP 429 with a `Retry-After` header and a JSON body explaining the limit?
➡️ Yes, return 429 with Retry-After.

Q5 - **Enterprise limits**: Should higher limits for enterprise customers be stored in a config file or environment variable, with customer-success owning the numbers and engineering owning the schema?
➡️ Yes, config/env with customer-success owning values.

Then round 2:
Q6 - **Redis unreachable**: If Redis becomes unreachable, should we fail open and allow requests through rather than blocking all customers?
➡️ Yes, fail open.

Q7 - **Rollout**: Should we roll out in three phases: 1) log-only / shadow mode to measure limits, 2) enforce but with a temporary allow-list for enterprise customers, 3) full enforce?
➡️ Yes, three-phase rollout.

But wait - the rollout strategy depends on the enterprise limits mechanism and the other decisions. If the user answers round 1, I can ask this in round 2.

Actually, I should check: are there other downstream decisions? For example:
- Token bucket specifics: burst size and refill rate per customer tier. These are "who owns the numbers" partly covered by Q5, but I might need to ask about default values.
- Per-endpoint limits: POST /orders vs GET /orders. PLAN.md says POST is expensive, GET is cheap. Should they have different limits? This is a design decision not explicitly listed.
- Redis key design, atomicity (Lua script vs Redis cell). This is implementation detail, but the user asked to grill on unresolved decisions in PLAN.md, not implementation.

Let me stick to the 7 decisions in PLAN.md plus natural follow-ups. I want to keep it focused on the listed unresolved decisions.

Actually, re-reading: "Map this as a design tree: every decision branches into the decisions that hang off it." So I should map the tree explicitly. But the output format is just the questions with recommended answers. I can mention the tree structure briefly in my intro.

Let me also think: should I ask about per-endpoint differentiation? It's implied by "POST /orders is expensive; GET /orders is cheap" but not in the unresolved list. It might be worth adding as a frontier question since it's a real unresolved decision. However, the user said "Grill me on the unresolved decisions in PLAN.md" - so I should focus on those. But if a decision logically hangs off, I can include it.

Hmm, actually "What to key the limit on" and "algorithm" etc. don't specify endpoint differentiation. A reasonable design would have separate limits for POST and GET, or only rate-limit POST. This is a decision that hangs off the basic rate-limiting decision. I think it's fair game.

But to avoid scope creep, I'll include it as a question because it's a clear design fork: do we rate-limit both endpoints with one counter, or only POST, or separate counters?

Let me revise. Round 1 questions:

Q1 - **Scope**: Should we apply rate limiting only to `POST /orders`, leaving `GET /orders` unthrottled for now?
➡️ Yes, limit only POST.

Q2 - **Key**: Should we key the limit on `x-customer-id` alone?
➡️ Yes, key on customer-id.

Q3 - **Algorithm**: Should we use token bucket?
➡️ Yes.

Q4 - **Counter store**: Should counters live in Redis?
➡️ Yes.

Q5 - **Rejected response**: 429 with Retry-After?
➡️ Yes.

Q6 - **Enterprise limits**: Config/env with customer-success owning values?
➡️ Yes.

That's 6 questions. Then round 2:

Q7 - **Redis failure**: Fail open?
➡️ Yes.

Q8 - **Rollout**: Three-phase (shadow, allow-list, enforce)?
➡️ Yes.

Q9 - **Default limits**: What should default per-customer limits be? (This depends on algorithm. For token bucket, need burst and refill rate.)
➡️ Recommend: 100 burst, 10/second refill for regular; 1000 burst, 100/second for enterprise.

But wait, Q9 depends on Q3 (algorithm) being token bucket. If user says no to token bucket, this changes. So it's a downstream decision.

Actually, I should be more disciplined. The skill says "A question whose answer depends on another question still open in this round belongs to a later round, not this one." So Q7 depends on Q4 (Redis), Q9 depends on Q3 (algorithm). Q8 depends on Q6 (enterprise limits). So round 2 has Q7, Q8, Q9.

But also Q6 (enterprise limits) might need to specify mechanism - config file vs DB table. That's a downstream decision too. I asked the policy; the mechanism is downstream.

Let me think about the tree structure:

Root: Add rate limiting to POST /orders
├── Scope: limit POST only (or both, or separate)
├── Key: customer-id (or IP or both)
├── Algorithm: token bucket (or fixed/sliding)
├── Store: Redis (or memory)
│   └── If Redis: failure mode (fail open or closed)
├── Rejected response: 429 + Retry-After
├── Enterprise limits: config/env + customer-success owns values
│   ├── Mechanism: config file vs DB table vs Redis hash
│   └── Values: default regular limits, default enterprise limits
└── Rollout: three-phase

Actually, the "enterprise limits" node has sub-decisions that depend on choosing to have enterprise limits at all. If the user says no to enterprise limits, those branches disappear. But given there are 20 enterprise customers with scripted integrations, having enterprise limits is almost certainly necessary. Still, I should ask.

Wait, Q6 as I phrased it assumes enterprise limits exist and asks about the mechanism/ownership. I should first ask: Should we have higher limits for enterprise customers at all? Then if yes, ask mechanism and values.

Let me restructure:

Round 1:
Q1 - Scope: limit POST only?
Q2 - Key: customer-id?
Q3 - Algorithm: token bucket?
Q4 - Store: Redis?
Q5 - Rejected response: 429 + Retry-After?
Q6 - Enterprise differentiation: Should enterprise customers get higher limits than regular customers?

Round 2:
Q7 - If Redis: fail open on unreachable?
Q8 - If enterprise limits: store/ownership mechanism?
Q9 - If token bucket: default limit values for regular and enterprise?
Q10 - Rollout strategy?

Round 3:
Q11 - Anything remaining? (e.g., monitoring, alerting)

But I need to be careful not to over-ask. The user has a plan with 7 unresolved items. I should map those. The "enterprise higher limits, and who owns those numbers" is one item - it includes both whether to differentiate and the ownership. I can ask it as one compound question, or split it. Given the format, one question is fine.

Let me go with a clean round 1 of 6 questions covering all independent decisions from the plan. Then round 2 will have dependent ones.

Actually, I realize "What happens if the counter store is unreachable" only matters if store is Redis. If store is memory, it's always reachable. So that's definitely round 2.

"How to roll out" depends on everything. Round 2 or 3.

Let me also consider: the user might want per-endpoint limits. I can ask this as part of scope. Good.

Now, I need to output round 1 in the exact format. Let me write it.

One more consideration: the skill says "Finding facts is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it". I've already read the files. The facts I found:
- server.ts uses Bun.serve, reads x-customer-id header, routes POST/GET /orders
- 3 instances behind load balancer (from PLAN)
- Redis 7 cluster exists (from PLAN)

I should mention these facts in the questions to ground them. For example, "Since the server already requires `x-customer-id` and rejects missing headers with 401, keying on that header is natural."

OK, let me write the round.
```

### Model reply

I read `PLAN.md` and the current `src/server.ts`. The server already rejects missing `x-customer-id` with 401, so customer-aware rate limiting is a natural fit.

Here is the first frontier of decisions — all the ones we can settle without guessing at each other:

---

❓ **Q1** - **Scope**: Should we rate-limit only `POST /orders` for now, leaving `GET /orders` unthrottled?

`POST /orders` writes to Postgres and is the expensive call; `GET /orders` is cheap. Limiting only the expensive path keeps the change small and avoids breaking read-heavy scripts.

➡️ **Yes**, apply rate limiting only to `POST /orders`.

---

❓ **Q2** - **Rate-limit key**: Should we key the limit on `x-customer-id` alone, ignoring client IP?

The server already requires `x-customer-id`, so every request has a customer identity. Keying by customer isolates the noisy neighbor problem directly. IP-based keying would splinter a single customer across addresses and accidentally lump different customers behind shared NATs.

➡️ **Yes**, key on `x-customer-id` only.

---

❓ **Q3** - **Algorithm**: Should we use a token-bucket algorithm?

Token bucket lets scripted integrations burst legitimately while still bounding sustained load. Fixed windows create spike-at-window-edge behavior; sliding windows are more complex without much gain here.

➡️ **Yes**, use token bucket.

---

❓ **Q4** - **Counter store**: Should counters live in the existing Redis 7 cluster?

With three instances behind a round-robin load balancer, per-instance memory counters would triple a customer's effective allowance and fail to isolate load globally. Redis is already running for sessions, so reuse avoids new infrastructure.

➡️ **Yes**, store counters in Redis.

---

❓ **Q5** - **Rejected response**: Should rejected requests return HTTP 429 with a `Retry-After` header and a small JSON error body?

A 429 with `Retry-After` is the standard signal for rate limiting and lets scripts back off automatically. A plain 503 or 400 would confuse clients and retry loops.

➡️ **Yes**, return 429 with `Retry-After`.

---

❓ **Q6** - **Enterprise limits**: Should enterprise customers get higher limits through a config file or environment variable, with customer-success owning the limit values and engineering owning the schema?

About 20 enterprise customers have scripted integrations that legitimately burst. They need higher limits than regular customers, but the numbers should not be hard-coded or require a deploy to change.

➡️ **Yes**, give enterprise customers higher limits via config/env, owned by customer-success.

---

Answer each with yes/no or your own choice, and I will compute the next frontier.

