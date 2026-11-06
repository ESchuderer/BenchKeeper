import { Container, MantineProvider, createTheme, type MantineColorsTuple } from '@mantine/core';
import type { ReactNode } from 'react';
import SiteFooter from './SiteFooter';
import SiteHeader from './SiteHeader';

// shortcut: a copy of the interim palette in packages/ui/src/main.tsx (the brand's evergreen #2e5e4e as shade 7), since
// web/ cannot import from the workspace; replace both with the theme generated from the family design tokens once published.
const evergreen: MantineColorsTuple = ['#eef5f2', '#dde9e4', '#b7d0c6', '#8fb6a7', '#6d9f8c', '#57917c', '#4a8571', '#2e5e4e', '#254d40', '#1b3a30'];

const theme = createTheme({
  primaryColor: 'evergreen',
  primaryShade: 7,
  colors: { evergreen },
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
