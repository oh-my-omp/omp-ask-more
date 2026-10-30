## Person: `/skill:grilling I want to ship PLAN.md this week. Poke holes in it.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them about their plan to ship PLAN.md this week. I need to first read the PLAN.md file and understand it, then ask frontier questions. Let me start by reading the file and maybe looking at the repo structure.
```

- tool `read` /tmp/askmore-grill/PLAN.md

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
I have the PLAN.md. Now I need to grill the user about it. Let me read the source files to understand the current implementation, which is a fact I can find myself rather than asking the user.
```

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Now I have context. I need to grill the user about their plan. The plan is to add rate limiting to src/server.ts and ship this week. I should ask frontier questions - questions whose prerequisites are already settled (i.e., I can ask them now without needing other answers first).

Key areas from the plan:
1. Key the limit on x-customer-id, client IP, or both
2. Algorithm: fixed window, sliding window, token bucket
3. Where counters live: Redis or instance memory
4. Counter store unreachable: let through or reject
5. Enterprise customers higher limits - who owns numbers
6. What rejected client sees
7. Rollout without breaking enterprise integrations

Also I should poke holes:
- They have 3 instances behind load balancer, so instance memory won't work unless sticky sessions by customer
- POST /orders is expensive, GET is cheap - do they want to rate limit both or just POST?
- "40,000 orders in ten minutes" = 4,000/min = 66.7/sec
- Redis cluster already used for sessions - network path, latency, failure modes
- Bun.serve, SQL/bun - tech constraints
- No mention of logging/monitoring/alerting
- No mention of tests
- No mention of schema changes for enterprise limits
- Customer ID is header-based, not authenticated - could be spoofed if not TLS terminated properly
- Need to know current load/SLA
- Need to know who decides on limits

Frontier questions I can ask now:
1. Keying decision (Q1)
2. Algorithm decision (Q2)
3. Counter storage decision (Q3) - but this partly depends on keying? Actually no, it's independent enough, though customer-id keying needs shared store across instances.
4. Store unreachable behavior (Q4) - depends on storage being Redis, but even with memory store there are failure modes. Actually if memory store, unreachable doesn't apply. So this depends on Q3. Better ask in next round or phrase conditionally.
5. Enterprise limits (Q5)
6. Rejected client response (Q6)
7. Rollout strategy (Q7)

Actually per instructions, I should ask the whole frontier in one round. Questions whose answers depend on another still-open question belong later. So Q4 (store unreachable) depends on Q3 (counter store), so Q4 is not frontier. Similarly, rollout might depend on several decisions.

So frontier questions: Q1, Q2, Q3, Q5, Q6. Q7 (rollout) can be asked now since it's independent enough - rollout approach can be decided in parallel.

Wait, the skill says: "Ask the whole frontier in one round: number each question and give your recommended answer." I need to format as:
```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

And word each question so "yes" accepts my recommended answer.

Let me think about each recommendation:

Q1: Key on x-customer-id only.
- Reason: customerId is already required and identifies the billing entity. IP is fragile (NAT, mobile, multiple servers per customer, VPNs). Both adds complexity and double-counting. x-customer-id is the natural boundary.
- Recommended: x-customer-id only.

Q2: Token bucket.
- Reason: fixed window allows bursts at window boundaries; sliding window is more complex; token bucket allows controlled bursts which is what enterprise integrations need, and is well-understood. For scripted integrations that legitimately burst, token bucket is ideal.
- Recommended: token bucket.

Q3: Redis cluster.
- Reason: 3 instances behind round-robin means in-memory counters would be per-instance and ineffective (a customer could hit each instance and get 3x the limit). Redis cluster already exists and is used for sessions, so operational team knows it.
- Recommended: Redis cluster.

Q5: Enterprise limits in config/db owned by SRE/on-call.
- The question is "how enterprise customers get higher limits, and who owns those numbers." I should recommend a per-customer override table in Postgres (since customer data already lives there) or Redis config, owned by the on-call engineer/SRE team, with a simple override mechanism. Maybe a `customer_rate_limits` table.
- Recommended: per-customer override table in Postgres, defaults in code; limits owned by the on-call engineer.

Q6: Rejected client sees 429 Too Many Requests with Retry-After header.
- Standard HTTP. Include body with JSON error and retry-after seconds.
- Recommended: 429 with Retry-After header and JSON body.

Q7: Rollout via dry-run/log-only mode first, then enforce for non-enterprise, then enforce for all.
- Need to avoid breaking enterprise integrations. Start with shadow mode that logs what would be throttled. Then enforce for customers without override. Then enable overrides.
- Actually, the rollout question could depend on decisions about enterprise limits. But I can still ask it as a general approach.

Wait, Q7 is about rollout. It depends on whether we have enterprise overrides, which is Q5. But I can ask it in a way that's independent: "Do you want to start in shadow/dry-run mode that logs would-be-throttled requests before enforcing?" This doesn't depend on Q5.

Actually, the rollout strategy more fully depends on all previous. But the core "start with dry-run" is independent. I can ask Q7 as: start with dry-run logging.

Let me also consider other frontier holes:
- Authentication of x-customer-id: currently it's just a header with no signature/API key. Could a malicious customer spoof another customer's ID? This is a security hole.
- What counts toward the limit: successful requests only, or all requests? Failed validation still hits DB? In current code, invalid JSON would throw before DB write. But rate limiting at server.ts level would count all requests.
- Do they want to rate limit GET /orders too? Plan says GET is cheap, but a customer could DoS with GET too. Should it have a separate/higher limit?
- Monitoring/alerting when rate limits are hit.
- Back-of-envelope: what limit numbers? 40k/10min = 4k/min. What should normal be?
- The incident was one customer. So per-customer limit could be like 100/min or 1000/min. Need to know.
- Redis latency: each POST would do Redis call before Postgres. Adds latency.
- Failure mode: if Redis is down, reject or allow? This is in the plan but depends on Q3.

These are good holes. I should include some. But I need to focus the frontier. Let me pick the most important independent decisions:

Frontier (independent):
1. What to key the limit on
2. Which algorithm
3. Where counters live
4. Whether to rate limit GET /orders separately
5. Whether to authenticate x-customer-id (currently just header)
6. What a rejected client sees
7. How enterprise customers get higher limits and who owns them
8. Start rollout in dry-run/shadow mode

Q4 (GET limits) and Q5 (auth) are holes I found - they are not in the plan but important. I should include them.

Q8 about dry-run is independent.

Q9 about Redis down behavior depends on Q3, so later.

Q10 about limit numbers might depend on enterprise limits, but can ask as "set a safe default" now. Actually I can ask: "Should the default per-customer limit be based on observed traffic (e.g., 10x the p99 burst)?" Hmm, that might need data. Better to ask in a later round or ask them to provide target numbers.

Let me ask the most important frontier questions. I'll keep it to 5-6 questions to not overwhelm, but the skill says "Ask the whole frontier" - so I should ask all independent questions. Let me identify all truly independent ones:

Independent:
1. Key: customer-id vs IP vs both
2. Algorithm: fixed vs sliding vs token bucket
3. Counter store: Redis vs instance memory
4. GET /orders: separate limit or unlimited?
5. x-customer-id authentication: trust header as-is or validate?
6. Rejected response: what status/body/headers?
7. Enterprise overrides: how and who owns?
8. Rollout: dry-run first or enforce immediately?

That's 8 questions. Might be a lot but they are all independent. I should include them. The format requires one round with all frontier questions.

Actually, maybe Q7 (enterprise overrides) and Q8 (rollout) could be related but still independent enough to ask now. Rollout doesn't require knowing the override mechanism; dry-run is a generic safe approach.

Let me draft the questions. Each needs to be worded so "yes" accepts the recommended answer. The format has question body with choices, then my recommended answer marked with ➡️.

Wait, the instructions say: "number each question and give your recommended answer." And "Word each question so 'yes' accepts your recommended answer." So I should make the question a yes/no or a choice question where the first option is my recommendation, and say "yes" means they accept it.

Actually for multiple choice, "yes" doesn't quite work. Maybe I should phrase each as "Should we ...?" with my recommendation, and provide alternatives. Or use ask tool? Wait, the skill says to use the format in the reply, not necessarily the ask tool. But earlier in the general instructions, it says to use ask tool for questions. However, the grilling skill specifically says:

"Work the tree in rounds... Format a round like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```"

So it wants me to write the round in the reply, not use the ask tool? But the general instructions say "MUST put every question that needs the user's answer through ask". This is a conflict. The skill is specifically invoked and says how to format rounds. Also, the skill says "Then wait for the user's answers before the next round." In chat, that's just waiting for the reply.

But the ask tool is for full-screen dialog. Since the skill is the user's explicit invocation and gives a specific format, I should follow the skill format in my chat reply. The general ask-tool rule is for normal cases; this is a skill-specific interview protocol. The skill says "Format a round like so" with markdown. I should do that.

But wait, the function ask is available and the general rule says use it. Let me re-read the grilling skill: "Interview the user relentlessly until you reach a shared understanding... Work the tree in rounds... Format a round like so... Then wait for the user's answers before the next round."

This explicitly describes a chat-based round format. So I'll use that, not the ask tool. The ask tool would not allow the numbered markdown format with recommendations.

Actually, I realize I can use ask for a single round? No, ask returns answers and then I'd continue in the same turn. But the skill wants me to wait. Also the format is specific. I'll follow the skill.

Let me write the round.

Q1: Key the limit on x-customer-id only.
Q2: Use token bucket algorithm.
Q3: Store counters in the existing Redis cluster.
Q4: Rate-limit GET /orders with a separate, much higher limit.
Q5: Validate/authenticate x-customer-id before trusting it for rate limiting.
Q6: Return 429 Too Many Requests with Retry-After header and JSON body.
Q7: Per-customer override table in Postgres, defaults in code; owned by on-call/SRE.
Q8: Start rollout in dry-run/shadow mode, then enforce.

Wait, Q4, Q5, Q6, Q7, Q8 are all independent and important holes. Good.

But Q5 (authenticate x-customer-id) is a big hole. Currently the server trusts the header. If rate limiting by customer ID, a malicious customer could send another customer's ID and exhaust their quota. This is critical.

Q4 is also important: if GET is unlimited, a customer could still DoS with GETs, though less expensive. Separate higher limit is prudent.

Let me draft these carefully.
```

### Model reply

I read `PLAN.md`, `src/server.ts`, `src/orders.ts`, and `src/db.ts`. Several decisions in the plan are independent enough to ask now; a few others (e.g., Redis-down behavior) depend on where counters live, so they wait.

❓ **Q1** - **Rate-limit key**: Should we key the per-customer limit on `x-customer-id` only, ignoring client IP?

Customer ID is already required, identifies the billing entity, and survives NAT/VPNs/multi-server integrations. IP-based keying would split one customer's traffic across many buckets and treat shared egress as a single abuser.

➡️ **Yes — key on `x-customer-id` only.**

---

❓ **Q2** - **Algorithm**: Should we use a token-bucket algorithm?

Fixed windows allow burst abuse at window boundaries; sliding windows are more complex for little gain here. Token buckets naturally accommodate the scripted bursts enterprise customers need while capping sustained rate.

➡️ **Yes — token bucket.**

---

❓ **Q3** - **Counter store**: Should counters live in the existing Redis 7 cluster?

With three `src/server.ts` instances behind round-robin, per-instance memory counters would give a customer roughly 3× the intended budget and fail when traffic shifts. Redis is already operated for sessions, so reuse it.

➡️ **Yes — Redis cluster.**

---

❓ **Q4** - **GET /orders limit**: Should `GET /orders` get its own separate, much higher rate limit rather than remaining completely unlimited?

The plan calls POST expensive and GET cheap, but an unlimited GET endpoint is still a DoS vector. A separate bucket keeps cheap reads protected without coupling them to order-creation limits.

➡️ **Yes — separate high limit for GET.**

---

❓ **Q5** - **Customer-ID trust**: Before rate-limiting by `x-customer-id`, should we authenticate or validate that header?

Right now `req.headers.get("x-customer-id")` is trusted blindly. If we rate-limit by it, a malicious customer can send another customer's ID and burn their quota. This needs at least an API-key-to-customer mapping, TLS client cert, or signed token.

➡️ **Yes — validate/authenticate the customer identity before applying the limit.**

---

❓ **Q6** - **Rejection response**: Should an over-limit request receive HTTP `429 Too Many Requests` with a `Retry-After` header and a JSON error body?

This is the standard, cache-friendly, client-observable signal. Enterprise scripts can back off using `Retry-After` seconds.

➡️ **Yes — 429 + Retry-After + JSON body.**

---

❓ **Q7** - **Enterprise overrides**: Should per-customer higher limits live in a Postgres table (next to customer data), with safe code defaults, and be owned by the on-call engineer/SRE team?

"Who owns the numbers" is in the plan but unanswered. A table makes overrides auditable and deployable without a code change; ownership by on-call keeps the change controllable during incidents.

➡️ **Yes — Postgres override table, code defaults, owned by on-call/SRE.**

---

❓ **Q8** - **Rollout**: Should we ship in dry-run/shadow mode first — logging what *would* be throttled without rejecting — before enforcing limits?

This protects the 20 enterprise scripted integrations from sudden breakage and lets us calibrate buckets against real traffic.

➡️ **Yes — start with dry-run logging, then enforce.**

---

Tell me which you accept, reject, or want to modify, and I'll recompute the next frontier.

