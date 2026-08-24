import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { mkdir, readFile, rename as moveFile, rm, stat, writeFile } from 'fs/promises';
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

async function verifyAllAssets(assets, getFileName) {
  for (const asset of assets) {
    const fileName = getFileName(asset.name);
    const destination = path.join(downloadFolder, fileName);
    if (!(await hasExpectedSize(destination, asset.size))) {
      return false;
    }
  }
  return true;
}

function renameMobileAsset(name) {
  return name.replace('app-release-signed', 'TidGi-Mobile');
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

console.log(`Desktop release: ${desktopTag}`);
console.log(`Mobile release: ${mobileTag}`);
console.log(`Download proxy: ${useProxy ? proxyUrl : 'direct'}`);
console.log(`Clean download folder: ${cleanDownloadFolder}`);

await mkdir(downloadFolder, { recursive: true });

const manifest = await readManifest();
const desktopComplete = await verifyAllAssets(latestDesktopReleaseData.assets, renameDesktopAsset);
const mobileComplete = await verifyAllAssets(latestMobileReleaseData.assets, renameMobileAsset);

if (
  manifest?.desktopTag === desktopTag
  && manifest?.mobileTag === mobileTag
  && desktopComplete
  && mobileComplete
) {
  console.log('All installers already synced for current releases; skipping download.');
  process.exit(0);
}

const versionChanged = manifest && (manifest.desktopTag !== desktopTag || manifest.mobileTag !== mobileTag);
if (cleanDownloadFolder || versionChanged) {
  const reason = cleanDownloadFolder ? 'DOWNLOAD_CLEAN requested' : 'release version changed';
  console.log(`${reason}; clearing download folder before sync`);
  await rm(downloadFolder, { recursive: true, force: true });
  await mkdir(downloadFolder, { recursive: true });
}

async function downloadAsset(asset, getFileName) {
  const fileName = getFileName(asset.name);
  const headers = getGithubHeaders('application/octet-stream');
  const destination = path.join(downloadFolder, fileName);
  const temporaryDestination = `${destination}.download`;
  if (await hasExpectedSize(destination, asset.size)) {
    console.log(`Skip ${fileName}; existing file size is already verified`);
    return;
  }
  if (await hasExpectedSize(temporaryDestination, asset.size)) {
    await rm(destination, { force: true });
    await moveFile(temporaryDestination, destination);
    console.log(`Done ${fileName}`);
    console.log(`File size verified for ${fileName}`);
    return;
  }
  console.log(`Downloading ${fileName} from ${asset.browser_download_url}`);
  try {
    await downloadFile(asset.browser_download_url, headers, temporaryDestination);
    const stats = await stat(temporaryDestination);
    if (stats.size !== asset.size) {
      await rm(temporaryDestination, { force: true });
      throw new Error(`File size mismatch for ${fileName}: expected ${asset.size}, got ${stats.size}`);
    }
    await rm(destination, { force: true });
    await moveFile(temporaryDestination, destination);
    console.log(`Done ${fileName}`);
    console.log(`File size verified for ${fileName}`);
  } catch (error) {
    try {
      const stats = await stat(temporaryDestination);
      console.log(`Kept partial download for ${fileName}: ${stats.size}/${asset.size} bytes`);
    } catch {}
    console.log(`Error downloading ${fileName}`, error);
    throw error;
  }
}

async function downloadAssetWithBackoff(asset, getFileName) {
  let retryCount = 0;
  await backOff(
    async () => {
      if (retryCount > 0) {
        console.log(`backoff retry ${asset.name} (count: ${retryCount})`);
      } else {
        console.log(`Start ${asset.name}`);
      }
      retryCount += 1;
      await downloadAsset(asset, getFileName);
    },
    { numOfAttempts: 20, jitter: 'full' },
  );
}

const syncedFiles = [];
for (const asset of latestDesktopReleaseData.assets) {
  await downloadAssetWithBackoff(asset, renameDesktopAsset);
  syncedFiles.push({ name: renameDesktopAsset(asset.name), size: asset.size });
}
for (const asset of latestMobileReleaseData.assets) {
  await downloadAssetWithBackoff(asset, renameMobileAsset);
  syncedFiles.push({ name: renameMobileAsset(asset.name), size: asset.size });
}

await writeManifest(desktopTag, mobileTag, syncedFiles);
console.log(`Sync complete for ${desktopTag} / ${mobileTag}`);
