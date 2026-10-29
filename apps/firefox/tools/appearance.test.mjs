import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { randomUUID } from 'node:crypto';

const source = readFileSync(new URL('../kivo/KivoData.sys.mjs', import.meta.url), 'utf8').replace(/^export /gm, '');
const session = '12345678-1234-4234-8234-123456789abc';
const theme = { version: 1, preset: 'clean', mode: 'light', accent: '#008c59', font: 'readex', corners: 'round', sites: 'theme', background: { kind: 'color', color: '#f5f4f0' }, start: { buddy: true, clock: true, fact: true, tiles: true } };
const photoTheme = { ...theme, background: { kind: 'photo', dim: 15, blur: 0, version: 10 } };

function host() {
  const encode = value => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
  const files = new Map([
    ['profile.json', encode({ avatar: { kind: 'photo', version: 10 } })],
    ['avatar.png', encode('original avatar')],
    ['background.jpg', encode('original background')],
    ['widgets.json', encode([])],
    ['picked.png', encode('input image')],
  ]);
  let stored = JSON.stringify(photoTheme);
  let failFile = null;
  const picker = { init() {}, appendFilters() {}, file: { path: 'picked.png' }, open(done) { done(0); } };
  const win = {
    browsingContext: {}, Blob,
    async createImageBitmap() { return { width: 500, height: 400, close() {} }; },
    document: { createElementNS() { return { getContext() { return { drawImage() {} }; }, toBlob(done, mime) { done(new Blob(['normalized image'], { type: mime })); } }; } },
  };
  const context = {
    TextEncoder, Uint8Array, Blob, URLSearchParams, btoa,
    ChromeUtils: { defineESModuleGetters() {} },
    Cc: { '@mozilla.org/filepicker;1': { createInstance: () => picker } },
    Ci: { nsIFilePicker: { modeOpen: 0, filterImages: 1, returnOK: 0 } },
    Services: {
      uuid: { generateUUID: () => `{${randomUUID()}}` },
      prefs: { getStringPref: () => stored, setStringPref: (_, value) => { stored = value; }, clearUserPref: () => { stored = ''; } },
      obs: { notifyObservers() {} },
    },
    IOUtils: {
      exists: async path => files.has(path),
      read: async path => { if (!files.has(path)) throw new Error('missing'); return files.get(path).slice(); },
      write: async (path, bytes) => { if (path === failFile) { failFile = null; throw new Error('Disk write failed'); } files.set(path, bytes.slice()); },
      async writeJSON(path, value) { await this.write(path, encode(value)); },
      remove: async path => { files.delete(path); },
      makeDirectory: async () => {},
    },
    readJsonFile: async path => files.has(path) ? JSON.parse(new TextDecoder().decode(files.get(path))) : undefined,
    savedProfile: async () => ({ id: 'default', name: 'Omar', color: JSON.parse(stored).accent, avatar: JSON.parse(new TextDecoder().decode(files.get('profile.json'))).avatar }),
    win,
  };
  const handle = runInNewContext(`${source}\nkivoPath = (file = '') => file; readJson = readJsonFile; readProfile = savedProfile; browserWindow = () => win; handle;`, context);
  const browser = {};
  return {
    files,
    theme: () => JSON.parse(stored),
    fail: file => { failFile = file; },
    request: (type, payload = {}, from = browser) => handle({ type, payload }, from).then(result => JSON.parse(JSON.stringify(result))),
  };
}

test('picking and canceling photos preserves saved pictures, avatar, and theme', async () => {
  const h = host();
  const before = new Map(h.files);
  const avatar = await h.request('avatar.pickPhoto', { session, preview: true });
  const background = await h.request('background.pickPhoto', { session, preview: true });
  assert.match(avatar.url, /^data:image\/png;base64,/);
  assert.match(background.url, /^data:image\/jpeg;base64,/);
  assert.deepEqual(h.files, before);
  await h.request('appearance.cancel', { session });
  assert.deepEqual(h.files, before);
  assert.deepEqual(h.theme(), photoTheme);
  await assert.rejects(h.request('appearance.save', { session, theme, avatar: { kind: 'photo', version: avatar.version } }), /expired/);
});

test('Save commits draft photos and settings together', async () => {
  const h = host();
  const avatar = await h.request('avatar.pickPhoto', { session, preview: true });
  const background = await h.request('background.pickPhoto', { session, preview: true });
  const draft = { ...theme, mode: 'dark', background: { kind: 'photo', dim: 20, blur: 3, version: background.version } };
  const result = await h.request('appearance.save', { session, theme: draft, avatar: { kind: 'photo', version: avatar.version }, widgets: [] });
  assert.equal(result.profile.avatar.version, avatar.version);
  assert.deepEqual(result.theme, draft);
  assert.deepEqual(h.theme(), draft);
  assert.equal(new TextDecoder().decode(h.files.get('avatar.png')), 'normalized image');
  assert.equal(new TextDecoder().decode(h.files.get('background.jpg')), 'normalized image');
  assert.deepEqual(result.widgets, []);
});

test('a failed Save restores files and leaves the draft available for retry', async () => {
  const h = host();
  const before = new Map(h.files);
  const avatar = await h.request('avatar.pickPhoto', { session, preview: true });
  const draft = { session, theme, avatar: { kind: 'photo', version: avatar.version }, widgets: [] };
  h.fail('widgets.json');
  await assert.rejects(h.request('appearance.save', draft), /Disk write failed/);
  assert.deepEqual(h.files, before);
  assert.deepEqual(h.theme(), photoTheme);
  const saved = await h.request('appearance.save', draft);
  assert.equal(saved.profile.avatar.version, avatar.version);
  assert.deepEqual(h.theme(), theme);
});

test('invalid settings and photos from another tab cannot overwrite saved settings', async () => {
  const h = host();
  const before = new Map(h.files);
  const photo = await h.request('avatar.pickPhoto', { session, preview: true });
  await assert.rejects(h.request('appearance.save', { session, theme: { ...theme, accent: 'red' }, avatar: { kind: 'initial' } }), /accent/);
  await assert.rejects(h.request('appearance.save', { session, theme, avatar: { kind: 'photo', version: photo.version } }, {}), /expired/);
  assert.deepEqual(h.files, before);
  assert.deepEqual(h.theme(), photoTheme);
});

test('discarding an older session does not discard the current photo draft', async () => {
  const h = host();
  const photo = await h.request('avatar.pickPhoto', { session, preview: true });
  await h.request('appearance.cancel', { session: '87654321-1234-4234-8234-123456789abc' });
  const saved = await h.request('appearance.save', { session, theme, avatar: { kind: 'photo', version: photo.version } });
  assert.equal(saved.profile.avatar.version, photo.version);
});

test('home presets preserve the original home and support save, rename, delete, and reload', async () => {
  const h = host();
  const widgets = [{ id: 'search', type: 'search', x: 0, y: 4, w: 12, h: 1, settings: {} }];
  h.files.set('widgets.json', new TextEncoder().encode(JSON.stringify(widgets)));
  const first = await h.request('homePresets.list');
  assert.equal(first.presets[0].name, 'My home');
  assert.deepEqual(first.presets[0].widgets, widgets);
  const home = { width: 1600, rowHeight: 50, columnGap: 20, rowGap: 16, padding: 24 };
  const saved = await h.request('homePresets.save', { preset: { name: 'My workspace', widgets, home } });
  assert.equal(saved.presets.length, 2);
  const preset = saved.presets[1];
  await h.request('homePresets.save', { preset: { ...preset, name: 'Daily home' } });
  const loaded = await h.request('homePresets.list');
  assert.equal(loaded.presets[1].name, 'Daily home');
  assert.deepEqual(loaded.presets[1].home, home);
  await h.request('homePresets.delete', { id: preset.id });
  assert.equal((await h.request('homePresets.list')).presets.length, 1);
  await h.request('homePresets.delete', { id: 'original-home' });
  assert.deepEqual((await h.request('homePresets.list')).presets, []);
});

test('applying a home preset backs up the previous home and rolls back a failed switch', async () => {
  const h = host();
  await h.request('homePresets.list');
  const before = new Map(h.files);
  const widgets = [{ id: 'search', type: 'search', x: 6, y: 3, w: 12, h: 1, settings: { simple: true } }, { id: 'shortcuts', type: 'shortcuts', x: 6, y: 5, w: 12, h: 3, settings: { source: 'top', showTitle: false } }];
  const draft = { session, theme: { ...photoTheme, home: { width: 1280, rowHeight: 44, columnGap: 12, rowGap: 12, padding: 32 } }, avatar: { kind: 'photo', version: 10 }, widgets };
  h.fail('home-presets.json');
  await assert.rejects(h.request('homePresets.apply', draft), /Disk write failed/);
  assert.deepEqual(h.files, before);
  assert.deepEqual(h.theme(), photoTheme);
  await h.request('homePresets.apply', draft);
  const library = (await h.request('homePresets.list')).presets;
  assert.equal(library.length, 2);
  assert.deepEqual(library.find(preset => preset.id === 'previous-home').widgets, []);
  assert.deepEqual(library.find(preset => preset.id === 'original-home').widgets, []);
  assert.equal(h.theme().accent, photoTheme.accent);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(h.files.get('widgets.json'))), widgets);
});

test('invalid home preset dimensions and widget fields cannot reach storage', async () => {
  const h = host();
  await h.request('homePresets.list');
  const before = new Map(h.files);
  await assert.rejects(h.request('homePresets.save', { preset: { name: 'Bad', widgets: [], home: { width: -1 } } }), /dimensions/);
  assert.deepEqual(h.files, before);
  const result = await h.request('homePresets.save', { preset: { name: 'Safe', widgets: [{ id: 'search', type: 'search', x: 0, y: 0, w: 12, h: 1, settings: { simple: true, css: 'body{}' } }], home: {} } });
  assert.deepEqual(result.presets.at(-1).widgets[0].settings, { simple: true });
});
