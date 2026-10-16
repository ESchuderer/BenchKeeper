<script lang="ts">
  import { Button, buttonVariants } from '$lib/components/ui/button/index.js';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { BookOpen, CircleDot, Target, FlaskConical, Settings2, Menu, Sun, Moon, ExternalLink } from '@lucide/svelte';
  import { href, type Route } from '../lib/router';
  import { t } from '../lib/i18n.svelte';
  import { theme, toggleTheme } from '../lib/theme.svelte';
  import { REPOSITORY_URL } from '../lib/repository';

  let { current }: { current: Route } = $props();
  let open = $state(false);
  const items = $derived([
    { label: t('nav.cartridges'), url: href.list(), icon: BookOpen, active: ['list', 'cartridge', 'compare', 'newCartridge'].includes(current.view) },
    { label: t('nav.bullets'), url: href.bullets(), icon: CircleDot, active: ['bullets', 'bullet', 'designer'].includes(current.view) },
    { label: t('targets.nav'), url: href.targets(), icon: Target, active: ['targets', 'newTarget'].includes(current.view) },
    { label: t('preview.nav'), url: href.preview(), icon: FlaskConical, active: ['preview', 'targetScoring'].includes(current.view) }
  ]);
</script>

{#snippet brand()}
  <a href={href.list()} onclick={() => open = false} class="flex items-center gap-3 text-foreground no-underline hover:no-underline">
    <span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary font-mono text-xs font-semibold text-primary-foreground">OB</span>
    <span class="text-sm font-semibold tracking-tight">Open Ballistics</span>
  </a>
{/snippet}

{#snippet navigation()}
  <nav aria-label={t('site.navigation')} class="flex flex-col gap-1">
    {#each items as item}
      <Button href={item.url} variant={item.active ? 'secondary' : 'ghost'} class="justify-start gap-3 px-3 text-sm" aria-current={item.active ? 'page' : undefined} onclick={() => open = false}>
        <item.icon class="size-4 text-muted-foreground" />{item.label}
      </Button>
    {/each}
  </nav>
  <div class="mt-auto pt-8">
    <Button href={href.myData()} variant={current.view === 'myData' ? 'secondary' : 'ghost'} class="w-full justify-start gap-3 px-3" aria-current={current.view === 'myData' ? 'page' : undefined} onclick={() => open = false}><Settings2 class="size-4 text-muted-foreground" />{t('data.title')}</Button>
    <div class="mt-4 flex items-center justify-between border-t pt-4">
      <Button href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" variant="ghost" size="sm"><ExternalLink class="size-4" />GitHub</Button>
      <Button variant="outline" size="icon" onclick={toggleTheme} aria-label={t(theme() === 'dark' ? 'settings.light' : 'settings.dark')}>
        {#if theme() === 'dark'}<Sun class="size-4" />{:else}<Moon class="size-4" />{/if}
      </Button>
    </div>
  </div>
{/snippet}

<aside class="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto border-r bg-card p-4 lg:flex print:hidden">
  <div class="px-2 pt-3 pb-9">{@render brand()}</div>
  {@render navigation()}
</aside>

<header class="flex h-16 items-center justify-between border-b bg-card px-4 lg:hidden print:hidden">
  {@render brand()}
  <Sheet.Root bind:open>
    <Sheet.Trigger class={buttonVariants({ variant: 'outline', size: 'icon' })} aria-label={t('site.navigation')}><Menu class="size-4" /></Sheet.Trigger>
    <Sheet.Content side="left" class="w-72 max-w-[90vw] overflow-y-auto" showCloseButton={true}>
      <Sheet.Header><Sheet.Title>Open Ballistics</Sheet.Title><Sheet.Description>{t('site.title')}</Sheet.Description></Sheet.Header>
      <div class="flex min-h-0 flex-1 flex-col px-4 pb-5">{@render navigation()}</div>
    </Sheet.Content>
  </Sheet.Root>
</header>
