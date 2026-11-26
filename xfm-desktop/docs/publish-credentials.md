# 发布凭据申请指南

本文说明如何为 `xfm publish` 支持的四个平台申请凭据。**所有 Token 都通过环境变量传入，不要写进 `xfm.config.json`，也不要提交到仓库。**

## 总览

| 平台 | 需要的东西 | 配置文件字段 | 环境变量 |
| --- | --- | --- | --- |
| GitHub Pages | 个人访问令牌（PAT） | `publish.github.repo` / `branch` | `GITHUB_TOKEN` 或 `GH_TOKEN` |
| Cloudflare Pages | API Token、Account ID | `publish.cloudflare.project` / `branch` / `accountId` | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` |
| Netlify | Auth Token、Site ID | `publish.netlify.siteId` | `NETLIFY_AUTH_TOKEN`、`NETLIFY_SITE_ID` |
| Vercel | Access Token、项目名、可选 Team ID | `publish.vercel.project` / `teamId` | `VERCEL_TOKEN`、`VERCEL_TEAM_ID` |

先配置 `publish.targets`，再按需填写各平台的非敏感参数：

```json
{
  "publish": {
    "targets": ["github", "cloudflare", "netlify", "vercel"],
    "github": { "repo": "owner/repo", "branch": "gh-pages" },
    "cloudflare": { "accountId": "…", "project": "my-blog", "branch": "main" },
    "netlify": { "siteId": "…" },
    "vercel": { "project": "my-blog", "teamId": "" }
  }
}
```

申请完成后先做一次只校验不上传的演练：

```bash
export GITHUB_TOKEN=...          # 按需导出本次要发布的平台
xfm publish my-blog --dry-run
```

---

## GitHub Pages

`xfm publish` 会把 `dist` 作为一次提交推送到仓库的 `gh-pages` 分支。

### 1. 创建 Personal Access Token

推荐使用 Fine-grained token：

1. 打开 GitHub → 右上角头像 → **Settings**
2. 左侧最下方 → **Developer settings**
3. **Personal access tokens → Fine-grained tokens → Generate new token**
4. Token name 随意（如 `xfm-publish`），设置过期时间
5. **Repository access** 选 `Only select repositories`，勾选目标仓库
6. **Permissions → Repository permissions → Contents** 选 `Read and write`
   （`Metadata` 会自动带上 Read）
7. 生成并立即复制 Token（只显示一次）

如果使用 Classic token：路径是 **Developer settings → Personal access tokens → Tokens (classic)**，勾选 `repo` 范围即可。

```bash
export GITHUB_TOKEN=github_pat_xxx     # 或 GH_TOKEN
# 仓库也可不写在配置里，由 GITHUB_REPO 或 git remote 推断
export GITHUB_REPO=owner/repo
```

> Token 缺省时，`xfm` 会尝试复用本机 git 凭据（credential helper / SSH）。CI 环境请显式提供 Token。

### 2. 开启 Pages

1. 进入仓库 → **Settings → Pages**
2. **Build and deployment → Source** 选 `Deploy from a branch`
3. Branch 选 `gh-pages`，目录选 `/ (root)`，保存

首次推送前该分支可能还不存在，可以先发布一次，再回来设置。

### 3. 验证

```bash
export GITHUB_TOKEN=...
xfm publish my-blog --target github
```

访问 `https://<owner>.github.io/<repo>/`；若仓库名是 `<owner>.github.io`，地址是 `https://<owner>.github.io/`。

---

## Cloudflare Pages

走 Pages 的 Direct Upload 接口，不需要 Git 仓库，也不需要先配 CI。

### 1. 创建 Pages 项目

1. 打开 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**
2. **Create → Pages → Upload assets**
3. 填写项目名（例如 `my-blog`），创建项目
   - 也可以在本机执行：`npx wrangler pages project create my-blog --production-branch main`
4. 项目必须是 **Direct Upload** 类型；通过 Git 集成的项目也支持 API 部署，但分支语义以项目设置为准

### 2. 获取 Account ID

Dashboard 右侧栏的 **Account ID**，或地址栏 `dash.cloudflare.com/<account-id>` 里的那段。

```bash
export CLOUDFLARE_ACCOUNT_ID=xxxxxxxxxxxxxxxx
```

也可以写进配置：`"cloudflare": { "accountId": "…" }`。

### 3. 创建 API Token

1. Dashboard → 右上角头像 → **My Profile → API Tokens**
2. **Create Token → Create Custom Token**
3. 权限按下表填写：

| 项目 | 值 |
| --- | --- |
| Permissions | `Account` · `Cloudflare Pages` · `Edit` |
| Account Resources | `Include` · 你的账号 |
| Zone Resources | 留空（发布静态站点不需要 Zone 权限） |

4. 创建后复制 Token：

```bash
export CLOUDFLARE_API_TOKEN=...
```

### 4. 分支与验证

`publish.cloudflare.branch` 与项目的 **Production branch** 一致时是生产部署，其他分支会生成预览部署。默认填 `main`。

```bash
xfm publish my-blog --target cloudflare
```

成功后输出 `https://<project>.pages.dev`（或本次部署的预览地址）。

---

## Netlify

`xfm publish` 会把 `dist` 打成 zip，通过 Zip Deploy 接口上传。

### 1. 获取 Site ID

1. 打开 [Netlify](https://app.netlify.com/) → 选择站点
2. **Site configuration → Site information → Site ID**
3. 或在本机执行 `netlify sites:list` 查看

```bash
export NETLIFY_SITE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

站点不存在时先创建一个空站点（**Add new site → Deploy manually**），拿到 Site ID 后即可用 API 部署。

### 2. 创建 Personal Access Token

1. 右上角头像 → **User settings**
2. **Applications → Personal access tokens → New access token**
3. 填写用途（如 `xfm-cli`），生成并复制

```bash
export NETLIFY_AUTH_TOKEN=...
```

### 3. 验证

```bash
xfm publish my-blog --target netlify
```

成功后会输出本次部署地址（`https://<deploy-id>--<site>.netlify.app`）或站点主域名。

---

## Vercel

`xfm publish` 通过 v13 Deployments 接口内联上传 `dist`。

### 1. 准备项目

Vercel 要求项目已存在。任选一种方式：

- Dashboard → **Add New → Project** 创建项目（可以暂时不接 Git 仓库）
- 或在本机执行一次 `vercel` 完成初始化

项目名（slug）就是配置里的 `publish.vercel.project`。

### 2. 创建 Access Token

1. 右上角头像 → **Account Settings → Tokens**
2. **Create Token**，选择作用域（个人或 Team）与过期时间
3. 复制生成的 Token

```bash
export VERCEL_TOKEN=...
```

### 3. Team ID（可选）

个人账号可以留空。Team 项目需要：

1. 进入 Team → **Settings → General → Team ID**
2. 或查看 `.vercel/project.json` 里的 `orgId`

```bash
export VERCEL_TEAM_ID=team_xxx
```

### 4. 验证

```bash
xfm publish my-blog --target vercel
```

默认 `target=production`；可在配置里改为 `preview`。输出形如 `https://<project>-<hash>.vercel.app`。

> 内联上传适合常规站点。若单次产物接近 100 MB 或文件数特别多，Vercel 可能拒绝；这种规模建议改用 Git 集成或官方 CLI。

---

## 在 CI 中使用

把 Token 存为仓库 Secrets，不要写进工作流文件。以 GitHub Actions 为例：

```yaml
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version-file: xfm-desktop/go.mod
      - name: Build xfm
        working-directory: xfm-desktop
        run: go build -o ../xfm .
      - name: Publish site
        env:
          GITHUB_TOKEN: ${{ secrets.XFM_GITHUB_TOKEN }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          NETLIFY_AUTH_TOKEN: ${{ secrets.NETLIFY_AUTH_TOKEN }}
          VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}
        run: ./xfm publish my-blog
```

注意：Actions 自带的 `GITHUB_TOKEN` 默认只能访问当前仓库，而且权限受 workflow 配置约束；跨仓库或需要长期稳定推送时，请使用单独的 PAT（`XFM_GITHUB_TOKEN`）。

---

## 排错

| 现象 | 常见原因 | 处理 |
| --- | --- | --- |
| GitHub `403` / `Permission denied` | Token 没有 Contents 写权限；组织开启了 SSO 但未授权 | 检查 Fine-grained 权限；在组织设置里 Authorize token |
| GitHub Pages `404` | Pages 未开启；Source 不是 `gh-pages`；分支名不一致 | Settings → Pages 选择 `gh-pages` / root |
| Cloudflare `project not found` | 项目名或 Account ID 不对；项目不是 Pages 项目 | 核对 `project`；确认是 Workers & Pages 下的项目 |
| Cloudflare `Authentication error` | Token 权限不足或已过期 | 重新创建 Token，权限选 Account · Cloudflare Pages · Edit |
| Netlify `404 Not Found` | Site ID 错误 | 用 `netlify sites:list` 核对 |
| Netlify `401` | Token 无效 | 重新生成 Personal access token |
| Vercel `not_authorized` | Team 项目缺少/写错 `teamId`；Token 作用域不含该 Team | 补 `VERCEL_TEAM_ID` 或换有权限的 Token |
| Vercel `413` / 请求过大 | 内联上传体积超限 | 改用 Git 集成或 `vercel` CLI |
| 本地成功、CI 失败 | Secrets 未注入，或变量名拼错 | 在 CI 日志确认环境变量存在（值会被打码） |
| `/index.html` 路径异常 | `site.base` 与托管子路径不一致 | GitHub Pages 项目页需设置 `base: "/<repo>/"` |

---

## 安全提醒

- **只放环境变量或 CI Secrets**，不要写进 `xfm.config.json`、README 或截图
- 按最小权限申请：GitHub 只勾选目标仓库的 Contents；Cloudflare 只给 Pages Edit
- 定期轮换 Token，离职/换机后立即吊销
- `xfm` 只会在推送/请求时使用 Token，错误信息里会对 GitHub Token 做脱敏；共享机器上仍建议使用一次性 Token
- 不要把 Token 贴在 issue、聊天记录或构建日志中
