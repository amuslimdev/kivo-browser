// Kivo's taskbar (KivoTaskbar.sys.mjs) on an isolated profile: the real HICONs and AppUserModel properties of an
// invisible test window, the Jump List lines and Kivo.exe writing them, and opening a workspace from the list.
// No user windows, profiles, taskbar pins or shortcuts are changed. The Jump List goes to the AppUserModelID of
// the tested package (never Kivo.Browser, the installed Kivo's) and is deleted at the end.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { launch } from './kivo-bidi.mjs';

const { values: args } = parseArgs({ options: { kivo: { type: 'string' }, out: { type: 'string' }, module: { type: 'string' } } });
if (!args.kivo || !args.out) throw new Error('taskbar-check.mjs --kivo <Kivo.exe> --out <directory> [--module <resource or file URL>]');
const output = resolve(args.out);
mkdirSync(output, { recursive: true });
const profile = mkdtempSync(join(output, 'profile-'));
if (!resolve(profile).startsWith(output + sep)) throw new Error('Unexpected test profile');
const kivo = await launch(args.kivo, {}, { profile });
const results = [];
let failed = false;
function check(name, ok) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (!ok) throw new Error(name);
}
const evaluate = expression => kivo.evaluate(expression);
const json = expression => evaluate(`(async () => JSON.stringify(await (${expression})))()`).then(JSON.parse);
try {
  let module = args.module ?? 'moz-src:///browser/components/kivo/KivoTaskbar.sys.mjs';
  if (module.startsWith('file:')) {
    const directory = new URL('.', module).href;
    const name = new URL(module).pathname.split('/').at(-1);
    await evaluate(`Services.io.getProtocolHandler('resource').QueryInterface(Ci.nsIResProtocolHandler).setSubstitution('kivo-taskbar-test',Services.io.newURI(${JSON.stringify(directory)})); true`);
    module = 'resource://kivo-taskbar-test/' + name;
  }
  check('privileged taskbar module loads', await evaluate(`window.taskbarModule = ChromeUtils.importESModule(${JSON.stringify(module)}); !!taskbarModule.KivoTaskbar`));
  await evaluate(`(async () => {
    const { ctypes: C } = ChromeUtils.importESModule('resource://gre/modules/ctypes.sys.mjs');
    const user = C.open('user32.dll');
    const gdi = C.open('gdi32.dll');
    const shell = C.open('shell32.dll');
    const ole = C.open('ole32.dll');
    const d = (lib, name, ret, ...types) => lib.declare(name, C.winapi_abi, ret, ...types);
    const create = d(user, 'CreateWindowExW', C.voidptr_t, C.uint32_t, C.char16_t.ptr, C.char16_t.ptr, C.uint32_t, C.int, C.int, C.int, C.int, C.voidptr_t, C.voidptr_t, C.voidptr_t, C.voidptr_t);
    const destroy = d(user, 'DestroyWindow', C.bool, C.voidptr_t);
    const send = d(user, 'SendMessageW', C.intptr_t, C.voidptr_t, C.uint32_t, C.uintptr_t, C.intptr_t);
    const draw = d(user, 'DrawIconEx', C.bool, C.voidptr_t, C.int, C.int, C.voidptr_t, C.int, C.int, C.uint32_t, C.voidptr_t, C.uint32_t);
    const dcNew = d(gdi, 'CreateCompatibleDC', C.voidptr_t, C.voidptr_t);
    const dcDelete = d(gdi, 'DeleteDC', C.bool, C.voidptr_t);
    const select = d(gdi, 'SelectObject', C.voidptr_t, C.voidptr_t, C.voidptr_t);
    const objectDelete = d(gdi, 'DeleteObject', C.bool, C.voidptr_t);
    const dib = d(gdi, 'CreateDIBSection', C.voidptr_t, C.voidptr_t, C.voidptr_t, C.uint32_t, C.voidptr_t.ptr, C.voidptr_t, C.uint32_t);
    const GUID = new C.StructType('GUID', [{d1:C.uint32_t},{d2:C.uint16_t},{d3:C.uint16_t},{d4:C.uint8_t.array(8)}]);
    const KEY = new C.StructType('PROPERTYKEY', [{format:GUID},{id:C.uint32_t}]);
    const VARIANT = new C.StructType('PROPVARIANT', [{type:C.uint16_t},{r1:C.uint16_t},{r2:C.uint16_t},{r3:C.uint16_t},{value:C.voidptr_t},{rest:C.voidptr_t}]);
    const guid = text => {
      const h = text.replace(/-/g,''); const tail = [];
      for (let i = 16; i < 32; i += 2) tail.push(parseInt(h.slice(i,i+2),16));
      return new GUID(parseInt(h.slice(0,8),16), parseInt(h.slice(8,12),16), parseInt(h.slice(12,16),16), C.uint8_t.array(8)(tail));
    };
    const storeOf = d(shell, 'SHGetPropertyStoreForWindow', C.int32_t, C.voidptr_t, GUID.ptr, C.voidptr_t.ptr);
    const clear = d(ole, 'PropVariantClear', C.int32_t, VARIANT.ptr);
    const hwnd = create(0, 'STATIC', 'Kivo taskbar test', 0, 0, 0, 32, 32, null, null, null, null);
    if (hwnd.isNull()) throw new Error('No native test window');
    const listeners = {};
    const fakeWindow = {
      document, Image, closed: false,
      docShell: { treeOwner: { QueryInterface: () => ({ nativeHandle: C.cast(hwnd, C.uintptr_t).value.toString() }) } },
      addEventListener: (name, fn) => { listeners[name] = fn; },
    };
    const avatar = document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
    avatar.width = avatar.height = 64;
    const ctx = avatar.getContext('2d');
    ctx.fillStyle = '#ff0066'; ctx.fillRect(0,0,64,64);
    const blob = await new Promise(resolve => avatar.toBlob(resolve));
    const path = PathUtils.join(PathUtils.profileDir, 'test-avatar.png');
    await IOUtils.write(path, new Uint8Array(await blob.arrayBuffer()));
    const p = { id: 99, name: 'Taskbar Test', path: PathUtils.profileDir, avatar: 'pink.png', theme: { themeBg:'#008c59' }, hasCustomAvatar: true, getAvatarPath: () => path };
    // The main profile keeps Kivo's own button: the test decides which one it is.
    window.taskbarMain = 1;
    taskbarModule.KivoTaskbar.mainProfileId = () => Promise.resolve(window.taskbarMain);
    window.taskbarTest = {
      C, user, gdi, hwnd, fakeWindow, profile:p,
      icons: () => [0,1].map(slot => send(hwnd, 0x7f, slot, 0).toString()),
      properties() {
        const store = C.voidptr_t();
        if (storeOf(hwnd, guid('886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99').address(), store.address()) < 0) throw new Error('No property store');
        const vtable = C.cast(C.cast(store, C.voidptr_t.ptr).contents, C.voidptr_t.array(8).ptr).contents;
        const getValue = C.cast(vtable[5], C.FunctionType(C.winapi_abi, C.int32_t, [C.voidptr_t, KEY.ptr, VARIANT.ptr]).ptr);
        const values = {};
        try {
          for (const [name, id] of [['command',2],['icon',3],['name',4],['appId',5]]) {
            const value = new VARIANT();
            const key = new KEY(guid('9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3'), id);
            if (getValue(store, key.address(), value.address()) < 0) throw new Error('GetValue failed');
            values[name] = value.type === 31 ? C.cast(value.value, C.char16_t.ptr).readString() : null;
            clear(value.address());
          }
        } finally {
          C.cast(vtable[2], C.FunctionType(C.winapi_abi, C.uint32_t, [C.voidptr_t]).ptr)(store);
        }
        return values;
      },
      snapshot(slot, size) {
        const icon = C.cast(C.intptr_t(send(hwnd, 0x7f, slot, 0)), C.voidptr_t);
        const dc = dcNew(null);
        const header = C.uint32_t.array(10)([40,size,(-size) >>> 0,0x00200001,0,size*size*4,0,0,0,0]);
        const bits = C.voidptr_t();
        const bitmap = dib(dc, header.address(), 0, bits.address(), null, 0);
        if (bitmap.isNull()) throw new Error('No native DIB');
        const old = select(dc, bitmap);
        try {
          if (!draw(dc,0,0,icon,size,size,0,null,3)) throw new Error('DrawIconEx failed');
          const raw = C.cast(bits,C.uint8_t.array(size*size*4).ptr).contents;
          const canvas = document.createElementNS('http://www.w3.org/1999/xhtml','canvas');
          canvas.width = canvas.height = size;
          const c = canvas.getContext('2d');
          const pixels = c.createImageData(size,size);
          let pink = 0, misplaced = 0;
          for(let i=0;i<size*size;i++) {
            const j=i*4;
            pixels.data[j]=raw[j+2]; pixels.data[j+1]=raw[j+1]; pixels.data[j+2]=raw[j]; pixels.data[j+3]=raw[j+3];
            if(raw[j+2]>200 && raw[j+1]<60 && raw[j]>60 && raw[j]<160 && raw[j+3]>128) {
              pink++;
              if(i%size > size*.44 || Math.floor(i/size)<size*.56) misplaced++;
            }
          }
          c.putImageData(pixels,0,0);
          return {png:canvas.toDataURL(),pink,misplaced};
        } finally {select(dc,old);objectDelete(bitmap);dcDelete(dc);}
      },
      close() {listeners.unload?.();destroy(hwnd);user.close();gdi.close();shell.close();ole.close();},
    };
    return 'ready';
  })()`);
  const setProfile = profile => evaluate(`taskbarModule.KivoTaskbar.setProfile(taskbarTest.fakeWindow,${profile}).then(()=>true)`);
  const empty = { command: null, icon: null, name: null, appId: null };
  const group = await evaluate(`Cc['@mozilla.org/windows-taskbar;1'].getService(Ci.nsIWinTaskbar).defaultGroupId`);
  const initial = await json('taskbarTest.icons()');
  check('a window starts on Kivo\'s own button', JSON.stringify(await json('taskbarTest.properties()')) === JSON.stringify(empty));
  await setProfile('taskbarTest.profile');
  const badged = await json('taskbarTest.icons()');
  check('small and large native window icons are set', badged.every((icon, i) => icon !== '0' && icon !== initial[i]));
  for (const [slot, size] of [[0,16],[1,32]]) {
    const shot = await json(`taskbarTest.snapshot(${slot},${size})`);
    writeFileSync(join(output, `native-badge-${size}.png`), Buffer.from(shot.png.split(',')[1], 'base64'));
    check(`${size}px native portrait is small and lower-left`, shot.pink > size * size * .035 && shot.pink < size * size * .13 && shot.misplaced === 0);
  }
  const own = await json('taskbarTest.properties()');
  const iconFile = await evaluate(`PathUtils.join(PathUtils.profileDir, 'kivo', 'taskbar.ico')`);
  check('another profile gets its own taskbar button', own.appId === `${group}.Profile99`);
  check('pinning that button starts Kivo.exe with the profile', /^"?[^"]*\\Kivo\.exe"? -profile /i.test(own.command ?? '') && own.command.includes(profile.replace(/\//g, '\\')));
  check('the pinned button keeps the profile icon and name', own.icon === `${iconFile},0` && own.name === 'Taskbar Test - Kivo'
    && await evaluate(`IOUtils.read(${JSON.stringify(iconFile)}).then(b => b[0] === 0 && b[2] === 1 && b[4] > 5)`));
  await setProfile('taskbarTest.profile');
  check('unchanged profile reuses native icons', JSON.stringify(await json('taskbarTest.icons()')) === JSON.stringify(badged));
  await evaluate('taskbarTest.profile = {...taskbarTest.profile,avatar:"updated.png"}; true');
  await setProfile('taskbarTest.profile');
  check('changing the profile refreshes both native icons', (await json('taskbarTest.icons()')).every((icon, i) => icon !== badged[i]));
  await evaluate('window.taskbarMain = 99; true');
  await setProfile('taskbarTest.profile');
  check('the main profile stays on Kivo\'s button with the plain icon', JSON.stringify(await json('taskbarTest.icons()')) === JSON.stringify(initial)
    && JSON.stringify(await json('taskbarTest.properties()')) === JSON.stringify(empty));
  await evaluate('window.taskbarMain = 1; true');
  await setProfile('taskbarTest.profile');
  check('it moves back when it is no longer the main profile', (await json('taskbarTest.properties()')).appId === `${group}.Profile99`);
  await setProfile('null');
  check('removing the profile badge restores both original icons and the button', JSON.stringify(await json('taskbarTest.icons()')) === JSON.stringify(initial)
    && JSON.stringify(await json('taskbarTest.properties()')) === JSON.stringify(empty));
  check('a missing portrait reports a recoverable error', await evaluate('taskbarModule.KivoTaskbar.setProfile(taskbarTest.fakeWindow,{...taskbarTest.profile,avatar:"missing.png",getAvatarPath:()=>PathUtils.join(PathUtils.profileDir,"missing.png")}).then(()=>false,()=>true)'));
  await setProfile('taskbarTest.profile');
  check('the next portrait still updates after an image failure', (await json('taskbarTest.icons()')).every((icon,i)=>icon!==initial[i]));
  await evaluate('Promise.all([taskbarModule.KivoTaskbar.setProfile(taskbarTest.fakeWindow,taskbarTest.profile),taskbarModule.KivoTaskbar.setProfile(taskbarTest.fakeWindow,null)]).then(()=>true)');
  check('a queued clear wins over an earlier portrait update', JSON.stringify(await json('taskbarTest.icons()')) === JSON.stringify(initial));
  check('the profile icon has one fixed file', JSON.stringify(await json(`IOUtils.getChildren(PathUtils.join(PathUtils.profileDir,"kivo")).then(all => all.filter(p => /\\.ico(\\.tmp)?$/.test(p)))`)) === JSON.stringify([iconFile]));

  // ---------- Jump List ----------
  await evaluate(`(async () => {
    const { KivoWorkspaces } = ChromeUtils.importESModule('moz-src:///browser/components/kivo/KivoWorkspaces.sys.mjs');
    window.taskbarWorkspaces = KivoWorkspaces;
    await KivoWorkspaces.create({ name: 'Work', color: '#2f80ed' });
    await KivoWorkspaces.create({ name: 'study', color: '#e5484d' });
    const { PlacesUtils } = ChromeUtils.importESModule('resource://gre/modules/PlacesUtils.sys.mjs');
    for (let i = 0; i < 3; i++) {
      await PlacesUtils.history.insert({ url: 'https://example.com/kivo-jumplist', title: 'Kivo jump list site', visits: [{ date: new Date() }] });
      await PlacesUtils.history.insert({ url: 'file:///C:/kivo-jumplist.html', visits: [{ date: new Date() }] });
    }
    return true;
  })()`);
  const spaces = await json('taskbarWorkspaces.list()');
  const work = spaces.find(ws => ws.name === 'Work');
  const study = spaces.find(ws => ws.name === 'study');
  const lines = (await evaluate('taskbarModule.KivoTaskbar.jumpListText()')).trimEnd().split('\n').map(line => line.split('\t'));
  writeFileSync(join(output, 'jumplist.txt'), lines.map(line => line.join('\t')).join('\n'));
  const at = (kind, title) => lines.findIndex(line => line[0] === kind && line[1] === title);
  const engine = await evaluate(`Services.dirsvc.get('XREExeF', Ci.nsIFile).path`);
  check('the list is for this button', lines[0][0] === 'app' && lines[0][1] === group);
  const workItem = lines.find(line => line[0] === 'item' && line[1] === 'Work');
  check('workspaces come first, each opening itself', at('category', 'Workspaces') === 1 && workItem?.[2] === `--kivo-workspace ${work.id}`
    && lines.some(line => line[0] === 'item' && line[1] === 'study' && line[2] === `--kivo-workspace ${study.id}`));
  const dot = Buffer.from(await json(`IOUtils.read(${JSON.stringify(workItem?.[3] ?? '')}).then(b => [...b])`));
  check('a workspace shows its color dot and letter', /[\\/]kivo[\\/]jumplist[\\/]2f80ed-87\.ico$/.test(workItem?.[3] ?? '')
    && dot.readUInt16LE(2) === 1 && dot.readUInt16LE(4) === 5);
  // Its 32px frame, to look at.
  const frame = [...Array(5).keys()].map(i => 6 + i * 16).find(entry => dot[entry] === 32);
  writeFileSync(join(output, 'jumplist-workspace-32.png'), dot.subarray(dot.readUInt32LE(frame + 12), dot.readUInt32LE(frame + 12) + dot.readUInt32LE(frame + 8)));
  const site = lines.find(line => line[0] === 'item' && line[2] === '-url https://example.com/kivo-jumplist');
  check('frequent sites follow, without non-web addresses', at('category', 'Frequent') > at('category', 'Workspaces') && site?.[1] === 'Kivo jump list site'
    && !lines.some(line => line[2]?.includes('file:')));
  const tasks = lines.slice(at('tasks'), lines.findIndex((line, i) => i > 0 && line[0] === 'app'));
  check('tasks keep Firefox\'s items with Kivo\'s icons in the engine', tasks.some(line => line[2] === '-browser' && line[3] === engine && line[4] === '2')
    && tasks.some(line => line[2] === '-private-window') && tasks.some(line => line[2] === '-new-tab about:blank'));
  const privateGroup = await evaluate(`Cc['@mozilla.org/windows-taskbar;1'].getService(Ci.nsIWinTaskbar).defaultPrivateGroupId`);
  check('the main button also writes the private windows\' tasks', lines.some(line => line[0] === 'app' && line[1] === privateGroup));
  await evaluate(`Services.prefs.setStringPref('kivo.taskbar.jumpListHidden', JSON.stringify({ '--kivo-workspace ${study.id}': Date.now() + 60000 })); true`);
  check('a workspace removed from the list stays out until it is used', !(await evaluate('taskbarModule.KivoTaskbar.jumpListText()')).includes(study.id));
  await evaluate(`Services.prefs.clearUserPref('kivo.taskbar.jumpListHidden'); true`);
  if (group === 'Kivo.Browser') throw new Error('This is the installed Kivo: its Jump List is not written by tests');
  const written = await json('taskbarModule.KivoTaskbar.writeJumpList()');
  check('Kivo.exe writes the Jump List', written?.exitCode === 0 && !/^error/m.test(written.output));
  await evaluate(`(async () => {
    const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
    const t = Cc['@mozilla.org/windows-taskbar;1'].getService(Ci.nsIWinTaskbar);
    const file = PathUtils.join(PathUtils.profileDir, 'kivo', 'jumplist-delete.txt');
    await IOUtils.writeUTF8(file, 'app\\t' + t.defaultGroupId + '\\napp\\t' + t.defaultPrivateGroupId + '\\n');
    const exe = PathUtils.join(Services.dirsvc.get('XREExeF', Ci.nsIFile).parent.path, 'Kivo.exe');
    const proc = await Subprocess.call({ command: exe, arguments: ['--kivo-jumplist', file] });
    if ((await proc.wait()).exitCode !== 0) throw new Error('Unable to delete the test Jump List');
    return true;
  })()`);

  // ---------- --kivo-workspace ----------
  await evaluate(`(() => {
    window.taskbarHandler = Cc['@kivo/workspaces-command-line;1'].getService(Ci.nsICommandLineHandler);
    window.taskbarRun = (id, state = Ci.nsICommandLine.STATE_REMOTE_EXPLICIT) => {
      const line = Cu.createCommandLine(['--kivo-workspace', id], null, state);
      taskbarHandler.handle(line);
      return line.preventDefault;
    };
    window.taskbarWindows = () => [...Services.wm.getEnumerator('navigator:browser')].filter(w => !w.closed);
    return true;
  })()`);
  check('the workspace flag is handled before Firefox opens a window', await evaluate(`Services.catMan.getCategoryEntry('command-line-handler', 'm-a-kivo-workspace') === '@kivo/workspaces-command-line;1'`));
  const count = await evaluate('taskbarWindows().length');
  check('an open workspace is brought forward, no new window', await evaluate(`taskbarRun('${work.id}')`)
    && await evaluate(`new Promise(r => setTimeout(r, 1500)).then(() => taskbarWindows().length)`) === count);
  await evaluate(`(async () => {
    const win = taskbarWindows().find(w => w.kivoWorkspaceId === '${work.id}');
    await taskbarWorkspaces.saveNow();
    const closed = new Promise(r => win.addEventListener('unload', r, { once: true }));
    win.close();
    await closed;
    return true;
  })()`);
  await evaluate(`taskbarRun('${work.id}')`);
  check('a closed workspace opens in its window again', await evaluate(`(async () => {
    for (let i = 0; i < 50; i++) {
      if (taskbarWindows().some(w => w.kivoWorkspaceId === '${work.id}')) return true;
      await new Promise(r => setTimeout(r, 200));
    }
    return false;
  })()`) && await evaluate('taskbarWindows().length') === count);
  check('a removed workspace opens nothing new', await evaluate(`taskbarRun('zzzzzzzzzz')`)
    && await evaluate(`new Promise(r => setTimeout(r, 1500)).then(() => taskbarWindows().length)`) === count);
  check('at startup Kivo opens normally, then the workspace', !(await evaluate(`taskbarRun('${work.id}', Ci.nsICommandLine.STATE_INITIAL_LAUNCH)`)));
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await evaluate('taskbarTest?.close(); true').catch(() => {});
  await kivo.close();
}
if (!failed) rmSync(profile, {recursive:true,force:true,maxRetries:5,retryDelay:300});
writeFileSync(join(output, 'taskbar-check.json'), JSON.stringify(results,null,2));
console.log(`${results.filter(result=>result.ok).length}/${results.length} passed`);
process.exitCode = failed ? 1 : 0;
