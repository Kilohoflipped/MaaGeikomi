import {loadConfig, runCheck} from "@nekosu/maa-tools";
import * as fs from "node:fs/promises";
import path from "node:path";
import {loadInterface} from "../resources/project_interface.mjs";

// maa-tools checks inactive entries and overrides against the selected resources.
// Filter applicability in temporary PI files; let upstream resolve imports and node references.
export function checkerViews(manifest, base, output, fragments = []) {
    if ((manifest.import ?? []).length !== fragments.length)
        throw new Error("PI import count does not match the loaded fragment count");

    const views = [];
    const supports = (item, key, name) => !item[key] || item[key].includes(name);
    const rebase = (value) => path.relative(output, path.resolve(base, value));

    const documents = [
        manifest,
        ...fragments.map((fragment) => fragment.manifest),
    ];
    const allTasks = documents.flatMap((document) => document.task ?? []);
    const allOptions = documents.flatMap((document) => Object.entries(document.option ?? {}));

    const declaredNames = {
        controller: new Set(manifest.controller.map((item) => item.name)),
        resource: new Set(manifest.resource.map((item) => item.name)),
    };
    for (const item of [
        ...allTasks,
        ...allOptions.map(
            ([
                ,
                option,
            ]) => option,
        ),
        ...manifest.resource,
    ]) {
        for (const [
            key,
            names,
        ] of Object.entries(declaredNames)) {
            for (const name of item[key] ?? []) {
                if (!names.has(name)) throw new Error(`Unknown ${key} constraint: ${name}`);
            }
        }
    }

    for (const controller of manifest.controller) {
        for (const resource of manifest.resource) {
            if (!supports(resource, "controller", controller.name)) continue;

            const active = (item) =>
                supports(item, "controller", controller.name) && supports(item, "resource", resource.name);
            const activeTasks = new Set(allTasks.filter(active).map((task) => task.name));
            const inactiveTasks = new Set(
                allTasks.filter((task) => !activeTasks.has(task.name)).map((task) => task.name),
            );
            const activeOptions = new Set(
                allOptions
                    .filter(
                        ([
                            ,
                            option,
                        ]) => active(option),
                    )
                    .map(([name]) => name),
            );
            const inactiveOptions = new Set(
                allOptions.filter(([name]) => !activeOptions.has(name)).map(([name]) => name),
            );

            const filterOptions = (item) => {
                if (item.option) item.option = item.option.filter((name) => !inactiveOptions.has(name));
            };
            const narrowConstraints = (item) => {
                if (item.controller) item.controller = [controller.name];
                if (item.resource) item.resource = [resource.name];
            };
            const filterDocument = (document) => {
                const view = structuredClone(document);
                if (view.task) {
                    view.task = view.task.filter(active);
                    view.task.forEach(filterOptions);
                    view.task.forEach(narrowConstraints);
                }
                if (view.option) {
                    view.option = Object.fromEntries(
                        Object.entries(view.option).filter(
                            ([
                                ,
                                option,
                            ]) => active(option),
                        ),
                    );
                    for (const option of Object.values(view.option)) {
                        narrowConstraints(option);
                        filterOptions(option);
                        option.cases?.forEach(filterOptions);
                    }
                }
                if (view.preset) {
                    for (const preset of view.preset) {
                        // Keep unknown names so upstream still reports broken references.
                        preset.task = (preset.task ?? []).filter((task) => !inactiveTasks.has(task.name));
                        for (const task of preset.task) {
                            if (task.option)
                                task.option = Object.fromEntries(
                                    Object.entries(task.option).filter(([name]) => !inactiveOptions.has(name)),
                                );
                        }
                    }
                }
                return view;
            };

            const view = filterDocument(manifest);
            view.controller = [structuredClone(controller)];
            view.resource = [{...resource, path: resource.path.map(rebase)}];
            filterOptions(view.controller[0]);
            filterOptions(view.resource[0]);
            if (view.resource[0].controller) view.resource[0].controller = [controller.name];
            if (view.global_option)
                view.global_option = view.global_option.filter((name) => !inactiveOptions.has(name));
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
            const imports = fragments.map((fragment, index) => ({
                path: `view-${views.length}-${index}-${path.basename(fragment.path)}`,
                manifest: filterDocument(fragment.manifest),
            }));
            if (view.import) view.import = imports.map((fragment) => fragment.path);
            views.push({manifest: view, imports});
        }
    }
    if (!views.length) throw new Error("No controller/resource pairs to check");
    return views;
}

async function main() {
    const projectRoot = path.resolve(import.meta.dirname, "../..");

    const config = await loadConfig(path.join(projectRoot, "maatools.config.mts"));
    if (!config) throw new Error("Cannot load maatools.config.mts");
    if (typeof config.cwd !== "string" || !config.cwd.trim()) {
        throw new Error("maatools.config.mts must specify a non-empty cwd string");
    }

    const source = path.resolve(config.cwd, config.interfacePath);
    const {manifest, fragments} = await loadInterface(source);

    const debugRoot = path.resolve(config.cwd, "debug");
    await fs.mkdir(debugRoot, {recursive: true});

    const temporary = await fs.mkdtemp(path.join(debugRoot, "resource-check-"));
    try {
        const views = checkerViews(manifest, path.dirname(source), temporary, fragments);
        let passed = true; // 先假设全部通过，发现失败后再改为 false
        for (const [
            index,
            view,
        ] of views.entries()) {
            const interfacePath = path.join(temporary, `interface-${index}.json`);
            await fs.writeFile(interfacePath, JSON.stringify(view.manifest, null, 2));
            for (const fragment of view.imports) {
                await fs.writeFile(path.join(temporary, fragment.path), JSON.stringify(fragment.manifest, null, 2));
            }
            if (!(await runCheck({...config, interfacePath}))) passed = false;
        }
        process.exitCode = passed ? 0 : 1;
    } finally {
        if (path.dirname(path.resolve(temporary)) !== debugRoot) throw new Error("Invalid debug cleanup path");
        await fs.rm(temporary, {recursive: true, force: true});
    }
}

if (import.meta.main) {
    // runCheck 留下的文件监听器会使 Node 持续运行；等 main 清理临时检查文件后再主动退出
    main()
        .then(() => process.exit(process.exitCode ?? 0))
        .catch((error) => {
            console.error(error);
            process.exit(1);
        });
}
