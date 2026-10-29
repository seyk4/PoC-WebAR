/**
 * Parameter PoC yang "ditentukan saat pengembangan dan dicatat"
 * (Ketentuan PoC v1.3, bagian 15). Ubah di sini, lalu catat nilainya
 * pada laporan pengujian.
 */

/** Batas sudut normal bidang terhadap horizontal agar hasil hit-test dianggap vertikal (derajat). */
export const VERTICAL_TOLERANCE_DEG = 15;

/** Jumlah frame berturut-turut dengan hasil vertikal dan stabil sebelum penempatan diizinkan. */
export const STABLE_FRAMES = 15;

/** Perubahan arah normal maksimum antar-frame agar masih dihitung stabil (derajat). */
export const STABLE_MAX_ANGLE_CHANGE_DEG = 4;

/**
 * Jarak (meter) dari kamera ke titik hit-test yang memicu peringatan "terlalu jauh".
 * Penempatan tetap diizinkan agar batas jarak dapat diukur pada uji T-18.
 */
export const PLACEMENT_WARN_DISTANCE_M = 2.5;

/** Jarak spanduk dari permukaan dinding (meter) agar tidak berkedip menembus bidang. */
export const WALL_OFFSET_M = 0.003;

/**
 * Preset lebar spanduk (cm). Tinggi dihitung otomatis dari rasio desain.
 * ASUMSI sementara; ganti dengan ukuran yang umum dipesan menurut perusahaan.
 */
export const SIZE_PRESETS_CM = [150, 200, 300, 400];

/** Ukuran acuan bawaan (lebar, cm). Untuk aset uji 3:1 berarti 300 × 100 cm. */
export const DEFAULT_WIDTH_CM = 300;

/** Batas input satu dimensi (cm). */
export const MIN_DIMENSION_CM = 20;
export const MAX_DIMENSION_CM = 1000;

/** Selang pengiriman status ke antarmuka (ms), agar UI tidak dirender ulang setiap frame. */
export const STATUS_INTERVAL_MS = 120;

/** Jumlah maksimum entri log uji yang disimpan di memori. */
export const MAX_LOG_ENTRIES = 1000;
