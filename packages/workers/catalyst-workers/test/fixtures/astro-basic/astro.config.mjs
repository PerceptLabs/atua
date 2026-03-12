import { defineConfig } from 'astro/config';
import catalyst from '@aspect/catalyst-astro';

export default defineConfig({
  output: 'server',
  adapter: catalyst(),
});
