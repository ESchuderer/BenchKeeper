// SITE_EDITION=next builds main for /next/ (pages.yml); the root shows the latest release. Both editions share one origin:
// the next edition keeps its browser storage (the color scheme choice) apart from the release at the root.
export const next = process.env.SITE_EDITION === 'next';
export const baseUrl = next ? '/BenchKeeper/next/' : '/BenchKeeper/';
export const storageNamespace = next ? 'benchkeeper-next' : 'benchkeeper';
