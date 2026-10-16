<script lang="ts">
  import type { Component } from 'svelte';
  import { onMount, tick } from 'svelte';
  import { pageMetadata } from './lib/metadata';
  import List from './routes/List.svelte';
  import ReportLink from './components/ReportLink.svelte';
  import PageLoadError from './components/PageLoadError.svelte';
  import SiteNavigation from './components/SiteNavigation.svelte';
  import { route } from './lib/router';
  // Read the asynchronous database once at startup into reactive state.
  import { load as loadRifles } from './lib/records.svelte';
  void loadRifles();
  import { lang, t } from './lib/i18n.svelte';
  import { theme } from './lib/theme.svelte';

  const current = $derived($route);
  const metadata = $derived(pageMetadata(current, t));

  $effect(() => {
    document.title = metadata.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', metadata.description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', metadata.title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', metadata.description);
  });

  onMount(() => {
    const navigate = async () => {
      await tick();
      document.getElementById('main')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    };
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  });

  /**
   * Every page but the list, fetched when it is first opened.
   *
   * All five used to be one bundle, so a reader who came for the catalogue - which is who arrives
   * at this site - downloaded, parsed and ran the bullet designer's image rectifier and the whole
   * cartridge sheet before the first card appeared. A quarter of the bundle was never executed on
   * that visit, and the parsing of it is main-thread time the page cannot answer a tap during.
   * `List` stays with the bundle because it is the page the site opens on; the rest are their own
   * chunks, asked for on the click that needs them and then held.
   *
   * They are held by promise, not by result, so two rapid navigations to the same page share one
   * request. A chunk that fails to arrive is forgotten rather than remembered as broken, so the
   * next attempt is a real one - a dropped connection should not make a page permanently missing.
   */
  type Page =
    | 'cartridge'
    | 'compare'
    | 'bullet'
    | 'bullets'
    | 'designer'
    | 'targets'
    | 'newTarget'
    | 'preview'
    | 'targetScoring'
    | 'myData'
    | 'newCartridge';

  // Written out rather than built from the name: the import specifier has to be statically
  // analysable or the bundler cannot know there is a chunk to make.
  const chunks: Record<Page, () => Promise<{ default: Component<any> }>> = {
    cartridge: () => import('./routes/Cartridge.svelte'),
    compare: () => import('./routes/Compare.svelte'),
    bullet: () => import('./routes/Bullet.svelte'),
    bullets: () => import('./routes/Bullets.svelte'),
    designer: () => import('./routes/Designer.svelte'),
    targets: () => import('./routes/Targets.svelte'),
    newTarget: () => import('./routes/TargetDesigner.svelte'),
    preview: () => import('./routes/Preview.svelte'),
    targetScoring: () => import('./routes/TargetScoring.svelte'),
    myData: () => import('./routes/MyData.svelte'),
    newCartridge: () => import('./routes/CartridgeDesigner.svelte')
  };

  const opened = new Map<Page, Promise<Component<any>>>();

  function page(name: Page): Promise<Component<any>> {
    const held = opened.get(name);
    if (held) return held;
    const loading = chunks[name]().then((module) => module.default);
    loading.catch(() => opened.delete(name));
    opened.set(name, loading);
    return loading;
  }

  // The theme lives in `lib/theme.svelte.ts`, because the drawings read it too; this stamps it.
  $effect(() => {
    document.documentElement.dataset.theme = theme();
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
      meta.setAttribute('content', theme() === 'dark' ? '#101012' : '#fafafa');
    });
  });
  // And what language it is in, which `setLang` stamps when the reader switches and nothing
  // stamped on the first load of a page that remembered a choice from last time.
  $effect(() => {
    document.documentElement.lang = lang();
  });
</script>

<a class="skip" href="#main" onclick={(event) => {
  event.preventDefault();
  document.getElementById('main')?.focus();
  document.getElementById('main')?.scrollIntoView();
}}>{t('site.skip')}</a>

<SiteNavigation {current} />

<main id="main" tabindex="-1" aria-label={metadata.title}>
<div class="page-container">
  <!--
    `page()` hands back the same promise every time, so re-rendering this block on any other state
    change does not restart the await and the reader does not see the message flash between two
    cartridges. The list is not awaited: it is in the bundle already.
  -->
  {#if current.view === 'cartridge'}
    {#await page('cartridge')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page key={current.key} />
    {:catch}
      <PageLoadError />
    {/await}
  {:else if current.view === 'compare'}
    {#await page('compare')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page a={current.a} b={current.b} />
    {:catch}
      <PageLoadError />
    {/await}
  {:else if current.view === 'bullet'}
    {#await page('bullet')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page key={current.key} />
    {:catch}
      <PageLoadError />
    {/await}
  {:else if current.view === 'bullets'}
    {#await page('bullets')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page />
    {:catch}
      <PageLoadError />
    {/await}
  {:else if current.view === 'designer'}
    {#await page('designer')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page />
    {:catch}
      <PageLoadError />
    {/await}
  {:else if current.view === 'preview' || current.view === 'targetScoring' || current.view === 'newTarget'}
    {#await page(current.view)}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page targetId={current.view === 'targetScoring' ? current.targetId : undefined} />
    {:catch}<PageLoadError />{/await}
  {:else if current.view === 'targets'}
    {#await page('targets')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page />
    {:catch}
      <PageLoadError />
    {/await}
  {:else if current.view === 'myData'}
    {#await page('myData')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page />
    {:catch}
      <PageLoadError />
    {/await}
  {:else if current.view === 'newCartridge'}
    {#await page('newCartridge')}
      <p class="loading" role="status">{t('site.loading')}</p>
    {:then Page}
      <Page />
    {:catch}
      <PageLoadError />
    {/await}
  {:else}
    <List />
  {/if}
</div>
</main>

<footer>
  <p><ReportLink {current} /></p>
  <!--
    One sentence in the dictionary, with the three parts that carry their own emphasis passed into
    it: word order moves between languages and a sentence glued together in the markup can only
    ever have English's.
  -->
  <p>
    {@html
      t('footer.source', {
        authority: `<strong>${t('footer.authority')}</strong>`,
        tables: `<em>${t('footer.tables')}</em>`,
        independent: `<strong>${t('footer.independent')}</strong>`
      })}
  </p>
  <p>{t('footer.licence')}</p>

</footer>

<style>
  @layer legacy {
    .skip { position: absolute; left: -9999px; }
    .skip:focus { position: fixed; left: 1rem; top: 1rem; z-index: 100; background: var(--surface); padding: .75rem 1rem; border-radius: var(--radius); }
    main { padding: 2rem var(--page-gutter) 4rem; }
    .page-container { max-width: var(--page-width); margin-inline: auto; }
    footer { padding: 1.5rem var(--page-gutter) 2rem; border-top: 1px solid var(--border); color: var(--muted-foreground); font-size: .75rem; }
    footer p { max-width: 90ch; margin: 0 0 .5rem; }
    .loading { color: var(--muted-foreground); padding: 2rem 0; }
    @media (min-width: 64rem) { main, footer { width: calc(100% - 15rem); margin-left: 15rem; } main { padding-top: 2.5rem; } }
    /* Paper carries none of the site's furniture. The navigation is already `print:hidden`; the
       footer's provenance note, licence line and report link belong beside the page while it is
       being read, not on the sheet that is carried to the bench - and each page's own print rules
       decide what of its content prints. The gutter goes too: the physical margin is the `@page`
       margin, and 2rem of padding on top of it is 17 mm of paper a drawing could have had. */
    @media print {
      main, footer { width: 100%; margin-left: 0; }
      main { padding: 0; }
      footer { display: none; }
    }
  }
</style>
