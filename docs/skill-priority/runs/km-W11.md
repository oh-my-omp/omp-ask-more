## Person: `/skill:grilling Review my rate-limiting plan and make me defend it.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user invoked the "grilling" skill and wants me to review their rate-limiting plan and make them defend it. I need to first read the skill directory to understand the instructions, and also explore the current working directory to find the rate-limiting plan.

Let me read the skill directory and look for the plan.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
Need to read SKILL.md and PLAN.md and the source files to understand the plan.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

- tool `read` /tmp/askmore-grill/PLAN.md

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/db.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

### Model reasoning

```text
Now I have the plan and context. Need to grill the user about their rate-limiting plan. I should map this as a design tree and ask the frontier questions in one round.

Plan facts:
- 3 instances behind round-robin LB
- Redis 7 cluster used for sessions by another service; may use it
- POST /orders expensive, GET /orders cheap
- ~20 enterprise customers have scripted integrations that legitimately burst
- Not decided: key (customer-id, IP, both), algorithm (fixed window, sliding window, token bucket), counter store (Redis or per-instance memory), store unreachable behavior, enterprise limits ownership, rejected client response, rollout strategy

Frontier questions (decisions whose prerequisites are already settled):

1. Key the limit on x-customer-id? This seems foundational - do we authenticate/identify by customer ID? Recommended: yes, key on x-customer-id, not IP (since enterprise customers may have multiple IPs and IPs can be shared/NATed). But maybe both? Need to ask.

2. Algorithm: token bucket? Recommended: token bucket for bursts. But need to understand if they want to allow bursts. The plan says enterprise customers legitimately burst. Token bucket is good for bursts.

3. Counter store: Redis cluster? Recommended: yes, Redis, because 3 instances behind LB means per-instance memory would allow 3x the limit under round-robin. But need to consider that Redis is used by another service for sessions - potential contention? But plan says we may use it.

4. Store unreachable behavior: fail open or fail closed? Recommended: fail open (let requests through) to avoid hard outage if Redis is down, but that's a risk. Alternatively fail closed to protect DB. Need to ask.

5. Enterprise limits: config-driven per-customer overrides? Who owns numbers - probably product/support? Recommended: config file or DB table, owned by customer success/support.

6. Rejected client response: 429 with Retry-After? Recommended: yes.

7. Rollout: dry-run/monitor first, then enforce? Recommended: yes, start with shadow mode/log-only.

But the skill says "Ask the whole frontier in one round: number each question and give your recommended answer." And "A question whose answer depends on another question still open in this round belongs to a later round."

Are these all independent? Some have dependencies. For example:
- Where counters live depends on key? Not really.
- Algorithm depends on whether they want bursts allowed - but bursts are already stated as fact.
- Enterprise limits depend on key - if keyed by customer-id, per-customer overrides make sense. If keyed by IP, per-customer overrides need mapping.
- Response format is independent.
- Rollout depends on having decided enforcement behavior.

So actually the first round should probably include the most foundational decisions first:
- Q1: Key on x-customer-id (not IP or both)?
- Q2: Use Redis cluster for counters (not per-instance memory)?
- Q3: Use token bucket algorithm (not fixed/sliding window)?
- Q4: Fail open when Redis unreachable?
- Q5: 429 with Retry-After header for rejected requests?
- Q6: Roll out in log-only / shadow mode first?

Wait, but "where counters live" might depend on "key" if they choose IP (Redis would need to track IPs across instances). But the decision is independent enough. Actually, per-instance memory for IP-based rate limiting would fail because round-robin means each IP hits different instances. So the answer to "where counters live" is constrained by "key on IP" - if they key on IP, they basically must use Redis. But if they key on customer-id, they still need Redis for consistency across instances. So either way Redis is strongly recommended. So it's fine to ask in round 1.

Enterprise limits and ownership depends on keying by customer-id. If they key on IP, per-customer limits require mapping IP to customer. So that should wait until after Q1.

Response format is independent.

Rollout strategy depends on knowing what will be enforced, so it depends on algorithm and response format, but those are about "what" not "whether". We can still ask rollout approach.

Let me think about dependencies more carefully:
- Key decision (Q1) is foundational
- Algorithm (Q2) is independent of key? Token bucket works with any key.
- Store (Q3) - Redis recommended regardless.
- Fail open/closed (Q4) - depends on using Redis, which is being asked in Q3. But since Q3 is in same round, Q4 depends on an unsettled answer. Hmm.

Actually, the skill says "A question whose answer depends on another question still open in this round belongs to a later round, not this round." So I should be careful.

Round 1 should be truly independent questions. Let me identify the root decisions:

Root decisions (no prerequisites):
1. What to key on: customer-id, IP, or both?
2. Algorithm: fixed window, sliding window, or token bucket?
3. Counter store: Redis or per-instance memory?
4. Store failure mode: fail open or closed? (This depends on store being Redis? Actually if store is per-instance memory, "unreachable" doesn't apply. So it depends on Q3. So should be later.)
5. Enterprise limits ownership (depends on key being customer-id)
6. Rejected client response (independent)
7. Rollout strategy (depends on enforcement existing, but we can ask general approach)

So Round 1 frontier:
- Q1: Key on x-customer-id?
- Q2: Token bucket algorithm?
- Q3: Redis cluster for counters?
- Q4: 429 with Retry-After?
- Q5: Roll out in shadow/log-only mode first?

Then Round 2 after answers:
- If Redis: fail open or closed?
- If customer-id: enterprise limits mechanism and ownership
- More rollout details depending on first answer

Actually, the rollout question depends on the enforcement mechanism. But I think it's fine to ask the high-level rollout strategy (shadow mode) now.

Let me draft Round 1:

Q1 - Key on x-customer-id, not IP or both?
- Context: x-customer-id is already required (401 if missing), enterprise customers may have multiple egress IPs, IPs can be NATed/shared.
- Recommended: key on x-customer-id only.
- But "both" could be a defense if customer IDs are spoofable. Is x-customer-id trusted? The server just reads the header. If it's set by client, it's spoofable. The plan doesn't mention authentication. This is a huge issue. Should I ask if x-customer-id is authenticated/trusted? That's a fact-finding question, but I can find it from code - the header is just read, no auth. So x-customer-id is not authenticated. This is a risk to surface.

Hmm, actually the plan says "What to key the limit on: x-customer-id, client IP, or both." The existence of x-customer-id as header is fact. Whether it's trustworthy is a question. The code shows no auth. I should include this concern in Q1.

Q2 - Token bucket algorithm?
- Allows legitimate bursts while bounding sustained rate.
- Recommended: yes.

Q3 - Store counters in Redis cluster, not per-instance memory?
- Round-robin LB means per-instance memory gives each customer 3x the intended budget and misses cross-instance bursts.
- Recommended: yes, Redis.

Q4 - Return 429 Too Many Requests with Retry-After header?
- Lets scripted clients back off programmatically.
- Recommended: yes.

Q5 - Roll out in log-only shadow mode first?
- Monitor who would be throttled before enforcing; protects enterprise integrations.
- Recommended: yes.

These are all independent. After answers, Round 2 can cover:
- Redis unreachable behavior (if Redis chosen)
- Enterprise customer limits and ownership (if customer-id chosen)
- Maybe authentication of x-customer-id (but I should raise this in Q1)

Wait, the authentication issue is critical. If x-customer-id is client-provided and unauthenticated, a malicious client can rotate IDs to evade rate limits. I should make this a frontier question too, but it's more of a "do you accept the risk" question. Actually, it's a prerequisite to keying on x-customer-id. If the answer is "key on x-customer-id", we need to know if they will authenticate it. But the plan doesn't list this as undecided. Should I add it as a decision? The user wants me to review and make them defend. So yes, I can surface it.

But is it independent? It affects whether keying on x-customer-id is sensible. I'd say it should be asked alongside Q1.

Actually, maybe Q1 should be: "Key rate limits on x-customer-id, accepting that the header is currently unauthenticated and any client can spoof it?"

Or split:
Q1a: Do you accept that x-customer-id must be authenticated/trusted before it can be a rate-limit key?
Q1b: Key on x-customer-id (once authenticated), not IP?

But these are dependent. Q1a must be settled first. If they say no, then Q1b changes.

Maybe Round 1:
Q1: Authenticate x-customer-id before using it as a rate-limit key?
Q2: If x-customer-id is authenticated, key on it rather than IP?
But Q2 depends on Q1.

Alternatively, frame Q1 as: "Key on x-customer-id, and add authentication/validation to make it trustworthy?"
That combines them. The recommended answer is yes. Then later we can ask how to authenticate.

But the user explicitly listed "What to key the limit on: x-customer-id, client IP, or both" as not decided. I should honor that as a decision. But I can raise the authentication concern within the question.

Let me think about the design tree structure:

Root: Do we trust x-customer-id?
- If no: key on IP (but then enterprise NAT issues)
- If yes: key on customer-id

Actually, the fact that x-customer-id is currently unauthenticated is an observation. The decision is: do we accept the risk of unauthenticated customer-id, or do we authenticate it first, or do we use IP?

I think Q1 should be: "Before keying on x-customer-id, authenticate/validate it (e.g., API key, signed token) so customers can't spoof their way around limits?"

Recommended: yes. This is independent.

Then Q2 depends on Q1: if we authenticate it, key on x-customer-id. But we can still ask in Round 1 if we frame it as "Assuming x-customer-id is authenticated, key on it rather than IP?"

Hmm, but the skill says no dependencies within a round. Let me be strict.

Round 1 independent questions:
1. Authenticate x-customer-id before rate-limiting on it?
2. Use Redis cluster for counters (vs per-instance memory)?
3. Use token bucket algorithm (vs fixed/sliding window)?
4. Return 429 with Retry-After?
5. Roll out in shadow/log-only mode first?

Then Round 2:
- If authenticate: how? (API key, mTLS, etc.) - but that's potentially out of scope. Or: key on x-customer-id?
- If not authenticate: key on IP? (with enterprise NAT problems)
- If Redis: fail open or closed?
- Enterprise limits ownership

Actually, "authenticate x-customer-id" might be seen as scope creep. The user wants rate limiting this week. Adding auth might be too much. But it's a legitimate concern. I should ask it.

Alternatively, I can ask: "Accept the risk that x-customer-id is currently spoofable, or add a trust mechanism before gating on it?"

Recommended: add trust mechanism.

I think that's a fair frontier question.

Let me also consider the Redis used by another service for sessions. Using it for rate limiting adds load. Is that a concern? Could ask later.

Also, "3 instances behind round-robin" means per-instance memory is wrong. Strong recommendation for Redis.

"20 enterprise customers have scripted integrations that legitimately burst" - token bucket is ideal.

Let me also think about whether GET /orders should be rate-limited. The plan says it's cheap. Should we rate-limit it too? Not listed as undecided, but it's a design question. Could add to frontier or later. Since the incident was POST /orders creating 40k orders, focus on POST. But cheap endpoints can still be abused. Maybe ask later.

Also, what are the actual limit numbers? Not decided: "How enterprise customers get higher limits, and who owns those numbers." The numbers themselves (default rate, enterprise rate) are not listed as decided. Should ask. But depends on algorithm.

OK, Round 1 questions:

Q1 - **Trust x-customer-id before gating on it**: The server currently reads `x-customer-id` straight from the request header with no authentication, so any client can pick a fresh ID and evade its own limit. Do you want to add a trust mechanism (API key, signed token, etc.) before keying rate limits on `x-customer-id`?

➡️ Yes, authenticate/validate `x-customer-id` before using it as a rate-limit key.

Q2 - **Store counters in Redis cluster**: With 3 server instances behind a round-robin load balancer, per-instance memory would give every customer 3× the intended budget and miss cross-instance bursts. Do you want to store rate-limit counters in the existing Redis 7 cluster?

➡️ Yes, use Redis for shared counters.

Q3 - **Use token bucket algorithm**: Token buckets naturally accommodate the legitimate bursts from enterprise scripted integrations while capping sustained throughput; fixed windows can spike at window boundaries, and sliding windows are more complex for the same gain. Do you want to use a token bucket for `POST /orders`?

➡️ Yes, token bucket.

Q4 - **Return 429 Too Many Requests with Retry-After**: Scripted integrations need a machine-readable signal to back off. Do you want rejected requests to return HTTP 429 with a `Retry-After` header?

➡️ Yes, 429 with Retry-After.

Q5 - **Roll out in shadow/log-only mode first**: To avoid breaking the ~20 enterprise integrations that legitimately burst, do you want the first deploy to log what *would* be throttled without actually rejecting requests?

➡️ Yes, start with log-only / shadow enforcement.

These are all independent. After answers, Round 2 frontier would include:
- If Redis chosen: fail open or closed on Redis unreachable?
- If customer-id trusted: key on customer-id (but this might already be implied by Q1)
- Enterprise limit override mechanism and ownership
- Default rate limit values
- Whether to rate-limit GET /orders too

Wait, Q1 says "authenticate before keying on x-customer-id" - if yes, then the key is settled to x-customer-id. If no, then we need to ask what to key on (IP or both). So Q1 doesn't fully settle the key decision. Hmm.

Maybe I should ask Q1 differently: "Key rate limits on a trusted customer identity rather than on client IP?" Then the authentication issue is part of the rationale.

Actually, the user listed "x-customer-id, client IP, or both" as options. I should give those options but challenge them. Let me reframe:

Q1 - **Key on x-customer-id**: Do you want to key rate limits on `x-customer-id` rather than client IP or a combination, accepting that you must first make `x-customer-id` trustworthy (it is currently read unauthenticated from the header)?

➡️ Yes, key on a trusted `x-customer-id`.

This settles the key decision contingent on making it trustworthy. Then Round 2 can ask "How do you make x-customer-id trustworthy?" and "What are default and enterprise limits?"

But the "how" is a new decision. Is it in scope? The user wants to ship rate limiting this week. Adding auth might not be feasible. But if they choose x-customer-id without auth, that's a hole. I need to make them defend it.

Maybe Round 1 should be:
Q1: **Make x-customer-id trustworthy before rate-limiting on it**: Do you accept that `x-customer-id` must be authenticated (e.g., API key validation) before it can be used as a rate-limit key, even if that adds scope to this week's ship?

➡️ Yes, add trust/validation for `x-customer-id`.

Then Q2: **Key on customer-id vs IP**: Assuming `x-customer-id` is authenticated, do you key limits on it rather than IP?

But Q2 depends on Q1. If Q1 is yes, Q2 is yes. If Q1 is no, Q2 changes. So Q2 should be Round 2.

OK, let me be strict about dependencies. Round 1:

Q1 - Make x-customer-id trustworthy before using it as rate-limit key?
Q2 - Use Redis cluster for counters?
Q3 - Use token bucket for POST /orders?
Q4 - Return 429 with Retry-After?
Q5 - Roll out in shadow mode first?

These are independent. Q1 and Q2 are independent. Q3, Q4, Q5 independent.

Actually, Q5 "roll out in shadow mode" is independent of Q3/Q4 because shadow mode just logs regardless of what algorithm/response you eventually use.

Yes.

Then Round 2 frontier after answers:
- If Q1 yes: how to authenticate x-customer-id? (API key, signed JWT, etc.)
- If Q1 yes: key on x-customer-id (yes/no) - but if we authenticate it, yes is obvious
- If Q1 no: key on IP or both? And accept spoofing risk?
- If Q2 yes: Redis unreachable behavior (fail open/closed)?
- If Q2 no: accept 3x budget risk?
- Default rate limit values
- Enterprise customer override mechanism and ownership
- Whether to also rate-limit GET /orders
- How long to run shadow mode

This seems like a good tree.

One more thing: the skill says "Word each question so 'yes' accepts your recommended answer." So all my recommended answers are "yes".

Let me write Round 1 in the exact format requested.

Actually, I realize that "make x-customer-id trustworthy" might not be the right framing if the user thinks x-customer-id is already trustworthy (e.g., set by a trusted proxy). The code shows it's from the client header with no validation. But maybe in production it's injected by an API gateway? I don't know. I can only go by the code I see. I should note that in the question.

Also, I should mention that "both" (customer-id + IP) is an option but doesn't help if customer-id is unauthenticated - an attacker can just rotate customer-id and IP (if using proxy).

Let me write it.

Wait, the skill format shows:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

So I need to include the question body and choices. The choices should be explicit enough that "yes" accepts recommended.

For Q1:
Choices:
- Yes, add a trust mechanism (API key, signed token, etc.) before keying on x-customer-id.
- No, use x-customer-id as-is and accept that clients can evade limits by changing the header.
- No, abandon x-customer-id and key on client IP instead.

Recommended: first option. "Yes" accepts.

For Q2:
Choices:
- Yes, use Redis cluster for shared counters.
- No, keep counters in instance memory and accept that round-robin gives 3× the intended budget.

Recommended: yes.

For Q3:
Choices:
- Yes, token bucket.
- No, fixed window.
- No, sliding window.

Recommended: yes (token bucket).

For Q4:
Choices:
- Yes, 429 with Retry-After.
- No, something else (e.g., 503, or close connection, or no special response).

Recommended: yes.

For Q5:
Choices:
- Yes, deploy in log-only shadow mode first.
- No, enforce from the first deploy.

Recommended: yes.

OK. Let me write the final Round 1.

I should be concise but include enough context. The user wants to be grilled, so I can be direct.

Also, I should not act on the plan, just ask questions. The skill says "Do not act on it until the user confirms you have reached a shared understanding."

Let me make sure I cover the design tree approach - mention that I'm asking the frontier now and will ask follow-ups based on answers.

One more consideration: the skill says "Finding facts is your job, never the user's." I've already found the facts from the files. I don't need to ask for facts. Good.

I should also consider if there are other frontier questions I'm missing. Let me re-read the plan's "Not decided yet" list:
- What to key the limit on: x-customer-id, client IP, or both. → Q1
- Algorithm: fixed window, sliding window, or token bucket. → Q3
- Where counters live: Redis, or in each instance's memory. → Q2
- What happens if the counter store is unreachable: let requests through or reject them. → depends on Q2
- How enterprise customers get higher limits, and who owns those numbers. → depends on Q1 (key)
- What a rejected client sees. → Q4
- How to roll it out without breaking the enterprise integrations. → Q5

So I've covered all the user's listed undecided items, plus raised the authentication concern. Good.

I think Round 1 is ready.

Wait, I should double-check: is x-customer-id really unauthenticated? The code in server.ts:
```typescript
const customerId = req.headers.get("x-customer-id");
if (!customerId) return new Response("missing x-customer-id", { status: 401 });
```
It only checks presence, not validity. So yes, unauthenticated. Any client can send any value.

I'll mention this in Q1.

Also, is there a package.json or other files? Not needed. The relevant facts are in PLAN.md and src/.

OK, final answer.
```

### Model reply

Here is the first frontier of decisions. Each is independent of the others, so answer them in any order.

❓ **Q1** - **Authenticate `x-customer-id` before gating on it**: `src/server.ts` reads `x-customer-id` straight from the request header and only checks that it is present. Any client can send a fresh value and walk around its own limit. Do you want to add a trust mechanism (API key, signed token, mTLS, gateway injection, etc.) *before* you key rate limits on `x-customer-id`?

- Yes, validate/authenticate `x-customer-id` first.
- No, key on the raw header and accept that clients can evade limits.
- No, abandon `x-customer-id` and key on client IP instead.

➡️ Yes, validate/authenticate `x-customer-id` first.

---

❓ **Q2** - **Store counters in Redis**: You run 3 instances of `src/server.ts` behind a round-robin load balancer. Per-instance memory counters would give every customer up to 3× the intended budget and would miss bursts spread across instances. Do you want to store rate-limit counters in the existing Redis 7 cluster?

- Yes, use Redis for shared counters.
- No, keep counters in instance memory and accept the 3× budget / split-burst risk.

➡️ Yes, use Redis for shared counters.

---

❓ **Q3** - **Use a token bucket for `POST /orders`**: You have ~20 enterprise customers with scripted integrations that legitimately burst. A token bucket accommodates bursts while capping sustained load; fixed windows spike at boundaries; sliding windows add complexity for little gain here. Do you want to use a token bucket for `POST /orders`?

- Yes, token bucket.
- No, fixed window.
- No, sliding window.

➡️ Yes, token bucket.

---

❓ **Q4** - **Return 429 with `Retry-After`**: The rejected clients are scripted integrations, so they need a machine-readable signal to back off. Do you want rejected requests to return HTTP 429 Too Many Requests with a `Retry-After` header?

- Yes, 429 with `Retry-After`.
- No, use a different response or close the connection without guidance.

➡️ Yes, 429 with `Retry-After`.

---

❓ **Q5** - **Roll out in shadow / log-only mode first**: To avoid breaking the ~20 enterprise integrations that legitimately burst, do you want the first deploy to record what *would* be throttled without actually rejecting requests?

- Yes, start with log-only enforcement to measure blast radius.
- No, enforce from the first deploy.

➡️ Yes, start with log-only enforcement to measure blast radius.

