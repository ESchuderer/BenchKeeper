# node:22.23.3-bookworm-slim, the same Node as CI
FROM docker.io/library/node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562

RUN apt-get update \
  && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 ca-certificates=20250419~deb12u1 \
  && rm -rf /var/lib/apt/lists/*

# Playwright MCP with its Chromium, and the Chromium headless shell of the site's @playwright/test (keep 1.64.0 equal to
# web/package.json)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm i -g --prefix /usr/local @playwright/mcp@0.0.83 \
  && cd /usr/local/lib/node_modules/@playwright/mcp && npx playwright install --with-deps chromium \
  && npx -y playwright@1.64.0 install --with-deps --only-shell chromium \
  && chown -R node:node /ms-playwright \
  && npm cache clean --force && rm -rf /root/.npm/_npx /var/lib/apt/lists/*

USER node
