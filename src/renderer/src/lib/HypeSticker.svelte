<script lang="ts">
  import {
    ACCOLADE_SOURCE_NAMES,
    accoladeLabel,
    stickerText,
    type Accolade
  } from '../../../shared/accolades'

  // A shrink-wrap "hype sticker" for critics' picks. Drop it inside a cover
  // box that is position:relative — it lays a full-size layer over the art
  // (so a host can lift it with the cover on hover) and pins the sticker to
  // a corner. AlbumCard's other corners are taken (played / format /
  // now-playing), so it defaults to bottom-right; hosts with a free top-right
  // and a bottom-center pill (the artist page's gaps) ask for top-right.
  interface Props {
    accolades: readonly Accolade[]
    corner?: 'bottom-right' | 'top-right'
  }
  const { accolades, corner = 'bottom-right' }: Props = $props()

  const top = $derived(accolades[0] ?? null)
  const extra = $derived(Math.max(0, accolades.length - 1))
  const sub = $derived(
    top?.source === 'pitchfork'
      ? 'P4K'
      : top?.source === 'stereogum'
        ? 'STEREOGUM'
        : top?.kind === 'year-end'
          ? `SACHER '${top.date.slice(2, 4)}`
          : 'PICK'
  )
  const tip = $derived(
    accolades
      .map((a) => {
        const when = a.date ? ` (${a.date.slice(0, 7)})` : ''
        return `${accoladeLabel(a)}${when}`
      })
      .join('\n')
  )
</script>

{#if top}
  <span class="hype-layer">
    <span
      class="hype-sticker"
      class:top-right={corner === 'top-right'}
      data-source={top.source}
      title={tip}
      aria-label={`critics' pick: ${accolades.map((a) => ACCOLADE_SOURCE_NAMES[a.source]).join(', ')}`}
    >
      <span class="seal-mark" aria-hidden="true">✦</span>
      <span class="main">{stickerText(top)}</span>
      <span class="sub">{sub}</span>
      {#if extra > 0}<span class="more">+{extra}</span>{/if}
    </span>
  </span>
{/if}

<style>
  .hype-layer {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    container-type: size;
  }
  /* Printed ink stays independent of the app theme, like a real sleeve sticker.
     The cut paper and inset keyline scale together; the shadow stays outside
     the die-cut so it reads on both pale and dark artwork. */
  .hype-sticker {
    --ink: #35270f;
    --paper: #f4cf59;
    position: absolute;
    right: 4%;
    bottom: 4%;
    width: clamp(36px, 29cqw, 88px);
    aspect-ratio: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: clamp(2px, 0.7cqw, 2.5px);
    color: var(--ink);
    transform: rotate(-8deg);
    filter: drop-shadow(0 1px 1px #0007) drop-shadow(0 2px 3px #0003);
    pointer-events: auto;
    font-family: 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif;
    line-height: 1;
    text-align: center;
    user-select: none;
    isolation: isolate;
  }
  .hype-sticker::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background: linear-gradient(145deg, #ffffff30, transparent 48%, #0000000c), var(--paper);
    clip-path: polygon(
      100.00% 50.00%, 97.40% 53.11%, 97.09% 56.20%, 99.04% 59.75%, 98.30% 62.94%, 94.98% 65.27%, 93.88% 68.18%, 94.84% 72.11%,
      93.30% 75.00%, 89.49% 76.39%, 87.68% 78.92%, 87.59% 82.97%, 85.36% 85.36%, 81.32% 85.71%, 78.92% 87.68%, 77.78% 91.57%,
      75.00% 93.30%, 71.01% 92.60%, 68.18% 93.88%, 66.07% 97.35%, 62.94% 98.30%, 59.27% 96.59%, 56.20% 97.09%, 53.27% 99.89%,
      50.00% 100.00%, 46.89% 97.40%, 43.80% 97.09%, 40.25% 99.04%, 37.06% 98.30%, 34.73% 94.98%, 31.82% 93.88%, 27.89% 94.84%,
      25.00% 93.30%, 23.61% 89.49%, 21.08% 87.68%, 17.03% 87.59%, 14.64% 85.36%, 14.29% 81.32%, 12.32% 78.92%, 8.43% 77.78%,
      6.70% 75.00%, 7.40% 71.01%, 6.12% 68.18%, 2.65% 66.07%, 1.70% 62.94%, 3.41% 59.27%, 2.91% 56.20%, 0.11% 53.27%,
      0.00% 50.00%, 2.60% 46.89%, 2.91% 43.80%, 0.96% 40.25%, 1.70% 37.06%, 5.02% 34.73%, 6.12% 31.82%, 5.16% 27.89%,
      6.70% 25.00%, 10.51% 23.61%, 12.32% 21.08%, 12.41% 17.03%, 14.64% 14.64%, 18.68% 14.29%, 21.08% 12.32%, 22.22% 8.43%,
      25.00% 6.70%, 28.99% 7.40%, 31.82% 6.12%, 33.93% 2.65%, 37.06% 1.70%, 40.73% 3.41%, 43.80% 2.91%, 46.73% 0.11%,
      50.00% 0.00%, 53.11% 2.60%, 56.20% 2.91%, 59.75% 0.96%, 62.94% 1.70%, 65.27% 5.02%, 68.18% 6.12%, 72.11% 5.16%,
      75.00% 6.70%, 76.39% 10.51%, 78.92% 12.32%, 82.97% 12.41%, 85.36% 14.64%, 85.71% 18.68%, 87.68% 21.08%, 91.57% 22.22%,
      93.30% 25.00%, 92.60% 28.99%, 93.88% 31.82%, 97.35% 33.93%, 98.30% 37.06%, 96.59% 40.73%, 97.09% 43.80%, 99.89% 46.73%
    );
  }
  .hype-sticker::after {
    content: '';
    position: absolute;
    inset: 9%;
    border: 1px solid currentColor;
    border-radius: 50%;
    opacity: 0.5;
    pointer-events: none;
  }
  .hype-sticker.top-right {
    bottom: auto;
    top: 4%;
    transform: rotate(8deg);
  }
  .hype-sticker[data-source='stereogum'] {
    --paper: #83c9b7;
    --ink: #123e35;
  }
  .hype-sticker[data-source='pitchfork'] {
    --paper: #c94736;
    --ink: #fff2d7;
  }
  .seal-mark {
    font-size: clamp(6px, 2.7cqw, 8px);
    line-height: 0.85;
    margin-bottom: 1%;
  }
  .main {
    font-weight: 900;
    letter-spacing: -0.035em;
    font-size: clamp(10px, 7cqw, 21px);
  }
  .hype-sticker[data-source='sacher'] .main {
    font-size: clamp(7px, 4.8cqw, 14px);
    letter-spacing: -0.04em;
  }
  .sub {
    font-weight: 800;
    letter-spacing: 0.12em;
    font-size: clamp(5px, 2.6cqw, 8px);
  }
  .hype-sticker[data-source='stereogum'] .sub {
    font-size: clamp(4px, 1.9cqw, 5.8px);
    letter-spacing: 0.025em;
  }
  .more {
    position: absolute;
    top: -2%;
    left: -9%;
    min-width: 1.65em;
    padding: 0.25em 0.3em;
    border: 1px solid #f7edce;
    border-radius: 999px;
    background: #302b23;
    color: #fff2d7;
    font-size: clamp(7px, 3cqw, 10px);
    font-weight: 800;
    letter-spacing: 0;
    transform: rotate(8deg);
  }
</style>
