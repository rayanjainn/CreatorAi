/** @type {import('next').NextConfig} */
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
const api = new URL(apiUrl)

const nextConfig = {
  // Generated AGENTS.md / CLAUDE.md files are not part of this repo.
  agentRules: false,
  images: {
    // Thumbnails are signed, short-lived URLs served by the local API (/media/...).
    // There is no remote image dependency; the API origin is the only allowed host.
    unoptimized: true,
    remotePatterns: [
      {
        protocol: api.protocol.replace(':', ''),
        hostname: api.hostname,
        port: api.port || undefined,
        pathname: '/media/**',
      },
    ],
  },
  // Allow the dev server to be opened via 127.0.0.1 as well as localhost.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
}

export default nextConfig
