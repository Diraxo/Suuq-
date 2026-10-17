import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Source-contract checks for UI wiring that cannot run under Node (React Native
// components). They guard against regressions in structure only — the behaviour
// itself is covered by the logic tests, and the on-device behaviour by the manual
// checklist in the final report.
const root = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');
const mobileHome = read('app', '(tabs)', 'home.tsx');
const webHome = read('web', 'src', 'app', 'page.tsx');

test('the "Updated just now" success notice is gone from both Home screens and every locale', () => {
  for (const src of [mobileHome, webHome]) {
    assert.doesNotMatch(src, /updatedLabel|UPDATED_NOTICE_MS|showUpdated|Updated just now/);
  }
  for (const l of ['en', 'so', 'am']) assert.doesNotMatch(read('locales', l, 'translation.json'), /Updated just now/i);
});

test('refresh feedback is a spinner while loading and a Retry only on failure (both platforms)', () => {
  assert.match(mobileHome, /ActivityIndicator/);
  assert.match(mobileHome, /refresh\.failed/);
  assert.match(mobileHome, /homeRefresh\.refresh\(\)/);
  assert.match(webHome, /animate-spin/);
  assert.match(webHome, /refresh\.failed/);
  assert.match(webHome, /Try again/);
  // The pull spinner and the inline spinner never show together.
  assert.match(mobileHome, /pulling \? null/);
});

test('keyboard handling uses measured avoidance, never a hard-coded device offset', () => {
  const sheet = read('components', 'KeyboardSheet.tsx');
  const search = read('app', '(tabs)', 'search.tsx');
  for (const src of [sheet, search]) {
    assert.match(src, /KeyboardAvoidingView/);
    assert.doesNotMatch(src, /keyboardVerticalOffset\s*=\s*\{?\s*-?\d/, 'no fixed keyboard offset');
    assert.doesNotMatch(src, /\b(?:height|maxHeight|top|bottom)\s*:\s*\d{3,}/, 'no fixed pixel layout');
  }
  assert.match(search, /keyboardShouldPersistTaps="handled"/);
  assert.match(read('app', '(tabs)', '_layout.tsx'), /tabBarHideOnKeyboard:\s*true/);
  // Typing must not unmount the result list (that caused the jump/flicker).
  assert.doesNotMatch(search, /setSearching|Skeleton/);
});

test('every place picker sheet on mobile shares the keyboard-safe sheet', () => {
  assert.match(mobileHome, /<KeyboardSheet/);
  assert.match(read('components', 'CityPicker.tsx'), /<KeyboardSheet/);
});

test('both platforms show the same location navigation and typo suggestions', () => {
  const webFilter = read('web', 'src', 'components', 'LocationFilter.tsx');
  assert.match(mobileHome, /scopeBack\(/);
  assert.match(webFilter, /scopeBack\(/);
  assert.match(read('components', 'LocationList.tsx'), /searchLocations\(/);
  assert.match(read('web', 'src', 'components', 'LocationPicker.tsx'), /searchLocations\(/);
  assert.match(read('app', '(tabs)', 'search.tsx'), /searchLocations\(/);
  assert.match(read('web', 'src', 'app', 'search', 'page.tsx'), /searchLocations\(/);
});

test('both platforms build the feed request from the one shared function and never fork the rules', () => {
  // Filtering and ordering happen in the database (home_feed); the screens only turn their selections into a request.
  assert.match(mobileHome, /buildHomeQuery\(/);
  assert.match(webHome, /buildHomeQuery\(/);
  for (const src of [mobileHome, webHome]) assert.doesNotMatch(src, /\.sort\(|\.filter\(\(l\)/, 'no local sorting/filtering of listings in the screens');
});

test('mobile Home reset hands the browse store no scope port, so Search\'s saved location is untouched', () => {
  assert.match(read('store', 'homeBrowse.ts'), /createHomeBrowseStore\(\)/);
});

test('the location directory request still asks only for approved places and now reads their status', () => {
  assert.match(read('store', 'locations.ts'), /\.eq\('status', 'approved'\)/);
  assert.match(read('web', 'src', 'services', 'locations.ts'), /\.eq\('status', 'approved'\)/);
});
