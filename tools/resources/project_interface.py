"""Discover local resource roots and direct Project Interface imports."""

from pathlib import Path

import jsonc


def interface_imports(interface_file):
    """Return declared PI fragments; this project supports task/option/preset only."""
    interface_file = Path(interface_file).resolve()
    interface = jsonc.loads(interface_file.read_text(encoding="utf-8"))
    base = interface_file.parent
    imports = interface.get("import", [])
    if not isinstance(imports, list):
        raise ValueError(f"PI import must be an array: {interface_file}")
    files = {}
    for value in imports:
        if not isinstance(value, str) or not value.strip():
            raise ValueError(f"Invalid PI import path: {value!r}")
        relative = Path(value)
        if relative.is_absolute() or relative == Path("."):
            raise ValueError(
                f"PI import must be a local file specified by a relative path: {value}"
            )
        source = (base / relative).resolve()
        if not source.is_relative_to(base):
            raise ValueError(f"PI import escapes the project: {value}")
        if not source.is_file():
            raise FileNotFoundError(f"PI import file not found: {source}")
        if source in files.values():
            raise ValueError(f"Duplicate PI import: {value}")
        fragment = jsonc.loads(source.read_text(encoding="utf-8"))
        if not isinstance(fragment, dict):
            raise ValueError(f"PI fragment must be an object: {source}")
        unsupported = fragment.keys() - {"task", "option", "preset"}
        if unsupported:
            raise ValueError(f"Unsupported PI fragment fields in {source}: {sorted(unsupported)}")
        files[relative] = source
    return files


def resource_directories(interface_file):
    interface_file = Path(interface_file).resolve()
    interface = jsonc.loads(interface_file.read_text(encoding="utf-8"))
    base = interface_file.parent
    directories = {}
    for resource in interface["resource"]:
        for value in resource["path"]:
            relative = Path(value)
            if relative.is_absolute() or ".." in relative.parts or relative == Path("."):
                raise ValueError(f"Resource path must be a local subdirectory: {value}")
            source = (base / relative).resolve()
            if not source.is_relative_to(base):
                raise ValueError(f"Resource path escapes the project: {value}")
            if not source.is_dir():
                raise FileNotFoundError(f"Resource directory not found: {source}")
            directories[relative] = source
    if not directories:
        raise ValueError(f"No resource directories declared in {interface_file}")
    return directories
