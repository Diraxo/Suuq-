// Emits web/src/lib/webText/{en,so,am}.ts from locales/*/translation.json — the website reads the same strings as the app.
// Run after editing a locale file:  node scripts/sync-web-text.js
const fs = require('fs');
for (const lang of ['en', 'so', 'am']) {
  const json = JSON.parse(fs.readFileSync(`locales/${lang}/translation.json`, 'utf8'));
  const body = `// GENERATED from locales/${lang}/translation.json — do not edit by hand (node scripts/sync-web-text.js).\n// tests/webText.test.ts fails if this drifts from the locale file.\n\nconst text: Record<string, unknown> = ${JSON.stringify(json, null, 1)};\n\nexport default text;\n`;
  fs.writeFileSync(`web/src/lib/webText/${lang}.ts`, body);
}
console.log('web text written');
