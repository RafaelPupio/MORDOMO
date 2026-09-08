import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // The staff upload form promises "até 5 MB". Next's default Server Action body is
      // 1 MB, and a 2 MB scan came back as a 413 "Body exceeded 1 MB limit" before the
      // action ever ran (2026-09-07). Route handlers (/api/ingest) were never affected.
      // 6 MB leaves room for multipart overhead around a 5 MB file; the action itself
      // still enforces MAX_UPLOAD_BYTES.
      bodySizeLimit: '6mb',
    },
  },
};

export default nextConfig;
