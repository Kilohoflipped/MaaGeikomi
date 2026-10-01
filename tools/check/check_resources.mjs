import {loadConfig, runCheck} from "@nekosu/maa-tools";
import {parse} from "jsonc-parser";
import * as fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

// maa-tools 1.0.23 diagnoses inactive task entries as if they were active.
// Give it one view per supported controller/resource pair, without ignoring diagnostics.
export function checkerViews(manifest, base, output) {
    if (manifest.import?.length) throw new Error("Checker views do not yet support PI import");
    const views = [];
    const supports = (item, key, name) => !item[key] || item[key].includes(name);
    const rebase = (value) => path.relative(output, path.resolve(base, value));
    for (const controller of manifest.controller) {
        for (const resource of manifest.resource) {
            if (!supports(resource, "controller", controller.name)) continue;
            const view = structuredClone(manifest);
            view.controller = [structuredClone(controller)];
            view.resource = [{...resource, path: resource.path.map(rebase)}];
            view.task = manifest.task.filter(
                (task) => supports(task, "controller", controller.name) && supports(task, "resource", resource.name),
            );
            if (view.controller[0].attach_resource_path) {
                view.controller[0].attach_resource_path = view.controller[0].attach_resource_path.map(rebase);
            }
            if (view.languages) {
                view.languages = Object.fromEntries(
                    Object.entries(view.languages).map(
                        ([
                            k,
                            v,
                        ]) => [
                            k,
                            rebase(v),
                        ],
                    ),
                );
            }
            views.push(view);
        }
    }
    if (!views.length) throw new Error("No controller/resource pairs to check");
    return views;
}

async function main() {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const config = await loadConfig(path.join(projectRoot, "maatools.config.mts"));
    if (!config) throw new Error("Cannot load maatools.config.mts");
    const source = path.resolve(config.cwd ?? process.cwd(), config.interfacePath);
    const errors = [];
    const manifest = parse(await fs.readFile(source, "utf8"), errors);
    if (errors.length) throw new Error("Invalid interface JSONC");
    const debugRoot = path.resolve(config.cwd ?? process.cwd(), "debug");
    await fs.mkdir(debugRoot, {recursive: true});
    const temporary = await fs.mkdtemp(path.join(debugRoot, "resource-check-"));
    try {
        const views = checkerViews(manifest, path.dirname(source), temporary);
        let passed = true;
        for (const [
            index,
            view,
        ] of views.entries()) {
            const interfacePath = path.join(temporary, `interface-${index}.json`);
            await fs.writeFile(interfacePath, JSON.stringify(view, null, 2));
            if (!(await runCheck({...config, interfacePath}))) passed = false;
        }
        process.exitCode = passed ? 0 : 1;
    } finally {
        if (path.dirname(path.resolve(temporary)) !== debugRoot) throw new Error("Invalid cleanup path");
        await fs.rm(temporary, {recursive: true, force: true});
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    // runCheck retains filesystem watchers; exit only after our temporary views are cleaned up.
    main()
        .then(() => process.exit(process.exitCode ?? 0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
