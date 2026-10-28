import { Container, MantineProvider, createTheme } from '@mantine/core';
import type { ReactNode } from 'react';
import SiteHeader from './SiteHeader';

const theme = createTheme({
  primaryColor: 'teal',
  primaryShade: { light: 9, dark: 9 },
  components: { Anchor: { defaultProps: { underline: 'always' } } },
  fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  headings: { fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif', fontWeight: '800' },
  defaultRadius: 'md',
});


export function BenchShell({ base, bench, children }: { base: string; bench?: boolean; children: ReactNode }) {
  return (
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <a className="skip" href="#main">Skip to content</a>
      <SiteHeader base={base} size="xl" bench={bench} />

      <main id="main" tabIndex={-1}>
        <Container size="xl" py={{ base: 40, md: 64 }}>{children}</Container>
      </main>
    </MantineProvider>
  );
}
