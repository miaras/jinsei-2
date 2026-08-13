/** @type {import('next').NextConfig} */
const nextConfig = {
  agentRules: false,
  outputFileTracingIncludes: {
    '/api/[endpoint]': ['./dictionaries/*.json.gz']
  },
  turbopack: {
    root: process.cwd()
  }
};

export default nextConfig;
