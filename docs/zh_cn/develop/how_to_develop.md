# 如何开发

在开始开发前请先阅读 MaaFramework 开发文档的 [快速开始](https://maafw.com/docs/1.1-QuickStarted) 章节，以便你对 MaaFramework 有一个基本的了解。

~~同时，我们还提供了一个 [🎞️ 视频教程](https://www.bilibili.com/video/BV1yr421E7MW) 以供参考。~~ 视频中使用的版本较老，一切问题须以最新版文档为准。

## 开发前提

使用本教程进行开发则默认你遵守 MaaFramework 衍生项目的相关开发规范以及共识，所有的讨论也将基于以下前提。

0. 拥有一个 GitHub 账号并且已经登录  
1. 使用基于 git 作为版本控制工具  
  如果你还不会用，可以先在 [菜鸟教程](https://www.runoob.com/git/git-tutorial.html) 进行学习。  
2. 使用 GitHub 托管代码并使用相关 [CI/CD 工作流](https://docs.github.com/zh/actions)。
  项目中附带了一些基于 [GitHub Actions](https://docs.github.com/zh/actions) 的 CI/CD 工作流配置，你可以通过他们来自动进行测试以及将项目打包和发布。  
3. 了解本框架中一些常见的术语  
  MaaFramework 手册中的 [术语解释](https://maafw.com/docs/1.2-ExplanationOfTerms) 章节介绍了一些基本的专有术语。  

## Python 开发环境

本项目使用 Conda 管理 Python 3.13。请先安装 Miniconda 或 Miniforge，然后在项目根目录创建环境：

```powershell
conda env create --prefix ./.conda --file environment.yml
conda activate ./.conda
python -m pip check
```

`environment.yml` 声明 Python 版本与环境变量，通过根目录的 `requirements.txt` 安装固定版本的 Python 依赖。`.conda/` 是本地环境目录，不进入 Git，也不打包给用户。CI 使用同一份声明创建名为 `maageikomi` 的环境。Node/npm 依赖仍由 `package-lock.json` 管理。

更新依赖声明后，在项目根目录同步环境：

```powershell
conda env update --prefix ./.conda --file environment.yml
```

Python 主次版本与直接依赖版本已固定，但这不是完整的跨平台锁文件，间接依赖仍由安装器解析。

VS Code 已配置 Windows 下的 `.conda/python.exe` 和环境内的 Ruff。如果编辑器曾记住其他解释器，请执行 `Python: Select Interpreter`，选择项目 `.conda/python.exe`。PyCharm 中也选择已有 Conda 环境的这个解释器。

在激活环境的终端中执行检查：

```powershell
python -m tools.check.validate_schema --schema-dir deps/tools --interface-files assets/interface.json
python -m unittest discover -s tests -v
python -m tools.dev.format_project --check
```

VS Code 的 `format: project` 任务直接使用项目 `.conda/python.exe` 调用格式化脚本，不依赖终端当前激活的环境。Ruff 的命令行与编辑器均使用项目环境中的版本。

若不激活环境，也可以用 `conda run --no-capture-output --prefix ./.conda python ...` 执行上述 Python 命令。Agent 开发依赖已包含在环境中；发布包中的 Agent 运行时仍需要独立配置。

### 工具目录

| 目录 | 职责 | 调用方式 |
| --- | --- | --- |
| `tools/build/` | 组装发布包 | `python -m tools.build.install <version> <os> <arch>` |
| `tools/check/` | Schema 与 MaaFramework 资源检查 | `python -m tools.check.validate_schema`、`node tools/check/check_resources.mjs` |
| `tools/resources/` | 发现 PI 导入文件与资源目录、准备 OCR 模型 | `python -m tools.resources.configure_ocr`；PI 辅助模块由其他工具导入 |
| `tools/dev/` | 项目 Python 格式化 | `python -m tools.dev.format_project --check` |

以上命令从项目根目录执行。Python 工具通过包内导入复用资源逻辑，无需修改 `sys.path`。打包前仍需准备好 `deps/` 中的 MaaFramework 原生库；OCR 配置需要已克隆的 MaaCommonAssets 子模块。

## 按游戏拆分 ProjectInterface

`assets/interface.json` 保留项目信息、控制器、资源列表和分组，通过 `import` 按顺序读取同目录下的 `interface_xxl.json`、`interface_housamo.json`、`interface_lah.json` 和 `interface_crave.json`。现有 Housamo 声明仍只提供启动入口，尚未接入 MAH。

每份游戏文件可以声明 `task`、`option` 和 `preset`。任务按主文件、导入列表的顺序追加；任务、选项和预设的名称使用游戏前缀，避免跨文件重名。游戏专用的任务和选项都要声明对应的 `resource` 限制；子选项也遵守这一约定，避免其 Pipeline 覆盖在其他游戏资源中生效。

本项目当前只使用主文件直接导入的本地文件，不使用嵌套导入。`group` 等其他顶层字段继续留在主文件，因为现有检查工具对导入字段的支持范围尚不一致。导入路径相对于主 `interface.json`，统一使用 `/`，文件名采用扁平的 `interface_<游戏>.json` 形式。

新增游戏文件时，先把它加入主文件的 `import` 列表。Schema 检查和打包都按这份列表发现文件：检查会拒绝缺失文件、重复导入和暂不支持的导入字段；打包保留原始文件及相对路径。VS Code 已为 `interface_*.json` 配置导入文件的 Schema。

`check_resources.mjs` 在临时目录为各控制器和资源组合生成主接口与导入文件的检查视图，筛选不适用的任务、选项及预设任务。它不合并 PI 文件，也不实现节点引用解析；实际诊断和资源加载仍由 `maa-tools` 完成。原始发布文件不经过筛选。上述 Python Schema 命令会自动校验导入列表中的文件，无需另加目录参数。

Node 工具通过 `tools/resources/project_interface.mjs` 的 `loadInterface()` 读取主文件和直接导入片段，返回 `{manifest, fragments}`。`manifest` 是主文件对象，`fragments` 按导入顺序保留每份文件的原始路径及对象。该模块参考 MaaFramework `MaaPiCli` 按主文件目录读取直接导入的流程，额外执行本项目的路径与片段字段约束；不复刻其 C++ 类型默认值、用户运行配置清理或选项合并行为。字段类型由 Schema 校验，检查视图中的导入由 `maa-tools` 解析。项目要求名称不重复，不依赖不同客户端对重名选项的覆盖规则。

Python 的 `project_interface.py` 为 Schema 检查和打包提供同样范围的导入发现，返回文件路径供校验或复制；它与 Node 模块服务于不同工具入口。修改导入范围时，应同步两者的约束和测试。

## 开发步骤

0. 使用 [本项目主页](https://github.com/MaaXYZ/MaaPracticeBoilerplate) 右上角 `Use this template` - `Create a new repository` 来基于本模板创建您自己的项目。  
    _（如果你找不到这个按钮，说明你没有登录 GitHub 账号）_

1. 克隆你的项目（地址请修改为您基于本模板创建的新项目地址）。

    ```bash
    git clone https://github.com/<你的用户名>/<你的项目名称>.git
    ```

2. 下载 OCR（文字识别）资源文件 [ppocr_v6.zip](https://download.maafw.xyz/MaaCommonAssets/OCR/ppocr_v6/ppocr_v6-small.zip) 解压到 `assets/resource/model/ocr/` 目录下，确保路径如下：

    ```tree
    assets/resource/model/ocr/
    ├── det.onnx
    ├── keys.txt
    └── rec.onnx
    ```

> [!WARNING]
> 请注意，您不需要将 OCR 资源文件上传到您的代码仓库中。`.gitignore` 已经忽略了 `assets/resource/model/ocr/` 目录，且 GitHub workflow 在发布版本时会自动配置这些资源文件。

    _如果希望使用其他版本的模型，可以参考 [这个说明](https://github.com/MaaXYZ/MaaCommonAssets/tree/main/OCR)。_

3. 进行开发工作。请参考 [MaaFramework 相关文档](https://maafw.com/docs/1.1-QuickStarted)，在对应的 `assets/resource_<游戏>/` 中编写资源，在 `assets/interface_<游戏>.json` 中声明任务和选项，再使用 [开发工具](https://maafw.com/docs/1.1-QuickStarted#%E8%B0%83%E8%AF%95) 调试。修改控制器、资源组合或分组时，编辑主 `assets/interface.json`。

    通常来说，您**不需要**为您的项目单独开发一套 UI，本模板附带了自动配置 _通用 UI_ 的持续集成（CI），使用方法请参考后续步骤。

4. 完成开发后，上传您的代码并发布版本。

    ```bash
    # 配置 git 信息（仅第一次需要，后续不用再配置）
    git config user.name "您的 GitHub 昵称"
    git config user.email "您的 GitHub 邮箱"
    
    # 提交修改
    git add .
    git commit -m "XX 新功能"
    git push origin HEAD -u
    ```

    如果您准备通过 PR 与他人协作，建议参考 [PR 规范](./pull_request_guidelines.md) 补充变更摘要、验证记录和必要的日志或截图。

5. 发布您的版本

    本模板附带 GitHub Actions 工作流的 [配置文件](/.github/workflows/install.yml)，CI 检测到 tag 会自动进行打包和发布。默认的配置文件会将 [MFAAvalonia](https://github.com/SweetSmellFox/MFAAvalonia) 与你的项目一同打包和发版。

    > [!NOTE]
    > 第一次操作前，需要**先**修改 GitHub 仓库设置 `Settings` - `Actions` - `General` - `Read and write permissions` - `Save`

    ```bash
    # 给最近的 commit 打上 v1.0.0 标签并推送
    git tag v1.0.0
    git push origin v1.0.0
    ```

    执行上述命令后，CI 会自动进行打包和发布，你可以在项目仓库的 `Actions` 页面中看到工作流的执行情况。如果一切顺利，运行结束后你可以在项目仓库的 `Releases` 页面中看到新发布的版本。更多有关 GitHub Actions 的内容请参考 [GitHub Actions 文档](https://docs.github.com/zh/actions)。

    _如果想要使用别的 [通用 UI](https://github.com/MaaXYZ/MaaFramework/#%E9%80%9A%E7%94%A8-ui)，请自行修改工作流的 [配置文件](/.github/workflows/install.yml)。_

## 常见问题

请参考 [FAQ](./faq.md)。

## 更多操作

请参考 [个性化配置](./custom_configure.md)（可选）。
