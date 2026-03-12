import { defineConfig } from 'astro/config';
import catalyst from '@aspect/atua-astro';

export default defineConfig({
  output: 'server',
  adapter: catalyst(),
});
