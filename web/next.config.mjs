/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // `pg` opens raw sockets and must not be bundled for the edge runtime.
    serverComponentsExternalPackages: ["pg"],
    // The case files are read with fs at runtime, so Next's import tracing
    // cannot see them and would leave them out of the serverless bundle.
    outputFileTracingIncludes: {
      "/api/**": ["./evals/**/*.json"],
    },
  },
};

export default nextConfig;
