import { inject, Injectable } from '@angular/core';
import { createApiClient, type ApiClient } from '@bf/contracts';
import { API_BASE_URL, AuthService } from './auth.service';

/** The typed contracts client with the signed-in user's bearer token; a 401 ends the session. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly auth = inject(AuthService);
  private readonly baseUrl = inject(API_BASE_URL);

  readonly client: ApiClient = this.create(false);
  /** Same client with `keepalive`, for requests sent while the page is being hidden or closed. */
  readonly keepaliveClient: ApiClient = this.create(true);

  private create(keepalive: boolean): ApiClient {
    return createApiClient({
      baseUrl: this.baseUrl,
      headers: (): Record<string, string> => {
        const token = this.auth.accessToken();
        return token ? { authorization: `Bearer ${token}` } : {};
      },
      fetch: async (input, init) => {
        const res = await fetch(input, { ...init, keepalive });
        if (res.status === 401) this.auth.markExpired();
        return res;
      },
    });
  }
}
