# MaaGeikomi

基于 [MaaFramework](https://github.com/MaaXYZ/MaaFramework) 的四合一护肝助手，用一个工程同时维护四款游戏的自动化。

**当前状态：骨架阶段。** 四个资源包都只有一个启动占位节点，尚未实现任何真实任务。

## 支持的游戏

| 游戏 | 客户端与包名 | 分辨率 | 当前状态 |
| :--- | :--- | :--- | :--- |
| XXL 猛汉特区（XXL WOOFIA / XXL 猛漢町） | PlayHorny R18 版，包名待实测 | 待实测 | 仅占位节点 |
| 东京放课后召唤师（Housamo） | `jp.co.lifewonders.housamo` | 1280x720 横屏 | 仅占位节点 |
| Live A Hero | `jp.co.lifewonders.liveahero` | 720x1280 竖屏 | 仅占位节点，上游无任何现成项目 |
| 神绊的导师（Crave Saga） | EROLABS 中文版，包名待实测 | 1280x720 320dpi 横屏 | 仅占位节点 |

## 环境要求

本项目只做 **Windows + 安卓模拟器**，不做手机端自跑。

- 模拟器优先 **MuMu 12 官方版**（本项目在 5.30.1 上验证）。BlueStacks 也能跑，但拿不到 MaaFramework 的模拟器增强通道，截图会慢一个数量级。
- 分辨率必须锁定 **1280x720 横屏**（Live A Hero 单独开一个 720x1280 竖屏实例）。MaaFramework 的模板必须基于无损原图缩放到短边 720 后裁剪。
- **必须开启 MuMu 截图增强**，配置由通用 UI 或调试脚本传入：

      {"extras": {"mumu": {"enable": true, "path": "D:\\Game\\Emulator\\MuMuPlayer-12.0"}}}

  不开启的后果在真机上实测过：同一实例、同一分辨率下，adb 截图 237 ms/帧，开启增强后 7.2 ms/帧，差 33 倍。这个通道不会自动生效。

- 输入方式用默认的 Maatouch 即可（约 50 ms/次点击）。MuMu 触控增强需要官方版 6.3.2 以上，5.30.1 不支持，也不影响使用。
- MuMu 可以在 Hyper-V 兼容模式下运行（`hyperv_enabled: true`），也可以在卸掉 Hyper-V 后的原生 VT 下运行（`hyperv_enabled: false`），两种都能正常自动化；实测截图延迟差异被分辨率因素掩盖，没有观察到显著差别。

## 目录结构

    assets/
      interface.json          项目接口声明（Project Interface v2）
      resource/               公共资源包：pipeline / image / model（OCR 模型）
      resource_xxl/           XXL 猛汉特区
      resource_housamo/       东京放课后召唤师
      resource_lah/           Live A Hero
      resource_crave/         神绊的导师
    agent/                    Python Agent：自定义识别与自定义动作
    deps/tools/               JSON Schema（写 pipeline 时编辑器据此校验）
    tools/                    安装与 schema 校验脚本

命名约定：公共节点统一 `Common_` 前缀，游戏节点使用 `XXL_` / `Housamo_` / `LAH_` / `Crave_` 前缀。资源加载顺序是公共包在前、游戏包在后，同名节点会被游戏包覆盖，因此前缀不能省。

## 本地准备

    git clone https://github.com/Kilohoflipped/MaaGeikomi.git
    cd MaaGeikomi
    git submodule update --init --recursive

子模块 `assets/MaaCommonAssets` 是官方资源库，不初始化会缺资源。

OCR 模型不随仓库分发（`assets/resource/model/.gitignore` 已忽略该目录），需要手动放置：下载 [ppocr_v6-small.zip](https://download.maafw.xyz/MaaCommonAssets/OCR/ppocr_v6/ppocr_v6-small.zip)，解压出 `det.onnx`、`keys.txt`、`rec.onnx` 放进 `assets/resource/model/ocr/`。CI 发版时会自动补齐。

调试建议用 MFAAvalonia 或 MaaDebugger，写 pipeline 时在 VS Code 里装 `maa-support-extension` 插件。

## 打包发布

推一个 `v*` 格式的 tag 即可触发 CI 打包并发布到 Releases。第一次打包前必须先在仓库的 `Settings` - `Actions` - `General` 里把 `Workflow permissions` 改成 `Read and write permissions`。

CI 默认只构建 `win-x86_64`（本项目只面向 Windows），需要其它平台时改 `.github/workflows/install.yml` 里的 matrix。

## 已知坑

- MuMu 的截图增强不会自动开启，配置键是 `extras.mumu.enable` / `extras.mumu.path`。
- 用 HTTPS 推送对 `.github/workflows/` 的修改时，token 必须带 `workflow` scope，否则 GitHub 会拒绝；用 SSH 推送不受此限制。
- 不要使用 MinicapDirect / MinicapStream 截图，它们编码为有损 jpg，会显著降低模板匹配准确率。
- 流水线默认节拍偏保守：`rate_limit` 1000 ms、`pre_delay` 与 `post_delay` 各 200 ms、`timeout` 20 s。截图本身只要 7 ms，速度上限取决于这些参数。
- 游戏自带挂机时不要重复实现战斗逻辑。XXL 有全自动战斗，Live A Hero 有 Battle Auto Mode，神绊有自動周回。

## 免责声明

本项目是图像识别加模拟输入的自动化工具，不修改游戏本体、不读写游戏内存、不篡改网络数据。自动化行为仍可能违反游戏的用户协议——其中 Live A Hero 的利用规约第十五条明文禁止使用 BOT 与外挂工具，且第十一条允许运营方在没有预告的情况下限制或删除账号。请自行评估风险，账号后果自负。

请勿在游戏官方渠道（官方社区、官方账号、玩家群等）提及或推广本项目。

## 鸣谢

- [MaaFramework](https://github.com/MaaXYZ/MaaFramework) —— 底层自动化框架（LGPL-3.0）
- [MaaPracticeBoilerplate](https://github.com/MaaXYZ/MaaPracticeBoilerplate) —— 项目模板（MIT）
- [MAH](https://github.com/Quartewe/MAH) —— 东京放课后召唤师助手，Housamo 部分的重要参考（MIT）
- [MaaCraveSaga](https://github.com/BryanChiao/MaaCraveSaga) —— 神绊的导师助手，Crave 部分的重要参考
