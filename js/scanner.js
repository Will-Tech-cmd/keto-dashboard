// scanner.js — Kamera-Zugriff, Barcode-Erkennung (nativ oder ZXing-Fallback).

const FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];

let stream = null;
let rafId = null;
let detector = null;
let zxingReader = null;
let onDetect = null;
let scanning = false;

function supportsNativeDetector() {
  return "BarcodeDetector" in window;
}

/**
 * Startet die Kamera in <video> und beginnt mit dem Scannen.
 * @param {HTMLVideoElement} videoEl
 * @param {(barcode: string) => void} callback  wird EINMAL pro erfolgreichem Scan aufgerufen
 * @param {(status: string) => void} onStatus  optionale Statusmeldungen fürs UI
 */
export async function startScanner(videoEl, callback, onStatus = () => {}) {
  onDetect = callback;
  scanning = true;

  stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } },
    audio: false,
  });
  videoEl.srcObject = stream;
  await videoEl.play();

  if (supportsNativeDetector()) {
    try {
      detector = new BarcodeDetector({ formats: FORMATS });
      onStatus("Kamera bereit – Barcode ins Bild halten");
      loopNative(videoEl);
      return;
    } catch (e) {
      // fällt durch zum ZXing-Fallback
      console.warn("BarcodeDetector konnte nicht initialisiert werden, nutze Fallback.", e);
    }
  }

  onStatus("Lade Scanner-Modul …");
  await loopZxing(videoEl, onStatus);
}

function loopNative(videoEl) {
  if (!scanning) return;
  detector.detect(videoEl)
    .then(codes => {
      if (codes.length > 0 && scanning) {
        handleHit(codes[0].rawValue);
        return;
      }
      rafId = requestAnimationFrame(() => loopNative(videoEl));
    })
    .catch(() => {
      rafId = requestAnimationFrame(() => loopNative(videoEl));
    });
}

async function loopZxing(videoEl, onStatus) {
  // ZXing-WASM wird lazy nachgeladen (nur Geräte ohne native BarcodeDetector, z.B. iPhone/Desktop).
  try {
    const mod = await import("../vendor/zxing/reader.js");
    zxingReader = await mod.createReader(FORMATS);
  } catch (e) {
    onStatus("Scanner-Modul konnte nicht geladen werden. Bitte Barcode manuell eingeben.");
    console.error("ZXing-Fallback fehlgeschlagen:", e);
    return;
  }
  onStatus("Kamera bereit – Barcode ins Bild halten");

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const tick = async () => {
    if (!scanning) return;
    if (videoEl.videoWidth) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0);
      try {
        const result = await zxingReader.decode(canvas);
        if (result && scanning) {
          handleHit(result);
          return;
        }
      } catch { /* kein Treffer in diesem Frame, normal */ }
    }
    rafId = requestAnimationFrame(tick);
  };
  tick();
}

function handleHit(code) {
  scanning = false;
  if (navigator.vibrate) navigator.vibrate(80);
  const cb = onDetect;
  stopScanner();
  cb?.(code);
}

export function stopScanner() {
  scanning = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    stream = null;
  }
}

export function isScannerSupported() {
  return !!navigator.mediaDevices?.getUserMedia;
}
