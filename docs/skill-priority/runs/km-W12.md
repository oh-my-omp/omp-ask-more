## Person: `/skill:grilling What still needs deciding in PLAN.md? Push me on each one.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user invoked the "grilling" skill. I need to read the skill directory first, then read PLAN.md, and grill the user about what still needs deciding.

Let me start by reading the skill directory and PLAN.md.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
Good. I have PLAN.md. Now I need to read the skill to follow its instructions exactly.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I have the skill instructions and PLAN.md. The user wants me to grill them about what still needs deciding in PLAN.md.

Looking at PLAN.md, the "Not decided yet" section lists 7 items:
1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if the counter store is unreachable: let requests through or reject them.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll it out without breaking the enterprise integrations.

The frontier consists of decisions whose prerequisites are already settled. Initially, all these are at the top level and their prerequisites are settled (the context is given). However, some decisions depend on others:
- Where counters live may depend on what to key the limit on (not really, but if keying on client IP behind load balancer, need to consider x-forwarded-for; if in-memory per-instance, then IP-based limiting would be inconsistent across instances).
- What happens if counter store unreachable depends on where counters live (if in-memory, this is less relevant unless instance restart).
- How enterprise customers get higher limits may depend on what we key on.
- Rollout may depend on algorithm, limits, etc.

But for the first round, I think I can ask all 7 as independent decisions since they're all currently open. However, per the skill, "A question whose answer depends on another question still open in this round belongs to a _later_ round." So I should pick the frontier.

Wait, are any of these truly dependent on each other such that I can't ask them now? They're design decisions that are somewhat interrelated but can be answered independently. For example:
- Key: can be decided independently
- Algorithm: can be decided independently
- Counter store: somewhat independent, though in-memory works poorly with IP-based limiting across instances
- Failure mode: depends on counter store choice somewhat
- Enterprise limits: depends on key choice (need to key on customer-id to give different limits per enterprise customer)
- Rejected client response: independent
- Rollout: depends on several decisions

For the first round, I think the frontier is: key, algorithm, maybe counter store. But actually all can be asked with recommendations. Let me think more carefully.

The design tree approach: decisions branch into sub-decisions. The frontier is decisions whose prerequisites are settled. Since nothing is settled yet, the frontier is the root decisions. But what are the root decisions? They all seem to be roots except maybe failure mode depends on counter store.

Actually, to be rigorous, I should ask the independent root decisions first. Let me identify roots:
- Root 1: Rate limit key (x-customer-id, IP, both)
- Root 2: Algorithm (fixed window, sliding window, token bucket)
- Root 3: Counter store (Redis, in-memory)
- Root 4: Enterprise customer limit mechanism (who owns numbers)
- Root 5: Rejected client response
- Root 6: Rollout strategy

Failure mode of counter store depends on choosing Redis. If in-memory, the question changes. So that's a child of counter store.

Enterprise limits depend on key choice (if we key on IP, enterprise limits per customer don't make sense unless we also key on customer-id). So that's somewhat dependent but can still be asked.

Actually, I think for round 1, I should ask the core independent decisions. But the user explicitly asked "What still needs deciding in PLAN.md? Push me on each one." So they want me to push on each undecided item.

Given the skill says "Ask the whole frontier in one round", and to avoid questions that depend on other open questions, I should structure it so that in round 1 I ask the truly independent decisions, then subsequent rounds handle dependencies.

But the user might expect all 7 to be addressed. Hmm. Let me re-read: "Push me on each one." This suggests addressing each item. But the skill says work in rounds.

I think the right approach is to ask the frontier. Let me determine the frontier more carefully:

Prerequisites already settled from PLAN.md context:
- 3 instances behind load balancer
- Redis 7 cluster available
- POST /orders is expensive, GET /orders is cheap
- 20 enterprise customers with scripted integrations that burst

Decisions:
1. Key: independent (prerequisites settled)
2. Algorithm: independent
3. Counter store: independent, though failure mode follows
4. Failure mode of counter store: depends on counter store (if in-memory, failure = process restart/crash; if Redis, failure = network/unreachable)
5. Enterprise limits: depends on key (need x-customer-id to differentiate enterprises)
6. Rejected response: independent
7. Rollout: depends on multiple decisions (algorithm, limits, key)

So the frontier for round 1 is: 1, 2, 3, 6. That's 4 questions.
After those are answered, round 2 could be: 5 (if key is x-customer-id or both), 4 (if counter store is Redis), and maybe 7 (after key/algorithm/store decided).

Actually, 7 (rollout) also depends on enterprise limits, so maybe rollout is round 3.

Let me also consider if I need to look up facts. The skill says finding facts is my job. What facts might I need? For example:
- Existing code structure of src/server.ts
- Whether x-customer-id is already present/parsed
- How load balancer handles x-forwarded-for
- Redis availability/uptime guarantees
- Postgres capacity

But the user is asking about decisions in PLAN.md, not asking me to implement. I could look at src/server.ts to ground some recommendations, but I think for this grilling session about the plan, I can work from the stated facts. However, the skill explicitly says "When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it". 

Do I need facts? For example, to recommend keying on x-customer-id, I'd want to know if the header is reliably present. To recommend Redis, I'd want to know if it's shared across instances. The plan says "A Redis 7 cluster already used for sessions by another service; we may use it" and "3 instances behind round-robin load balancer". So the facts are in the plan.

I could optionally explore src/server.ts to see if x-customer-id is already parsed, but I don't think it's strictly needed for the frontier questions. The plan explicitly lists the undecided items.

Wait, the skill says "Finding facts is your job, never the user's." So if I can look up facts that would help recommendations, I should. But I shouldn't block on it. Let me think if any frontier question needs a fact. Maybe I should check if src/server.ts exists and how it's structured. But that might be overkill for a planning grilling session. The plan itself is the artifact.

Actually, let me consider: the user says "What still needs deciding in PLAN.md? Push me on each one." They want me to use the plan as the source of truth. I don't necessarily need to explore the filesystem.

But to be safe, I could dispatch a sub-agent to look at src/server.ts and related code. However, that would be a running exploration and I'd only block downstream questions on it. Since the frontier questions are mostly independent of code details (based on the plan), I could ask them now and use sub-agent results for later rounds.

Actually, I think I should keep this simple and ask the frontier based on the plan. Let me structure round 1 with 4 questions.

Wait, but maybe the user wants me to be relentless and ask all 7. The skill says ask the frontier. Let me trust the skill.

Actually, I realize some of these decisions could be asked now with caveats. For example, I can ask "If you choose Redis, what happens when it's unreachable?" as a contingent question. But the skill wants binary/recommended answers. I could frame it as "Do you want Redis?" and "If Redis, fail open or closed?" But the second depends on the first.

I think cleanest is round 1: key, algorithm, counter store, rejected client response.

Round 2: failure mode (if Redis), enterprise limits (if customer-id based), rollout strategy.

Round 3: maybe refine rollout.

Let me draft the questions with recommended answers.

Q1: Key the limit on x-customer-id?
- Context: 20 enterprise customers burst, POST is expensive, behind LB
- Options: x-customer-id (recommended), client IP, both
- Recommended: x-customer-id
- Why: IP can be shared/NATed across enterprises, x-customer-id lets you give per-customer limits and matches your authentication/authorization. Both adds complexity and false sense of security.
- Worded so "yes" accepts: "Should we key the rate limit on x-customer-id rather than IP or both?"

Q2: Use token bucket algorithm?
- Context: enterprise customers legitimately burst
- Options: fixed window, sliding window, token bucket (recommended)
- Recommended: token bucket
- Why: handles bursts naturally, which matches "legitimately burst" requirement.
- Worded so "yes" accepts: "Should we use a token bucket rather than fixed or sliding window?"

Q3: Store counters in Redis?
- Context: 3 instances behind round-robin LB, Redis 7 cluster available
- Options: Redis (recommended), in-memory
- Recommended: Redis
- Why: in-memory counters would give each instance its own limit, effectively multiplying the allowed rate by 3 and making it inconsistent.
- Worded so "yes" accepts: "Should counters live in the Redis cluster rather than per-instance memory?"

Q4: Rejected clients see 429 Too Many Requests with Retry-After?
- Context: scripted integrations
- Options: 429 with Retry-After (recommended), 503, 429 without Retry-After, custom JSON error
- Recommended: 429 with Retry-After header
- Why: standard, scripts can back off.
- Worded so "yes" accepts: "Should rejected clients receive HTTP 429 with a Retry-After header?"

Then wait for answers. But the user wants me to "push" them. I should include tradeoffs and why I'm recommending.

Let me also think about whether I should explore the filesystem. The plan is clear. But the skill says facts are my job. Maybe I should quickly check if src/server.ts exists and what framework it uses. That might help with later questions about rollout/rejected response. But it's not needed for the frontier.

Actually, I think for this first round, I'll ask based on the plan. If later rounds need code facts, I'll dispatch a sub-agent.

Wait, I should re-read the skill one more time to make sure I follow formatting exactly.

Format:
```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body...
```

Word each question so "yes" accepts your recommended answer.

OK. I'll produce 4 questions for round 1.

Actually, let me reconsider: should I include "How to roll out without breaking enterprise integrations" in round 1? It depends on key, algorithm, and store choices. But I could ask it as a high-level strategic decision: e.g., "Roll out in monitor-only mode first?" This is somewhat independent of the specific algorithm. However, the rollout details (limits, exceptions) depend on enterprise limits which depend on key. So I think rollout is later.

Similarly, "How enterprise customers get higher limits" depends on key choice. If key is IP, higher limits per enterprise customer is hard. So it's later.

"What happens if counter store unreachable" depends on counter store choice. If in-memory, the question is different. So it's later.

So round 1 frontier = 4 questions.

Now, I should also consider: is there a fact I need about x-customer-id? The plan says we have it as an option, implying it's a header used. To recommend it, I should assume it's reliable. But maybe I should check if src/server.ts already extracts it. I think I can ask the question without that fact, and if the user says "yes but we need to verify it exists", we can explore. Or I can dispatch a sub-agent now to check, but that would block? No, I can ask the other questions now and only block follow-ups that need the code fact.

Actually, I think for thoroughness and since the skill says facts are my job, I should look at src/server.ts to see how x-customer-id is used. But maybe I shouldn't overcomplicate. The user is asking about the plan, and the plan lists x-customer-id as an option. I can work with that.

I'll proceed with round 1 questions.

One more consideration: the skill says "Ask the whole frontier in one round". So I should ask all 4 together, not one by one. Good.

Let me draft them now.

Q1 title: Key on `x-customer-id`
Body: With 3 instances behind a load balancer, client IPs may be NATed or shared across enterprise customers, and per-IP limits could accidentally throttle a whole building. `x-customer-id` aligns limits with your authenticated customer, which is necessary if enterprise customers get different limits later. Keying on both adds complexity without much benefit if the header is already trustworthy.
Choices: x-customer-id, IP, both
Recommended: x-customer-id

Q2 title: Token bucket algorithm
Body: Fixed windows allow bursts at window boundaries and penalize legitimate scripts that arrive in clumps. Sliding windows are smoother but more expensive to compute. Token buckets naturally accommodate bursts up to a bucket size while capping sustained rate, which matches "enterprise customers legitimately burst."
Choices: fixed window, sliding window, token bucket
Recommended: token bucket

Q3 title: Store counters in Redis
Body: Per-instance memory means each of the 3 servers maintains its own counter. Under round-robin load balancing, a customer hitting all 3 instances effectively gets 3x the intended limit, and the limit varies with instance count. Redis gives a single source of truth and lets you change limits centrally.
Choices: Redis, in-memory
Recommended: Redis

Q4 title: Reject with 429 + Retry-After
Body: Scripts need a machine-readable signal to back off. 429 Too Many Requests is the standard status; Retry-After tells them when to retry without hard-coding a backoff. 503 implies server overload, which is misleading, and a bare 429 forces clients to guess.
Choices: 429 + Retry-After, 503, 429 without Retry-After, custom JSON error
Recommended: 429 + Retry-After

I think these are good. Let me format them properly.

Wait, I should make sure "yes" accepts the recommended answer. Let me check:
- "Should we key the rate limit on x-customer-id?" Yes → accept.
- "Should we use a token bucket algorithm?" Yes → accept.
- "Should counters live in the Redis cluster?" Yes → accept.
- "Should rejected clients receive HTTP 429 with Retry-After?" Yes → accept.

Good.

Now I should produce the output.
```

### Model reply

I see seven open decisions in `PLAN.md`. Four of them are independent enough to settle first; the other three branch off these.

---

❓ **Q1** - **Key on `x-customer-id`**: Client IPs can be NATed or shared across enterprise customers, and per-IP limits would throttle a whole building by accident. Keying on `x-customer-id` ties the limit to the authenticated customer, which is also required if enterprise customers later get different limits. Keying on both adds complexity without much benefit if the header is already trustworthy.

➡️ **Recommended**: Key the limit on `x-customer-id`.

---

❓ **Q2** - **Use a token bucket**: Fixed windows allow bursts at window boundaries and can clobber legitimate scripts that arrive in lumps. Sliding windows are smoother but more expensive to compute. A token bucket naturally absorbs bursts up to a bucket size while capping sustained rate, which matches your stated case that enterprise customers legitimately burst.

➡️ **Recommended**: Use a token bucket algorithm.

---

❓ **Q3** - **Store counters in Redis**: With three instances behind a round-robin load balancer, per-instance memory means each server keeps its own counter. A customer hitting all three effectively gets 3× the intended limit, and the limit drifts whenever instance count changes. Redis gives a single source of truth and central limit management.

➡️ **Recommended**: Store counters in the existing Redis 7 cluster.

---

❓ **Q4** - **Reject with 429 + Retry-After**: Scripted integrations need a machine-readable signal to back off. `429 Too Many Requests` is the standard; `Retry-After` tells them exactly when to retry. `503` implies server overload, which is misleading, and a bare `429` forces clients to guess.

➡️ **Recommended**: Return `429 Too Many Requests` with a `Retry-After` header.

