# Azusa Player Scripting

`Azusa Player Scripting` 是基于 [Scripting](https://scriptingapp.github.io/) 的 Azusa iPhone 客户端探索版。

它不是把原来的 Chrome 扩展或 Swift 原生工程直接搬过来，而是用 Scripting 的 `fetch`、`AVPlayer`、`MediaPlayer`、`BackgroundURLSession` 和本地存储能力，先做一个可运行的最小播放器。

## 当前目标

- 在 iPhone 上绕开 PWA 的跨域限制，直接请求 Bilibili API
- 跑通 `BV 导入 -> 分P列表 -> 点播 -> 锁屏控制 -> 本地缓存`
- 为后续的歌词、收藏夹、离线曲库、移动端 UI 重构打基础

## 当前能力

- `index.tsx`
  - 主入口，直接打开播放器页面
- `intent.tsx`
  - Share Sheet / Shortcuts 入口，可接收 bilibili 链接或文本
- `lib/api.ts`
  - Bilibili 视频信息、播放地址和请求头处理
- `lib/player.ts`
  - `AVPlayer` 播放、`MediaPlayer` 锁屏信息与耳机控制
- `lib/storage.ts`
  - 轻量状态记忆与下载索引
- `lib/app.tsx`
  - 最小可用 UI

## 快速开始

1. 在 iPhone 上安装并打开 `Scripting`。
2. 新建一个 Script Project。
3. 把本仓库文件按目录结构导入到项目里。
4. 运行 `index.tsx`。
5. 输入一个 `BV` 号或 bilibili 视频链接。
6. 导入完成后，点击任意分P开始播放。

如果你想从分享菜单直接导入：

1. 保留 `intent.tsx`
2. 在 Scripting 项目里打开 Intent Settings
3. 勾选 `Text` 和 `URLs`

## 本地检查

这个仓库附带了一个轻量 `TypeScript` 检查配置，方便在 Mac 上先跑静态检查：

```bash
npm install
npm run typecheck
```

如果你只是把仓库导进 Scripting，本地不需要额外构建步骤。

## 当前边界

- 现在还是 PoC，不是完整移植版
- 只支持 `BV / 视频链接`
- 下载当前依赖 `BackgroundURLSession`
- 还没接：
  - 收藏夹导入
  - 合集 / 频道导入
  - QQ 歌词搜索
  - 更完整的下载管理
  - 真正的离线曲库索引
  - 更像 Azusa 的移动端 UI

## 接下来最值得做的

1. 加 `收藏夹 / 合集 / 频道` 导入
2. 把歌词映射和 QQ 搜词接回来
3. 用 `SQLite + FileManager` 做离线索引
4. 重做移动端 UI，让它更像真正的 Azusa 客户端
