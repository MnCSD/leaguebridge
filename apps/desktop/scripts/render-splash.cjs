/**
 * Renders scripts/splash/splash.html into resources/install-splash.gif (the installer splash).
 * Run with: npm run splash -w apps/desktop   (optionally pass a .png path to also save one frame)
 *
 * How: load the page offscreen, pause all CSS animations, and for each frame jump them to an exact
 * time (Web Animations API), capture the page, then encode the frames as a looping GIF.
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const W = 480;
const H = 300;
const LOOP_MS = 2000; // must match --loop in splash.html
const FPS = 20;
const FRAMES = (LOOP_MS / 1000) * FPS;

const out = path.join(__dirname, '..', 'resources', 'install-splash.gif');
const previewPng = process.argv.find((a) => a.endsWith('.png'));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: W,
    height: H,
    useContentSize: true,
    frame: false,
    webPreferences: { offscreen: true },
  });
  await win.loadFile(path.join(__dirname, 'splash', 'splash.html'));
  await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)');

  const frames = [];
  for (let i = 0; i < FRAMES; i++) {
    const t = (i * LOOP_MS) / FRAMES;
    // Jump every animation to time t, then wait for two paints so the frame is on screen.
    await win.webContents.executeJavaScript(`
      document.getAnimations().forEach((a) => { a.pause(); a.currentTime = ${t}; });
      new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))));
    `);
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    const sized = img.getSize().width === W ? img : img.resize({ width: W, height: H, quality: 'best' });
    if (i === 0 && previewPng) fs.writeFileSync(previewPng, sized.toPNG());
    frames.push(bgraToRgba(sized.toBitmap()));
  }

  // One palette for all frames (sampled from several), so colours don't flicker between frames.
  const sample = new Uint8Array(W * H * 4 * 6);
  for (let k = 0; k < 6; k++) sample.set(frames[Math.floor((k * FRAMES) / 6)], k * W * H * 4);
  const palette = quantize(sample, 256);

  const gif = GIFEncoder();
  for (const rgba of frames) {
    gif.writeFrame(applyPalette(dither(rgba), palette), W, H, { palette, delay: 1000 / FPS, repeat: 0 });
  }
  gif.finish();
  fs.writeFileSync(out, Buffer.from(gif.bytes()));
  console.log(`wrote ${out} (${FRAMES} frames, ${(gif.bytes().length / 1024).toFixed(0)} KB)`);
  app.quit();
});

/**
 * Ordered (Bayer 4x4) dithering: nudges each pixel by a tiny fixed pattern before it's mapped to
 * the 256-colour palette. Hides the visible rings ("banding") that smooth dark gradients get in a
 * GIF. The pattern is the same in every frame, so it doesn't shimmer.
 */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
// Max nudge in colour steps (out of 255). The current design is nearly flat, so only a touch is
// needed; higher values show as a visible texture.
const STRENGTH = 2;
function dither(rgba) {
  const out = new Uint8Array(rgba.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const n = (BAYER[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * STRENGTH;
      out[i] = clamp(rgba[i] + n);
      out[i + 1] = clamp(rgba[i + 1] + n);
      out[i + 2] = clamp(rgba[i + 2] + n);
      out[i + 3] = 255;
    }
  }
  return out;
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** nativeImage bitmaps are BGRA; the GIF encoder wants RGBA. */
function bgraToRgba(buf) {
  const px = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    px[i] = buf[i + 2];
    px[i + 1] = buf[i + 1];
    px[i + 2] = buf[i];
    px[i + 3] = 255;
  }
  return px;
}
