// Both editions share one origin: the next edition (main, under /next/) keeps its browser storage apart from the release at the root.
export const themeKey = import.meta.env.BASE_URL.includes('/next') ? 'benchkeeper-next-color-scheme' : 'mantine-color-scheme-value';
