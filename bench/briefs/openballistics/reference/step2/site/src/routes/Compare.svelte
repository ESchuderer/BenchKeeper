<script lang="ts">
  import PageHeader from '../components/PageHeader.svelte';
  import { load } from '../lib/data';
  import { href } from '../lib/router';
  import { t } from '../lib/i18n.svelte';
  import { unitSystem } from '../lib/units.svelte';
  import { defaultUnit, displayNumber } from '../lib/units';
  import { compareRows } from '../lib/compare';
  import { formatValue, type Record_ } from '@lib/core';
  import { adaptMetallic, caseOuterProfile, type CartridgeRecord } from '@lib/shapes2d';
  import { fullSectionPath, viewportFor } from '@lib/geom';
  import type { Profile } from '@lib/geom';

  let { a, b }: { a: string; b: string } = $props();

  const records = $derived(Promise.all([load(a), load(b)]));
  const unit = $derived(defaultUnit('length', unitSystem()));
  // Record values as the sheet prints them; converted values and differences only lose float noise.
  const shown = (value: number) => (unit === 'mm' ? formatValue(value) : displayNumber(value, unit));

  function outline(record: Record_): Profile | null {
    try {
      return caseOuterProfile(adaptMetallic(record as unknown as CartridgeRecord));
    } catch {
      return null;
    }
  }
  const COLOURS = ['var(--chart-1, #2563eb)', 'var(--chart-2, #dc2626)'];
</script>

<div data-ui="Compare" class="contents">
{#await records}
  <p class="status" role="status">{t('site.loading')}</p>
{:then [ra, rb]}
  {@const profiles = [outline(ra), outline(rb)]}
  {@const drawn = profiles.filter((p): p is Profile => p !== null)}
  {@const view = drawn.length ? viewportFor(drawn, { frame: 'landscape', scale: 4 }) : null}
  <PageHeader title={t('compare.heading', { a: ra.name, b: rb.name })} backHref={href.cartridge(a)} backLabel={ra.name} />

  {#if view}
    <svg class="overlay" role="img" aria-label={t('compare.drawing', { a: ra.name, b: rb.name })} viewBox="0 0 {view.width} {view.height}" xmlns="http://www.w3.org/2000/svg">
      {#each profiles as profile, i (i)}
        {#if profile}
          <path d={fullSectionPath(profile, view)} fill="none" stroke={COLOURS[i]} stroke-width="1.5" />
        {/if}
      {/each}
    </svg>
  {/if}
  <ul class="legend">
    {#each [ra, rb] as record, i (record.key)}
      <li><span class="swatch" style:background={COLOURS[i]}></span>{record.name}{#if !profiles[i]} ({t('compare.noProfile', { name: record.name })}){/if}</li>
    {/each}
  </ul>

  <table class="compare">
    <caption>{t('compare.table', { unit })}</caption>
    <thead>
      <tr>
        <th scope="col">{t('compare.symbol')}</th>
        <th scope="col">{ra.name}</th>
        <th scope="col">{rb.name}</th>
        <th scope="col">{t('compare.difference')}</th>
      </tr>
    </thead>
    <tbody>
      {#each compareRows(ra, rb) as row (row.symbol)}
        <tr>
          <th scope="row">{row.symbol}</th>
          <td>{shown(row.a)}</td>
          <td>{shown(row.b)}</td>
          <td>{displayNumber(row.b - row.a, unit)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  <p class="note">{t('compare.note', { a: ra.name, b: rb.name })}</p>
{:catch error}
  <p class="status error">{error.message} <a href={href.list()}>{t('record.back')}</a></p>
{/await}
</div>

<style>
  @layer legacy {
    .overlay { display: block; width: 100%; max-width: 48rem; height: auto; margin-bottom: 1rem; }
    .legend { display: flex; gap: 1.5rem; list-style: none; padding: 0; margin: 0 0 1.5rem; font-size: .875rem; }
    .swatch { display: inline-block; width: .75rem; height: .75rem; border-radius: 2px; margin-right: .5rem; }
    .compare { border-collapse: collapse; font-variant-numeric: tabular-nums; }
    .compare caption { text-align: left; font-weight: 600; padding-bottom: .5rem; }
    .compare th, .compare td { text-align: left; padding: .25rem 1rem .25rem 0; border-bottom: 1px solid var(--border); }
    .note, .status { color: var(--muted-foreground); font-size: .875rem; }
  }
</style>
