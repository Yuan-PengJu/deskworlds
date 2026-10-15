// Builds the Windows installer, dist/Deskworlds-Setup-<version>.exe, with everything the
// app needs inside it: Electron's Windows runtime, koffi's Windows binary, this host and
// the scenes. Nothing is downloaded or compiled on the machine it is installed on.
//
//   npm install
//   npm run dist                       (scenes from the checkout this folder sits in)
//   npm run dist -- --scenes <folder>  (scenes from another Deskworlds checkout)
//
// Runs on Windows, macOS or Linux, and needs NSIS 3's makensis on PATH: `apt install
// nsis`, `brew install makensis`, or the installer from https://nsis.sourceforge.io.
// ELECTRON_MIRROR is honoured for the runtime download.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadArtifact } from '@electron/get';
import * as ResEdit from 'resedit';

const windows = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(windows, 'package.json'), 'utf8'));
const dist = path.join(windows, 'dist');
const stage = path.join(dist, 'stage');
const app = path.join(stage, 'resources', 'app');
const onWindows = process.platform === 'win32';

// Chromium's own interface text, which this app never shows, in the languages kept.
// en-US must stay: it is the fallback for every other language.
const LOCALES = ['en-US', 'zh-CN', 'zh-TW'];

const step = (text) => console.log(`==> ${text}`);
const megabytes = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;
const sizeOf = (target) => {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.size;
  return fs.readdirSync(target).reduce((sum, entry) => sum + sizeOf(path.join(target, entry)), 0);
};
/** Deletes every file `keep` turns down, then any folder left empty. */
const prune = (folder, keep) => {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const target = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      prune(target, keep);
      if (!fs.readdirSync(target).length) fs.rmdirSync(target);
    } else if (!keep(entry.name)) {
      fs.rmSync(target);
    }
  }
};
const fail = (text) => { console.error(`build-installer: ${text}`); process.exit(1); };
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', shell: onWindows && command === 'npm', ...options });

// "1.1.0-windows.4" is shown as 1.1.0 and stamped on the files as 1.1.0.4.
const match = /^(\d+)\.(\d+)\.(\d+)(?:-windows\.(\d+))?/.exec(pkg.version);
if (!match) fail(`cannot read a version from "${pkg.version}"`);
const version = `${match[1]}.${match[2]}.${match[3]}`;
const version4 = `${version}.${match[4] || 0}`;

const flag = process.argv.indexOf('--scenes');
const project = path.resolve(flag > 0 ? process.argv[flag + 1] : path.join(windows, '..'));
if (!fs.existsSync(path.join(project, 'scenes'))) {
  fail(`no scenes in ${project}. Put this folder inside a Deskworlds checkout or pass --scenes <folder>.`);
}

try {
  execFileSync('makensis', ['-VERSION'], { stdio: 'ignore' });
} catch {
  fail('makensis was not found. Install NSIS 3 (apt install nsis, brew install makensis, or nsis.sourceforge.io).');
}

const extractZip = (zip, into) => {
  fs.mkdirSync(into, { recursive: true });
  // tar.exe has been part of Windows since 10 1803 and reads zip files.
  if (onWindows) run('tar', ['-xf', zip, '-C', into]);
  else run('unzip', ['-q', '-o', zip, '-d', into]);
};

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

step(`Electron ${pkg.devDependencies.electron} for Windows x64 (checksum-verified, cached after the first time)`);
const runtime = await downloadArtifact({
  version: pkg.devDependencies.electron, platform: 'win32', arch: 'x64', artifactName: 'electron',
});
extractZip(runtime, stage);
fs.renameSync(path.join(stage, 'electron.exe'), path.join(stage, 'Deskworlds.exe'));
// Electron starts resources\app when it is there; its own default app is not needed.
fs.rmSync(path.join(stage, 'resources', 'default_app.asar'), { force: true });
const localesBefore = sizeOf(path.join(stage, 'locales'));
for (const file of fs.readdirSync(path.join(stage, 'locales'))) {
  if (!LOCALES.includes(path.basename(file, '.pak'))) fs.rmSync(path.join(stage, 'locales', file));
}
console.log(`    locales: ${megabytes(localesBefore)} -> ${megabytes(sizeOf(path.join(stage, 'locales')))} (${LOCALES.join(', ')})`);
// LICENSE and LICENSES.chromium.html stay: Electron's and Chromium's licences require them.

step('The host');
fs.mkdirSync(app, { recursive: true });
for (const file of ['main.js', 'desktop.js', 'preload.js', 'icon.ico', 'icon.png']) {
  fs.copyFileSync(path.join(windows, file), path.join(app, file));
}
const { name, productName, description, license, main, dependencies } = pkg;
fs.writeFileSync(path.join(app, 'package.json'),
  `${JSON.stringify({ name, productName, version: pkg.version, description, license, main, dependencies }, null, 2)}\n`);

step(`koffi ${dependencies.koffi} with its Windows x64 binary`);
const modules = path.join(app, 'node_modules');
fs.cpSync(path.join(windows, 'node_modules', 'koffi'), path.join(modules, 'koffi'), { recursive: true });
// koffi also ships its C++ sources, Node-API headers, build tool and documentation, for
// building it from source. Running it needs only its JavaScript and the prebuilt binary.
const koffiBefore = sizeOf(path.join(modules, 'koffi'));
prune(path.join(modules, 'koffi'), (file) =>
  (/\.c?js$/.test(file) && file !== 'cnoke.cjs') || file === 'package.json' || /^LICEN[CS]E/i.test(file));
console.log(`    koffi: ${megabytes(koffiBefore)} -> ${megabytes(sizeOf(path.join(modules, 'koffi')))}`);
// npm only installed the binary for the machine running this build, so the Windows one is
// fetched as the package npm would have chosen on Windows, the same version as koffi.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'deskworlds-koffi-'));
const binary = `@koromix/koffi-win32-x64@${dependencies.koffi}`;
run('npm', ['pack', binary, '--pack-destination', scratch, '--silent'], { stdio: ['ignore', 'ignore', 'inherit'] });
const tarball = fs.readdirSync(scratch).find((file) => file.endsWith('.tgz'));
if (!tarball) fail(`npm pack ${binary} produced nothing`);
// The same bytes package-lock.json recorded, or the build stops.
const lock = JSON.parse(fs.readFileSync(path.join(windows, 'package-lock.json'), 'utf8'));
const expected = lock.packages?.['node_modules/@koromix/koffi-win32-x64']?.integrity;
const actual = `sha512-${createHash('sha512').update(fs.readFileSync(path.join(scratch, tarball))).digest('base64')}`;
if (!expected) fail('package-lock.json has no entry for @koromix/koffi-win32-x64; run npm install');
if (actual !== expected) fail(`${binary} does not match package-lock.json (${actual} != ${expected})`);
run('tar', ['-xzf', path.join(scratch, tarball), '-C', scratch]);
fs.cpSync(path.join(scratch, 'package'), path.join(modules, '@koromix', 'koffi-win32-x64'), { recursive: true });
fs.rmSync(scratch, { recursive: true, force: true });

step(`The scenes, from ${project}`);
const scene = path.join(app, 'scene');
fs.cpSync(path.join(project, 'scenes'), path.join(scene, 'scenes'), {
  recursive: true,
  filter: (source) => path.basename(source) !== 'tests',
});
for (const folder of ['vendor', 'ui']) {
  fs.cpSync(path.join(project, folder), path.join(scene, folder), { recursive: true });
}
// The project's own licence travels with its scenes; three.js brings its own in vendor.
fs.copyFileSync(path.join(project, 'LICENSE'), path.join(scene, 'LICENSE'));

step('Deskworlds.exe: its own icon and name, in place of Electron\'s');
const exePath = path.join(stage, 'Deskworlds.exe');
// Electron's signature no longer matches once the resources change, so it is dropped.
const exe = ResEdit.NtExecutable.from(fs.readFileSync(exePath), { ignoreCert: true });
const resources = ResEdit.NtExecutableResource.from(exe);
const icon = ResEdit.Data.IconFile.from(fs.readFileSync(path.join(windows, 'icon.ico')));
const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
if (!groups.length) fail('Electron\'s executable has no icon to replace');
for (const group of groups) {
  ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
    resources.entries, group.id, group.lang, icon.icons.map((item) => item.data));
}
const info = ResEdit.Resource.VersionInfo.fromEntries(resources.entries)[0];
const [major, minor, patch, build] = version4.split('.').map(Number);
for (const language of info.getAllLanguagesForStringValues()) {
  info.setFileVersion(major, minor, patch, build, language.lang);
  info.setProductVersion(major, minor, patch, build, language.lang);
  info.setStringValues(language, {
    ProductName: 'Deskworlds',
    FileDescription: 'Deskworlds',
    CompanyName: 'Deskworlds',
    InternalName: 'Deskworlds',
    OriginalFilename: 'Deskworlds.exe',
    LegalCopyright: 'MIT License',
  });
  // Electron marks itself for the Squirrel installer, which this is not.
  info.removeStringValue(language, 'SquirrelAwareVersion');
}
info.outputToResourceEntries(resources.entries);
resources.outputResource(exe);
fs.writeFileSync(exePath, Buffer.from(exe.generate()));

const setup = path.join(dist, `Deskworlds-Setup-${version}.exe`);
step(`The installer: ${path.relative(windows, setup)}`);
run('makensis', [
  '-V2',
  `-DVERSION=${version}`,
  `-DVERSION4=${version4}`,
  `-DSTAGE_FILES=${path.join(stage, '*')}`,
  `-DOUTFILE=${setup}`,
  `-DICON=${path.join(windows, 'icon.ico')}`,
  path.join(windows, 'build', 'installer.nsi'),
]);
console.log(`\nDone: ${setup} (${megabytes(fs.statSync(setup).size)}, ${megabytes(sizeOf(stage))} installed)`);
