import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

// Carga *.csv como texto, igual que la regla Text de wrangler.toml.
export default defineConfig({
  plugins: [
    {
      name: 'csv-as-text',
      transform(_code: string, id: string) {
        if (id.endsWith('.csv')) return { code: `export default ${JSON.stringify(readFileSync(id, 'utf8'))};`, map: null };
      },
    },
  ],
  test: { include: ['test/**/*.test.ts'] },
});
