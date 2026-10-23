const path = require('path');
const { palette, canvas, font, phone, IOS } = require('./tokens');

function toFileUrl(absPath) {
  let p = absPath.replace(/\\/g, '/');
  if (!p.startsWith('/')) p = '/' + p;
  return 'file://' + encodeURI(p).replace(/#/g, '%23');
}

const INTER_DIR = path.resolve(__dirname, '../node_modules/@fontsource/inter/files');
const MONTSERRAT_DIR = path.resolve(__dirname, '../node_modules/@fontsource/montserrat/files');
const INPUT_DIR = path.resolve(__dirname, IOS ? '../.tmp/input-2x' : '../input');
const IOS_SCALE = 1.25;
const ICON_PATH = path.resolve(__dirname, '../../../assets/images/fursad-icon.png');

function fontFace(family, dir, slug, weight) {
  const woff2 = toFileUrl(path.join(dir, `${slug}-latin-${weight}-normal.woff2`));
  const woff = toFileUrl(path.join(dir, `${slug}-latin-${weight}-normal.woff`));
  return `
  @font-face {
    font-family: '${family}';
    font-style: normal;
    font-weight: ${weight};
    font-display: block;
    src: url('${woff2}') format('woff2'), url('${woff}') format('woff');
  }`;
}

const FONT_FACES = [
  ...[400, 500, 600, 700, 800, 900].map((w) => fontFace('Inter', INTER_DIR, 'inter', w)),
  // Brand wordmark: Montserrat ExtraBold, uppercase
  ...[700, 800].map((w) => fontFace('Montserrat', MONTSERRAT_DIR, 'montserrat', w)),
].join('\n');

const SCREEN_W = phone.width - phone.bezel * 2;
const NOTCH_H = IOS ? 56 : 28;
// All prepared input screenshots share this cropped aspect ratio (574x1240, status bar removed)
const SHOT_ASPECT = 574 / 1240;
const SCREEN_H = Math.round(SCREEN_W / SHOT_ASPECT);

function renderBlob(b) {
  return `<div class="blob" style="
    width:${b.size}px;height:${b.size}px;
    top:${b.top};left:${b.left};
    background:radial-gradient(circle at 50% 50%, ${b.color} 0%, transparent 70%);
    opacity:${b.opacity};
  "></div>`;
}

function renderSlide(slide) {
  const shotUrl = toFileUrl(path.join(INPUT_DIR, slide.screenshot));
  const iconUrl = toFileUrl(ICON_PATH);

  const headlineLines = slide.headline
    .map((line) => `<div class="line">${line}</div>`)
    .join('\n');

  const blobs = slide.blobs.map(renderBlob).join('\n');

  const phoneScale = IOS ? slide.phone.scale * IOS_SCALE : slide.phone.scale;
  // Scaling is about the centre, so push the phone down by the amount it grows upward.
  const phoneTop = IOS ? slide.phone.offsetY + Math.round(((phoneScale - slide.phone.scale) * 1370) / 2) + 40 : slide.phone.offsetY;
  const phoneTransform = `translate(-50%, 0) translate(${slide.phone.offsetX}px, 0) rotate(${slide.phone.rotate}deg) scale(${phoneScale})`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  ${FONT_FACES}

  * { margin:0; padding:0; box-sizing:border-box; }

  html, body { width:${canvas.width}px; height:${canvas.height}px; overflow:hidden; }

  body {
    font-family: ${font.family};
    background: ${slide.background};
    position: relative;
  }

  .grain {
    position:absolute; inset:0;
    opacity:0.05;
    mix-blend-mode:overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
  }

  .blob {
    position:absolute;
    border-radius:50%;
    filter: blur(90px);
    transform: translate(-50%, -50%);
    pointer-events:none;
  }

  .brand {
    position:absolute;
    top:64px; left:64px;
    display:flex; align-items:center; gap:16px;
    z-index:5;
  }
  .brand img {
    width:52px; height:52px; border-radius:14px;
    box-shadow:0 6px 16px rgba(0,0,0,0.25);
  }
  .brand span {
    color:#fff;
    font-family: 'Montserrat', 'Inter', -apple-system, 'Segoe UI', sans-serif;
    font-weight:800;
    font-size:30px;
    text-transform:uppercase;
    letter-spacing:1px;
    opacity:0.96;
  }

  .headline {
    position:absolute;
    top:${slide.headlineTop}px;
    left:64px; right:64px;
    z-index:5;
    text-align:${slide.headlineAlign};
  }
  .headline .eyebrow {
    color:${palette.white};
    opacity:0.78;
    font-weight:700;
    font-size:26px;
    letter-spacing:4px;
    margin-bottom:18px;
  }
  .headline .line {
    color:#fff;
    font-weight:800;
    font-size:80px;
    line-height:0.98;
    letter-spacing:-2px;
    text-shadow: 0 4px 30px rgba(0,0,0,0.28);
  }

  .phone {
    position:absolute;
    top:${phoneTop}px;
    left:50%;
    width:${phone.width}px;
    transform: ${phoneTransform};
    transform-origin: 50% 50%;
  }

  .phone-body {
    position:relative;
    background: linear-gradient(160deg, #34343e 0%, #101018 55%, #050507 100%);
    border-radius:${phone.outerRadius}px;
    padding:${phone.bezel}px;
    box-shadow:
      0 70px 120px -30px rgba(2,6,23,0.55),
      0 30px 70px -20px rgba(0,0,0,0.45),
      inset 0 0 0 1.5px rgba(255,255,255,0.06);
  }

  .screen {
    background:#000;
    border-radius:${phone.screenRadius}px;
    overflow:hidden;
    display:flex;
    flex-direction:column;
  }

  .notch {
    height:${NOTCH_H}px;
    background:#050507;
    display:flex;
    align-items:center;
    justify-content:center;
    flex-shrink:0;
  }
  .notch .dot {
    width:${IOS ? 96 : 10}px; height:${IOS ? 20 : 10}px; border-radius:${IOS ? 10 : 5}px;
    background:${IOS ? '#000' : '#1c1c22'};
    box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
  }

  .shot-wrap {
    flex:1;
    overflow:hidden;
    position:relative;
  }
  .shot-wrap img {
    width:100%; height:100%;
    object-fit:cover;
    object-position: top center;
    display:block;
  }

  .side-btn {
    position:absolute;
    right:-3px;
    width:4px;
    background:#1c1c22;
    border-radius:2px;
  }
  .btn-power { top:220px; height:90px; }
  .btn-vol-up { top:340px; height:60px; }
  .btn-vol-down { top:410px; height:60px; }

  ${IOS ? `
  .phone-body {
    background: linear-gradient(145deg, #d9d6cf 0%, #8f8c86 18%, #3a3936 50%, #8f8c86 82%, #d9d6cf 100%);
    box-shadow:
      0 70px 120px -30px rgba(2,6,23,0.55),
      0 30px 70px -20px rgba(0,0,0,0.45),
      inset 0 0 0 2px rgba(255,255,255,0.25),
      inset 0 0 0 6px rgba(0,0,0,0.55);
  }
  .screen { background:#000; position:relative; }
  .notch { height:${NOTCH_H}px; position:relative; }
  .notch .dot { position:absolute; top:12px; left:50%; transform:translateX(-50%); width:118px; height:34px; border-radius:17px; background:#000; }
  .notch .time { position:absolute; left:52px; top:14px; color:#fff; font-weight:700; font-size:22px; letter-spacing:0.3px; }
  .notch .status { position:absolute; right:46px; top:17px; display:flex; gap:8px; align-items:center; }
  .notch .bars { display:flex; gap:3px; align-items:flex-end; }
  .notch .bars i { width:5px; background:#fff; border-radius:1px; display:block; }
  .notch .batt { width:36px; height:17px; border:2px solid rgba(255,255,255,0.6); border-radius:6px; padding:1.5px; }
  .notch .batt i { display:block; height:100%; width:78%; background:#fff; border-radius:3px; }
  .home-ind { position:absolute; bottom:10px; left:50%; transform:translateX(-50%); width:180px; height:6px; border-radius:3px; background:rgba(15,23,42,0.85); z-index:3; }
  .side-btn { background:linear-gradient(90deg,#6b6862,#bdbab3); }
  .side-btn.left { right:auto; left:-3px; }
  .btn-action { top:170px; height:44px; }
  .btn-vol-up { top:250px; height:84px; }
  .btn-vol-down { top:350px; height:84px; }
  .btn-power { top:290px; height:130px; }
  ` : ''}
</style>
</head>
<body>
  <div class="grain"></div>
  ${blobs}

  <div class="brand">
    <img src="${iconUrl}" />
    <span>SUUQIYE</span>
  </div>

  <div class="headline">
    <div class="eyebrow">${slide.eyebrow}</div>
    ${headlineLines}
  </div>

  <div class="phone">
    <div class="phone-body">
      <div class="side-btn btn-power"></div>
      ${IOS ? '<div class="side-btn left btn-action"></div>' : ''}
      <div class="side-btn ${IOS ? 'left ' : ''}btn-vol-up"></div>
      <div class="side-btn ${IOS ? 'left ' : ''}btn-vol-down"></div>
      <div class="screen" style="width:${SCREEN_W}px;height:${SCREEN_H}px;">
        <div class="notch">${IOS ? '<span class="time">9:41</span>' : ''}<div class="dot"></div>${IOS ? '<div class="status"><div class="bars"><i style="height:6px"></i><i style="height:9px"></i><i style="height:12px"></i><i style="height:15px"></i></div><div class="batt"><i></i></div></div>' : ''}</div>
        <div class="shot-wrap">
          <img src="${shotUrl}" />
        </div>
        
      </div>
    </div>
  </div>
</body>
</html>`;
}

module.exports = { renderSlide };
