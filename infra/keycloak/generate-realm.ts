// Generates the local Keycloak realms from the seeded users in libs/seed, so realm users, fixed subjects
// (JWT `sub`) and database memberships always match. Run after changing libs/seed roles:
//   npx tsx --tsconfig libs/seed/tsconfig.lib.json infra/keycloak/generate-realm.ts
// Writes budgetflow-realm.json (the product realm) and hyland-sso-realm.json (a local stand-in for the
// company identity provider, brokered into the product realm as "Hyland SSO").
// Secrets and ports are ${ENV} placeholders resolved by Keycloak at import from the stack's env file.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ALL_USERS, ROLES, seedId, SSO_LINKED_USERS, userById } from '../../libs/seed/src';

const KC_PUBLIC = 'http://localhost:${BF_KEYCLOAK_PORT:8080}';
/** Keycloak calling itself from inside its container (token, keys and user info for the broker). */
const KC_INTERNAL = 'http://localhost:8080';
const IDP = 'hyland-sso';
const WEB_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4202',
  'http://localhost:${BF_WEB_PORT:4200}',
];

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

const password = { type: 'password', value: '${BF_E2E_PASSWORD}', temporary: false };
const totp = {
  type: 'otp',
  userLabel: 'Authenticator app',
  secretData: JSON.stringify({ value: '${BF_E2E_TOTP_SECRET}' }),
  credentialData: JSON.stringify({
    subType: 'totp',
    digits: 6,
    counter: 0,
    period: 30,
    algorithm: 'HmacSHA1',
  }),
};

/** Fixed subject of a seeded user's account in the corporate identity provider realm. */
const corporateSubject = (n: number) => seedId('51000000', n);
const ssoUsers = SSO_LINKED_USERS.map((id, i) => ({
  user: userById(id),
  subject: corporateSubject(i + 1),
}));

const realm = {
  realm: 'budgetflow',
  displayName: 'BudgetFlow',
  enabled: true,
  sslRequired: 'none',
  loginTheme: 'budgetflow',
  internationalizationEnabled: false,
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  duplicateEmailsAllowed: false,
  resetPasswordAllowed: true,
  rememberMe: false,
  // Lockout after 5 failed attempts for 5 minutes; a successful sign-in resets the count.
  bruteForceProtected: true,
  permanentLockout: false,
  failureFactor: 5,
  waitIncrementSeconds: 300,
  maxFailureWaitSeconds: 300,
  minimumQuickLoginWaitSeconds: 60,
  quickLoginCheckMilliSeconds: 200,
  maxDeltaTimeSeconds: 43200,
  accessTokenLifespan: 900,
  ssoSessionIdleTimeout: 1800,
  otpPolicyType: 'totp',
  otpPolicyAlgorithm: 'HmacSHA1',
  otpPolicyDigits: 6,
  otpPolicyPeriod: 30,
  // Accept the previous and next 30-second code as well (clock skew); a used code is never accepted again.
  otpPolicyLookAheadWindow: 1,
  otpPolicyCodeReusable: false,
  // Password-reset and other account emails go to Mailpit in the local stack.
  smtpServer: {
    host: 'mailpit',
    port: '1025',
    from: 'no-reply@budgetflow.example.test',
    fromDisplayName: 'BudgetFlow',
    auth: 'false',
    ssl: 'false',
    starttls: 'false',
  },
  roles: { realm: ROLES.map((r) => ({ name: r.id, description: `BudgetFlow role: ${r.id}` })) },
  clients: [
    {
      clientId: 'budgetflow-web',
      name: 'BudgetFlow web app',
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      implicitFlowEnabled: false,
      redirectUris: WEB_ORIGINS.map((o) => `${o}/*`),
      webOrigins: ['+'],
      attributes: {
        'pkce.code.challenge.method': 'S256',
        'post.logout.redirect.uris': WEB_ORIGINS.map((o) => `${o}/*`).join('##'),
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
  identityProviders: [
    {
      alias: IDP,
      displayName: 'Hyland SSO',
      providerId: 'oidc',
      enabled: true,
      trustEmail: true,
      storeToken: false,
      linkOnly: false,
      hideOnLogin: false,
      firstBrokerLoginFlowAlias: 'first broker login',
      config: {
        clientId: 'budgetflow-broker',
        clientSecret: '${BF_KC_BROKER_CLIENT_SECRET}',
        clientAuthMethod: 'client_secret_post',
        issuer: `${KC_PUBLIC}/realms/${IDP}`,
        authorizationUrl: `${KC_PUBLIC}/realms/${IDP}/protocol/openid-connect/auth`,
        logoutUrl: `${KC_PUBLIC}/realms/${IDP}/protocol/openid-connect/logout`,
        tokenUrl: `${KC_INTERNAL}/realms/${IDP}/protocol/openid-connect/token`,
        userInfoUrl: `${KC_INTERNAL}/realms/${IDP}/protocol/openid-connect/userinfo`,
        jwksUrl: `${KC_INTERNAL}/realms/${IDP}/protocol/openid-connect/certs`,
        validateSignature: 'true',
        useJwksUrl: 'true',
        pkceEnabled: 'true',
        pkceMethod: 'S256',
        defaultScope: 'openid email profile',
        syncMode: 'LEGACY',
      },
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
    credentials: u.id === 'mfa-user' ? [password, totp] : [password],
    realmRoles: u.roles.filter((r) => ROLES.some((x) => x.id === r)),
    ...(SSO_LINKED_USERS.includes(u.id as never)
      ? {
          federatedIdentities: ssoUsers
            .filter((s) => s.user.id === u.id)
            .map((s) => ({ identityProvider: IDP, userId: s.subject, userName: u.username })),
        }
      : {}),
  })),
};

const corporateIdp = {
  realm: IDP,
  displayName: 'Hyland SSO (local stand-in)',
  enabled: true,
  sslRequired: 'none',
  internationalizationEnabled: false,
  registrationAllowed: false,
  loginWithEmailAllowed: true,
  resetPasswordAllowed: false,
  clients: [
    {
      clientId: 'budgetflow-broker',
      name: 'BudgetFlow (brokered sign-in)',
      publicClient: false,
      secret: '${BF_KC_BROKER_CLIENT_SECRET}',
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      redirectUris: [`${KC_PUBLIC}/realms/budgetflow/broker/${IDP}/endpoint`],
      attributes: { 'pkce.code.challenge.method': 'S256' },
    },
  ],
  users: ssoUsers.map(({ user, subject }) => ({
    id: subject,
    username: user.username,
    email: user.username,
    emailVerified: true,
    firstName: user.firstName,
    lastName: user.lastName,
    enabled: true,
    credentials: [password],
  })),
};

const write = (file: string, data: object) =>
  writeFileSync(join(__dirname, file), `${JSON.stringify(data, null, 2)}\n`);
write('budgetflow-realm.json', realm);
write('hyland-sso-realm.json', corporateIdp);
console.log(
  `wrote budgetflow-realm.json (${realm.users.length} users) and hyland-sso-realm.json (${corporateIdp.users.length} users)`,
);
