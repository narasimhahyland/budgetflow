// Generates infra/keycloak/budgetflow-realm.json from the seeded users in libs/seed, so realm users,
// fixed subjects (JWT `sub`) and database memberships always match. Run after changing libs/seed roles:
//   npx tsx --tsconfig libs/seed/tsconfig.lib.json infra/keycloak/generate-realm.ts
// Secrets are ${ENV} placeholders resolved by Keycloak at import from infra/.env.example values.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_USERS, ROLES } from '../../libs/seed/src';

const audience = {
  name: 'budgetflow-api audience',
  protocol: 'openid-connect',
  protocolMapper: 'oidc-audience-mapper',
  consentRequired: false,
  config: {
    'included.client.audience': 'budgetflow-api',
    'id.token.claim': 'false',
    'access.token.claim': 'true',
    'introspection.token.claim': 'true',
  },
};

const realm = {
  realm: 'budgetflow',
  displayName: 'BudgetFlow',
  enabled: true,
  sslRequired: 'none',
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  resetPasswordAllowed: true,
  rememberMe: false,
  bruteForceProtected: true,
  accessTokenLifespan: 900,
  ssoSessionIdleTimeout: 1800,
  otpPolicyType: 'totp',
  otpPolicyAlgorithm: 'HmacSHA1',
  otpPolicyDigits: 6,
  otpPolicyPeriod: 30,
  roles: { realm: ROLES.map((r) => ({ name: r.id, description: `BudgetFlow role: ${r.id}` })) },
  clients: [
    {
      clientId: 'budgetflow-web',
      name: 'BudgetFlow web app',
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      implicitFlowEnabled: false,
      redirectUris: [
        'http://localhost:4200/*',
        'http://localhost:4201/*',
        'http://localhost:4202/*',
      ],
      webOrigins: ['+'],
      attributes: {
        'pkce.code.challenge.method': 'S256',
        'post.logout.redirect.uris': 'http://localhost:4200/*',
      },
      protocolMappers: [audience],
    },
    {
      clientId: 'budgetflow-api',
      name: 'BudgetFlow API',
      publicClient: false,
      secret: '${BF_KC_API_CLIENT_SECRET}',
      standardFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
    },
    {
      clientId: 'budgetflow-e2e',
      name: 'BudgetFlow local test client (direct grant, local stack only)',
      publicClient: true,
      standardFlowEnabled: false,
      directAccessGrantsEnabled: true,
      protocolMappers: [audience],
    },
  ],
  users: ALL_USERS.map((u) => ({
    id: u.subject,
    username: u.username,
    email: u.username,
    emailVerified: true,
    firstName: u.firstName,
    lastName: u.lastName,
    enabled: true,
    credentials: [{ type: 'password', value: '${BF_E2E_PASSWORD}', temporary: false }],
    realmRoles: u.roles.filter((r) => ROLES.some((x) => x.id === r)),
  })),
};

writeFileSync(join(__dirname, 'budgetflow-realm.json'), `${JSON.stringify(realm, null, 2)}\n`);
console.log(`wrote budgetflow-realm.json with ${realm.users.length} users`);
