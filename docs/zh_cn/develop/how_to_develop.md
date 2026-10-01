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
| `tools/resources/` | 解析资源目录、准备 OCR 模型 | `python -m tools.resources.configure_ocr` |
| `tools/dev/` | 项目 Python 格式化 | `python -m tools.dev.format_project --check` |

以上命令从项目根目录执行。Python 工具通过包内导入复用资源逻辑，无需修改 `sys.path`。打包前仍需准备好 `deps/` 中的 MaaFramework 原生库；OCR 配置需要已克隆的 MaaCommonAssets 子模块。

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

3. 进行开发工作。请参考 [MaaFramework 相关文档](https://maafw.com/docs/1.1-QuickStarted)，并按您的业务需求修改 `assets` 目录下的 `resource` 资源文件以及 `interface.json` 文件，然后使用 [开发工具](https://maafw.com/docs/1.1-QuickStarted#%E8%B0%83%E8%AF%95) 进行调试。

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
