import fs from 'fs';
import path from 'path';
import { mkdir, writeFile } from "fs/promises";
import { Readable } from "stream";
import { finished } from "stream/promises";
import { backOff } from "exponential-backoff";

const latestReleaseData = await fetch('https://api.github.com/repos/tiddly-gittly/TidGi-Desktop/releases/latest').then(async (response) => await response.json());
const latestVersion = latestReleaseData.tag_name.replace('v', '');
const urls = latestReleaseData.assets.map((asset) => asset.browser_download_url);
console.log(urls);
// download urls to `files` folder

async function downloadAsset(asset) {
  const fileName = asset.name.replace(latestVersion, 'latest');
  console.log(`Downloading ${fileName} from ${asset.browser_download_url}`);
  const { body } = await fetch(asset.browser_download_url);
  const destination = path.join(__dirname, `../files/${fileName}`);
  const fileStream = fs.createWriteStream(destination, { flags: 'wx' });
  await finished((body).pipe(fileStream));
  console.log(`Done ${fileName}`);
}

await mkdir(path.join(__dirname, '../files'), { recursive: true });
await Promise.all(
  latestReleaseData.assets.map(asset => backOff(() => downloadAsset(asset))),
);
