const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { assertSeparated } = require('./folder-access.cjs');

function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'postorca-folder-access-')));
  const working = path.join(dir, 'working');
  const source = path.join(dir, 'source');
  fs.mkdirSync(working); fs.mkdirSync(source);
  return { dir, working, source, close: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('working and source folder roles reject equal, ancestor, descendant and symlink overlaps', () => {
  const f = fixture();
  try {
    assert.doesNotThrow(() => assertSeparated(f.working, [f.source]));
    assert.doesNotThrow(() => assertSeparated(f.working, [f.working + '-source']));
    for (const source of [f.working, path.join(f.working, 'nested'), f.dir])
      assert.throws(() => assertSeparated(f.working, [source]), /separate from read-only/);
    const alias = path.join(f.dir, 'alias');
    fs.symlinkSync(f.source, alias, 'dir');
    assert.throws(() => assertSeparated(path.join(alias, 'output'), [f.source]), /separate from read-only/);
  } finally { f.close(); }
});

test('content saves reject source overlap before creating directories or changing files', async () => {
  const f = fixture();
  const filename = require.resolve('./working-folder.cjs');
  const previous = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports: { get: () => f.working } };
  const { write_content_file, saveToContentFolder } = require('./tools/files.cjs');
  try {
    await assert.rejects(write_content_file.run({ folder: 'New/Plan', name: 'plan.md', text: 'x', read_only_roots: [f.dir] }), /separate from read-only/);
    assert.equal(fs.existsSync(path.join(f.working, 'New')), false);
    await assert.rejects(saveToContentFolder('New', 'clip.mp4', Buffer.from('x'), [f.working]), /separate from read-only/);
    assert.equal(fs.existsSync(path.join(f.working, 'New')), false);
    await write_content_file.run({ folder: 'New/Plan', name: 'plan.md', text: 'valid', read_only_roots: [f.source] });
    assert.equal(fs.readFileSync(path.join(f.working, 'New/Plan/plan.md'), 'utf8'), 'valid');
  } finally { if (previous) require.cache[filename] = previous; else delete require.cache[filename]; f.close(); }
});

test('saves cannot create directories or follow file links into sources, including dangling links', async () => {
  const f = fixture();
  const filename = require.resolve('./working-folder.cjs');
  const previous = require.cache[filename];
  require.cache[filename] = { id: filename, filename, loaded: true, exports: { get: () => f.working } };
  const { write_content_file, saveToContentFolder } = require('./tools/files.cjs');
  try {
    fs.symlinkSync(f.source, path.join(f.working, 'source-link'), 'dir');
    await assert.rejects(write_content_file.run({ folder: 'source-link/New', name: 'plan.md', text: 'bad', read_only_roots: [f.source] }), /working folder/);
    assert.equal(fs.existsSync(path.join(f.source, 'New')), false);
    fs.mkdirSync(path.join(f.working, 'Plan'));
    const target = path.join(f.source, 'missing.md');
    fs.symlinkSync(target, path.join(f.working, 'Plan/plan.md'));
    await assert.rejects(write_content_file.run({ folder: 'Plan', name: 'plan.md', text: 'bad', read_only_roots: [f.source] }), /working folder/);
    assert.equal(fs.existsSync(target), false);
    const missingDir = path.join(f.source, 'missing');
    fs.symlinkSync(missingDir, path.join(f.working, 'dangling-dir'), 'dir');
    await assert.rejects(saveToContentFolder('dangling-dir/New', 'clip.mp4', Buffer.from('bad'), [f.source]), /working folder/);
    assert.equal(fs.existsSync(missingDir), false);
    const sourceFile = path.join(f.source, 'original.md');
    fs.writeFileSync(sourceFile, 'source unchanged');
    fs.linkSync(sourceFile, path.join(f.working, 'Plan/script.md'));
    await write_content_file.run({ folder: 'Plan', name: 'script.md', text: 'generated', read_only_roots: [f.source] });
    assert.equal(fs.readFileSync(sourceFile, 'utf8'), 'source unchanged');
    assert.equal(fs.readFileSync(path.join(f.working, 'Plan/script.md'), 'utf8'), 'generated');
  } finally { if (previous) require.cache[filename] = previous; else delete require.cache[filename]; f.close(); }
});

test('working folder picker rejects overlaps without replacing saved settings and supports cancellation', async () => {
  const f = fixture();
  try {
    const userData = path.join(f.dir, 'profile'); fs.mkdirSync(userData);
    const settings = path.join(userData, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ workingFolder: f.working, theme: 'dark' }));
    let selected = f.source;
    const module = { exports: {} };
    const electron = { app: { getPath: (name) => name === 'userData' ? userData : f.dir }, dialog: { showOpenDialog: async () => ({ canceled: !selected, filePaths: selected ? [selected] : [] }) } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./working-folder.cjs'), 'utf8'), { module, require: (name) => name === 'electron' ? electron : require(name) });
    await assert.rejects(module.exports.choose(null, [f.source]), /separate from read-only/);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { workingFolder: f.working, theme: 'dark' });
    selected = null;
    assert.equal(await module.exports.choose(null, [f.source]), null);
    selected = path.join(f.dir, 'new-output'); fs.mkdirSync(selected);
    assert.equal(await module.exports.choose(null, [f.source]), selected);
    assert.deepEqual(JSON.parse(fs.readFileSync(settings, 'utf8')), { workingFolder: selected, theme: 'dark' });
  } finally { f.close(); }
});

test('asset downloads refuse to create their managed destination inside a source folder', async () => {
  const { saveOriginal } = require('./tools/file-transfer.cjs');
  const { Readable } = require('node:stream');
  const f = fixture();
  try {
    let uploads = 0;
    const directory = path.join(f.source, 'Downloads/PostOrca');
    await assert.rejects(saveOriginal(Readable.from(['data']), { filename: 'track.mp3', reported_type: 'audio/mpeg' }, { uploadFile: async () => { uploads++; } }, { directory, readOnlyRoots: [f.source] }), /separate from read-only/);
    assert.equal(fs.existsSync(directory), false);
    assert.equal(uploads, 0);
  } finally { f.close(); }
});
