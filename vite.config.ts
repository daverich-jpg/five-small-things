import { defineConfig } from 'vite';

// relative asset paths so the build works under GitHub Pages' /five-small-things/ subpath
export default defineConfig({ base: './' });
