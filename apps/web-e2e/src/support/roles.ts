// One seeded Keycloak test user per role (infra/keycloak, generated from libs/seed). The id is the
// storageState file name (tmp/e2e-auth/<id>.json) used by specs and visual/screens.json from Phase 2.
export { ROLES, authFile, type RoleId } from '@bf/seed';
