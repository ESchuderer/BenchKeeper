import type { Props } from '@theme/ColorModeToggle';
import { useEffect } from 'react';
import useIsBrowser from '@docusaurus/useIsBrowser';
import { useColorMode } from '@docusaurus/theme-common';
import { Icon } from '../../components/icons';

// One button with a pressed state: dark or light. Until a reader presses it, the page follows the system scheme
// (themeConfig.colorMode.respectPrefersColorScheme); a press is stored and wins over later system changes.
export default function ColorModeToggle({ className }: Props) {
  const isBrowser = useIsBrowser();
  const { colorMode, setColorMode } = useColorMode();
  const dark = colorMode === 'dark';
  // Docusaurus starts following the system scheme only after hydration; a change between page load and then would be
  // missed. With no stored choice, catch up once.
  useEffect(() => {
    const root = document.documentElement;
    if (root.getAttribute('data-theme-choice') !== 'system') return;
    if ((matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') !== root.getAttribute('data-theme')) setColorMode(null);
  }, [setColorMode]);
  return (
    <div className={className}>
      <button type="button" className="clean-btn theme-toggle" data-theme-toggle aria-label="Dark theme" aria-pressed={dark}
        disabled={!isBrowser} onClick={() => setColorMode(dark ? 'light' : 'dark')}>
        <Icon name="Moon" size={16} className="icon-moon" />
        <Icon name="Sun" size={16} className="icon-sun" />
      </button>
    </div>
  );
}
