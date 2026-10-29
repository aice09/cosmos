import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: projectRoot,
  outputFileTracingIncludes: {
    '/api/security/scan': [
      './node_modules/@b2bc-devkit/trivy-scan/**/*',
      './node_modules/tar/**/*',
      './node_modules/unzipper/**/*',
    ],
  },
};

export default nextConfig;
