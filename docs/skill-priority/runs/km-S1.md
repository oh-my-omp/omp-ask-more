## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to first read the grilling skill and then read PLAN.md to understand what decisions need to be made.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
I should read the skill instructions too.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
The user has a PLAN.md with several "Not decided yet" items. I need to grill them on unresolved decisions. I should map this as a design tree and work in rounds. Let me first explore the project structure to gather facts about the code, then ask the frontier questions.

Let me dispatch a sub-agent or use tools to find facts about the codebase. Actually, I should check if there's relevant code/files.
```

- tool `read` /tmp/askmore-grill

### Model reasoning

```text
Let me read the source files to gather facts.
```

### Model reply

.

- tool `read` /tmp/askmore-grill/src/server.ts

- tool `read` /tmp/askmore-grill/src/orders.ts

- tool `read` /tmp/askmore-grill/src/db.ts

### Model reasoning

```text
Now I have facts. Let me construct the design tree from PLAN.md and ask the frontier questions. The current unsettled decisions are:

1. What to key the limit on: x-customer-id, client IP, or both
2. Algorithm: fixed window, sliding window, or token bucket
3. Where counters live: Redis, or in each instance's memory
4. What happens if the counter store is unreachable: let requests through or reject them
5. How enterprise customers get higher limits, and who owns those numbers
6. What a rejected client sees
7. How to roll it out without breaking the enterprise integrations

Some of these are independent and can be asked now. Some depend on others. Let me think about dependencies:

- What happens if counter store unreachable depends on where counters live (Redis vs memory)
- How enterprise customers get higher limits depends on what we key on (x-customer-id makes it easy)
- Rollout strategy might depend on key choice and algorithm

The frontier (questions we can ask without guessing answers we haven't heard):
- Q1: What to key the limit on? (no prerequisites)
- Q2: Where counters live? (no prerequisites - it's a decision between Redis and memory)
- Q3: What a rejected client sees? (no prerequisites)
- Q4: How to roll it out without breaking enterprise integrations? (could be asked now, but might depend on key/algorithm decisions)

Actually, all of these are largely independent from a design standpoint, except:
- Counter store failure mode depends on where counters live
- Enterprise limit ownership depends somewhat on key choice

But the PLAN.md explicitly lists them as "Not decided yet" - these are all frontier decisions since none of them strictly require another to be answered first. They can all be asked in round 1.

Wait, but I should think more carefully. The skill says "frontier is every decision whose prerequisites are already settled". So I can ask all 7 in round 1 since none have prerequisites that are unsettled. But some have dependencies: failure mode depends on store, enterprise limit ownership depends on key. The skill says a question whose answer depends on another question still open in this round belongs to a later round. So:

- Failure mode if store unreachable → depends on where counters live. So this should be in a later round.
- How enterprise customers get higher limits → depends on what we key on (if keyed on IP, can't easily do per-customer limits). So later round.

So frontier for round 1:
- Q1: What to key the limit on?
- Q2: Algorithm
- Q3: Where counters live
- Q4: What a rejected client sees
- Q5: How to roll it out without breaking enterprise integrations

Actually, rollout might depend on algorithm and key too. But it can be answered at a high level. The question is whether we need to know the answer before asking. I think rollout is a separate concern that can be discussed now.

Let me re-read: "a question whose answer depends on another question still open in this round belongs to a later round". The key thing is "depends on another question still open". For example, "What happens if counter store is unreachable" literally cannot be answered without knowing where counters live. Because if counters live in memory, "unreachable" doesn't make sense. So that's clearly dependent.

For enterprise limits, if we key on IP only, then "how enterprise customers get higher limits" has a different answer than if we key on x-customer-id. So it's dependent.

For rollout, it might be informed by key/algorithm but not strictly dependent. We can ask about rollout strategy now.

OK so round 1 frontier: key, algorithm, store, rejected client response, rollout.

Let me formulate questions worded so "yes" accepts my recommended answer.

Q1 - Key the limit on x-customer-id only
Question: Should we key the rate limit on `x-customer-id` only, ignoring client IP?
Recommended: yes, because x-customer-id identifies the paying customer, survives NAT/mobile IPs, matches the abuse scenario (one customer script), and lets us set per-enterprise limits. IP can be spoofed or shared.

Q2 - Algorithm: token bucket
Question: Should we use a token bucket algorithm?
Recommended: yes, because it allows legitimate bursts while capping sustained rate, which fits enterprise scripts better than fixed window. Sliding window is more accurate but more expensive in Redis.

Q3 - Counters in Redis
Question: Should counters live in the existing Redis 7 cluster rather than per-instance memory?
Recommended: yes, because with 3 instances behind round-robin, per-instance memory would give 3x the effective limit and be uneven. Redis cluster is already operational for sessions.

Q4 - Rejected client sees 429 with Retry-After
Question: Should rejected clients receive HTTP 429 Too Many Requests with a `Retry-After` header?
Recommended: yes, because it's standard, machine-parseable, and scripts can back off.

Q5 - Roll out via allow-list / dry-run first
Question: Should we roll out by first running in shadow/dry-run mode that logs would-be rejections, then enforce only for non-enterprise customers before enabling enterprise limits?
Recommended: yes, because it protects the 20 enterprise integrations from surprise breakage.

Wait, the format requires "Word each question so 'yes' accepts your recommended answer." So I should phrase them as yes/no questions.

Let me reconsider. These are decisions with multiple options, but the recommended answer is one of them. I need to word so yes accepts recommended. The examples in skill show multiple choice-like options. Let me follow the format with options, but phrase the question so "yes" maps to recommended.

Actually the format example shows `<question body, might be multiple paragraphs, including multiple choices>` and then `➡️ <your recommended answer>`. So I can include multiple choices and then give recommended. But also "Word each question so 'yes' accepts your recommended answer." This suggests the question itself should be framed as "Should we do X?" where X is recommended.

I think I can do both: present the options, then ask "Should we go with [recommended option]?" So yes means recommended.

Let me draft:

❓ **Q1 - Rate-limit key**: The abuse came from one customer script; the header `x-customer-id` is already required, while client IP is unstable behind NATs and doesn't map to billing. Should we key the limit on `x-customer-id` only, ignoring IP?

➡️ **Yes** — key on `x-customer-id` only.

---

❓ **Q2 - Algorithm**: Enterprise scripts legitimately burst, so we need burst tolerance. Token buckets allow bursts up to a bucket size while capping the long-term rate; fixed windows allow burst-at-window-edge artifacts; sliding windows are accurate but need more Redis operations. Should we use a token bucket?

➡️ **Yes** — use a token bucket.

---

❓ **Q3 - Counter store**: With three instances behind round-robin, per-instance memory would make the effective limit 3× the intended cap and vary by instance. The Redis 7 cluster is already running for sessions. Should counters live in Redis?

➡️ **Yes** — store counters in the existing Redis cluster.

---

❓ **Q4 - Rejection response**: For rate-limited requests, should the server return HTTP 429 Too Many Requests with a JSON body and a `Retry-After` header (in seconds)?

➡️ **Yes** — return 429 with `Retry-After`.

---

❓ **Q5 - Rollout strategy**: To avoid breaking the 20 enterprise integrations, should we roll out in three stages: (1) dry-run/log-only for a week to measure would-be rejections, (2) enforce only for non-enterprise customers with a generous default limit, (3) then add negotiated enterprise limits?

➡️ **Yes** — staged rollout with dry-run first.

That looks good. These are the frontier questions. Then after they answer, I'll ask the dependent questions:
- Q6: Counter store unreachable behavior (depends on Redis)
- Q7: How enterprise customers get higher limits and who owns the numbers (depends on key)

Let me make sure the questions are clear and answerable with yes/no.
```

### Model reply

I read `PLAN.md` and the `src/` files. Current frontier: the five decisions below have no unsettled prerequisites. (Two more decisions depend on your answers here; I'll ask those next.)

❓ **Q1 - Rate-limit key**: The abuse came from one customer script, and `src/server.ts` already requires the `x-customer-id` header. Client IP is unstable behind NATs and doesn't map to a billing entity. Should we key the limit on `x-customer-id` only, ignoring client IP?

➡️ **Yes** — key on `x-customer-id` only.

---

❓ **Q2 - Algorithm**: Enterprise scripts legitimately burst. Token buckets allow bursts up to a bucket size while capping the sustained rate; fixed windows create burst-at-window-edge artifacts; sliding windows are more accurate but need more Redis operations. Should we use a token bucket?

➡️ **Yes** — use a token bucket.

---

❓ **Q3 - Counter store**: Three `src/server.ts` instances run behind round-robin load balancing. Per-instance memory would make the effective limit roughly 3× the intended cap and uneven across instances. The Redis 7 cluster is already running for sessions. Should counters live in Redis?

➡️ **Yes** — store counters in the existing Redis cluster.

---

❓ **Q4 - Rejection response**: For rate-limited requests, should the server return HTTP 429 Too Many Requests with a `Retry-After` header (in seconds) and a small JSON error body?

➡️ **Yes** — return 429 with `Retry-After` and JSON.

---

❓ **Q5 - Rollout strategy**: To avoid breaking the 20 enterprise integrations, should we roll out in stages: (1) dry-run/log-only to measure would-be rejections, (2) enforce only for non-enterprise customers with a generous default limit, (3) then add negotiated enterprise limits?

➡️ **Yes** — staged rollout starting with dry-run.

