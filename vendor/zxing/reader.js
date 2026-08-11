// reader.js — dünner Wrapper um die lokal vendorte ZXing-Bibliothek (UMD-Build).
// Wird nur auf Geräten ohne native BarcodeDetector-API nachgeladen (z.B. iPhone, Desktop-Browser).

const FORMAT_MAP = {
  ean_13: "EAN_13",
  ean_8: "EAN_8",
  upc_a: "UPC_A",
  upc_e: "UPC_E",
};

async function loadZXingGlobal() {
  if (window.ZXing) return window.ZXing;
  await new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./zxing-library.min.js", import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error("zxing-library.min.js konnte nicht geladen werden"));
    document.head.appendChild(script);
  });
  if (!window.ZXing) throw new Error("ZXing wurde geladen, ist aber nicht global verfügbar.");
  return window.ZXing;
}

export async function createReader(formats) {
  const ZXing = await loadZXingGlobal();
  const hints = new Map();
  const wanted = formats.map(f => ZXing.BarcodeFormat[FORMAT_MAP[f]]).filter(Boolean);
  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, wanted);
  const reader = new ZXing.MultiFormatReader();
  reader.setHints(hints);

  return {
    /** @param {HTMLCanvasElement} canvas */
    async decode(canvas) {
      const ctx = canvas.getContext("2d");
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const luminanceSource = new ZXing.RGBLuminanceSource(
        rgbaToLuminance(imgData.data, canvas.width, canvas.height),
        canvas.width,
        canvas.height
      );
      const binaryBitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(luminanceSource));
      try {
        const result = reader.decode(binaryBitmap);
        return result.getText();
      } catch {
        return null; // kein Treffer in diesem Frame — normal, kein echter Fehler
      } finally {
        reader.reset();
      }
    },
  };
}

function rgbaToLuminance(data, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) {
    out[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }
  return out;
}
