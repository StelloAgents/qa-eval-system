/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // `pg` opens raw sockets and must not be bundled for the edge runtime.
    serverComponentsExternalPackages: ["pg"],
  },
};

export default nextConfig;
