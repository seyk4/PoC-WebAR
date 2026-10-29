import * as THREE from 'three';
import bannerUrl from '../../assets/spanduk-uji.png';
import {
  PLACEMENT_WARN_DISTANCE_M,
  STABLE_FRAMES,
  STABLE_MAX_ANGLE_CHANGE_DEG,
  STATUS_INTERVAL_MS,
  VERTICAL_TOLERANCE_DEG,
  WALL_OFFSET_M,
} from '../config';

export type ArPhase = 'scanning' | 'ready' | 'placed';

export interface ArStatus {
  phase: ArPhase;
  /** Petunjuk utama untuk pengguna (F-03). */
  message: string;
  /** Pesan sesaat, misalnya ketukan yang ditolak. */
  notice: string | null;
  tracking: boolean;
  /** Sudut normal bidang terhadap horizontal; 0° = dinding tegak sempurna. */
  hitAngleDeg: number | null;
  /** Apakah hasil hit-test saat ini dianggap vertikal. */
  hitVertical: boolean | null;
  /** Jarak kamera ke titik hit-test (meter). */
  hitDistanceM: number | null;
  /** Jarak kamera ke spanduk yang sudah ditempatkan (meter). */
  bannerDistanceM: number | null;
  /**
   * Selisih kedalaman spanduk terhadap perkiraan dinding ARCore saat ini di titik bidik (cm).
   * Positif = spanduk di depan dinding (melayang), negatif = di belakang dinding.
   * Hanya dihitung bila titik bidik mengenai bidang yang sejajar dengan spanduk.
   */
  wallGapCm: number | null;
  /** Besar koreksi posisi spanduk oleh anchor sejak penempatan (cm). */
  anchorShiftCm: number | null;
  stableFrames: number;
  anchorsSupported: boolean;
  anchored: boolean;
  domOverlay: boolean;
  widthCm: number;
  heightCm: number;
}

export interface LogEntry {
  time: string;
  event: string;
  detail: Record<string, string | number | boolean | null>;
}

export interface BannerAsset {
  texture: THREE.Texture;
  /** Rasio lebar ÷ tinggi desain; dikunci untuk semua ukuran (F-06). */
  aspect: number;
}

interface Callbacks {
  onStatus: (status: ArStatus) => void;
  onLog: (entry: LogEntry) => void;
  onEnd: () => void;
}

const DEG = 180 / Math.PI;
const WORLD_UP = new THREE.Vector3(0, 1, 0);

let bannerPromise: Promise<BannerAsset> | null = null;

/** Memuat aset spanduk satu kali; dipanggil saat halaman dibuka agar sesi AR cepat siap. */
export function loadBanner(): Promise<BannerAsset> {
  if (!bannerPromise) {
    bannerPromise = new THREE.TextureLoader().loadAsync(bannerUrl).then((texture) => {
      texture.colorSpace = THREE.SRGBColorSpace;
      const image = texture.image as HTMLImageElement;
      return { texture, aspect: image.width / image.height };
    });
    bannerPromise.catch(() => {
      bannerPromise = null;
    });
  }
  return bannerPromise;
}

export type SupportResult = { ok: true } | { ok: false; reason: string };

/** Pemeriksaan awal sebelum tombol Mulai AR diaktifkan (F-10). */
export async function checkArSupport(): Promise<SupportResult> {
  if (!window.isSecureContext) {
    return {
      ok: false,
      reason:
        'Halaman tidak dibuka melalui koneksi aman. Buka lewat HTTPS (misalnya GitHub Pages) atau localhost (port forwarding USB).',
    };
  }
  if (!('xr' in navigator) || !navigator.xr) {
    return {
      ok: false,
      reason: 'Browser ini tidak menyediakan WebXR. Gunakan Chrome di ponsel Android yang mendukung ARCore.',
    };
  }
  try {
    const supported = await navigator.xr.isSessionSupported('immersive-ar');
    if (!supported) {
      return {
        ok: false,
        reason:
          'Perangkat atau browser tidak mendukung sesi AR. Pastikan Google Play Services for AR terpasang dan Chrome versi terbaru.',
      };
    }
  } catch {
    return { ok: false, reason: 'Pemeriksaan dukungan AR gagal dijalankan oleh browser.' };
  }
  return { ok: true };
}

export type CameraPermission = PermissionState | 'unknown';

/** Membaca status izin kamera situs ini (Chrome mendukung nama izin "camera"). */
export async function getCameraPermission(): Promise<CameraPermission> {
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

const CAMERA_DENIED_MESSAGE =
  'Izin kamera untuk situs ini ditolak, sehingga sesi AR tidak dapat dimulai. Ketuk ikon pengaturan situs di kiri bilah alamat Chrome → Izin → Kamera → Izinkan, lalu muat ulang halaman.';

/** Menerjemahkan kegagalan requestSession menjadi pesan yang dapat dipahami (F-10, T-03). */
function describeStartError(err: unknown, camera: CameraPermission): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  // Chrome melaporkan penolakan izin kamera/AR sebagai NotSupportedError atau NotAllowedError.
  if ((name === 'NotSupportedError' || name === 'NotAllowedError') && camera === 'denied') {
    return CAMERA_DENIED_MESSAGE;
  }
  switch (name) {
    case 'NotAllowedError':
      return 'Izin AR atau kamera ditolak. Tekan Mulai AR lagi lalu pilih Izinkan pada dialog Chrome.';
    case 'NotSupportedError':
      // Pemeriksaan awal sudah lolos, jadi penyebab paling umum adalah dialog izin yang ditolak.
      return 'Sesi AR tidak dapat dimulai. Biasanya ini terjadi karena izin AR atau kamera ditolak pada dialog Chrome. Tekan Mulai AR lagi dan pilih Izinkan. Jika tetap gagal, periksa izin Kamera di pengaturan situs Chrome.';
    case 'SecurityError':
      return 'Browser menolak sesi AR karena alasan keamanan. Pastikan halaman dibuka lewat HTTPS atau localhost.';
    case 'InvalidStateError':
      return 'Sesi AR lain masih berjalan. Tutup sesi tersebut lalu coba lagi.';
    default:
      return `Sesi AR gagal dimulai${err instanceof Error && err.message ? `: ${err.message}` : '.'}`;
  }
}

export class ArController {
  private cb: Callbacks;
  private renderer: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera();
  private session: XRSession | null = null;
  private refSpace: XRReferenceSpace | null = null;
  private hitSource: XRHitTestSource | null = null;

  private banner = new THREE.Group();
  private bannerMesh: THREE.Mesh | null = null;
  private reticle = new THREE.Group();
  private reticleOutline: THREE.LineLoop | null = null;
  private reticleRing: THREE.Mesh | null = null;
  private reticleMaterials: { line: THREE.LineBasicMaterial; ring: THREE.MeshBasicMaterial } | null = null;

  private widthM = 3;
  private heightM = 1;
  private aspect = 3;

  private stableFrames = 0;
  private prevNormal: THREE.Vector3 | null = null;
  private placeRequested = false;
  private placed = false;
  /** Bertambah setiap penempatan/reset agar anchor lama yang selesai terlambat diabaikan. */
  private placementId = 0;

  private anchorsSupported = false;
  private anchor: XRAnchor | null = null;
  private anchorLocal: THREE.Matrix4 | null = null;
  private domOverlay = false;

  private wasTracking: boolean | null = null;
  private lastStatusAt = 0;
  private notice: { text: string; until: number } | null = null;
  private ended = false;

  // Objek sementara agar tidak membuat objek baru setiap frame.
  private tmpMatrix = new THREE.Matrix4();
  private tmpPos = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();
  private tmpScale = new THREE.Vector3();
  private viewerPos = new THREE.Vector3();
  private bannerPos = new THREE.Vector3();
  private bannerNormal = new THREE.Vector3();
  /** Posisi pusat spanduk tepat saat ditempatkan, untuk menghitung koreksi anchor. */
  private placedPos = new THREE.Vector3();
  private snapshotCount = 0;

  constructor(callbacks: Callbacks) {
    this.cb = callbacks;
  }

  /**
   * Memulai sesi AR. Harus dipanggil langsung dari tindakan pengguna (F-01),
   * karena browser mensyaratkan aktivasi pengguna untuk requestSession.
   */
  async start(overlayRoot: HTMLElement, widthCm: number, heightCm: number): Promise<void> {
    const xr = navigator.xr;
    if (!xr) throw new Error('Browser ini tidak menyediakan WebXR.');

    let session: XRSession;
    try {
      // requestSession dipanggil pertama kali, sebelum await lain, agar aktivasi pengguna masih berlaku.
      session = await xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'anchors'],
        domOverlay: { root: overlayRoot },
      });
    } catch (err) {
      const camera = await getCameraPermission();
      this.log('session_start_failed', {
        error: err instanceof Error ? err.name : String(err),
        message: err instanceof Error ? err.message : null,
        cameraPermission: camera,
      });
      throw new Error(describeStartError(err, camera));
    }

    this.session = session;
    try {
      await this.setup(session, widthCm, heightCm);
    } catch (err) {
      this.log('session_setup_failed', { error: err instanceof Error ? err.message : String(err) });
      await session.end().catch(() => undefined);
      throw new Error(
        `Sesi AR terbuka tetapi persiapannya gagal${err instanceof Error && err.message ? `: ${err.message}` : '.'}`,
      );
    }
  }

  private async setup(session: XRSession, widthCm: number, heightCm: number): Promise<void> {
    const asset = await loadBanner();
    this.aspect = asset.aspect;
    this.widthM = widthCm / 100;
    this.heightM = heightCm / 100;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    this.renderer = renderer;

    asset.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    this.buildScene(asset.texture);

    session.addEventListener('end', this.handleEnd);
    session.addEventListener('select', this.handleSelect);

    await renderer.xr.setSession(session);
    this.refSpace = renderer.xr.getReferenceSpace();

    const viewerSpace = await session.requestReferenceSpace('viewer');
    if (!session.requestHitTestSource) throw new Error('hit-test tidak tersedia pada sesi ini');
    const hitSource = await session.requestHitTestSource({ space: viewerSpace });
    if (!hitSource) throw new Error('sumber hit-test tidak dapat dibuat');
    this.hitSource = hitSource;

    const enabled = (session as XRSession & { enabledFeatures?: readonly string[] }).enabledFeatures;
    this.anchorsSupported = enabled
      ? enabled.includes('anchors')
      : typeof XRHitTestResult !== 'undefined' && 'createAnchor' in XRHitTestResult.prototype;
    this.domOverlay = !!session.domOverlayState;

    this.log('session_start', {
      domOverlay: this.domOverlay,
      domOverlayType: session.domOverlayState?.type ?? null,
      anchorsSupported: this.anchorsSupported,
      widthCm,
      heightCm,
      aspect: Number(this.aspect.toFixed(4)),
      verticalToleranceDeg: VERTICAL_TOLERANCE_DEG,
      stableFrames: STABLE_FRAMES,
      userAgent: navigator.userAgent,
    });

    renderer.setAnimationLoop(this.onFrame);
  }

  private buildScene(texture: THREE.Texture): void {
    // Spanduk: bidang 1 × 1 m yang diskalakan ke ukuran fisik (F-06).
    // MeshBasicMaterial tidak terpengaruh cahaya, sehingga warna desain tampil apa adanya.
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    this.bannerMesh = mesh;
    this.banner.add(mesh);
    this.banner.matrixAutoUpdate = false;
    this.banner.visible = false;
    this.scene.add(this.banner);

    // Reticle: garis tepi seukuran spanduk + cincin di titik tengah.
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffb020, depthTest: false, transparent: true });
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb020,
      side: THREE.DoubleSide,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    this.reticleMaterials = { line: lineMat, ring: ringMat };

    const outlineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, -0.5, 0),
      new THREE.Vector3(0.5, -0.5, 0),
      new THREE.Vector3(0.5, 0.5, 0),
      new THREE.Vector3(-0.5, 0.5, 0),
    ]);
    this.reticleOutline = new THREE.LineLoop(outlineGeom, lineMat);
    this.reticleRing = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.09, 40), ringMat);

    this.reticle.add(this.reticleOutline, this.reticleRing);
    this.reticle.matrixAutoUpdate = false;
    this.reticle.visible = false;
    this.scene.add(this.reticle);

    this.applySize();
  }

  private applySize(): void {
    this.bannerMesh?.scale.set(this.widthM, this.heightM, 1);
    this.reticleOutline?.scale.set(this.widthM, this.heightM, 1);
  }

  /** Mengganti ukuran fisik spanduk; tinggi selalu mengikuti rasio desain (F-07). */
  setSize(widthCm: number, heightCm: number): void {
    // Ukuran yang sama tidak dicatat agar log tidak berisi perubahan semu.
    if (Math.abs(widthCm / 100 - this.widthM) < 0.0005 && Math.abs(heightCm / 100 - this.heightM) < 0.0005) return;
    const before = { widthCm: round(this.widthM * 100, 1), heightCm: round(this.heightM * 100, 1) };
    this.widthM = widthCm / 100;
    this.heightM = heightCm / 100;
    this.applySize();
    this.log('size_change', {
      fromWidthCm: before.widthCm,
      fromHeightCm: before.heightCm,
      widthCm: Number(widthCm.toFixed(1)),
      heightCm: Number(heightCm.toFixed(1)),
      placed: this.placed,
    });
    this.emitStatus(true);
  }

  /** Menghapus penempatan agar pengguna dapat memilih lokasi baru (F-08). */
  reset(): void {
    if (!this.session) return;
    this.removeAnchor();
    this.placementId++;
    this.placed = false;
    this.banner.visible = false;
    this.stableFrames = 0;
    this.prevNormal = null;
    this.log('reset', {});
    this.emitStatus(true);
  }

  /** Mengakhiri sesi dan melepas kamera (F-09). */
  async end(): Promise<void> {
    if (this.session) await this.session.end().catch(() => undefined);
  }

  private handleSelect = (): void => {
    // Penempatan diproses pada frame berikutnya agar memakai hasil hit-test frame yang aktif.
    this.placeRequested = true;
  };

  private handleEnd = (): void => {
    if (this.ended) return;
    this.ended = true;
    this.log('session_end', { placed: this.placed });
    this.renderer?.setAnimationLoop(null);
    this.hitSource?.cancel();
    this.hitSource = null;
    this.removeAnchor();
    this.session?.removeEventListener('select', this.handleSelect);
    this.session?.removeEventListener('end', this.handleEnd);
    this.session = null;
    this.disposeScene();
    this.renderer?.dispose();
    this.renderer = null;
    this.cb.onEnd();
  };

  private disposeScene(): void {
    this.bannerMesh?.geometry.dispose();
    (this.bannerMesh?.material as THREE.Material | undefined)?.dispose();
    this.reticleOutline?.geometry.dispose();
    this.reticleRing?.geometry.dispose();
    this.reticleMaterials?.line.dispose();
    this.reticleMaterials?.ring.dispose();
    // Tekstur dipertahankan (cache) agar sesi berikutnya cepat dimulai.
  }

  private removeAnchor(): void {
    try {
      this.anchor?.delete();
    } catch {
      /* anchor mungkin sudah tidak berlaku */
    }
    this.anchor = null;
    this.anchorLocal = null;
  }

  private onFrame = (_time: number, frame?: XRFrame): void => {
    const renderer = this.renderer;
    const refSpace = this.refSpace;
    if (!frame || !renderer || !refSpace) return;

    const viewerPose = frame.getViewerPose(refSpace);
    const tracking = !!viewerPose && !viewerPose.emulatedPosition;
    if (tracking !== this.wasTracking) {
      if (this.wasTracking !== null) this.log(tracking ? 'tracking_regained' : 'tracking_lost', {});
      this.wasTracking = tracking;
    }
    if (viewerPose) {
      const p = viewerPose.transform.position;
      this.viewerPos.set(p.x, p.y, p.z);
    }

    // Spanduk yang sudah ditempatkan mengikuti anchor bila tersedia (F-05).
    if (this.placed && this.anchor && frame.trackedAnchors?.has(this.anchor)) {
      const anchorPose = frame.getPose(this.anchor.anchorSpace, refSpace);
      if (anchorPose) {
        const anchorMatrix = this.tmpMatrix.fromArray(anchorPose.transform.matrix);
        if (!this.anchorLocal) {
          // Simpan posisi spanduk relatif terhadap anchor pada saat anchor pertama kali dilacak.
          this.anchorLocal = anchorMatrix.clone().invert().multiply(this.banner.matrix);
        }
        this.banner.matrix.multiplyMatrices(anchorMatrix, this.anchorLocal);
        this.banner.matrixWorldNeedsUpdate = true;
      }
    }

    let hitAngleDeg: number | null = null;
    let hitVertical: boolean | null = null;
    let hitDistanceM: number | null = null;
    let readyHit: { result: XRHitTestResult; position: THREE.Vector3; normal: THREE.Vector3 } | null = null;
    let hitPosition: THREE.Vector3 | null = null;
    let hitNormal: THREE.Vector3 | null = null;

    const results = tracking && this.hitSource ? frame.getHitTestResults(this.hitSource) : [];
    const hit = results[0];
    const hitPose = hit?.getPose(refSpace);

    if (hit && hitPose) {
      const m = this.tmpMatrix.fromArray(hitPose.transform.matrix);
      m.decompose(this.tmpPos, this.tmpQuat, this.tmpScale);
      const position = this.tmpPos.clone();
      // Sumbu Y pose hasil hit-test adalah normal permukaan.
      const normal = new THREE.Vector3().setFromMatrixColumn(m, 1).normalize();
      // Pastikan normal menghadap kamera agar spanduk tampil di sisi depan dinding.
      if (normal.dot(this.viewerPos.clone().sub(position)) < 0) normal.negate();

      hitAngleDeg = Math.asin(Math.min(1, Math.abs(normal.y))) * DEG;
      hitVertical = hitAngleDeg <= VERTICAL_TOLERANCE_DEG;
      hitDistanceM = this.viewerPos.distanceTo(position);
      hitPosition = position;
      hitNormal = normal;

      // Reticle dianggap stabil bila vertikal dan arahnya tidak banyak berubah antar-frame.
      if (hitVertical) {
        const steady =
          this.prevNormal !== null && this.prevNormal.angleTo(normal) * DEG <= STABLE_MAX_ANGLE_CHANGE_DEG;
        this.stableFrames = steady ? this.stableFrames + 1 : 1;
      } else {
        this.stableFrames = 0;
      }
      this.prevNormal = normal;

      if (hitVertical && this.stableFrames >= STABLE_FRAMES) readyHit = { result: hit, position, normal };

      this.updateReticle(position, normal, hitVertical, readyHit !== null, m);
    } else {
      this.stableFrames = 0;
      this.prevNormal = null;
      this.reticle.visible = false;
    }

    if (this.placed) this.reticle.visible = false;

    if (this.placeRequested) {
      this.placeRequested = false;
      this.handlePlacement(readyHit, hitAngleDeg, hitDistanceM, tracking);
    }

    let wallGapCm: number | null = null;
    let anchorShiftCm: number | null = null;
    if (this.placed) {
      this.bannerPos.setFromMatrixPosition(this.banner.matrix);
      this.bannerNormal.setFromMatrixColumn(this.banner.matrix, 2).normalize();
      anchorShiftCm = this.bannerPos.distanceTo(this.placedPos) * 100;

      // Selisih kedalaman hanya bermakna bila titik bidik mengenai bidang yang sejajar dengan spanduk.
      if (hitPosition && hitNormal && hitNormal.angleTo(this.bannerNormal) * DEG <= 10) {
        const gapM = this.tmpPos.copy(this.bannerPos).sub(hitPosition).dot(this.bannerNormal) - WALL_OFFSET_M;
        wallGapCm = gapM * 100;
      }
    }

    renderer.render(this.scene, this.camera);

    this.emitStatus(false, {
      tracking,
      hitAngleDeg,
      hitVertical,
      hitDistanceM,
      bannerDistanceM: this.placed ? this.viewerPos.distanceTo(this.bannerPos) : null,
      wallGapCm,
      anchorShiftCm,
    });
  };

  /**
   * Menyimpan cuplikan pengukuran ke log (dipakai untuk T-07, T-09, T-13/T-14).
   * Catatan: drift terhadap dinding asli tidak terlihat dalam koordinat AR,
   * sehingga tetap perlu diukur secara visual memakai selotip dan grid spanduk.
   */
  snapshot(): void {
    if (!this.session) return;
    const info = this.lastFrameInfo;
    this.snapshotCount++;
    this.log('snapshot', {
      no: this.snapshotCount,
      placed: this.placed,
      tracking: info.tracking,
      hitAngleDeg: round(info.hitAngleDeg, 1),
      hitDistanceM: round(info.hitDistanceM, 3),
      bannerDistanceM: round(info.bannerDistanceM, 3),
      wallGapCm: round(info.wallGapCm, 1),
      anchorShiftCm: round(info.anchorShiftCm, 1),
      anchored: this.anchor !== null,
      widthCm: round(this.widthM * 100, 1),
      heightCm: round(this.heightM * 100, 1),
    });
    this.flash(`Pengukuran #${this.snapshotCount} dicatat.`);
  }

  private updateReticle(
    position: THREE.Vector3,
    normal: THREE.Vector3,
    vertical: boolean,
    ready: boolean,
    hitMatrix: THREE.Matrix4,
  ): void {
    if (!this.reticleMaterials || !this.reticleOutline) return;
    const color = ready ? 0x2ecc71 : vertical ? 0xffb020 : 0xff4d4d;
    this.reticleMaterials.line.color.setHex(color);
    this.reticleMaterials.ring.color.setHex(color);

    if (vertical) {
      // Pratinjau tepi spanduk pada dinding, sejajar dan tegak.
      this.composeWallMatrix(position, normal, this.reticle.matrix);
      this.reticleOutline.visible = true;
    } else {
      // Bidang tidak vertikal: hanya cincin mengikuti orientasi hit-test (sumbu Y → Z cincin).
      this.reticle.matrix.copy(hitMatrix).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
      this.reticleOutline.visible = false;
    }
    this.reticle.matrixWorldNeedsUpdate = true;
    this.reticle.visible = true;
  }

  /**
   * Menyusun matriks spanduk di dinding: sumbu Z = normal dinding (menghadap kamera),
   * sumbu Y = arah "atas" dunia yang diproyeksikan ke bidang dinding, sehingga spanduk tegak.
   */
  private composeWallMatrix(position: THREE.Vector3, normal: THREE.Vector3, target: THREE.Matrix4): void {
    const z = normal.clone().normalize();
    const x = new THREE.Vector3().crossVectors(WORLD_UP, z);
    if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
    x.normalize();
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    target.makeBasis(x, y, z);
    target.setPosition(position.clone().addScaledVector(z, WALL_OFFSET_M));
  }

  private handlePlacement(
    readyHit: { result: XRHitTestResult; position: THREE.Vector3; normal: THREE.Vector3 } | null,
    hitAngleDeg: number | null,
    hitDistanceM: number | null,
    tracking: boolean,
  ): void {
    if (this.placed) {
      this.flash('Spanduk sudah ditempatkan. Tekan Reset untuk memilih lokasi baru.');
      this.log('place_ignored', { reason: 'already_placed' });
      return;
    }
    if (!readyHit) {
      const reason = !tracking
        ? 'tracking_not_ready'
        : hitAngleDeg === null
          ? 'no_surface'
          : hitAngleDeg > VERTICAL_TOLERANCE_DEG
            ? 'not_vertical'
            : 'not_stable';
      const text: Record<string, string> = {
        tracking_not_ready: 'Pelacakan belum siap. Gerakkan ponsel perlahan.',
        no_surface: 'Belum ada bidang terdeteksi di titik tengah layar.',
        not_vertical: 'Bidang yang dibidik tidak vertikal. Arahkan ke dinding.',
        not_stable: 'Tahan sebentar sampai penanda berwarna hijau.',
      };
      this.flash(text[reason]);
      this.log('place_rejected', {
        reason,
        hitAngleDeg: round(hitAngleDeg, 1),
        hitDistanceM: round(hitDistanceM, 2),
        stableFrames: this.stableFrames,
      });
      return;
    }

    this.composeWallMatrix(readyHit.position, readyHit.normal, this.banner.matrix);
    this.banner.matrixWorldNeedsUpdate = true;
    this.banner.visible = true;
    this.placed = true;
    this.placedPos.setFromMatrixPosition(this.banner.matrix);
    const id = ++this.placementId;

    this.log('place', {
      hitAngleDeg: round(hitAngleDeg, 1),
      hitDistanceM: round(hitDistanceM, 2),
      widthCm: round(this.widthM * 100, 1),
      heightCm: round(this.heightM * 100, 1),
      stableFrames: this.stableFrames,
      anchorRequested: this.anchorsSupported,
    });

    if (this.anchorsSupported && readyHit.result.createAnchor) {
      readyHit.result
        .createAnchor()
        ?.then((anchor) => {
          if (id !== this.placementId || !this.placed) {
            anchor.delete();
            return;
          }
          this.anchor = anchor;
          this.anchorLocal = null;
          this.log('anchor_created', {});
        })
        .catch((err: unknown) => {
          this.log('anchor_failed', { error: err instanceof Error ? err.message : String(err) });
        });
    }
    this.emitStatus(true);
  }

  private flash(text: string): void {
    this.notice = { text, until: performance.now() + 2500 };
    this.emitStatus(true);
  }

  private lastFrameInfo: Pick<
    ArStatus,
    'tracking' | 'hitAngleDeg' | 'hitVertical' | 'hitDistanceM' | 'bannerDistanceM' | 'wallGapCm' | 'anchorShiftCm'
  > = {
    tracking: false,
    hitAngleDeg: null,
    hitVertical: null,
    hitDistanceM: null,
    bannerDistanceM: null,
    wallGapCm: null,
    anchorShiftCm: null,
  };

  private emitStatus(force: boolean, frameInfo?: ArController['lastFrameInfo']): void {
    if (frameInfo) this.lastFrameInfo = frameInfo;
    const now = performance.now();
    if (!force && now - this.lastStatusAt < STATUS_INTERVAL_MS) return;
    this.lastStatusAt = now;

    const info = this.lastFrameInfo;
    const ready = !this.placed && info.hitVertical === true && this.stableFrames >= STABLE_FRAMES;
    const phase: ArPhase = this.placed ? 'placed' : ready ? 'ready' : 'scanning';
    if (this.notice && now > this.notice.until) this.notice = null;

    this.cb.onStatus({
      phase,
      message: this.describe(phase, info),
      notice: this.notice?.text ?? null,
      ...info,
      stableFrames: this.stableFrames,
      anchorsSupported: this.anchorsSupported,
      anchored: this.anchor !== null,
      domOverlay: this.domOverlay,
      widthCm: this.widthM * 100,
      heightCm: this.heightM * 100,
    });
  }

  /** Petunjuk utama sesuai keadaan (F-03). */
  private describe(phase: ArPhase, info: ArController['lastFrameInfo']): string {
    if (!info.tracking) {
      return phase === 'placed'
        ? 'Pelacakan hilang. Gerakkan ponsel perlahan ke arah dinding agar spanduk kembali stabil.'
        : 'Gerakkan ponsel perlahan ke kiri dan kanan agar ruangan dikenali.';
    }
    if (phase === 'placed') {
      return 'Spanduk terpasang. Mundur perlahan untuk melihat seluruh spanduk.';
    }
    if (info.hitAngleDeg === null) {
      return 'Mendekat ke dinding (sekitar 1–2 m) dan arahkan titik tengah layar ke dinding.';
    }
    if (!info.hitVertical) {
      return 'Bidang yang dibidik tidak vertikal. Arahkan ke dinding.';
    }
    const far = info.hitDistanceM !== null && info.hitDistanceM > PLACEMENT_WARN_DISTANCE_M;
    const dist = formatId(info.hitDistanceM, 1);
    if (phase === 'ready') {
      return far
        ? `Siap, tetapi jarak ${dist} m cukup jauh. Mendekat ke 1–2 m untuk hasil terbaik, atau ketuk untuk menempatkan.`
        : 'Siap. Ketuk layar untuk menempatkan spanduk.';
    }
    return far
      ? `Dinding terdeteksi pada ${dist} m. Mendekat ke 1–2 m dan tahan sebentar.`
      : 'Dinding terdeteksi. Tahan ponsel sebentar sampai penanda berwarna hijau.';
  }

  private log(event: string, detail: LogEntry['detail']): void {
    this.cb.onLog({ time: new Date().toISOString(), event, detail });
  }
}

/** Format angka Indonesia (koma desimal), sama dengan panel Info uji. */
function formatId(value: number | null, digits: number): string {
  return value === null
    ? '—'
    : value.toLocaleString('id-ID', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function round(value: number | null, digits: number): number | null {
  return value === null ? null : Number(value.toFixed(digits));
}
