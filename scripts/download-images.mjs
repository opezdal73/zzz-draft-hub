import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'scripts-image-manifest.json'), 'utf8'));
const wiki = (file) => `https://zenlesszonezero.wiki.gg/ru/wiki/Special:FilePath/${encodeURIComponent(file).replace(/%20/g, '_')}`;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function download(entry, folder) {
  const targetDir = path.join(root, 'public', 'images', folder);
  await fs.mkdir(targetDir, { recursive: true });
  const target = path.join(targetDir, `${entry.id}.png`);
  for (const filename of [...new Set([entry.file, entry.fallback])]) {
    const url = wiki(filename);
    try {
      let response;
      for (let attempt = 0; attempt < 4; attempt++) {
        response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'ZZZ-Draft-Hub image asset downloader' }, signal: AbortSignal.timeout(7000) });
        if (response.status !== 429 || attempt === 3) break;
        await sleep(1500 * (attempt + 1));
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const type = response.headers.get('content-type') || '';
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!type.startsWith('image/') || bytes.length < 1000) throw new Error(`not an image (${type}, ${bytes.length} bytes)`);
      await fs.writeFile(target, bytes);
      console.log(`OK   ${folder}/${entry.id}.png <- ${filename}`);
      return true;
    } catch (error) {
      console.warn(`MISS ${entry.name}: ${filename} (${error.message})`);
    }
    await sleep(200);
  }
  return false;
}

const tasks = [
  ...manifest.agents.map(entry => () => download(entry, 'agents')),
  ...manifest.amplifiers.map(entry => () => download(entry, 'amplifiers'))
];
let success = 0;
let next = 0;
const worker = async () => { while (true) { const index = next++; if (index >= tasks.length) return; if (await tasks[index]()) success++; await sleep(650); } };
await Promise.all(Array.from({ length: 1 }, () => worker()));
const total = tasks.length;
console.log(`\nDownloaded ${success}/${total} images.`);
console.log(`Missing images are listed above. Re-run this script after checking the source filenames.`);
if (success === 0) process.exitCode = 1;
