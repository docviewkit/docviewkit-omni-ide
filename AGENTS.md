# 项目规则

- 产品名称统一为 `DocViewKit Omni`，定位为 VS Code 与 JetBrains IDE 内的只读文档预览产品。
- 本仓库只包含 `vscode/` 与 `jetbrains/` 两个宿主 adapter；Web 预览项目与 DocViewKit 渲染内核保持独立，通过固定版本、可校验的构建产物集成。
- 两个 adapter 必须使用同一版本、同一校验和的 Web 构建产物，禁止复制 Web 源码、使用 Git submodule 或分别修改构建产物。
- 宿主差异只保留在各自目录。可严格证明等价的预览行为、消息语义、错误码和格式声明必须定义在共享的 Web 构建产物接口中，不得在两个 adapter 中平行实现。
- 最终预览必须来自 DocViewKit 对文档真实内容与结构的解析和渲染，禁止使用文档内嵌缩略图、预览图或封面图作为最终结果或解析失败兜底。
- 遵循“最佳努力渲染、局部失败隔离、整体可用优先”。宿主 adapter 不得把可隔离的单页、单对象或单资源错误升级为整个文件失败；所有降级必须保留可复制的诊断信息。
- 文档内容默认只在本机或 IDE 指定的远程工作区内处理，不得上传文件、后台发送文件名或路径，也不得加载远程脚本。
- 不绕过 IDE 的文件系统、权限、主题、焦点、快捷键和生命周期接口。Webview/JCEF 不得直接信任任意 `file://` 路径。
- VS Code 使用官方 Custom Editor/Webview 接口；JetBrains 使用 IntelliJ Platform File Editor/JCEF 接口。JCEF 不可用时显示明确诊断，不提供图片预览兜底。
- 每个非平凡 adapter 行为至少保留一个可运行回归；共享行为必须同时通过 VS Code 与 JetBrains 契约测试。
- 保持最少依赖、最少目录和最薄 adapter。未经产品规范要求，不新增后台服务、账户系统、遥测、编辑、批注、转换或 AI 功能。
