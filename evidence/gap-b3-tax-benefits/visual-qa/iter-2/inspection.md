# Iteration 2: not inspected

Every capture timed out waiting for the page, including the forbidden states. `scripts/stack.sh reset`
had re-imported the Keycloak realm, so the saved sign-in state in `tmp/e2e-auth/` was stale. The
setup project was re-run and the same capture repeated as iteration 3. Nothing in the screens changed
between iterations 2 and 3.
