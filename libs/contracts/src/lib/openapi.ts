import { z } from 'zod';
import { problemResponse, endpoints, type Endpoint } from './endpoints';
import { schemaRegistry } from './registry';

type JsonSchema = Record<string, unknown>;

function strip(schema: JsonSchema): JsonSchema {
  const { $schema: _s, $id: _sid, id: _id, ...rest } = schema;
  return rest;
}

function refFor(schema: z.ZodType): JsonSchema {
  const meta = schemaRegistry.get(schema);
  if (!meta) throw new Error('Every request and response schema must be registered with named()');
  return { $ref: `#/components/schemas/${meta.id}` };
}

function parameters(obj: z.ZodObject | undefined, where: 'path' | 'query'): JsonSchema[] {
  if (!obj) return [];
  const js = z.toJSONSchema(obj, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, JsonSchema>;
    required?: string[];
  };
  return Object.entries(js.properties ?? {}).map(([name, schema]) => ({
    name,
    in: where,
    required: where === 'path' || (js.required ?? []).includes(name),
    schema: strip(schema),
  }));
}

/** OpenAPI 3.1 document generated from the zod contracts. Never hand-edit openapi.json. */
export function buildOpenApiDocument(): JsonSchema {
  const { schemas } = z.toJSONSchema(schemaRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    unrepresentable: 'any',
  }) as {
    schemas: Record<string, JsonSchema>;
  };
  const paths: Record<string, Record<string, JsonSchema>> = {};
  for (const e of Object.values(endpoints) as Endpoint[]) {
    const headers: JsonSchema[] = [];
    if (e.auth) {
      headers.push({
        name: 'X-Tenant-Id',
        in: 'header',
        required: false,
        description: 'Tenant to act in; required when the user belongs to more than one tenant.',
        schema: { type: 'string', format: 'uuid' },
      });
    }
    if (e.idempotent) {
      headers.push({
        name: 'Idempotency-Key',
        in: 'header',
        required: true,
        description:
          'Unique per user action; a replay returns the first response without posting again.',
        schema: { type: 'string', minLength: 8, maxLength: 200 },
      });
    }
    const responses: Record<string, JsonSchema> = {
      [String(e.response.status)]: {
        description: 'Success',
        content: { 'application/json': { schema: refFor(e.response.schema) } },
      },
    };
    for (const status of e.errors) {
      responses[String(status)] = {
        description: 'Problem details',
        content: { 'application/problem+json': { schema: refFor(problemResponse) } },
      };
    }
    paths[e.path] ??= {};
    paths[e.path][e.method] = {
      operationId: e.operationId,
      summary: e.summary,
      tags: e.tags,
      security: e.auth ? [{ bearer: [] }] : [],
      parameters: [...parameters(e.params, 'path'), ...parameters(e.query, 'query'), ...headers],
      ...(e.body
        ? {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: refFor(e.body) } },
            },
          }
        : {}),
      responses,
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'BudgetFlow API',
      version: '0.1.0',
      description:
        'Corporate budget delegation and control. Money is integer minor units with ISO 4217 codes; errors are RFC 9457 problem details.',
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local stack' }],
    components: {
      securitySchemes: {
        bearer: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Keycloak access token (OIDC).',
        },
      },
      schemas: Object.fromEntries(
        Object.entries(schemas)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => [k, strip(v)]),
      ),
    },
    paths,
  };
}
