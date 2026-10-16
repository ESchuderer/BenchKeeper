import type { Route } from './router';
import { byKey } from './data';
import { bulletByKey } from './bullets';

/** Page metadata uses the same translated names and descriptions as the visible headers. */
export function pageMetadata(route: Route, t: (key: string) => string) {
  const pages: Record<Route['view'], [string, string]> = {
    list: ['list.title', 'list.lede'],
    cartridge: ['list.title', 'list.lede'],
    compare: ['compare.title', 'list.lede'],
    bullets: ['bullets.title', 'bullets.lede'],
    bullet: ['bullets.title', 'bullets.lede'],
    designer: ['actions.addBullet', 'designer.lede2'],
    targets: ['targets.title', 'targets.databaseLede'],
    newTarget: ['actions.addTarget', 'targetEditor.lede'],
    preview: ['preview.title', 'preview.lede'],
    targetScoring: ['photo.title', 'photo.lede'],
    myData: ['data.title', 'data.lede'],
    newCartridge: ['actions.addCartridge', 'newCartridge.lede']
  };
  const [titleKey, descriptionKey] = pages[route.view];
  let title = t(titleKey);
  let description = t(descriptionKey);
  if (route.view === 'cartridge') {
    const entry = byKey(route.key);
    if (entry) {
      title = `${entry.name} · ${title}`;
      description = `${entry.name}. ${description}`;
    }
  } else if (route.view === 'bullet') {
    const entry = bulletByKey(route.key);
    if (entry) {
      title = `${entry.manufacturer} ${entry.name} · ${title}`;
      description = `${entry.manufacturer} ${entry.name}. ${description}`;
    }
  }
  return { title: `${title} | Open Ballistics`, description };
}
