<script lang="ts">
  import CipBadge from '../components/CipBadge.svelte';
  import { Button as ShadcnButton } from '$lib/components/ui/button/index.js';

  import ScaleRuler from '../components/ScaleRuler.svelte';
  import Drawing from '../components/Drawing.svelte';
  import Flag from '../components/Flag.svelte';
  import GroupTable from '../components/GroupTable.svelte';
  import { byKey, entries, load } from '../lib/data';
  import {
  extent,
  plates,
  STYLES
} from '@lib/core';
import {
  rememberStyle,
  storedStyle,
  styleLabel,
  styleNote,
  subjectLabel
} from '../lib/drawings';
  import { bulletsFor } from '../lib/bullets';
  import { href } from '../lib/router';
  import { t } from '../lib/i18n.svelte';
  import { PX_PER_MM } from '@lib/core';
  import {
    defaultLength,
    fitScale as fitScaleIn,
    hullLengths,
    panels,
    tag
  } from '@lib/core/plates';
  import {
  type Drawing as Plate,
  type DrawingStyle,
  type DrawingSubject
} from '@lib/core';
import { familyLabel } from '../lib/labels';

  interface Props {
    key: string;
  }
  let { key }: Props = $props();
  let compareWith = $state('');
  const others = $derived(entries.filter((other) => other.key !== key).sort((x, y) => x.name.localeCompare(y.name, 'en')));

  const entry = $derived(byKey(key));
  const record = $derived(load(key));

  /**
   * Pixels per millimetre for the drawing at the head of the page: the CSS reference, so 100% is
   * life size.
   *
   * The page used to fit the drawing to its column, which made every cartridge arrive the same
   * width on screen and told the reader nothing about how big it is - a .22 Long Rifle and a
   * 12.7x108 both filled the column. At `PX_PER_MM` the drawing opens as the object: a 9x19 is a
   * couple of inches of screen and a .50 BMG is most of a column, and the two pages compare with
   * each other as directly as two cards in the grid do. Anything longer than the column pans; see
   * `PX_PER_MM` for what a monitor can and cannot promise about "life size".
   */

  /**
   * A zoom on top of life size, in steps, from the +/- buttons beside the drawing. Kept per
   * browser so the reader who likes it larger finds it larger next time; 100% - the cartridge at
   * its own size - is where it opens when nothing is stored.
   */
  const ZOOM_STEPS: Zoom[] = ['fit', 0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  /**
   * How big the drawing is: a multiple of life size, or `fit`, which fills the column it is in.
   *
   * Life size is the site's own measure and stays the default for a rendered drawing - 100% means
   * a cartridge the size of the cartridge, held against a ruler. It is the wrong default for a
   * dimensioned one. Those are drawn at the size of the object too, but what a reader wants from
   * them is the writing, and C.I.P.'s symbols are 1.6 mm high at that size: legible on paper at
   * arm's length and not on a screen. So the two styles keep their own zoom, and a dimensioned
   * drawing opens filling its column.
   *
   * `fit` is a word rather than a percentage because it is not one: it depends on how wide the
   * window is. Both panels still share it, computed from the wider of the two, so the cartridge
   * and the chamber stay at one scale and stay comparable - filling each column independently
   * would show them at two different scales and quietly break the only comparison worth making.
   */
  type Zoom = number | 'fit';

  function zoomKey(style: DrawingStyle): string {
    return style === 'technical' ? 'drawing-zoom-technical' : 'drawing-zoom';
  }
  function storedZoom(style: DrawingStyle): Zoom {
    // Both styles open at `fit`, which is life size wherever life size fits; see `fitScale`.
    const fallback: Zoom = 'fit';
    try {
      const raw = localStorage.getItem(zoomKey(style));
      if (raw === null) return fallback;
      const value: Zoom = raw === 'fit' ? 'fit' : Number(raw);
      return ZOOM_STEPS.includes(value) ? value : fallback;
    } catch {
      return fallback;
    }
  }
  let zoom = $state<Zoom>(storedZoom(storedStyle()));
  let dragging = $state(false);
  let startX = 0;
  let startY = 0;
  let startScrollLeft = 0;
  let startScrollTop = 0;
  let pointerId: number | null = null;

  /**
   * What a drag pans.
   *
   * Side by side, each panel scrolls inside its own column, so a drag in the chamber must move the
   * chamber and leave the cartridge where it is. On its own, the drawing pans the whole box, the
   * way it did before there were two of them. Whichever of the two actually overflows is the one
   * that can be panned, so that is what is asked.
   */
  function scroller(from: EventTarget | null): HTMLElement | null {
    return from instanceof Element
      ? from.closest('.diagram-panel')?.querySelector<HTMLElement>('.plate-viewport') ?? null
      : null;
  }
  let panning: HTMLElement | null = null;

  function startDrag(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || (event.target as Element).closest('button')) return;
    panning = scroller(event.target);
    if (!panning) return;
    panning.setPointerCapture(event.pointerId);
    pointerId = event.pointerId;
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startScrollLeft = panning.scrollLeft;
    startScrollTop = panning.scrollTop;
  }

  function drag(event: PointerEvent) {
    if (!dragging || !panning) return;
    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;
    if (Math.abs(deltaX) <= 3 && Math.abs(deltaY) <= 3) return;
    event.preventDefault();
    panning.scrollLeft = startScrollLeft - deltaX;
    panning.scrollTop = startScrollTop - deltaY;
  }

  function endDrag() {
    dragging = false;
    if (panning && pointerId !== null && panning.hasPointerCapture(pointerId)) {
      panning.releasePointerCapture(pointerId);
    }
    panning = null;
    pointerId = null;
  }

  function setZoom(value: Zoom) {
    zoom = value;
    try {
      localStorage.setItem(zoomKey(wanted), String(value));
    } catch {
      // Storage may be unavailable; the zoom still applies for this page.
    }
  }
  function zoomBy(direction: 1 | -1) {
    const index = ZOOM_STEPS.indexOf(zoom);
    const next = ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))];
    setZoom(next ?? 1);
  }

  /**
   * How wide one panel is, which is all `fit` needs to know.
   *
   * The panels are equal grid tracks, so every one of them reports the same number and they can
   * all write to it. Zero until the first measurement, and `fit` falls back to life size until
   * then, so the first frame is never a drawing of no width.
   */
  let panelWidth = $state(0);
  /**
   * How tall the window is, which is what bounds a drawing standing up.
   *
   * Lying down, a drawing was bounded by the column it sat in and `fit` meant the column's width.
   * Upright it is three to five times taller than it is wide, so filling the column's width would
   * make a cartridge eleven hundred pixels tall and the page a thing to scroll rather than read.
   * So `fit` is whichever binds first, the width of the column or a little under two thirds of the
   * window, and the pair still shares one scale.
   */
  let viewportHeight = $state(900);
  /**
   * `fit`: life size, unless life size does not fit, and then as large as does.
   *
   * Asked for 2026-09-05. Life size is the site's own measure - 100% means a cartridge the size of
   * the cartridge - and it is what a drawing should open at whenever the column can hold it. It
   * used to fill the column instead, which blew a 9 mm Luger up to fill a screen and made "fit" a
   * different size on every window. Now fit never enlarges: it is 100% with room to spare, and the
   * largest whole drawing that fits when there is not, bounded by the column's width and a little
   * under two thirds of the window's height. The pair still shares one scale.
   */
  // Bound here rather than at each call: the library form takes the column and window it has
  // to fit inside, because it may not read this component's state.
  const fitScale = (widest: number, tallest: number): number =>
    fitScaleIn(widest, tallest, panelWidth, viewportHeight, PX_PER_MM);

  /**
   * One standard, several drawings.
   *
   * A cartridge is drawn along three axes and the page lets the reader move along each of them:
   *
   * - **Subject.** The cartridge, or the chamber it is fired in. The tables have shown both sides
   *   since the beginning - Cartridge maxi and Chamber mini - while the picture showed one.
   * - **Style.** The rendered object, or the dimensioned drawing: the same geometry answering
   *   "what is it" and "what are its numbers", which are two different questions a reader has.
   * - **Length.** A shot cartridge is a family, not a cartridge. A 12 gauge is published at nine
   *   hull lengths, from 12/35 to 12/89 - 54 mm between the ends of that range, each with its own
   *   chamber and its own pressures - and the sheet names each one, `12/70`.
   *
   * A control appears only where the dataset has more than one thing to show on that axis, so a
   * cartridge with one drawing looks exactly as it always did. Nothing is hidden by picking:
   * both tables still list every published length, and the selection marks one of them.
   */
  /** How a drawing is named in a sentence: "chamber at 12/70". */
  function describe(plate: Plate): string {
    const at = tag(plate);
    return `${subjectLabel(plate.subject).toLowerCase()}${at ? t('draw.at', { length: at }) : ''}`;
  }



  /**
   * What is on screen, where it is not what was asked for.
   *
   * Written here rather than in the markup so that the sentence is one string: a `{#if}` around a
   * clause is a place for a space to go missing, and this one is read as prose.
   */
  function missingNote(subject: DrawingSubject, length: string | null, plate: Plate): string {
    return t('draw.missing', {
      asked: subjectLabel(subject).toLowerCase(),
      at: length ? t('draw.at', { length }) : '',
      shown: describe(plate)
    });
  }


  /**
   * The length the reader picked, and the cartridge it was picked on.
   *
   * Both, because a marking is only meaningful on the cartridge it was picked on: 12/70 means
   * nothing on a 20 gauge, and following a link from one shot cartridge to another must not carry
   * one page's choice onto another page's list.
   */
  let chosen = $state<{ key: string; length: string } | null>(null);

  /**
   * Which style the reader last looked at, shared with the grid; see `storedStyle`.
   *
   * Unlike the length this is not about one cartridge, which is why it is not kept per cartridge
   * and not kept per page: a reader working from dimensioned drawings is doing that across the
   * dataset and should not have to say so twice. Where a cartridge has not been drawn that way the
   * page falls back to what it has, and the stored preference is left alone for the next cartridge
   * that can honour it.
   *
   * The subject used to be kept here too, back when the page showed one drawing and switched. It
   * shows both now, so there is nothing to remember.
   */
  let wanted = $state(storedStyle());
  function setStyle(next: DrawingStyle) {
    wanted = next;
    // Each style keeps its own size, so switching to the dimensioned drawing does not leave it at
    // a life size nobody can read, nor the rendered one blown up to fill a column.
    zoom = storedZoom(next);
    rememberStyle(next);
  }

  /**
   * Whether the dimensions are drawn over the picture.
   *
   * Its own switch since 2026-09-05, when one file began to carry both styles with and without
   * their dimensions: the rendered cartridge can now wear C.I.P.'s symbols too, which nothing
   * offered before. On by default - the numbers are what the page is for - and kept per browser.
   */
  const DIMENSIONS_KEY = 'drawing-dimensions';
  function storedDimensions(): boolean {
    try {
      return localStorage.getItem(DIMENSIONS_KEY) !== 'off';
    } catch {
      return true;
    }
  }
  let dimensions = $state(storedDimensions());
  function setDimensions(next: boolean) {
    dimensions = next;
    try {
      localStorage.setItem(DIMENSIONS_KEY, next ? 'on' : 'off');
    } catch {
      // The choice still applies for this page.
    }
  }
</script>
<svelte:window bind:innerHeight={viewportHeight} />
<div data-ui="Cartridge" class="contents">



{#await record}
  <p class="status">{t('record.loading', { name: entry?.name ?? key })}</p>
{:then data}
  {@const drawn = plates(entry)}
  {@const styles = drawn.length ? STYLES : []}
  {@const style = wanted}
  {@const hulls = hullLengths(data)}
  {@const selected = hulls
    ? (chosen?.key === key ? chosen.length : defaultLength(hulls, entry))
    : null}
  {@const want = hulls?.find((row) => tag(row) === selected)?.l ?? null}
  {@const shown = panels(drawn, selected, want)}
  <!--
    One scale for every drawing on the page, from the widest and the tallest of them. The point of
    showing a cartridge and the chamber it is fired in is the tenth of a millimetre between them,
    and sizing each to its own row would show them at two scales and quietly destroy it.
  -->
  {@const widest = shown.length ? Math.max(...shown.map((plate) => extent(plate, dimensions)[0])) : 1}
  {@const tallest = shown.length ? Math.max(...shown.map((plate) => extent(plate, dimensions)[1])) : 1}
  {@const drawScale = zoom === 'fit' ? fitScale(widest, tallest) : PX_PER_MM * zoom}

  <header class="head">
    <div>
      <p class="eyebrow flex-wrap">
        <CipBadge />
        {familyLabel(data.family)}
        {#if entry?.countries.length}
          <span class="origin">·</span>
          <Flag codes={entry.countries} />
        {/if}
      </p>
      <h1>{data.name}</h1>
      {#if data.alternativeNames?.length}
        <p class="alt">{t('record.alsoPublished', { names: data.alternativeNames.join(', ') })}</p>
      {/if}
    </div>
    <dl class="meta">
      {#if data.pressureMethod}
        <dt>{t('record.method')}</dt>
        <dd>{data.pressureMethod}</dd>
      {/if}
      {#if data.published}
        <dt>{t('record.published')}</dt>
        <dd class="num">{data.published}</dd>
      {/if}
      {#if data.revised}
        <dt>{t('record.revised')}</dt>
        <dd class="num">{data.revised}</dd>
      {/if}
      <dt>{t('record.key')}</dt>
      <dd class="num">{data.key}</dd>
    </dl>
  </header>

  <!--
    What the picture is, where there is more than one picture to be. Each control appears only
    where the dataset has something to switch to, so the bar is empty for a cartridge drawn once
    and the page reads as it always did.

    Above the drawing rather than under it. It used to sit below, where it read as a caption, which
    is fair enough for the length - 12/70 names what you are looking at - but wrong for the
    style, which is a question the reader answers before looking rather than after. Paper keeps it
    a caption either way: printed it is a title line saying which of the drawings this sheet is.
  -->
  {#if styles.length > 1 || hulls || shown.length}
    <div class="views">
      {#if styles.length > 1}
        <!--
          Three toggles, no labels (asked for 2026-09-05): the two styles, of which one is always
          down, and the dimensions, which are on or off for either. All faces of one file, so
          nothing is fetched twice and the two styles cannot disagree about where the shoulder is.
        -->
        <div class="view">
          <div class="inline-flex isolate" role="group" aria-label={t('draw.style')}>
            {#each styles as option (option)}
              <ShadcnButton variant={option === style ? 'default' : 'outline'} class="-ml-px rounded-none first:ml-0 first:rounded-l-md last:rounded-r-md focus-visible:relative focus-visible:z-10"
                type="button"


                aria-pressed={option === style}
                title={styleNote(option)}
                onclick={() => setStyle(option)}
              >
                <span class="option-name">{styleLabel(option)}</span>
              </ShadcnButton>
            {/each}
          </div>
          <div class="options" role="group" aria-label={t('draw.dimensions')}>
            <ShadcnButton variant={dimensions ? 'default' : 'outline'}
              type="button"


              aria-pressed={dimensions}
              onclick={() => setDimensions(!dimensions)}
            >
              <span class="option-name">{t('draw.dimensions')}</span>
            </ShadcnButton>
          </div>
        </div>
      {/if}

      {#if hulls}
        <div class="view">
          <span class="eyebrow view-label">{t('draw.length')}</span>
          <div class="options" role="group" aria-label="Published hull length">
            {#each hulls as row (tag(row))}
              {@const on = tag(row) === selected}
              <ShadcnButton variant={on ? 'default' : 'outline'} class="flex h-auto min-h-10 flex-col gap-0.5"
                type="button"


                aria-pressed={on}
                onclick={() => (chosen = { key, length: tag(row)! })}
              >
                <span class="option-name">{row.marking ?? t('draw.published')}</span>
                <span class="option-sub num">{row.l} mm</span>
              </ShadcnButton>
            {/each}
          </div>
        </div>
      {/if}

      <!--
        How large, beside what and which length: the picks all read together above the sheet. The
        size used to be pinned inside the figure, which was fair while there was one figure; there
        are two now, one per subject, and a control that sizes both of them cannot live in half of
        them.
      -->
      {#if shown.length}
        <div class="view">
          <span class="eyebrow view-label">{t('draw.size')}</span>
          <div class="zoom" role="group" aria-label="Drawing size">
            <ShadcnButton variant="outline" class="-ml-px rounded-none first:ml-0 first:rounded-l-md last:rounded-r-md focus-visible:relative focus-visible:z-10"
              type="button"
              onclick={() => zoomBy(-1)}
              disabled={zoom === ZOOM_STEPS[0]}
              aria-label={t('draw.smaller')}>-</ShadcnButton
            >
            <ShadcnButton variant="outline" type="button" class="min-w-16 -ml-px rounded-none first:ml-0 first:rounded-l-md last:rounded-r-md focus-visible:relative focus-visible:z-10" onclick={() => setZoom(1)} title={t('draw.reset')}
              >{zoom === 'fit' ? t('draw.fit') : `${Math.round(zoom * 100)}%`}</ShadcnButton
            >
            <ShadcnButton variant="outline" class="-ml-px rounded-none first:ml-0 first:rounded-l-md last:rounded-r-md focus-visible:relative focus-visible:z-10"
              type="button"
              onclick={() => zoomBy(1)}
              disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]}
              aria-label={t('draw.larger')}>+</ShadcnButton
            >
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!--
    The sheet: each drawing beside the numbers it is a drawing of, the way the standard's own pages
    are laid out. Asked for 2026-09-04, for the printed sheet and for the page alike.

    A cartridge is three to five times longer than it is wide and so is its chamber, so a drawing of
    one lying down is a wide, short picture that wastes most of a column and leaves the numbers to
    fill the width underneath. Stood upright it is a tall narrow thing, which is exactly the shape
    of the space beside a table of figures - and the taller a drawing is allowed to be, the larger
    it is drawn.

    Two rows, one per subject: the cartridge over the chamber, each with its own side of the sheet
    beside it. The pair used to be stacked together in one column, which put the chamber drawing
    beside Cartridge maxi and asked the reader to look in two directions at once.

    `drawn` because six records publish too little to draw at all, and an empty column is not a
    layout: without a drawing the numbers take the whole width.
  -->
  {#snippet panel(plate: Plate | undefined, label: string)}
    <!--
      One drawing, in the row of the thing it draws. Every one is at the same
      millimetres-per-pixel, so the chamber is the size of the chamber beside the round that goes
      into it, and a dimensioned drawing puts its case at the size of the case. What varies between
      the two styles is how much paper the drawing needs around the object, not how big the object
      is; see `unitsPerMm` in the build for the four-to-one the renderer draws the dimensioned ones
      at, and undoing it is what makes the two comparable at all.
    -->
    {#if plate && entry}
      {@const off = selected !== null && tag(plate) !== null && tag(plate) !== selected}
      {@const mm = extent(plate, dimensions)}
      <figure
        class="diagram-panel"
        onpointerdown={startDrag}
        onpointermove={drag}
        onpointerup={endDrag}
        onpointercancel={endDrag}
        onlostpointercapture={endDrag}
        class:dragging
        role="region"
        aria-label={`${data.name}, ${label}`}
        title={t('draw.drag')}
      >
        <!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard users need to pan enlarged diagrams.) -->
        <div class="plate-viewport" bind:clientWidth={panelWidth} tabindex="0" role="region" aria-label={`${data.name}, ${label}`}>
          <div
            class="plate-box"
            style={`--mm-w:${mm[0]};--mm-h:${mm[1]};--px:${drawScale}`}
          >
            <!--
              Fetched at once rather than when it scrolls into view. There are two drawings on this
              page and the second is often below the fold, and a lazy image that has not been
              scrolled to is one the browser has every right not to have fetched when somebody hits
              print - which would print the sheet with the chamber missing. The grid is the place
              for lazy loading, where there are 526 of them.
            -->
            <Drawing
              {entry}
              scale={drawScale}
              height={Math.round(drawScale * 32)}
              drawing={plate}
              {style}
              {dimensions}
              eager
            />
          </div>
        </div>
        <ScaleRuler widthMm={mm[0]} />
        <!--
          Per drawing, because the two of them can miss in different ways: a chamber drawn only at
          12/70 stands in for 12/89 while the cartridge beside it does not.
        -->
        {#if off}
          <p class="plate-note">{missingNote(plate.subject, selected, plate)}</p>
        {/if}
      </figure>
    {:else}
      <div class="undrawn"></div>
    {/if}
  {/snippet}
  <div
    class="sheet"
    class:drawn={!!entry && shown.length > 0}
    style={`--mm-widest:${widest};--mm-tallest:${tallest}`}
  >
    {#if entry && shown.length}
      {@render panel(shown.find((plate) => plate.subject === 'cartridge'), 'cartridge drawing')}
    {/if}
    <GroupTable side="cartridge" heading={t('record.cartridgeMaxi')} groups={data.cartridge} {selected}>
      {#if data.annotations?.defaultBullet}
        <section class="group bullet">
          <h3>{t('record.bullet')}</h3>
          <dl class="bullet-data">
            {#if data.annotations.defaultBulletShape}
              <dt>{t('record.shape')}</dt>
              <dd>{data.annotations.defaultBulletShape}</dd>
            {/if}
            <dt>{t('record.category')}</dt>
            <dd>{data.annotations.defaultBullet.category}</dd>
            <dt>{t('record.ogive')}</dt>
            <dd>{data.annotations.defaultBullet.ogive}</dd>
            <dt>{t('record.base')}</dt>
            <dd>{data.annotations.defaultBullet.base}</dd>
            <dt>{t('record.tip')}</dt>
            <dd>{data.annotations.defaultBullet.tip}</dd>
          </dl>
        </section>
      {/if}
    </GroupTable>

    {#if entry && shown.length}
      {@render panel(shown.find((plate) => plate.subject === 'chamber'), 'chamber drawing')}
    {/if}
    <GroupTable side="chamber" heading={t('record.chamberMini')} groups={data.chamber} {selected} />
  </div>



  {#if entry}
    {@const catalogued = bulletsFor(entry)}
    {#if catalogued.length}
      <!--
        The catalogue's bullets that fit this case, by diameter (see `bulletsFor`). A list and
        not a table: the page is about the cartridge, and these are pointers to pages about
        something else.
      -->
      <section class="catalogue">
        <h2>{t('bullets.forCartridge')}</h2>
        <ul>
          {#each catalogued as bullet (bullet.key)}
            <li>
              <a href={href.bullet(bullet.key)}>{bullet.manufacturer} {bullet.name}</a>
              <span class="muted num">{bullet.model} · {(bullet.mass / 0.06479891).toFixed(0)} gr · {bullet.diameter} mm</span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}

  <form class="compare-with" onsubmit={(event) => { event.preventDefault(); if (compareWith) location.hash = href.compare(key, compareWith); }}>
    <label for="compare-with">{t('compare.with')}</label>
    <select id="compare-with" bind:value={compareWith}>
      <option value=""></option>
      {#each others as other (other.key)}<option value={other.key}>{other.name}</option>{/each}
    </select>
    <button type="submit">{t('compare.go')}</button>
  </form>
  <p class="foot">
    <a href={href.list()}>{t('record.back')}</a>
  </p>
{:catch error}
  <p class="status error">{error.message} <a href={href.list()}>Back to all cartridges</a></p>
{/await}

</div>
<style>
  @layer legacy {
    .compare-with { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: 2rem; }
    .compare-with select, .compare-with button { border: 1px solid var(--border); border-radius: var(--radius); padding: .25rem .5rem; background: var(--surface); }
    @media print { .compare-with { display: none; } }
  :global([data-ui="Cartridge"] .head > div) { min-width: 0; }
  :global([data-ui="Cartridge"] .head .eyebrow) { margin: 0 0 .375rem; }
  :global([data-ui="Cartridge"] .head) {
    padding-bottom: var(--space-6);
    border-bottom: 1px solid var(--rule);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 1rem 2rem;
    align-items: start;
  }
  :global([data-ui="Cartridge"] h1) {
    font-size: clamp(var(--step-3), 1.2rem + 2vw, var(--step-4));
    line-height: 1.15;
    letter-spacing: -0.01em;
  }
  :global([data-ui="Cartridge"] .eyebrow) {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  :global([data-ui="Cartridge"] .origin) {
    color: var(--ink-3);
  }
  :global([data-ui="Cartridge"] .alt) {
    margin: 0.25rem 0 0;
    color: var(--ink-2);
    font-size: var(--step-0);
  }
  :global([data-ui="Cartridge"] .meta) {
    display: grid;
    grid-template-columns: minmax(0, auto) minmax(0, 1fr);
    gap: 0.1rem 0.9rem;
    margin: 0;
    font-size: var(--step-0);
  }
  :global([data-ui="Cartridge"] .meta dt) {
    color: var(--ink-3);
  }
  :global([data-ui="Cartridge"] .meta dd) {
    margin: 0;
    text-align: right;
  }

  /* In the bar with the other picks now, not pinned inside a figure: there are two figures and
     one size. */
  :global([data-ui="Cartridge"] .zoom) { display: inline-flex; isolation: isolate; }
  :global([data-ui="Cartridge"] .diagram-panel) {
    position: relative;
    margin: 0;
    padding: var(--panel-padding);
    background: var(--surface);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: visible;
    cursor: grab;
    /* `pan-y` and not `none`: a finger dragged sideways pans the drawing, and a finger dragged up
       the screen scrolls the page, which is what a reader on a phone is nearly always doing. */
    touch-action: pan-y;
    user-select: none;
  }
  :global([data-ui="Cartridge"] .diagram-panel.dragging) {
    cursor: grabbing;
  }
  /* The window on to one drawing. It fills the width of its column, which is what `fit` measures,
     and the drawing sits centred in it. */
  :global([data-ui="Cartridge"] .plate-viewport) {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    /* Keep both axes reachable by touch, pointer dragging and keyboard at high zoom. */
    overflow: auto;
    max-height: 70vh;
    align-items: safe center;
  }
  :global([data-ui="Cartridge"] .plate-note) {
    margin: 0.3rem 0 0;
    font-size: 0.72rem;
    color: var(--warn);
  }
  :global([data-ui="Cartridge"] .diagram-panel img),
:global([data-ui="Cartridge"] .diagram-panel svg) {
    flex: 0 0 auto;
    user-select: none;
    -webkit-user-drag: none;
  }
  /* Standing the drawing up.

     The picture is rendered lying down - every drawing is, because that is how the object is
     drawn - and turned a quarter turn here rather than in the renderer, so that one file serves
     the card lying down and the sheet standing up. The box is sized to the turned extents, in
     pixels here and in millimetres on paper (`--px` is the scale the page computed, in pixels per
     millimetre), and the picture is pinned to the middle of it and rotated about its own centre,
     which is the one transform that does not move it off the box. */
  :global([data-ui="Cartridge"] .plate-box) {
    position: relative;
    flex: none;
    width: calc(var(--mm-h) * var(--px) * 1px);
    height: calc(var(--mm-w) * var(--px) * 1px);
  }
  :global([data-ui="Cartridge"] .plate-box > .drawing-ink) {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-90deg);
  }
  :global([data-ui="Cartridge"] .diagram-panel:not(.paired) img),
:global([data-ui="Cartridge"] .diagram-panel:not(.paired) svg) {
    margin-inline: auto;
  }

  /* What the picture is, above the picture it decides. Every choice is a button rather than a
     menu, so the range a gauge covers is readable at a glance - nine lengths for a 12 gauge --
     instead of being a list to open. */
  :global([data-ui="Cartridge"] .views) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 1.4rem;
    margin: 1.5rem 0 1rem;
  }
  :global([data-ui="Cartridge"] .view) {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem 0.6rem;
  }
  :global([data-ui="Cartridge"] .view-label) {
    margin: 0;
  }
  :global([data-ui="Cartridge"] .options) {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  :global([data-ui="Cartridge"] .option-sub) { font-size: .7rem; }
  /* The sheet: a drawing beside the numbers it draws, a row per subject.

     Narrow, it is one column and the source order carries it - cartridge drawing, Cartridge maxi,
     chamber drawing, Chamber mini - so a phone reads each drawing immediately above its own
     figures rather than meeting both pictures and then both tables. Wide, the rows are real: the
     left column takes the narrower share, because an upright cartridge is a tall sliver and a
     table of dimensions is not. */
  :global([data-ui="Cartridge"] .sheet) {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 1.5rem;
    align-items: start;
  }
  @media (min-width: 58rem) {
    :global([data-ui="Cartridge"] .sheet.drawn) {
      grid-template-columns: minmax(0, 4fr) minmax(0, 8fr);
      column-gap: 2.5rem;
      row-gap: 3rem;
    }
  }
  :global([data-ui="Cartridge"] .status) {
    color: var(--ink-2);
  }
  :global([data-ui="Cartridge"] .error) {
    color: var(--ink);
  }
  :global([data-ui="Cartridge"] .foot) {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
    color: var(--ink-2);
    font-size: var(--step-0);
  }
  :global([data-ui="Cartridge"] .catalogue) {
    margin-top: 2rem;
    font-size: var(--step-0);
  }
  :global([data-ui="Cartridge"] .catalogue h2) {
    font-size: var(--step-0);
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-2);
    margin: 0 0 0.4rem;
  }
  :global([data-ui="Cartridge"] .catalogue ul) {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  :global([data-ui="Cartridge"] .catalogue li) {
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--rule);
  }
  :global([data-ui="Cartridge"] .catalogue .muted) {
    color: var(--ink-3);
    font-size: 0.85em;
  }
  /* The bullet, among the cartridge dimensions it belongs to; see the snippet passed to the
     cartridge's own table. */
  :global([data-ui="Cartridge"] .bullet h3) {
    font-size: var(--step-0);
    margin-bottom: 0.3rem;
  }
  :global([data-ui="Cartridge"] .bullet-data) {
    display: grid;
    grid-template-columns: 5.5rem minmax(0, 1fr);
    gap: 0.15rem 0.75rem;
    margin: 0;
    font-size: var(--step-0);
  }
  :global([data-ui="Cartridge"] .bullet-data dt) {
    color: var(--ink-2);
  }
  :global([data-ui="Cartridge"] .bullet-data dd) {
    margin: 0;
    overflow-wrap: anywhere;
  }

  /* A phone has no room for a wide frame around the drawing, and every rem of it came off the
     drawing. */
  @media (max-width: 40rem) {
    :global([data-ui="Cartridge"] .diagram-panel) {
      padding: 1rem 0.75rem;
    }
    :global([data-ui="Cartridge"] .zoom [data-slot="button"]) {
      padding: 0.25rem 0.5rem;
    }
    :global([data-ui="Cartridge"] .zoom .reset) {
      min-width: 3rem;
    }
  }

  @media print {
    @page {
      size: A4 portrait;
      margin: 1.5cm;
    }
    /* The page's own furniture. The site's - the navigation and the footer with its provenance
       note - is taken off the sheet by `App.svelte`, which is where those elements are: they are
       siblings of `main`, so nothing scoped inside this page could ever have reached them. */
    :global([data-ui="Cartridge"] .zoom),
:global([data-ui="Cartridge"] .foot) {
      display: none !important;
    }
    /* The sheet: the drawings down the left, the numbers down the right.

       Which is how the standard's own pages read, and it is the arrangement the page itself now
       uses; the screen rules above carry the reasoning. On paper it earns its keep twice over.
       A drawing lying across the sheet could only be as tall as the tables could spare - about a
       fifth of the page each, and the taller the record's tables the smaller its drawings, which
       is precisely backwards. Standing them in a column of their own takes the tables out of the
       argument: both columns are as tall as the page, and each is sized by what it holds.

       72 mm of the 180 across the sheet, because a cartridge stood on its base is a narrow thing
       and the numbers beside it are not. Each drawing may be half of what is left down the page
       once the masthead and the captions are paid for; whichever of the two binds first is the
       scale, and both panels take it from the wider and the taller of the pair (`--mm-widest`,
       `--mm-tallest`) so that the chamber and the round that goes into it stay comparable. The
       tenth of a millimetre between those two is the whole subject of the sheet, and two scales
       would quietly destroy it.

       Arithmetic in millimetres, not a share of what is left over: laying the page out as a flex
       column and handing the figure the slack is the obvious way to fill a sheet and it does work
       in the browser's own print preview - and not in the pipeline that renders the PDF, where
       the flex height stays indefinite, every drawing falls back to its natural size and the
       second one prints across the tables. */
    :global([data-ui="Cartridge"] .sheet),
:global([data-ui="Cartridge"] .sheet.drawn) {
      /* 72 mm of the 180 across the sheet for the drawings, because a cartridge stood on its base
         is a narrow thing and the numbers beside it are not. */
      --col: 72mm;
      /* What one drawing may have down the page. Measured rather than reasoned: at 113 mm a 308
         Win laid 273 mm of content into a 267 mm page and printed a second sheet carrying the tail
         of a drawing, and a millimetre here costs about two down the page because the two rows
         share one scale. */
      --row: 100mm;
      --scale: min(calc(var(--col) / var(--mm-tallest)), calc(var(--row) / var(--mm-widest)));
      display: grid;
      grid-template-columns: var(--col) minmax(0, 1fr);
      column-gap: 6mm;
      row-gap: 4mm;
      align-items: start;
      margin-top: 3mm;
    }
    /* One drawing, and a second row of tables standing on their own.

       The 100 mm above buys two drawings a fair half of the page each, and the shared scale is
       what makes the pair worth printing at all. Where the dataset draws the cartridge and not
       its chamber there is no pair: nothing is being compared, the second row is a table beside
       an empty column, and the tallest of those - Cal. 12, whose chamber list runs to 135 mm -
       is what pushed the sheet onto a second page. So the lone drawing takes 80 and the tables
       get the rest, which is the row that needs it. */
    :global([data-ui="Cartridge"] .sheet:has(.undrawn)) {
      --row: 80mm;
    }
    :global([data-ui="Cartridge"] .diagram-panel) {
      display: block;
      min-height: 0;
      max-height: none;
      margin: 0;
      padding: 0;
      overflow: visible;
      border: 0;
      background: transparent;
    }
    :global([data-ui="Cartridge"] .plate-viewport) {
      display: block;
      width: auto;
      margin: 0;
      break-inside: avoid;
      max-height: none;
      outline: none;
      /* On screen a drawing larger than its column is dragged about inside it; on paper there is
         nothing to drag with, and a clipped drawing would just be a drawing with its end cut off. */
      overflow: visible;
    }
    :global([data-ui="Cartridge"] .plate-box) {
      position: relative;
      width: calc(var(--mm-h) * var(--scale));
      height: calc(var(--mm-w) * var(--scale));
    }
    :global([data-ui="Cartridge"] .plate-box > .drawing-ink) {
      position: absolute;
      top: 50%;
      left: 50%;
      width: calc(var(--mm-w) * var(--scale)) !important;
      height: calc(var(--mm-h) * var(--scale)) !important;
      max-width: none;
      transform: translate(-50%, -50%) rotate(-90deg);
    }
    /* Off the sheet. A caveat about the figures belongs beside the page while you are reading it,
       and pointers to other pages not on the paper you carry to the machine. */
    :global([data-ui="Cartridge"] .catalogue) {
      display: none !important;
    }

    /* The controls are for choosing, and on paper there is nothing to choose: the sheet is of
       the drawing it shows, and each drawing's caption names it and its length. */
    :global([data-ui="Cartridge"] .views) {
      display: none !important;
    }

    :global([data-ui="Cartridge"] .head > div) { min-width: 0; }
  :global([data-ui="Cartridge"] .head) {
      gap: 0.5rem 2rem;
      margin-top: 0;
    }
    :global([data-ui="Cartridge"] h1) {
      font-size: 1.4rem;
    }
    :global([data-ui="Cartridge"] .alt),
:global([data-ui="Cartridge"] .meta) {
      font-size: 0.7rem;
    }
    :global([data-ui="Cartridge"] .meta) {
      gap: 0 0.7rem;
    }

    :global([data-ui="Cartridge"] .bullet h3) {
      font-size: 0.7rem;
      margin-bottom: 0.15rem;
    }
    /* The same label column as the dimension rows beside it, which is also what keeps
       `pistol_round_nose` on one line in a 42 mm sub-column. */
    :global([data-ui="Cartridge"] .bullet-data) {
      grid-template-columns: 3.1rem minmax(0, 1fr);
      gap: 0.03rem 0.35rem;
      font-size: 0.65rem;
    }
    :global([data-ui="Cartridge"] .side h2) {
      font-size: 0.8rem;
      padding-bottom: 0.2rem;
      margin-bottom: 0.4rem;
    }
    :global([data-ui="Cartridge"] .side .group) {
      margin-bottom: 0.45rem;
    }
    :global([data-ui="Cartridge"] .side h3) {
      font-size: 0.7rem;
      margin-bottom: 0.15rem;
    }
    /* A row is one line where it can be. Each side is two sub-columns of about 42 mm on paper, and
       a label column of 4rem left "39.62 mm" and its "-0.2" nothing to do but wrap; the labels are
       seven characters at most, so the value keeps its tolerance beside it.

       The value track is `minmax(0, 1fr)` rather than `1fr`, whose floor is the widest line it
       holds: a row too long for the sub-column would otherwise push the whole list over the
       column's edge and print across the rows beside it. */
    :global([data-ui="Cartridge"] .side dl) {
      grid-template-columns: 3.1rem minmax(0, 1fr);
      gap: 0.03rem 0.35rem;
    }
    :global([data-ui="Cartridge"] .side dt),
:global([data-ui="Cartridge"] .side dd),
:global([data-ui="Cartridge"] .side table) {
      font-size: 0.65rem;
    }
    :global([data-ui="Cartridge"] .side th),
:global([data-ui="Cartridge"] .side td) {
      padding: 0.1rem 0.25rem 0.1rem 0;
    }
    /* A group stays whole; a side may break, or a long record's tables would jump to a second
       sheet together and leave the first one two-thirds empty. */
    :global([data-ui="Cartridge"] .side .group) {
      break-inside: avoid;
    }
    :global([data-ui="Cartridge"] h1),
:global([data-ui="Cartridge"] h2),
:global([data-ui="Cartridge"] h3) {
      break-after: avoid;
    }
  }
  }
</style>
