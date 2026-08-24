# TidGi Official Website

## Design Priciple

- 在侧边栏文件目录里，按语言整理不同条目，方便切换语言
- 自定义太微的条目，放到 tiddlywiki 条目里（加上 tiddlywiki 标签的意思）

## Related Discussion

- [How to create product website using tw? (Like apple.com)](https://talk.tiddlywiki.org/t/how-to-create-product-website-using-tw-like-apple-com)

## DLC

Use [scripts/download-installers.mjs](scripts/download-installers.mjs) to download installer exe/zip/dmg to `files/downloaders`.

Binary files in `files/downloaders` should be gitignored, because files are large and updated frequently. When setup website on a server, please use things like `pm2` to run the download-installers script periodically.

The downloader uses `socks5h://127.0.0.1:1080` by default. Override it with `DOWNLOAD_PROXY`, or set `DOWNLOAD_PROXY=direct` to disable proxy usage. By default it keeps existing files and only downloads missing or size-mismatched assets; set `DOWNLOAD_CLEAN=true` to wipe the folder before syncing (mainly for local rebuilds).
