import { CONFIG, Public, type AppConfig } from '@bf/api/core';
import type { AuthConfigResponse } from '@bf/contracts';
import { Controller, Get, Inject } from '@nestjs/common';

/** Public sign-in settings, so the web bundle carries no environment-specific URLs. */
@Controller('api/auth')
export class AuthConfigController {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {}

  @Public()
  @Get('config')
  authConfig(): AuthConfigResponse {
    return { issuer: this.config.KEYCLOAK_ISSUER, clientId: this.config.KEYCLOAK_WEB_CLIENT_ID };
  }
}
