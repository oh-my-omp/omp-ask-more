## Person: `/skill:grilling Grill me on the unresolved decisions in PLAN.md. Do not implement the plan.`

omp injected the skill as a user-attributed message: its first line, then the 25 lines of `grilling/SKILL.md`.

```text
[IMPORTANT: User invoked the "grilling" skill; follow its instructions. Full skill below.]
```

### Model reasoning

```text
The user wants me to grill them on unresolved decisions in PLAN.md. I need to read the skill first, then read PLAN.md, then identify unresolved decisions and ask them as a design tree frontier. Let me start by reading the skill directory and PLAN.md.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling

- tool `read` /tmp/askmore-grill/PLAN.md

### Model reasoning

```text
I have the skill directory and PLAN.md. Let me read the SKILL.md to understand the grilling skill instructions fully, then formulate the frontier questions.

The plan has these unresolved decisions:
1. Key the limit on: x-customer-id, client IP, or both
2. Algorithm: fixed window, sliding window, or token bucket
3. Where counters live: Redis, or in each instance's memory
4. What happens if counter store unreachable: let through or reject
5. How enterprise customers get higher limits, and who owns those numbers
6. What a rejected client sees
7. How to roll out without breaking enterprise integrations

Some dependencies:
- Where counters live affects what happens if store unreachable (only relevant if Redis)
- Algorithm might affect rollout (token bucket easier for bursts, etc.)
- Keying decision affects enterprise higher limits and rollout

The frontier right now: all decisions can be asked, but some depend on others. Let me think about the tree:

Round 1 frontier: decisions with no prerequisites:
- Q1: Key on what? (x-customer-id, IP, both)
- Q2: Algorithm? (fixed, sliding, token bucket)
- Q3: Counter store? (Redis, in-memory)

Then based on answers:
- If Redis chosen → Q4: Store unreachable behavior
- If x-customer-id or both → Q5: Enterprise higher limits + ownership
- Always → Q6: Rejected client response
- Always → Q7: Rollout strategy

Actually, Q5 (enterprise limits) could be asked regardless of keying choice but is most relevant if keying on customer-id. But it could still matter with IP if they want IP-based exemptions. Hmm.

Also Q7 rollout could depend on all the above. Let me do proper rounds.

Actually, I should read the skill first to make sure I follow format.
```

- tool `read` /tmp/askmore-grill/.omp/skills/grilling/SKILL.md

### Model reasoning

```text
Now I have the skill. I need to ask the frontier. The current unresolved decisions in PLAN.md can be organized as a design tree.

Round 1 - decisions with no prerequisites (can all be asked now):
1. What to key the limit on
2. Which algorithm
3. Where counters live

Round 2 will depend on answers. For example:
- If Redis: counter store unreachable behavior
- If x-customer-id or both: enterprise higher limits
- Always: rejected client response, rollout

But I should also consider: rollout might be partly independent. And rejected client response is independent. However, rollout strategy does depend on knowing who gets limited and how. But I can still ask about high-level approach.

Actually, let me be careful. The skill says: "A question whose answer depends on another question still open in this round belongs to a later round, not this one." So decisions that depend on Round 1 answers go in Round 2.

Frontier for Round 1:
- Q1: Key on x-customer-id, IP, or both?
- Q2: Algorithm: fixed window, sliding window, token bucket?
- Q3: Counter store: Redis or in-memory?

I should provide recommended answers with reasoning based on the plan facts.

For each, word so "yes" accepts recommendation. I can say "Do you want to...?" with my recommendation.

Let me also note I might want to inspect the codebase for facts. The skill says finding facts is my job. Should I look at src/server.ts to understand the structure? The user said "Do not implement the plan" but reading for context is appropriate. However, the questions are about the plan's unresolved decisions, and the plan itself provides the facts. I could look at src/server.ts to ground recommendations, but it might not be necessary for these high-level decisions. Still, it would be useful to know if there's existing middleware structure, how headers are read, etc.

Actually, the skill says "When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent". Do any of my Round 1 questions need filesystem facts? They could benefit from knowing src/server.ts structure, but the questions themselves are decisions. The plan already gives key facts. I think reading src/server.ts would help me give better recommendations, especially for later rounds about rejected responses and rollout. But I can also do that in later rounds.

For now, let me focus on Round 1 with three questions. I should read the codebase to ground my recommendations? The plan says "add rate limiting to src/server.ts". Let me check if src/server.ts exists and what it looks like, to make recommendations concrete.

Actually, the skill says don't ask the user for facts I can look up. But it also says "A running exploration is an unsettled prerequisite, so only the questions downstream of it wait". Since my Round 1 questions don't strictly depend on src/server.ts content, I can ask them now. But I could dispatch a sub-agent or read the file. Reading the file is quick.

Let me read src/server.ts to give grounded recommendations.
```

- tool `read` /tmp/askmore-grill/src/server.ts

### Model reasoning

```text
Good. Now I have facts:
- Bun.serve, fetch handler
- Already requires x-customer-id header, returns 401 if missing
- POST /orders is expensive, GET /orders is cheap
- 3 instances behind round-robin LB
- Redis 7 cluster available for sessions
- ~20 enterprise customers with scripted integrations that burst

Round 1 frontier questions:

Q1: What to key the limit on?
Options:
- x-customer-id only
- client IP only
- both
Recommendation: x-customer-id. Because the app already authenticates with it; customer-level limits make sense for enterprise tiers; IP is unreliable (NAT, dynamic IPs, multiple servers behind one customer). But IP could catch bypass attempts. The plan says "x-customer-id, client IP, or both."

Q2: Algorithm?
Options:
- Fixed window
- Sliding window
- Token bucket
Recommendation: Token bucket. Because enterprise customers legitimately burst; token bucket allows bursts while controlling long-term rate. Fixed window has thundering herd at window boundaries. Sliding window is more precise but complexer and more Redis ops.

Q3: Counter store?
Options:
- Redis
- In-memory
Recommendation: Redis. Because 3 instances behind LB; in-memory limits would give 3x effective limit and uneven distribution. Redis cluster already exists. In-memory is simpler but wrong for multi-instance.

Now, the user said "Do not implement the plan." I'm just grilling.

I should format exactly as specified. Each question with title, body, choices, and recommended answer. Use "Do you want to...?" framing so "yes" accepts recommendation. But the recommendations can be more nuanced - they can pick an option.

Let me write Round 1.
```

### Model reply

I read `PLAN.md` and `src/server.ts`. The server already requires `x-customer-id`, runs on three instances behind a round-robin load balancer, and has a Redis 7 cluster available.

Here is the first frontier of decisions that have no unresolved prerequisites.

---

❓ **Q1** - **Rate-limit key**: Do you want to key the rate limit on `x-customer-id` rather than client IP or a combination?

The app already authenticates every request with `x-customer-id`, so customer-level limiting is natural. IP is unreliable for scripted integrations (NAT, dynamic IPs, multiple servers per customer), and a combination adds complexity without much gain if the header is mandatory. Keying on `x-customer-id` also makes per-enterprise tiers straightforward later.

Options: `x-customer-id` only / client IP only / both.

➡️ **Recommended:** `x-customer-id` only.

---

❓ **Q2** - **Limiting algorithm**: Do you want to use a token bucket instead of fixed or sliding window?

About 20 enterprise customers legitimately burst, so the algorithm should tolerate bursts while capping sustained rate. Fixed windows create boundary spikes and can clobber the database at the top of each window. Sliding windows are more precise but cost more Redis operations and are harder to reason about under load. Token bucket gives burst tolerance with a bounded average.

Options: fixed window / sliding window / token bucket.

➡️ **Recommended:** token bucket.

---

❓ **Q3** - **Counter store**: Do you want to store counters in Redis rather than in each instance's memory?

There are three server instances behind a round-robin load balancer. In-memory counters would give each customer roughly 3× the intended budget and distribute unevenly across instances depending on load-balancer affinity. The Redis 7 cluster is already running for sessions, so the operational cost is low.

Options: Redis cluster / in-memory per instance.

➡️ **Recommended:** Redis cluster.

---

Answer these three and I will compute the next frontier.

