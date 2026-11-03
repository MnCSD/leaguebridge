/**
 * Renders resources/icon.svg (and icon-small.svg for tiny sizes) into the PNG/ICO files the app
 * uses, with Electron's own browser engine (so no image library is needed).
 *
 *   node scripts/electron-vite.mjs ... is not needed; run:  npm run icons -w apps/desktop
 *   Optional: a path as first argument also writes a preview sheet PNG there.
 *
 * Outputs in resources/: icon.png (512), icon.ico (16-256, for Windows), tray.png (16) + tray@2x.png (32).
 */
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const res = path.join(__dirname, '..', 'resources');
const previewOut = process.argv.find((a) => a.endsWith('.png') && !a.includes('electron'));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 512,
    height: 512,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true },
  });

  const toDataUrl = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const capture = async (html, width, height) => {
    win.setContentSize(width, height);
    await win.loadURL(`data:text/html;base64,${Buffer.from(html).toString('base64')}`);
    await new Promise((r) => setTimeout(r, 250));
    return win.webContents.capturePage({ x: 0, y: 0, width, height });
  };
  /** Render an SVG big (512) and scale down with high quality; small sizes stay crisp. */
  const render = async (svg, size) => {
    const img = await capture(`<body style="margin:0;background:transparent"><img src="${toDataUrl(svg)}" width="512" height="512">`, 512, 512);
    return size === 512 ? img : img.resize({ width: size, height: size, quality: 'best' });
  };

  const master = fs.readFileSync(path.join(res, 'icon.svg'), 'utf8');
  const small = fs.readFileSync(path.join(res, 'icon-small.svg'), 'utf8');

  const big = await render(master, 512);
  fs.writeFileSync(path.join(res, 'icon.png'), big.toPNG());

  // Windows .ico: several sizes in one file; small ones use the simplified artwork.
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) pngs.push((await render(s <= 32 ? small : master, s)).toPNG());
  fs.writeFileSync(path.join(res, 'icon.ico'), buildIco(sizes, pngs));
  fs.writeFileSync(path.join(res, 'tray.png'), (await render(small, 16)).toPNG());
  fs.writeFileSync(path.join(res, 'tray@2x.png'), (await render(small, 32)).toPNG());

  if (previewOut) {
    // A sheet with every size on a dark and a light background, to check legibility.
    const cells = [16, 24, 32, 48, 96, 192]
      .map((s) => `<img src="${toDataUrl(s <= 32 ? small : master)}" width="${s}" height="${s}">`)
      .join('');
    const row = (bg) => `<div style="display:flex;align-items:center;gap:22px;padding:18px 24px;background:${bg}">${cells}</div>`;
    const sheet = await capture(`<body style="margin:0">${row('#1b1f27')}${row('#e9ecf1')}</body>`, 560, 460);
    fs.writeFileSync(previewOut, sheet.toPNG());
  }
  console.log('icons written to', res);
  app.quit();
});

/** ICO container holding PNG images (supported since Windows Vista). */
function buildIco(sizes, pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(sizes.length, 4);
  const entries = [];
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s >= 256 ? 0 : s, 0); // 0 means 256
    e.writeUInt8(s >= 256 ? 0 : s, 1);
    e.writeUInt8(0, 2); // palette
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(pngs[i].length, 8);
    e.writeUInt32LE(offset, 12);
    offset += pngs[i].length;
    entries.push(e);
  });
  return Buffer.concat([header, ...entries, ...pngs]);
}
