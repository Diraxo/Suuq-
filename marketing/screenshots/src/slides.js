const { palette } = require('./tokens');

// Six-slide Fursad Google Play campaign.
// Every headline is grounded in a verified feature (see AUDIT.md) — no invented
// stats, no geography, no features that don't exist in the current app.
const slides = [
  {
    id: '01-discover',
    screenshot: '01-home.png',
    eyebrow: 'BROWSE',
    headline: ['DISCOVER WHAT', "YOU'RE LOOKING FOR."],
    background: `linear-gradient(135deg, ${palette.indigo700} 0%, ${palette.indigo500} 100%)`,
    blobs: [
      { color: palette.coral500, top: '72%', left: '78%', size: 620, opacity: 0.35 },
      { color: palette.indigo400, top: '6%', left: '-10%', size: 520, opacity: 0.4 },
    ],
    phone: { offsetX: 0, offsetY: 480, rotate: 0, scale: 1 },
    headlineAlign: 'left',
    headlineTop: 150,
  },
  {
    id: '02-find',
    screenshot: '02-search.png',
    eyebrow: 'SEARCH',
    headline: ['FIND IT', 'FAST.'],
    background: `linear-gradient(140deg, ${palette.indigo600} 0%, ${palette.indigo400} 55%, ${palette.coral400} 100%)`,
    blobs: [
      { color: palette.coral500, top: '4%', left: '70%', size: 560, opacity: 0.4 },
      { color: palette.indigo700, top: '80%', left: '-8%', size: 600, opacity: 0.35 },
    ],
    phone: { offsetX: 76, offsetY: 460, rotate: -4, scale: 0.98 },
    headlineAlign: 'left',
    headlineTop: 150,
  },
  {
    id: '03-sell',
    screenshot: '03-post.png',
    eyebrow: 'SELL',
    headline: ['LIST IT.', 'SELL IT. DONE.'],
    background: `linear-gradient(135deg, ${palette.coral600} 0%, ${palette.coral500} 50%, ${palette.indigo600} 100%)`,
    blobs: [
      { color: palette.indigo500, top: '6%', left: '-8%', size: 560, opacity: 0.38 },
      { color: palette.coral300, top: '78%', left: '76%', size: 580, opacity: 0.32 },
    ],
    phone: { offsetX: -76, offsetY: 460, rotate: 4, scale: 0.98 },
    headlineAlign: 'right',
    headlineTop: 150,
  },
  {
    id: '04-connect',
    screenshot: '04-chat.png',
    eyebrow: 'MESSAGE & OFFER',
    headline: ['MESSAGE SELLERS.', 'MAKE OFFERS.'],
    background: `linear-gradient(165deg, ${palette.slate950} 0%, ${palette.indigo700} 62%, ${palette.coral600} 130%)`,
    blobs: [
      { color: palette.indigo400, top: '2%', left: '65%', size: 600, opacity: 0.45 },
      { color: palette.coral500, top: '82%', left: '4%', size: 520, opacity: 0.3 },
    ],
    phone: { offsetX: 48, offsetY: 460, rotate: -7, scale: 0.97 },
    headlineAlign: 'left',
    headlineTop: 150,
  },
  {
    id: '05-save',
    screenshot: '05-favorites.png',
    eyebrow: 'FAVORITES',
    headline: ['KEEP YOUR', 'FAVORITES CLOSE.'],
    background: `linear-gradient(135deg, ${palette.indigo600} 0%, ${palette.coral400} 100%)`,
    blobs: [
      { color: palette.coral300, top: '4%', left: '-6%', size: 560, opacity: 0.4 },
      { color: palette.indigo400, top: '78%', left: '72%', size: 600, opacity: 0.35 },
    ],
    phone: { offsetX: 0, offsetY: 460, rotate: 2, scale: 1 },
    headlineAlign: 'left',
    headlineTop: 150,
  },
  {
    id: '06-trust',
    screenshot: '06-seller.png',
    eyebrow: 'RATINGS & REVIEWS',
    headline: ['BUY WITH', 'CONFIDENCE.'],
    background: `linear-gradient(135deg, ${palette.indigo700} 0%, ${palette.coral600} 100%)`,
    blobs: [
      { color: palette.coral400, top: '6%', left: '68%', size: 620, opacity: 0.4 },
      { color: palette.indigo400, top: '80%', left: '-6%', size: 620, opacity: 0.4 },
    ],
    phone: { offsetX: 0, offsetY: 420, rotate: 0, scale: 1.06 },
    headlineAlign: 'center',
    headlineTop: 140,
  },
];

module.exports = { slides };
