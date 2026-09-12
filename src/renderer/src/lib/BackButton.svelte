<script lang="ts">
  // The one back button. Every screen-level back affordance renders this so
  // the shape/weight/hover language stays identical across the app.
  let { onclick, label = 'Back to library' }: { onclick: () => void; label?: string } = $props()
</script>

<button class="back" {onclick} aria-label={label} title={label}>
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <line x1="19" y1="12" x2="6" y2="12"></line>
    <polyline points="12 18 6 12 12 6"></polyline>
  </svg>
</button>

<style>
  .back {
    -webkit-app-region: no-drag;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--hairline);
    border-radius: var(--radius-pill);
    color: var(--walnut);
    cursor: pointer;
    transition:
      color 140ms ease,
      border-color 140ms ease,
      background 140ms ease,
      transform 80ms ease;
  }
  .back:hover {
    color: var(--espresso);
    border-color: var(--hairline-strong);
    background: var(--surface);
  }
  .back:active {
    transform: scale(0.95);
  }
  .back:focus-visible {
    outline: 2px solid var(--brick);
    outline-offset: 2px;
  }
</style>
