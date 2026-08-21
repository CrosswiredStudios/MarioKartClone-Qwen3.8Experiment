---
description: "Run the full quality gate: lint, typecheck, unit tests, build, e2e"
agent: "agent"
---

Run the full quality gate for this repo, in this exact order, **stopping at the first failure**:

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm test`
4. `npm run build`
5. `npm run test:e2e`

Rules:

- **Step 4 (build) MUST complete before step 5** — `vite preview` serves the last `dist/` build, so e2e would otherwise test a stale bundle.
- Before step 5, kill any stale preview server on port 4173 (a leftover listener is silently reused):
  `Get-NetTCPConnection -LocalPort 4173 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`
- If a step fails, report the failure clearly (which step, the error, the likely cause) and stop — do not continue to later steps.
- If all steps pass, report a concise per-step pass summary.
- Do NOT modify any source files to make the gate pass unless the user explicitly asks.
