import { defineConfig } from 'vite';

const API_PORT = process.env.PORT ?? '8787';

export default defineConfig(({ mode }) => {
  // `--mode static` builds the site to be hosted as plain files, with no server.
  const isStatic = mode === 'static';
  return {
    // Relative addresses, so the static site works from any folder, such as
    // the /<repository>/ a GitHub Pages project site is served from.
    base: isStatic ? './' : '/',
    build: {
      outDir: isStatic ? 'dist-static' : 'dist',
    },
    server: {
      proxy: {
        '/api': `http://localhost:${API_PORT}`,
      },
    },
  };
});
