import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { mkdir, readdir, readFile, rename as moveFile, rm, stat, writeFile } from 'fs/promises';
import { backOff } from 'exponential-backoff';
import 'dotenv/config';

const { GITHUB_TOKEN } = process.env;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const downloadFolder = path.join(__dirname, '../files/downloaders');
const manifestPath = path.join(downloadFolder, '.release-manifest.json');
const proxyUrl = process.env.DOWNLOAD_PROXY ?? 'socks5h://127.0.0.1:1080';
const useProxy = proxyUrl !== '' && !['0', 'false', 'none', 'direct'].includes(proxyUrl.toLowerCase());
const cleanDownloadFolder = !['0', 'false', 'no'].includes((process.env.DOWNLOAD_CLEAN ?? 'false').toLowerCase());
const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';

/*
set DOWNLOAD_PROXY=socks5h://127.0.0.1:1080
set DOWNLOAD_PROXY=direct
set DOWNLOAD_CLEAN=true
*/

function getHeaderArgs(headers) {
  return Object.entries(headers).flatMap(([key, value]) => ['--header', `${key}: ${value}`]);
}

function getProxyArgs() {
  return useProxy ? ['--proxy', proxyUrl] : [];
}

function getWindowsCurlArgs() {
  return process.platform === 'win32' ? ['--ssl-no-revoke'] : [];
}

async function runCurl(args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(curlCommand, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${curlCommand} exited with code ${code}: ${stderr || stdout}`));
    });
  });
}

function getGithubHeaders(accept = 'application/vnd.github+json') {
  const headers = {
    Accept: accept,
    'User-Agent': 'TidGi-Official-Website-downloader',
  };
  if (GITHUB_TOKEN) {
    headers.Authorization = `token ${GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchJson(url) {
  const text = await runCurl([
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    '--http1.1',
    ...getWindowsCurlArgs(),
    '--connect-timeout',
    '30',
    ...getProxyArgs(),
    ...getHeaderArgs(getGithubHeaders()),
    url,
  ]);
  return JSON.parse(text);
}

async function downloadFile(url, headers, destination) {
  await runCurl([
    '--fail',
    '--location',
    '--silent',
    '--show-error',
    '--http1.1',
    ...getWindowsCurlArgs(),
    '--connect-timeout',
    '30',
    '--retry',
    '20',
    '--retry-all-errors',
    '--retry-delay',
    '3',
    '--continue-at',
    '-',
    ...getProxyArgs(),
    ...getHeaderArgs(headers),
    '--output',
    destination,
    url,
  ]);
}

async function hasExpectedSize(filePath, expectedSize) {
  try {
    const stats = await stat(filePath);
    return stats.size === expectedSize;
  } catch {
    return false;
  }
}

async function readManifest() {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

async function writeManifest(desktopTag, mobileTag, files) {
  await writeFile(
    manifestPath,
    `${JSON.stringify({ desktopTag, mobileTag, files, syncedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );
}

function buildAssetPlan(assets, getFileName) {
  return assets.map((asset) => ({
    sourceName: asset.name,
    fileName: getFileName(asset.name),
    size: asset.size,
    url: asset.browser_download_url,
  }));
}

async function verifyAssetPlan(plan) {
  for (const item of plan) {
    const destination = path.join(downloadFolder, item.fileName);
    if (!(await hasExpectedSize(destination, item.size))) {
      return false;
    }
  }
  return true;
}

async function removeOrphanFiles(expectedFileNames) {
  let entries;
  try {
    entries = await readdir(downloadFolder);
  } catch {
    return 0;
  }

  let removed = 0;
  for (const entry of entries) {
    if (entry === '.release-manifest.json') {
      continue;
    }
    if (expectedFileNames.has(entry)) {
      continue;
    }
    if (entry.endsWith('.download')) {
      const baseName = entry.slice(0, -'.download'.length);
      if (expectedFileNames.has(baseName)) {
        continue;
      }
    }
    await rm(path.join(downloadFolder, entry), { force: true });
    console.log(`Removed orphan file: ${entry}`);
    removed += 1;
  }
  return removed;
}

const latestDesktopReleaseData = await fetchJson('https://api.github.com/repos/tiddly-gittly/TidGi-Desktop/releases/latest');
const latestMobileReleaseData = await fetchJson('https://api.github.com/repos/tiddly-gittly/TidGi-Mobile/releases/latest');
if (typeof latestDesktopReleaseData.tag_name === 'undefined') {
  console.warn(latestDesktopReleaseData);
  throw new Error('Try add github token to .env file');
}

const desktopTag = latestDesktopReleaseData.tag_name;
const mobileTag = latestMobileReleaseData.tag_name;
const latestDesktopVersion = desktopTag.replace(/^v/, '');
const latestDesktopVersionBase = latestDesktopVersion.match(/\d+\.\d+\.\d+/)?.[0] ?? latestDesktopVersion;

function renameDesktopAsset(name) {
  const fileName = name.replace(latestDesktopVersion, 'latest').replace(latestDesktopVersionBase, 'latest');
  return fileName.replace(/^tidgi-latest-/, 'TidGi-latest-');
}

function renameMobileAsset(name) {
  return name.replace('app-release-signed', 'TidGi-Mobile');
}

const desktopPlan = buildAssetPlan(latestDesktopReleaseData.assets, renameDesktopAsset);
const mobilePlan = buildAssetPlan(latestMobileReleaseData.assets, renameMobileAsset);
const allPlan = [...desktopPlan, ...mobilePlan];
const expectedFileNames = new Set(allPlan.map((item) => item.fileName));

console.log(`Desktop release: ${desktopTag}`);
console.log(`Mobile release: ${mobileTag}`);
console.log(`Download proxy: ${useProxy ? proxyUrl : 'direct'}`);
console.log(`Clean download folder: ${cleanDownloadFolder}`);

await mkdir(downloadFolder, { recursive: true });

if (cleanDownloadFolder) {
  console.log('DOWNLOAD_CLEAN requested; clearing download folder');
  await rm(downloadFolder, { recursive: true, force: true });
  await mkdir(downloadFolder, { recursive: true });
}

const manifest = await readManifest();
const desktopComplete = await verifyAssetPlan(desktopPlan);
const mobileComplete = await verifyAssetPlan(mobilePlan);

if (desktopComplete && mobileComplete) {
  if (manifest?.desktopTag !== desktopTag || manifest?.mobileTag !== mobileTag) {
    await writeManifest(
      desktopTag,
      mobileTag,
      allPlan.map(({ fileName, size }) => ({ name: fileName, size })),
    );
  }
  console.log('All installers already present with verified sizes; skipping download.');
  process.exit(0);
}

const orphansRemoved = await removeOrphanFiles(expectedFileNames);
if (orphansRemoved > 0) {
  console.log(`Removed ${orphansRemoved} orphan file(s) not in current release asset list`);
}

async function downloadPlannedAsset(item) {
  const { fileName, size, url, sourceName } = item;
  const headers = getGithubHeaders('application/octet-stream');
  const destination = path.join(downloadFolder, fileName);
  const temporaryDestination = `${destination}.download`;

  if (await hasExpectedSize(destination, size)) {
    console.log(`Skip ${fileName}; size already verified (${size} bytes)`);
    return 'skipped';
  }

  if (await hasExpectedSize(temporaryDestination, size)) {
    await rm(destination, { force: true });
    await moveFile(temporaryDestination, destination);
    console.log(`Recovered ${fileName} from completed partial download`);
    return 'downloaded';
  }

  console.log(`Downloading ${fileName} from ${url}`);
  try {
    await downloadFile(url, headers, temporaryDestination);
    const stats = await stat(temporaryDestination);
    if (stats.size !== size) {
      await rm(temporaryDestination, { force: true });
      throw new Error(`File size mismatch for ${fileName}: expected ${size}, got ${stats.size}`);
    }
    await rm(destination, { force: true });
    await moveFile(temporaryDestination, destination);
    console.log(`Done ${fileName} (${size} bytes)`);
    return 'downloaded';
  } catch (error) {
    try {
      const stats = await stat(temporaryDestination);
      console.log(`Kept partial download for ${fileName}: ${stats.size}/${size} bytes`);
    } catch {}
    console.log(`Error downloading ${sourceName} -> ${fileName}`, error);
    throw error;
  }
}

async function downloadPlannedAssetWithBackoff(item) {
  let retryCount = 0;
  return await backOff(
    async () => {
      if (retryCount > 0) {
        console.log(`Retry ${item.sourceName} (attempt ${retryCount + 1})`);
      }
      retryCount += 1;
      return await downloadPlannedAsset(item);
    },
    { numOfAttempts: 20, jitter: 'full' },
  );
}

let downloaded = 0;
let skipped = 0;

for (const item of allPlan) {
  const result = await downloadPlannedAssetWithBackoff(item);
  if (result === 'skipped') {
    skipped += 1;
  } else {
    downloaded += 1;
  }
}

await writeManifest(
  desktopTag,
  mobileTag,
  allPlan.map(({ fileName, size }) => ({ name: fileName, size })),
);
console.log(`Sync complete for ${desktopTag} / ${mobileTag}: ${downloaded} downloaded, ${skipped} skipped`);
