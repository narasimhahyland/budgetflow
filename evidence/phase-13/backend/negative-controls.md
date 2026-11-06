# Negative controls: the guardrail scenarios fail when the guardrail is weakened

Two guards carry the Phase 13 guarantees. Each was deliberately disabled on the running stack, the
scenarios were re-run, and the guard was restored. Both times the scenarios that are supposed to
prove the guarantee failed, so they are not passing vacuously.

## 1. The figure guard

`libs/api/ai/src/lib/figure-guard.ts`, `figuresTraceable` changed to always return `{ ok: true }`:

```text
Running 1 test using 1 worker
  ✘  1 apps/api-e2e/src/ai/guardrails.spec.ts:20:5 › an answer containing a figure the ledger did not produce is discarded (147ms)

  1) an answer containing a figure the ledger did not produce is discarded

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "discarded_unreliable"
    Received: "answered"

      29 |     AskAnswer,
      30 |   );
    > 31 |   expect(answer.outcome).toBe('discarded_unreliable');

  1 failed
```

With the guard in place the same scenario passes and the model-written figure never reaches the
user. The AI query log still records the call with outcome `discarded_unreliable`, which a second
scenario asserts.

## 2. PolicyService-scoped retrieval

`libs/api/ai/src/lib/retrieval.service.ts`, the `PolicyService.can` filter in `budgetFacts` replaced
by `const permitted = candidates;` (so RLS alone decides what the model sees):

```text
  ✘  1 scoped-retrieval.spec.ts:14 › an owner is answered from the ledger read models, with every figure traceable to a budget
  ✘  2 scoped-retrieval.spec.ts:52 › a scoped owner asking about another subtree is refused and gets no figures from it
  ✘  3 scoped-retrieval.spec.ts:78 › the same question with a context chip the asker may not read surfaces nothing
  ✓  4 scoped-retrieval.spec.ts:93 › another tenant never appears in an answer or in its query-log row
  ✓  5 scoped-retrieval.spec.ts:131 › the query log records the scope that was applied, the records used and the fields sent

  3 failed
  2 passed
```

The two that still pass are the cross-tenant ones, which Postgres RLS holds on its own — exactly the
split you would expect, and the reason the per-record policy check has to exist as well: RLS stops
another tenant, `PolicyService` stops another subtree of the same tenant.

Both files were restored from backup afterwards (`git status` clean, full suite 444 passed).
