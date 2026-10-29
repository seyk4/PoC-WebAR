<script lang="ts">
  import { flushSync, onMount } from 'svelte';
  import {
    ArController,
    checkArSupport,
    getCameraPermission,
    loadBanner,
    type ArStatus,
    type LogEntry,
  } from './lib/ar/ArController';
  import SizeControl from './lib/SizeControl.svelte';
  import { DEFAULT_WIDTH_CM, MAX_LOG_ENTRIES, STABLE_FRAMES, VERTICAL_TOLERANCE_DEG } from './lib/config';

  let aspect = $state<number | null>(null);
  let assetError = $state<string | null>(null);
  let widthCm = $state(DEFAULT_WIDTH_CM);
  let heightCm = $state(0);

  let support = $state<{ checking: boolean; ok: boolean; reason?: string }>({ checking: true, ok: false });
  let inAr = $state(false);
  let startError = $state<string | null>(null);
  let status = $state<ArStatus | null>(null);
  let showInfo = $state(false);
  let showSize = $state(false);
  let logs = $state<LogEntry[]>([]);
  let actionMessage = $state<string | null>(null);
  let cameraDenied = $state(false);

  let overlayEl: HTMLDivElement;
  let controller: ArController | null = null;

  async function refreshCameraPermission() {
    cameraDenied = (await getCameraPermission()) === 'denied';
  }

  onMount(() => {
    checkArSupport().then((result) => {
      support = result.ok ? { checking: false, ok: true } : { checking: false, ok: false, reason: result.reason };
    });
    refreshCameraPermission();
    // Periksa ulang saat pengguna kembali dari pengaturan situs Chrome.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshCameraPermission();
    };
    document.addEventListener('visibilitychange', onVisible);
    loadBanner()
      .then((asset) => {
        aspect = asset.aspect;
        heightCm = widthCm / asset.aspect;
      })
      .catch(() => {
        assetError = 'Aset spanduk gagal dimuat. Muat ulang halaman.';
      });
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  function addLog(entry: LogEntry) {
    logs = logs.length >= MAX_LOG_ENTRIES ? [...logs.slice(1), entry] : [...logs, entry];
  }

  function setSize(w: number, h: number) {
    if (Math.abs(w - widthCm) < 0.05 && Math.abs(h - heightCm) < 0.05) return;
    widthCm = w;
    heightCm = h;
    controller?.setSize(w, h);
  }

  function startAr() {
    if (!aspect || controller) return;
    startError = null;
    // Overlay harus sudah tampil saat sesi dibuat, karena menjadi root DOM overlay.
    flushSync(() => {
      inAr = true;
      showInfo = false;
      showSize = false;
      status = null;
    });
    const ctrl = new ArController({
      onStatus: (s) => (status = s),
      onLog: addLog,
      onEnd: () => {
        controller = null;
        inAr = false;
        status = null;
      },
    });
    controller = ctrl;
    // Dipanggil langsung dari klik pengguna (F-01).
    ctrl.start(overlayEl, widthCm, heightCm).catch((err: unknown) => {
      controller = null;
      inAr = false;
      startError = err instanceof Error ? err.message : String(err);
      refreshCameraPermission();
    });
  }

  function snapshot() {
    controller?.snapshot();
  }

  function endAr() {
    controller?.end();
  }

  function resetAr() {
    controller?.reset();
  }

  /** Mencegah ketukan pada panel kontrol ikut menempatkan spanduk. */
  function blockXrSelect(node: HTMLElement) {
    const handler = (event: Event) => event.preventDefault();
    node.addEventListener('beforexrselect', handler);
    return {
      destroy: () => node.removeEventListener('beforexrselect', handler),
    };
  }

  function logText() {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        userAgent: navigator.userAgent,
        parameters: { verticalToleranceDeg: VERTICAL_TOLERANCE_DEG, stableFrames: STABLE_FRAMES },
        entries: logs,
      },
      null,
      2,
    );
  }

  async function copyLog() {
    try {
      await navigator.clipboard.writeText(logText());
      actionMessage = 'Log disalin ke clipboard.';
    } catch {
      actionMessage = 'Gagal menyalin. Gunakan tombol Unduh.';
    }
  }

  function downloadLog() {
    const blob = new Blob([logText()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `log-uji-poc-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    actionMessage = 'Log diunduh.';
  }

  function clearLog() {
    logs = [];
    actionMessage = 'Log dikosongkan.';
  }

  const fmt = (v: number | null | undefined, digits = 1) =>
    v === null || v === undefined ? '—' : v.toLocaleString('id-ID', { maximumFractionDigits: digits, minimumFractionDigits: digits });

  const phaseLabel: Record<ArStatus['phase'], string> = {
    scanning: 'Mencari dinding',
    ready: 'Siap ditempatkan',
    placed: 'Terpasang',
  };

  const canStart = $derived(support.ok && aspect !== null && !inAr);
</script>

<main class="landing" aria-hidden={inAr}>
  <header>
    <p class="eyebrow">Proof of Concept</p>
    <h1>AR Print Preview</h1>
    <p class="lead">
      Tempatkan spanduk virtual berskala fisik pada dinding melalui kamera ponsel, lalu tinjau penempatan, proporsi,
      dan perkiraan ukurannya.
    </p>
  </header>

  <section class="card">
    {#if aspect}
      <SizeControl {widthCm} {aspect} onchange={setSize} />
    {:else if assetError}
      <p class="error">{assetError}</p>
    {:else}
      <p>Memuat aset spanduk…</p>
    {/if}
  </section>

  <section class="card start">
    {#if support.checking}
      <p>Memeriksa dukungan AR…</p>
    {:else if !support.ok}
      <p class="error" role="alert">{support.reason}</p>
    {/if}
    {#if cameraDenied && !startError}
      <p class="error" role="alert">
        Izin kamera untuk situs ini sedang ditolak. Ketuk ikon pengaturan situs di kiri bilah alamat Chrome → Izin →
        Kamera → Izinkan, lalu muat ulang halaman.
      </p>
    {/if}
    {#if startError}
      <p class="error" role="alert">{startError}</p>
    {/if}
    <button class="primary" type="button" disabled={!canStart} onclick={startAr}>Mulai AR</button>
    <ol class="steps">
      <li>Mendekat ke dinding, sekitar 1–2 m.</li>
      <li>Arahkan titik tengah layar ke dinding dan gerakkan ponsel perlahan.</li>
      <li>Saat penanda berwarna hijau, ketuk layar untuk menempatkan spanduk.</li>
      <li>Mundur perlahan untuk melihat seluruh spanduk.</li>
    </ol>
  </section>

  <section class="card">
    <div class="log-head">
      <h2>Log uji</h2>
      <span>{logs.length} entri</span>
    </div>
    {#if logs.length}
      <ul class="log-list">
        {#each logs.slice(-6).reverse() as entry (entry.time + entry.event)}
          <li><code>{entry.time.slice(11, 19)}</code> {entry.event}</li>
        {/each}
      </ul>
      <div class="log-actions">
        <button type="button" onclick={copyLog}>Salin</button>
        <button type="button" onclick={downloadLog}>Unduh .json</button>
        <button type="button" onclick={clearLog}>Kosongkan</button>
      </div>
    {:else}
      <p class="muted">Belum ada entri. Log terisi selama sesi AR dan dipakai untuk mengisi laporan pengujian.</p>
    {/if}
    {#if actionMessage}
      <p class="muted">{actionMessage}</p>
    {/if}
  </section>
</main>

<!--
  Root DOM overlay sesi AR. Elemen ini selalu ada di DOM. Isinya baru ditampilkan setelah
  sesi benar-benar berjalan (status pertama diterima), agar tidak menimpa halaman awal
  selama dialog izin Chrome terbuka.
-->
<div class="overlay" class:visible={inAr} bind:this={overlayEl}>
  {#if inAr && status}
    <div class="crosshair" aria-hidden="true"></div>

    <div class="top" use:blockXrSelect>
      <div class="status-card">
        <div class="status-row">
          <span class="phase {status.phase}">{phaseLabel[status.phase]}</span>
          <button type="button" class="ghost" onclick={() => (showInfo = !showInfo)} aria-expanded={showInfo}>
            Info uji
          </button>
        </div>
        <p class="message">{status.message}</p>
        {#if status.notice}
          <p class="notice" role="status">{status.notice}</p>
        {/if}
      </div>

      {#if showInfo}
        <dl class="info">
          <dt>Sudut normal</dt>
          <dd>{fmt(status.hitAngleDeg)}° (batas {VERTICAL_TOLERANCE_DEG}°)</dd>
          <dt>Vertikal</dt>
          <dd>{status.hitVertical === null ? '—' : status.hitVertical ? 'Ya' : 'Tidak'}</dd>
          <dt>Frame stabil</dt>
          <dd>{Math.min(status.stableFrames, 999)}/{STABLE_FRAMES}</dd>
          <dt>Jarak ke bidang</dt>
          <dd>{fmt(status.hitDistanceM, 2)} m</dd>
          <dt>Jarak ke spanduk</dt>
          <dd>{fmt(status.bannerDistanceM, 2)} m</dd>
          <dt>Selisih ke dinding</dt>
          <dd>
            {#if status.wallGapCm === null}
              — <span class="dim">(bidik area spanduk)</span>
            {:else}
              {fmt(status.wallGapCm)} cm
              <span class="dim">{status.wallGapCm > 0.5 ? 'di depan' : status.wallGapCm < -0.5 ? 'di belakang' : 'menempel'}</span>
            {/if}
          </dd>
          <dt>Koreksi anchor</dt>
          <dd>{fmt(status.anchorShiftCm)} cm</dd>
          <dt>Ukuran</dt>
          <dd>{fmt(status.widthCm)} × {fmt(status.heightCm)} cm</dd>
          <dt>Anchor</dt>
          <dd>{status.anchorsSupported ? (status.anchored ? 'Terpasang' : 'Didukung') : 'Tidak didukung'}</dd>
          <dt>Pelacakan</dt>
          <dd>{status.tracking ? 'Berjalan' : 'Belum/hilang'}</dd>
          <dt>Log</dt>
          <dd>{logs.length} entri · {logs.at(-1)?.event ?? '—'}</dd>
          <dd class="info-actions">
            <button type="button" class="ghost" onclick={snapshot}>Catat pengukuran</button>
          </dd>
        </dl>
      {/if}
    </div>

    <div class="bottom" use:blockXrSelect>
      {#if showSize && aspect}
        <div class="size-panel">
          <SizeControl {widthCm} {aspect} compact onchange={setSize} />
        </div>
      {/if}
      <div class="controls">
        <button type="button" onclick={() => (showSize = !showSize)} aria-expanded={showSize}>
          {fmt(widthCm, 0)} × {fmt(heightCm, 0)} cm
        </button>
        <button type="button" onclick={resetAr} disabled={status?.phase !== 'placed'}>Reset</button>
        <button type="button" class="danger" onclick={endAr}>Akhiri AR</button>
      </div>
    </div>
  {/if}
</div>
