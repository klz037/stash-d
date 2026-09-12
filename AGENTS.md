# stash'd agent notes

Monorepo: `apps/api` (NestJS), `apps/web` (Vite React PWA), `packages/shared`.

Read `README.md`, `SPEC.md`, and `PAIRING.md` before changing product behavior.

- A **lock** is the noun. **Stash** is the verb.
- Never return lock `text` / `imageUrl` unless `state === UNLOCKED`.
- Pairing codes: alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, stored uppercase without hyphen.
- Auth0 JWTs only. No fake client secrets. JWT guard stays on every domain route.
