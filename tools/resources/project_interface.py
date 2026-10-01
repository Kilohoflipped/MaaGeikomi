"""Discover and validate local resource roots declared by Project Interface."""

from pathlib import Path

import jsonc


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
