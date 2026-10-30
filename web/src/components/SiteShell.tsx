import { Container, MantineProvider, createTheme } from '@mantine/core';
import type { ReactNode } from 'react';
import SiteFooter from './SiteFooter';
import SiteHeader from './SiteHeader';

const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 9, dark: 9 },
  components: { Anchor: { defaultProps: { underline: 'always' } } },
  fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', fontWeight: '800' },
  defaultRadius: 'md',
});

// The frame of every page: theme, skip link, header and footer. The main page (home) lays out its own sections.
export function SiteShell({ base, home = false, updated, commit, children }: { base: string; home?: boolean; updated?: string; commit?: string; children: ReactNode }) {
  const size = home ? undefined : 'xl';
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader base={base} home={home} size={size} />

      <main id="main" tabIndex={-1}>
        {home ? children : <Container size="xl" py={{ base: 40, md: 64 }}>{children}</Container>}
      </main>
      <SiteFooter base={base} size={size} updated={updated} commit={commit} />
    </MantineProvider>
  );
}
