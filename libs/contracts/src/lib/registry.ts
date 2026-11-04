import { z } from 'zod';

/** Named schemas become OpenAPI components; register every request and response schema here. */
export const schemaRegistry = z.registry<{ id: string; description?: string }>();

export function named<T extends z.ZodType>(id: string, schema: T): T {
  schemaRegistry.add(schema, schema.description ? { id, description: schema.description } : { id });
  return schema;
}
