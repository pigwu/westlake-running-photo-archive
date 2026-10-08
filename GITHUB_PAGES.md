# 用 GitHub 发布跑团相册

本版本无需自建服务器。网页直接读取学校网盘的 HTTP 分享接口，照片仍存学校网盘。

## 发布一次

1. 在 GitHub 新建仓库，默认分支用 `main`。
2. 把项目代码传入仓库，包含 `.github/workflows/pages.yml`、`public/`、`src/`、`package.json` 和 `package-lock.json`。不要上传 `node_modules`、`data`、`tmp`、`.env` 或照片原件。
3. 仓库打开 **Settings → Pages → Source → GitHub Actions**。
4. 打开 **Actions → Publish shared albums → Run workflow**。
5. 等待绿色通过，在 **Settings → Pages** 复制网站地址，发给跑友。

## 加相册 / 改活动和日期

1. 把照片上传到学校网盘的一个文件夹。
2. 生成该文件夹的 HTTP 共享链接，开启照片预览，需要下载时开启下载权限。
3. 在 GitHub 编辑 `public/albums.json`，添加一条记录。例如：

```json
{
  "id": "autumn-run",
  "title": "秋日晨跑",
  "activity": "晨跑",
  "date": "2026-10-10",
  "description": "本次活动的合影与沿途照片。",
  "url": "https://pan.westlake.edu.cn/link/替换为真实分享ID",
  "expiresAt": "2026-11-06T23:59:59+08:00"
}
```

4. 点击 **Commit changes**，等待 Actions 绿色通过，网页会自动更新。`date` 是拍摄/活动日期，不是上传日期；不知道就留空。
5. 将分享密码单独告知跑友。不要把密码写进 `albums.json` 或仓库。

当前已接入你提供的第一份分享，期限为 **2026-11-06 23:59**。期限变更或重新生成分享后，请同步更新链接和 `expiresAt`。

## 跑友怎么用

1. 打开网站，点 **浏览相册**。
2. 输入学校网盘分享密码，点 **打开照片**。
3. 浏览照片；每张照片下点 **下载原图**，直接保存原件，无需离开网站。下载须在网盘分享中开启。
4. 如需分类，点 **本机人脸分组**。计算在本机进行；人物分组只在当前页面有效，关闭后清除。缩略图识别会遗漏小脸或侧脸，分组需人工确认。

## 本机预览

```powershell
npm install
npm run build:pages
npm run preview:pages
```

打开 http://127.0.0.1:4173/ 。原先含服务器的完整版本仍使用 `npm run build` 和 `npm start`。

## 接口验证说明

2026-10-08，使用学校网页公开代码中的实际调用方式验证：`POST https://pan.westlake.edu.cn/api/v1/link?method=get`、`listdir`、`thumbnail`、`osdownload`。请求为 `text/plain` 的 JSON，携带分享 ID 与访问者输入的分享密码。测试返回 `Access-Control-Allow-Origin: *`，可供浏览器跨域读取；缩略图响应实际为图片字节。原图下载由网盘返回带有效期的 `driveoss.westlake.edu.cn` 签名地址，响应带 `Content-Disposition: attachment`，直接由浏览器保存。

这是学校网页正在使用的内部接口，并非手册承诺的正式开放 API。后续学校升级或收紧跨域权限时可能需要调整；网页保留直接打开网盘的入口。此次测试证明当前网络可访问，不代表所有校外网络均可访问。GitHub Pages 页面本身是公开入口，实际照片访问由分享密码、预览权限与期限控制。
