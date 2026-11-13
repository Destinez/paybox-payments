import SwaggerParser from '@apidevtools/swagger-parser';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { db, pool, resetDatabase, setupDatabase } from './database';
import { fixture } from './fixtures';

beforeAll(setupDatabase);
beforeEach(resetDatabase);
afterAll(() => pool.end());
it('generated OpenAPI validates and matches every documented route', async () => {
  const { app } = await fixture(db);
  const response = await app.request('/v1/openapi.json');
  const spec = JSON.parse(await response.text());
  await SwaggerParser.validate(spec);
  const methods = ['get', 'post', 'put', 'delete'];
  for (const [path, definition] of Object.entries(spec.paths as Record<string, Record<string, unknown>>)) {
    for (const method of methods.filter((m) => m in definition))
      expect(
        app.routes.some(
          (route) =>
            route.method === method.toUpperCase() && route.path === path.replace(/\{(\w+)\}/g, ':$1'),
        ),
      ).toBe(true);
  }
  for (const route of app.routes.filter(
    (r) => r.path.startsWith('/v1/') && r.method !== 'ALL' && r.path !== '/v1/openapi.json',
  ))
    expect(spec.paths[route.path.replace(/:(\w+)/g, '{$1}')]).toHaveProperty(route.method.toLowerCase());
});
