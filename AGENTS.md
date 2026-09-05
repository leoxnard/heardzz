<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

Project runs in Docker on server with this specification:
leosrv full specs:

CPU: Intel Core i7-4770HQ @ 2.20GHz (4 cores / 8 threads, up to 3.4 GHz) — this matches the Crystal Well integrated GPU, a NUC-class/laptop chip
GPU: Intel Crystal Well integrated graphics only, no discrete GPU
RAM: 15 GiB total, 3.8 GiB used, 11 GiB available
Swap: 12 GiB, barely used
Disk (/): 217 GB, 29 GB used, 178 GB free (14%)
OS/Kernel: Debian 13 (trixie), kernel 6.12.100+deb13-amd64
Modest, older hardware (Haswell-era, ~2013/14) but plenty of free RAM/disk for a Docker host running these workloads.

<!-- END:nextjs-agent-rules -->
