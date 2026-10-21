# 日有所成

GitHub Pages 本地版入口：https://rpc66.github.io/git/ 。网站文件在 `docs/`，无需安装依赖或登录。支持完成事项、编辑删除、日历、周/月回顾、搜索、每日感想及 JSON 备份导入导出。

本地版数据仅保存在当前浏览器，不跨设备同步；清除浏览器数据会删除记录，请定期导出备份。原站云端记录可先导出 JSON，再在本地版导入。同一 GitHub Pages 域名下的网站共享浏览器存储来源，请勿在不信任的同域网站使用个人数据。

网站左侧提供“GitHub 备份 / 恢复”。专用私有仓库为 [RPC66/daily-done-backups](https://github.com/RPC66/daily-done-backups)。在 GitHub 创建 fine-grained personal access token，仅选择此备份仓库，设置 Contents: Read and write 和有效期，在网站弹窗填写。令牌仅保存在页面内存中，刷新后需要重新输入，不会写入源码、本地存储或备份文件。请勿将令牌发到聊天中。

点击“备份到 GitHub”创建独立 JSON 快照，旧备份保留；另一设备上使用相同仓库和令牌，点击“读取备份列表”，选择快照并点击“恢复所选备份”，确认后与本地记录合并，相同编号事项、相同日期感想以备份为准。填写令牌后点击“启用自动备份”：内容每次修改后重新计时，连续 10 分钟无新修改后自动备份，失败 10 分钟后重试。侧栏显示待授权、待备份和成功/失败状态。手动备份成功取消相同内容的自动备份。待备份标记保留在浏览器，刷新后重新填写令牌可继续；关闭页面、休眠或后台限速会阻止或延迟执行。恢复仍需手动确认，不是自动跨设备同步。备份操作拒绝公开仓库。功能检查：`node --test pages.test.mjs github-backup.test.mjs auto-backup.test.mjs`。

发布源为 `main` 分支 `/docs`，推送后 GitHub 自动发布。修改 `public/` 界面后运行 `node scripts/build-pages.mjs` 重新生成静态文件；`docs/storage.mjs` 是本地存储模块。检查命令：`node --test model.test.mjs pages.test.mjs`。

原始云端版源码仍保存在 `app/`、`lib/` 等目录，需要服务端和 Cloudflare D1，原站地址：https://daily-done-oct21.neatvole65.chatgpt.site 。`.openai/hosting.json` 保留原站配置。GitHub Pages 只发布 `docs/`，不发布后端目录；仓库不包含线上账号、个人记录、会话或运行时密钥。下文为云端版说明。

个人完成记录网站，支持邮箱密码注册、登录、退出、账号会话、Cloudflare D1 云端记录、日历回顾、周/月汇总、搜索及 JSON 备份导入导出。

新记录保存在云数据库，API 由服务端认证账号并按账号隔离。旧版本的 localStorage 记录只用于用户主动迁移；原始记录不删除。离线 HTML 文件仍保留在 E:/codex/artifacts/日有所成.html，与云端网站分别使用。

当前使用独立邮箱账号，不要求短信或邮件发送服务。邮箱用作账号名称，不验证邮箱所有权，暂不提供邮件找回密码。密码通过随机盐和 scrypt（N=32768,r=8,p=3）保存为摘要；安全会话最长 30 天。生产 API 不接受平台身份作为邮箱登录的替代。

短信后端保留为未启用的扩展；登录页面只提供邮箱登录。参见 [短信登录接入说明](./短信登录接入说明.md)。网站外层访问范围由 Sites 管理；只有所有者明确授权后才能改为公开登录入口，个人数据 API 始终需要有效的账号会话。

`app/` 是 Vinext 服务端与登录页面，`public/` 是记录界面，`lib/` 是 API 与密码处理代码，`db/` 和 `drizzle/` 是数据库结构与迁移，`dist/` 仅存放生成的部署输出。测试命令：`node --test model.test.mjs auth.test.mjs`。验证码扩展测试使用内存 SQLite 和隔离的模拟发送函数，不发送真实短信。邮箱注册、登录、退出、云端保存和备份导入已在本地浏览器及 D1 预览中验证。
