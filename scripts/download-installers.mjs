import fs from 'fs';
import path from 'path';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { Readable } from 'stream';
import { finished } from 'stream/promises';
import { backOff } from 'exponential-backoff';

require('dotenv').config()
const { GITHUB_TOKEN } = process.env;

/* 
set HTTP_PROXY =http://localhost:1080
set HTTPS_PROXY=http://localhost:1080
*/
// $.env.HTTP_PROXY = 'http://127.0.0.1:1080';
// $.env.HTTPS_PROXY = 'http://127.0.0.1:1080';

const latestDesktopReleaseData = await fetch('https://api.github.com/repos/tiddly-gittly/TidGi-Desktop/releases/latest').then(
  async (response) => await response.json(),
);
const latestMobileReleaseData = await fetch('https://api.github.com/repos/tiddly-gittly/TidGi-Mobile/releases/latest').then(
  async (response) => await response.json(),
);
const latestDesktopVersion = latestDesktopReleaseData.tag_name.replace('v', '');
const latestMobileVersion = latestMobileReleaseData.tag_name.replace('v', '');
const desktopUrls = latestDesktopReleaseData.assets.map((asset) => asset.browser_download_url);
const mobileUrls = latestMobileReleaseData.assets.map((asset) => asset.browser_download_url);
console.log(desktopUrls);
console.log(mobileUrls);
// download urls to `files` folder

async function downloadAsset(asset, rename) {
  const fileName = rename(asset.name);
  console.log(`Downloading ${fileName} from ${asset.browser_download_url}`);
  try {
    await unlink(destination);
  } catch {}
  const headers = {
    Accept: 'application/octet-stream',
    'User-Agent': '@terascope/fetch-github-release',
  };

  if (GITHUB_TOKEN) {
    headers.Authorization = `token ${GITHUB_TOKEN}`;
  }
  const { body } = await fetch(asset.url, { headers });
  const destination = path.join(__dirname, `../files/${fileName}`);
  const fileStream = fs.createWriteStream(destination, { flags: 'wx' });
  await finished(body.pipe(fileStream));
  console.log(`Done ${fileName}`);
}

await mkdir(path.join(__dirname, '../files'), { recursive: true });
await Promise.all([
  ...latestDesktopReleaseData.assets.map((asset) => backOff(() => downloadAsset(asset, (name) => {
    const fileName = name.replace(latestDesktopVersion, 'latest');
    return fileName
  }))),
  ...latestMobileReleaseData.assets.map((asset) => backOff(() => downloadAsset(asset, (name) => {
    const fileName = name.replace('app-release-signed', 'TidGi-Mobile');
    return fileName
  }))),
]);
