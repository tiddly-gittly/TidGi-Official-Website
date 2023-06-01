# TidGi Official Website

## Design Priciple

- 在侧边栏文件目录里，按语言整理不同条目，方便切换语言
- 自定义太微的条目，放到 tiddlywiki 条目里（加上 tiddlywiki 标签的意思）

## Related Discussion

- [How to create product website using tw? (Like apple.com)](https://talk.tiddlywiki.org/t/how-to-create-product-website-using-tw-like-apple-com)

## DLC

Use [scripts/download-installers.mjs](../scripts/download-installers.mjs) to download installer exe/zip/dmg to this folder.

Binary files in this folder should be gitignored, because files are large and updated frequently. When setup website on a server, please use things like `pm2` to run the download-installers script periodically.
