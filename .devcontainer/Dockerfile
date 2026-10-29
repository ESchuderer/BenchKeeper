# node:22.23.3-bookworm-slim, the same Node as CI
FROM docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562

# shortcut: exact Debian versions stop resolving after the next bookworm security release; bump them when the build fails
RUN apt-get update \
  && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 ca-certificates=20250419~deb12u2 \
    bubblewrap=0.8.0-2+deb12u1 socat=1.7.4.4-2 ripgrep=13.0.0-4+b2 procps=2:4.0.2-3 \
  && rm -rf /var/lib/apt/lists/*

# Playwright MCP with its Chromium, and the Chromium headless shell of the site's @playwright/test (keep 1.64.1 equal to
# web/package.json); the system libraries once, from the MCP's Playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm i -g --ignore-scripts --prefix /usr/local @playwright/mcp@0.0.83 \
  && mcp=/usr/local/lib/node_modules/@playwright/mcp/node_modules/playwright-core/cli.js \
  && node $mcp install-deps chromium && node $mcp install chromium \
  && npm i -g --ignore-scripts --prefix /tmp/pw playwright@1.64.1 && node /tmp/pw/lib/node_modules/playwright/cli.js install --only-shell chromium \
  && chown -R node:node /ms-playwright \
  && npm cache clean --force && rm -rf /tmp/pw /var/lib/apt/lists/*

USER node
