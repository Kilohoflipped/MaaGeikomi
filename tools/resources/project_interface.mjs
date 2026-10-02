import {parse} from "jsonc-parser";
import * as fs from "node:fs/promises";
import path from "node:path";

// PI 片段中允许的字段
const fragmentFields = new Set([
    "task",
    "option",
    "preset",
]);

async function readManifest(file) {
    // 接受 PI Json 文件，以 JSONC 读取 PI 配置
    const errors = [];
    const manifest = parse(await fs.readFile(file, "utf8"), errors);
    if (errors.length || !manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error(`Invalid interface JSONC: ${file}`);
    }
    return manifest;
}

/**
 *  按声明顺序读取根 PI 及其直接引用的 PI 片段
 * @param {string} source 根 PI 文件的路径
 * @returns {Promise<{manifest: object, fragments: Array<{path: string, manifest: object}>}>}
 */
export async function loadInterface(source) {
    const manifest = await readManifest(source);
    const imports = manifest.import === undefined ? [] : manifest.import;
    if (!Array.isArray(imports)) throw new Error("The imports of PI must be an array");

    const base = await fs.realpath(path.dirname(source));
    const seen = new Set(); // 已经加载的 PI 片段文件路径，避免重复加载
    const fragments = []; // 按顺序保存的读取结果
    for (const value of imports) {
        if (typeof value !== "string" || !value.trim() || path.isAbsolute(value)) {
            throw new Error(`An import of root PI must be a local file specified by a relative path: ${value}`);
        }

        const file = await fs.realpath(path.resolve(base, value));
        const relative = path.relative(base, file);
        if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
            throw new Error(
                `An import of root PI must resolve to a file within the directory tree containing the root PI: ${value}`,
            );
        }

        if (seen.has(file)) throw new Error(`Duplicate import of PI fragment: ${value}`);
        seen.add(file);
        const fragment = await readManifest(file);

        const unsupported = Object.keys(fragment).filter((key) => !fragmentFields.has(key));
        if (unsupported.length) throw new Error(`Unsupported PI fragment fields in ${file}: ${unsupported.join(", ")}`);

        fragments.push({path: value, manifest: fragment});
    }
    return {manifest, fragments};
}
