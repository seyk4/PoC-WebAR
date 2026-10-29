<script lang="ts">
  import { MAX_DIMENSION_CM, MIN_DIMENSION_CM, SIZE_PRESETS_CM } from './config';

  interface Props {
    widthCm: number;
    /** Rasio lebar ÷ tinggi desain. Tinggi selalu dihitung dari rasio ini (F-06). */
    aspect: number;
    compact?: boolean;
    onchange: (widthCm: number, heightCm: number) => void;
  }

  let { widthCm, aspect, compact = false, onchange }: Props = $props();

  type Dimension = 'lebar' | 'tinggi';
  let dimension = $state<Dimension>('lebar');
  let customValue = $state('');
  let error = $state<string | null>(null);

  const fmt = (cm: number) => (Math.round(cm * 10) / 10).toLocaleString('id-ID');
  const heightOf = (w: number) => w / aspect;

  function choosePreset(w: number) {
    error = null;
    onchange(w, heightOf(w));
  }

  /** Input satu dimensi; dimensi lain dihitung dari rasio desain (F-07). */
  function applyCustom(event: SubmitEvent) {
    event.preventDefault();
    const value = Number(customValue.replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      error = 'Masukkan angka dalam sentimeter.';
      return;
    }
    const w = dimension === 'lebar' ? value : value * aspect;
    const h = heightOf(w);
    if (Math.min(w, h) < MIN_DIMENSION_CM || Math.max(w, h) > MAX_DIMENSION_CM) {
      error = `Setiap sisi harus antara ${MIN_DIMENSION_CM} dan ${MAX_DIMENSION_CM} cm (hasil: ${fmt(w)} × ${fmt(h)} cm).`;
      return;
    }
    error = null;
    customValue = '';
    onchange(w, h);
  }

  const preview = $derived.by(() => {
    const value = Number(customValue.replace(',', '.'));
    if (!customValue || !Number.isFinite(value) || value <= 0) return null;
    const w = dimension === 'lebar' ? value : value * aspect;
    return `${fmt(w)} × ${fmt(heightOf(w))} cm`;
  });
</script>

<div class="size" class:compact>
  {#if !compact}
    <p class="label">Ukuran spanduk (rasio desain dikunci)</p>
  {/if}
  <div class="presets" role="group" aria-label="Preset ukuran">
    {#each SIZE_PRESETS_CM as w (w)}
      <button
        type="button"
        class="preset"
        class:active={Math.abs(widthCm - w) < 0.05}
        aria-pressed={Math.abs(widthCm - w) < 0.05}
        onclick={() => choosePreset(w)}
      >
        {fmt(w)} × {fmt(heightOf(w))}
      </button>
    {/each}
  </div>

  <form class="custom" onsubmit={applyCustom}>
    <select bind:value={dimension} aria-label="Dimensi yang diisi">
      <option value="lebar">Lebar</option>
      <option value="tinggi">Tinggi</option>
    </select>
    <input
      type="text"
      inputmode="decimal"
      placeholder="cm"
      aria-label="Nilai dalam sentimeter"
      bind:value={customValue}
    />
    <button type="submit">Terapkan</button>
  </form>
  {#if preview}
    <p class="hint">Menjadi {preview}</p>
  {/if}
  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}
  <p class="current">Saat ini: <strong>{fmt(widthCm)} × {fmt(heightOf(widthCm))} cm</strong></p>
</div>

<style>
  .size {
    display: grid;
    gap: 0.5rem;
  }
  .label {
    margin: 0;
    font-weight: 600;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }
  .preset {
    padding: 0.45rem 0.7rem;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--chip);
    color: inherit;
    font-size: 0.85rem;
    font-variant-numeric: tabular-nums;
  }
  .preset.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #fff;
  }
  .custom {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 0.4rem;
  }
  .custom select,
  .custom input {
    min-width: 0;
    padding: 0.45rem 0.5rem;
    border-radius: 8px;
    border: 1px solid var(--line);
    background: var(--field);
    color: inherit;
    font-size: 1rem;
  }
  .custom button {
    padding: 0.45rem 0.8rem;
    border-radius: 8px;
    border: none;
    background: var(--ink-button);
    color: var(--ink-button-text);
    font-weight: 600;
  }
  .hint,
  .current,
  .error {
    margin: 0;
    font-size: 0.85rem;
  }
  .error {
    color: var(--danger);
  }
  .compact .current {
    display: none;
  }
</style>
