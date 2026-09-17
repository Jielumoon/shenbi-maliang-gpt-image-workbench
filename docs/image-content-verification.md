# AI 内容验证

工作台侧栏的“更多”子菜单卡片提供“创作提示词”和“验证 AI 内容”两个入口。首版仅验证图片中 OpenAI 支持的来源信号，不是通用 AI 图片分类器。

## 路由与调用

- 页面：`/image-provenance`
- 能力查询：`GET /api/image-provenance/capabilities`
- 图片验证：`POST /api/image-provenance/check`
- OpenAI 上游：`POST https://api.openai.com/v1/content_provenance_checks`

普通用户只需要登录工作台。服务端使用已启用的 API 直连渠道凭据；该渠道的地址必须是 HTTPS 的 `api.openai.com`，避免将待验证图片发送到兼容站或私有端点。未找到这样的渠道时，服务端再读取 `OPENAI_API_KEY` 环境变量。

服务端会在发出请求前拒绝明显无效的短 Key 或占位值。通过本地格式检查只代表“可能是 OpenAI Platform API Key”，最终有效性及 Content Provenance 权限仍由 OpenAI 响应确定。

OpenAI 的官方网页版验证工具目前可以直接使用，不要求先登录 OpenAI。未配置 API Key 时，工作台不展示无法执行的站内上传操作，改为提供“前往 OpenAI 官方验证”按钮。网页版是 OpenAI 自己的产品入口；公开开发者 API 仍需要 Bearer API Key，不能把网页版内部请求当作免鉴权 API 接入。

侧栏“更多”菜单同样读取能力状态：只有检测到可能有效的 OpenAI Platform API Key 时才进入站内验证页；没有配置、配置明显无效或能力查询失败时，“验证 AI 内容”直接在新标签页打开官方网页版。

配置 API Key 后仍可能因为所属 OpenAI 组织尚未取得 Content Provenance API 权限而返回 404。页面会将其显示为“当前 OpenAI 组织尚未开通 AI 内容验证”。

如果站内请求收到 OpenAI 的 401、403 或 404，页面保留具体错误，并在图片预览下方显示官方网页版按钮，避免用户停在无法继续的错误状态。

## 文件与结果边界

- 支持 PNG、JPEG、WebP 单图，本站限制为 20 MB。
- 服务端先校验声明格式、文件签名、解码结果、尺寸和像素总量，再发送原始字节。
- 图片不写入作品库、素材库或检测历史，响应禁止缓存。
- 同一用户同时最多执行一个验证，站点同时最多执行两个验证，上游请求 30 秒超时。
- C2PA 和 SynthID 结果分别展示。`not_detected` 只表示未发现支持的信号，不能证明图片由真人创作或不是 AI 生成。
- 截图、压缩、裁剪、重新保存或格式转换可能移除或削弱来源信号。
- OpenAI 官方说明 Content Provenance 检查不适用 Zero Data Retention。

官方行为与限制以 [OpenAI Content provenance 文档](https://developers.openai.com/api/docs/guides/content-provenance) 为准。
