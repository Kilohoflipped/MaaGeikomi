"""用 VS Code 所设置的格式化器，格式化本项目拥有的每一个 Python 文件。

文件选择来自 git，只有已跟踪文件，加上未跟踪但未被忽略的文件，才会被格式化。

格式化器不是硬编码的。脚本从 VS Code 设置中读出 Python 的默认格式化器
（先工作区，再 profile，最后用户级），再把它映射到一个 CLI，
因此在编辑器里换格式化器也会同时换掉本脚本所用的格式化器。
当扩展自带打包好的可执行文件时，优先使用它而不是解释器的模块，
这样钩子跑的就是编辑器保存时所用的同一个二进制文件。

规范化一个文件要跑两遍，因为 ``ruff format`` 从不重排 import：
``ruff check --select I --fix`` 先排好 import 块，
随后 ``ruff format`` 给出最终版式。

只用标准库，也不需要项目的虚拟环境：只要求 Python 3.10+，任何解释器都能运行。

用法：
    python scripts/tools/format_project.py --check
    python scripts/tools/format_project.py --apply
    python scripts/tools/format_project.py --apply --quiet     # 供钩子使用：只输出一行汇总
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# VS Code 扩展 id -> 自带可执行文件名。优先使用自带的二进制文件，
# 这样钩子在保存时运行的正是编辑器所用的那个二进制文件``ruff.importStrategy:useBundled``
# 让这成为常态，也能避免 import 顺序来回震荡。
FORMATTERS: dict[str, str] = {
    "charliermarsh.ruff": "ruff",
}

VSCODE_EXTENSIONS = Path.home() / ".vscode" / "extensions"


def _extension_version(path: Path) -> tuple[int, ...]:
    match = re.search(r"-(\d+(?:\.\d+)*)", path.name)
    return tuple(int(part) for part in match.group(1).split(".")) if match else (0,)


def bundled_executable(extension_id: str, name: str) -> str | None:
    """VS Code 扩展自带的最新可执行文件，如果该扩展已安装的话。

    只有普通文件才算数。扩展还会自带同名的*包*——ruff 的
    ``bundled/libs/ruff`` 就是一个目录——而把目录交给 CreateProcess
    会以 WinError 5 失败，所以 ``is_file`` 才是这里真正起作用的防护。

    Returns:
        自带可执行文件的路径；扩展未安装或没找到普通文件时返回 ``None``。
    """
    if not name:
        return None
    installs = [path for path in VSCODE_EXTENSIONS.glob(f"{extension_id}-*") if path.is_dir()]
    for install in sorted(installs, key=_extension_version, reverse=True):
        for suffix in (".exe", ""):
            for candidate in sorted(install.glob(f"bundled/**/{name}{suffix}")):
                if candidate.is_file():
                    return str(candidate)
    return None


def formatter_steps(extension_id: str, files: list[str], *, check: bool) -> list[list[str]]:
    """规范化本项目所需的命令，按它们必须执行的先后顺序排列。

    import 顺序是 lint 自动修复（``I``），不属于 ``ruff format``：
    ``ruff format`` 从不重排 import。所以 import 那一遍先跑，随后格式化器
    给出最终版式。``--select I`` 是刻意写明的——单跑 ``ruff check --fix``
    会把仓库里其他所有自动修复也一并应用。

    Returns:
        按执行先后排列的命令行参数列表；``check`` 为真时两遍都不改写文件。
    """
    bundled = bundled_executable(extension_id, FORMATTERS[extension_id])
    base = [bundled] if bundled else [sys.executable, "-m", "ruff"]
    settings = json.loads(
        _strip_jsonc((REPO / ".vscode" / "settings.json").read_text(encoding="utf-8"))
    )
    line_length = settings.get("ruff.lineLength")
    options = (
        ["--line-length", str(line_length)]
        if isinstance(line_length, int) and line_length > 0
        else []
    )
    if check:
        return [
            [*base, "check", "--select", "I", *options, *files],
            [*base, "format", "--check", *options, *files],
        ]
    return [
        [*base, "check", "--select", "I", "--fix", *options, *files],
        [*base, "format", *options, *files],
    ]


def _strip_jsonc(text: str) -> str:
    """去掉 // 与 /* */ 注释以及尾随逗号，好让 json.loads 能读设置文件。

    Returns:
        去掉注释与尾随逗号后的文本。
    """
    text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
    text = re.sub(r"//.*$", "", text, flags=re.M)
    return re.sub(r",(\s*[}\]])", r"\1", text)


def _settings_candidates() -> list[Path]:
    """先工作区设置，再每个 VS Code profile，最后用户级。

    Returns:
        按优先级排列的候选设置文件路径，不保证其中任何一个存在。
    """
    candidates = [REPO / ".vscode" / "settings.json"]
    appdata = os.environ.get("APPDATA")
    if appdata:
        user = Path(appdata) / "Code" / "User"
        profiles = user / "profiles"
        if profiles.is_dir():
            candidates.extend(sorted(profiles.glob("*/settings.json")))
        candidates.append(user / "settings.json")
    return candidates


def default_python_formatter() -> str | None:
    """返回为 Python 配置的 ``editor.defaultFormatter``，如果配置了的话。

    Returns:
        格式化器扩展 id；所有候选设置都没给出非空字符串时返回 ``None``。
    """
    for path in _settings_candidates():
        if not path.is_file():
            continue
        try:
            data = json.loads(_strip_jsonc(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
        block = data.get("[python]")
        if isinstance(block, dict):
            value = block.get("editor.defaultFormatter")
            if isinstance(value, str) and value:
                return value
    return None


def project_python_files() -> list[str]:
    """已跟踪加上未跟踪但未被忽略的 ``*.py``，路径相对仓库根目录。

    Returns:
        相对仓库根目录的路径列表；git 索引里已被删除的条目会被过滤掉。
    """
    result = subprocess.run(
        ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.py"],
        cwd=REPO,
        capture_output=True,
        check=True,
    )
    names = [name for name in result.stdout.decode("utf-8").split("\0") if name]
    return [name for name in names if (REPO / name).is_file()]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report without writing")
    mode.add_argument("--apply", action="store_true", help="rewrite the files")
    parser.add_argument("--formatter", help="override the detected VS Code formatter id")
    parser.add_argument("--quiet", action="store_true", help="print one summary line only")
    args = parser.parse_args(argv)

    extension_id = args.formatter or default_python_formatter()
    if not extension_id:
        print("no Python editor.defaultFormatter found in VS Code settings", file=sys.stderr)
        return 1
    if extension_id not in FORMATTERS:
        supported = ", ".join(sorted(FORMATTERS))
        print(f"unsupported formatter {extension_id!r}; supported: {supported}", file=sys.stderr)
        return 1

    files = project_python_files()
    if not files:
        print("no project Python files found", file=sys.stderr)
        return 1

    steps = formatter_steps(extension_id, files, check=args.check)
    results = [subprocess.run(step, cwd=REPO, capture_output=True, text=True) for step in steps]
    output = "\n".join((result.stdout + result.stderr).strip() for result in results).strip()
    failure = next((result.returncode for result in results if result.returncode), 0)

    if args.quiet:
        print(
            f"format_project: {extension_id} {'check' if args.check else 'apply'} over {len(files)} files"
        )
    else:
        print(f"formatter : {extension_id}  ({FORMATTERS[extension_id]})")
        print(f"binary    : {steps[0][0]}")
        print(f"files     : {len(files)}")
        print(f"steps     : {len(steps)}  ({' + '.join(step[1] for step in steps)})")
        print(f"mode      : {'check' if args.check else 'apply'}")
        print(output)
    return failure


if __name__ == "__main__":
    raise SystemExit(main())
