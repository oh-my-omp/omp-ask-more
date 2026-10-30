## Person: `/skill:grilling Let's nail down the rate limiter design in PLAN.md together.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to use the "grilling" skill to interview them about a rate limiter design in PLAN.md. I need to read the skill first, then read PLAN.md, then start asking questions through the ask tool.

Let me read the skill directory and PLAN.md in parallel.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
I need to read the SKILL.md file to understand the grilling skill better.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I understand the skill and the PLAN.md content. I need to design the first round of questions.

The plan mentions these undecided items:
1. What to key the limit on: `x-customer-id`, client IP, or both.
2. Algorithm: fixed window, sliding window, or token bucket.
3. Where counters live: Redis, or in each instance's memory.
4. What happens if the counter store is unreachable: let requests through or reject them.
5. How enterprise customers get higher limits, and who owns those numbers.
6. What a rejected client sees.
7. How to roll it out without breaking the enterprise integrations.

I need to map these as a design tree. Some decisions are independent (can be asked now), some depend on others.

Independent decisions (frontier):
- Key: customer-id vs IP vs both
- Algorithm: fixed vs sliding vs token bucket
- Counter store: Redis vs in-memory
- Rollout strategy (this might be independent)
- Rejected client response (mostly independent)

Dependent decisions:
- Store unreachable behavior depends on counter store choice (only relevant if Redis)
- Enterprise higher limits depends on key choice (if keyed by customer-id, enterprise customers can be identified; if IP, harder)

Actually, let me think about the design tree more carefully:

1. Key decision → affects enterprise limits and possibly rollout
2. Algorithm decision → independent initially, but affects Redis data structures
3. Store decision → Redis or in-memory; if Redis, then failure mode question
4. Enterprise limits → depends on key decision
5. Rejected response → somewhat independent
6. Rollout → depends on knowing key, limits, etc.

For round 1, the frontier should be questions whose prerequisites are settled. Since no user answers yet, prerequisites are just facts from PLAN.md. So I can ask:
- Q1: Key the limit on `x-customer-id` (recommended)
- Q2: Algorithm: token bucket (recommended - handles bursts well for enterprise)
- Q3: Counter store: Redis cluster (recommended - needed for 3 instances behind LB)
- Q4: Rollout: start with monitoring-only / shadow mode then enforce

Then dependent questions go to round 2:
- If Redis: failure mode (fail-open vs fail-closed)
- If customer-id key: enterprise limits mechanism
- Rejected client response (could be in round 1 or 2; let's put it in round 2 since the format might depend on key)

Wait, rejected client response is fairly independent. But it's a small detail. Let me include it in round 2 to keep round 1 focused on architectural decisions.

Actually, I should be careful. The skill says "Ask the whole frontier in one round." The frontier is all decisions I can ask now. So I should include all independent decisions.

Let me reconsider:
- Q1: Key on `x-customer-id` alone? (recommended yes)
- Q2: Use token bucket? (recommended yes)
- Q3: Store counters in Redis cluster? (recommended yes)
- Q4: Start rollout in shadow/monitoring mode? (recommended yes)

Then round 2 would have:
- Q5: If Redis unreachable, fail-open? (recommended yes - avoid breaking all orders if Redis down)
- Q6: Enterprise limits via per-customer config keyed by `x-customer-id`? (recommended yes)
- Q7: Return 429 with Retry-After header? (recommended yes)
- Q8: Who owns enterprise limit numbers? (depends on enterprise limits decision)

Actually, Q8 depends on Q6. So Q8 is round 3 if Q6 is yes.

Let me think about the exact tree structure:

Root: Rate limiter design
├─ Key: customer-id / IP / both
│  ├─ (if customer-id or both) Enterprise limits mechanism
│  │  ├─ Per-customer config table/file
│  │  ├─ Who owns numbers: ops/account management/engineering
│  ├─ (if IP or both) NAT/shared IP handling
├─ Algorithm: fixed / sliding / token bucket
├─ Store: Redis / in-memory
│  ├─ (if Redis) Failure mode: fail-open / fail-closed
│  ├─ (if in-memory) LB affinity requirement
├─ Rejected response: 429 + headers / 503 / custom JSON
├─ Rollout: shadow / gradual / immediate

For round 1, I can ask about: Key, Algorithm, Store, Rollout strategy, Rejected response. But rejected response is independent. Let me include it in round 1 too? The skill says ask the whole frontier.

Actually, let me keep it manageable. Round 1 has 4 big architectural decisions. Round 2 handles their dependents.

But wait - rollout strategy depends on knowing if enterprise customers have higher limits. If we don't know how enterprise limits work, we can't fully decide rollout. But we can still ask about the general rollout approach (shadow → enforce). The details depend on limits.

Hmm, actually all these are somewhat interdependent. But I should follow the skill strictly: only ask questions whose prerequisites are already settled. The prerequisite for rollout details is knowing the limit mechanism, but a high-level rollout strategy (monitor first) can be asked independently.

Let me formulate round 1:

Q1: Key on `x-customer-id` (not IP)?
- Recommended: yes
- Reason: PLAN.md says 20 enterprise customers have scripted integrations; customer-id identifies them for differentiated limits. IP is brittle (NAT, shared egress, dynamic IPs).

Q2: Use token bucket algorithm?
- Recommended: yes
- Reason: handles legitimate bursts better than fixed window; smoother than sliding window log implementation.

Q3: Store counters in Redis cluster?
- Recommended: yes
- Reason: 3 instances behind round-robin LB; in-memory counters would allow 3x the intended limit.

Q4: Start rollout in shadow/monitoring mode before enforcing?
- Recommended: yes
- Reason: 20 enterprise integrations burst legitimately; need to measure actual traffic before setting limits.

Then round 2 depends on answers.

Let me construct the ask call. Each question needs:
- id
- question
- options (2-5)
- brief with what, where, how
- recommended index

I need to make options where "yes" accepts the recommended answer.

For Q1:
Options:
1. Yes, key on `x-customer-id` only
2. Yes, but key on `x-customer-id` with IP as fallback
3. No, key on client IP only
4. No, key on both independently

Recommended: 0 (first option)

For Q2:
Options:
1. Yes, token bucket
2. No, fixed window
3. No, sliding window

Recommended: 0

For Q3:
Options:
1. Yes, Redis cluster
2. No, in-memory with sticky sessions from LB
3. No, in-memory and accept 3x effective limit

Recommended: 0

For Q4:
Options:
1. Yes, shadow mode first
2. No, enforce immediately with high limits
3. No, enforce immediately with conservative limits

Recommended: 0

I should use the ask tool. The skill says to put every question through ask, never into reply. So I need to call ask with these 4 questions.

Let me prepare the ask call with proper structure.
```

### ask call

```json
{"questions":[{"id":"key","question":"Should the rate limiter key on `x-customer-id` rather than client IP?","options":[{"label":"Key on `x-customer-id` only","tradeoff":"Lets us give enterprise customers differentiated limits and ignores NAT/shared egress issues, but a customer can spin up multiple clients and still looks like one identity."},{"label":"Key on `x-customer-id`, with IP as a secondary signal","tradeoff":"Adds some abuse detection but complicates the key scheme and may split one customer's legitimate traffic across IPs."},{"label":"Key on client IP only","tradeoff":"Simple to implement, but shared NAT, dynamic IPs, and multi-region customers will get wrong limits; enterprise tiers become hard to support."},{"label":"Key on both independently","tradeoff":"Strongest abuse isolation, but doubles counter storage and a customer can still be throttled by another IP behind the same NAT."}],"brief":{"where":"PLAN.md says one customer created 40,000 orders in ten minutes and there are ~20 enterprise customers with scripted integrations that legitimately burst.","what":"We must choose the request attribute that identifies a \"user\" for rate-limit accounting.","how":"This decides whether enterprise tiers and shared-egress customers are handled naturally or require extra work. Picking `x-customer-id` makes the later enterprise-limit decision straightforward; IP-based keys make that branch much harder."},"recommended":0,"header":"Limit key"},{"id":"algorithm","question":"Should we use a token-bucket algorithm for the limiter?","options":[{"label":"Token bucket","tradeoff":"Smoothly absorbs legitimate bursts (good for scripted integrations) while enforcing a long-term rate; slightly more state to maintain in Redis."},{"label":"Fixed window","tradeoff":"Simple and cheap, but allows traffic spikes at window boundaries and can unfairly throttle a burst that straddles two windows."},{"label":"Sliding window","tradeoff":"More precise than fixed window, but accurate implementations need a log of request timestamps; Redis memory cost scales with burst size."}],"brief":{"where":"PLAN.md lists fixed window, sliding window, and token bucket as options and notes enterprise scripts legitimately burst.","what":"We must choose the accounting algorithm that turns a counter into an allow/deny decision.","how":"This affects burst friendliness, Redis data structures, and fairness. Token bucket is the conventional choice when callers need short bursts but must not sustain high throughput."},"recommended":0,"header":"Algorithm"},{"id":"store","question":"Should counters live in the existing Redis 7 cluster rather than in each instance's memory?","options":[{"label":"Use the Redis 7 cluster","tradeoff":"Correctly enforces limits across the three round-robin instances, but adds a network hop and a new failure mode to reason about."},{"label":"Use in-memory counters and require sticky sessions from the load balancer","tradeoff":"Avoids Redis dependency, but reconfiguring the LB for sticky sessions is a separate change and uneven load can over- or under-limit customers."},{"label":"Use in-memory counters and accept the effective limit will be ~3× the configured value","tradeoff":"Simplest implementation, but a single customer could still use 3× the intended quota and the real limit becomes unpredictable."}],"brief":{"where":"PLAN.md says there are 3 instances of `src/server.ts` behind a round-robin load balancer and a Redis 7 cluster is already used for sessions.","what":"We must decide where the limiter state is stored.","how":"This determines whether the limit is global across instances or per-instance, and whether Redis unavailability becomes a design concern."},"recommended":0,"header":"Counter store"},{"id":"rollout","question":"Should we roll out in a shadow/monitoring mode before enforcing limits?","options":[{"label":"Start in shadow mode: log what would be throttled, then flip to enforce","tradeoff":"Safest for the 20 enterprise integrations, but delays protection by at least one deployment and requires building a monitoring/alerting path."},{"label":"Enforce immediately with intentionally high limits","tradeoff":"Gives protection now while avoiding false positives, but the initial limits may still be wrong and customers may already adapt to them."},{"label":"Enforce immediately with conservative limits and a kill switch","tradeoff":"Fastest protection, but risks breaking legitimate enterprise bursts and requires active on-call response if it goes wrong."}],"brief":{"where":"PLAN.md notes enterprise customers legitimately burst and asks how to roll out without breaking their integrations.","what":"We must choose how the new behavior is introduced to production.","how":"This decides whether we collect real traffic data before setting limits and how we manage the risk of cutting off paying customers."},"recommended":0,"header":"Rollout strategy"}]}
```

### ask result

```text
User answers:
key: (cancelled)
algorithm: (cancelled)
store: (cancelled)
rollout: (cancelled)
```

