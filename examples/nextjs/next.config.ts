import path from 'node:path';
import type { NextConfig } from 'next';

// The sdk lives in the workspace root — alias the package name to its source
// so the example runs against it without a build step.
const sdkDir = path.resolve(process.cwd(), '../../src/sdk').replace(/\\/g, '/');
const incidentsDir = path.resolve(process.cwd(), '../../packages/incidents/src').replace(/\\/g, '/');
const reactDir = path.resolve(process.cwd(), '../../packages/react/src').replace(/\\/g, '/');
const nextjsDir = path.resolve(process.cwd(), '../../packages/nextjs/src').replace(/\\/g, '/');
const nodeDir = path.resolve(process.cwd(), '../../packages/node/src').replace(/\\/g, '/');

const nextConfig: NextConfig = {
  // Allow compiling sources outside this project dir (the workspace sdk).
  experimental: { externalDir: true },
  turbopack: {
    // The sdk lives above the project dir — the workspace root must cover it
    // and aliases must be relative (absolute paths aren't portable here).
    root: '../../',
    resolveAlias: {
      '@jwhenry123/mesh-nextjs': '../../packages/nextjs/src/index.ts',
      '@jwhenry123/mesh-react': '../../packages/react/src/index.ts',
      '@jwhenry123/mesh-incidents': '../../packages/incidents/src/index.ts',
      '@jwhenry123/mesh-node': '../../packages/node/src/index.ts',
      '@jwhenry123/mesh-node/*': '../../packages/node/src/*',
      '@jwhenry123/mesh/sdk': '../../src/sdk/index.ts',
      '@jwhenry123/mesh/sdk/*': '../../src/sdk/*',
      // Pin react to this app's copy: the aliased @jwhenry123/mesh-react source
      // would otherwise resolve the workspace-root react — a second instance
      // whose hooks dispatcher is null at render time.
      react: './node_modules/react',
      'react-dom': './node_modules/react-dom',
    },
  },

  // SharedArrayBuffer requires a cross-origin isolated context
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'require-corp' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' http://localhost:* http://127.0.0.1:*",
          },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },

  webpack: (config) => {
    config.resolve.alias['@jwhenry123/mesh'] = `${sdkDir}/index.ts`;
    config.resolve.alias['@jwhenry123/mesh-nextjs'] = `${nextjsDir}/index.ts`;
    config.resolve.alias['@jwhenry123/mesh-react'] = `${reactDir}/index.ts`;
    config.resolve.alias['@jwhenry123/mesh-incidents'] = `${incidentsDir}/index.ts`;
    config.resolve.alias['@jwhenry123/mesh-node'] = `${nodeDir}/index.ts`;
    config.resolve.alias['@jwhenry123/mesh/sdk'] = sdkDir;
    // Same single-React constraint as the turbopack resolveAlias above.
    config.resolve.alias['react'] = path.resolve(process.cwd(), 'node_modules/react');
    config.resolve.alias['react-dom'] = path.resolve(process.cwd(), 'node_modules/react-dom');
    return config;
  },
};

export default nextConfig;
