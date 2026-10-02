import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {checkerViews} from "../tools/check/check_resources.mjs";
import {loadInterface} from "../tools/resources/project_interface.mjs";

const base = path.resolve("assets");
const output = path.resolve("debug/check");
const manifest = {
    controller: [
        {name: "adb"},
        {name: "win32"},
    ],
    resource: [
        {
            name: "A",
            controller: ["adb"],
            path: [
                "./resource",
                "./resource_a",
            ],
        },
        {
            name: "B",
            controller: ["adb"],
            path: [
                "./resource",
                "./resource_b",
            ],
        },
    ],
    task: [
        {name: "A", entry: "A_Start", resource: ["A"]},
        {name: "B", entry: "B_Start", resource: ["B"]},
        {name: "common", entry: "Common"},
        {name: "other controller", entry: "Other", controller: ["win32"]},
    ],
};

test("each view checks only supported tasks and preserves their actual entries", () => {
    const original = structuredClone(manifest);
    const views = checkerViews(manifest, base, output);
    assert.deepEqual(
        views.map((v) => v.manifest.task.map((t) => t.entry)),
        [
            [
                "A_Start",
                "Common",
            ],
            [
                "B_Start",
                "Common",
            ],
        ],
    );
    assert.equal(path.resolve(output, views[1].manifest.resource[0].path[1]), path.join(base, "resource_b"));
    assert.deepEqual(manifest, original);
});

test("a broken active entry is retained for maa-checker to reject", () => {
    const broken = structuredClone(manifest);
    broken.task[0].entry = "Missing";
    assert.equal(checkerViews(broken, base, output)[0].manifest.task[0].entry, "Missing");
});

test("declared imports cannot be silently omitted", () => {
    assert.throws(
        () => checkerViews({...manifest, import: ["tasks.json"]}, base, output),
        /import count does not match/,
    );
});

test("shared constraints are narrowed only after unknown names are rejected", () => {
    const shared = structuredClone(manifest);
    shared.task = [
        {
            name: "shared",
            entry: "Common",
            resource: [
                "A",
                "B",
            ],
            controller: [
                "adb",
                "win32",
            ],
        },
    ];
    const views = checkerViews(shared, base, output);
    assert.deepEqual(
        views.map((view) => view.manifest.task[0].resource),
        [
            ["A"],
            ["B"],
        ],
    );
    shared.task[0].resource = ["MissingResource"];
    assert.throws(() => checkerViews(shared, base, output), /Unknown resource constraint/);
});

test("imported tasks, options and presets are filtered without merging fragments", () => {
    const root = {
        ...manifest,
        task: [manifest.task[2]],
        import: [
            "interface_a.json",
            "interface_b.json",
        ],
    };
    const fragments = [
        {
            path: "interface_a.json",
            manifest: {
                task: [
                    {
                        ...manifest.task[0],
                        entry: "Missing",
                        option: [
                            "A_Mode",
                            "MissingOption",
                        ],
                    },
                ],
                option: {
                    A_Mode: {
                        type: "select",
                        resource: ["A"],
                        cases: [{name: "daily", pipeline_override: {A_Start: {enabled: true}}}],
                    },
                },
                preset: [
                    {
                        name: "daily",
                        task: [
                            {name: "A", option: {A_Mode: "daily"}},
                            {name: "B"},
                            {name: "MissingTask"},
                        ],
                    },
                ],
            },
        },
        {
            path: "interface_b.json",
            manifest: {task: [manifest.task[1]], option: {B_Mode: {type: "select", resource: ["B"]}}},
        },
    ];
    const original = structuredClone({root, fragments});
    const [
        a,
        b,
    ] = checkerViews(root, base, output, fragments);
    assert.equal(a.imports[0].manifest.task[0].entry, "Missing");
    assert.deepEqual(a.imports[0].manifest.task[0].option, [
        "A_Mode",
        "MissingOption",
    ]);
    assert.deepEqual(a.imports[1].manifest.task, []);
    assert.deepEqual(a.imports[1].manifest.option, {});
    assert.deepEqual(b.imports[0].manifest.option, {});
    assert.deepEqual(
        a.imports[0].manifest.preset[0].task.map((task) => task.name),
        [
            "A",
            "MissingTask",
        ],
    );
    assert.deepEqual(
        b.imports[0].manifest.preset[0].task.map((task) => task.name),
        [
            "B",
            "MissingTask",
        ],
    );
    assert.deepEqual(
        a.manifest.import,
        a.imports.map((fragment) => fragment.path),
    );
    assert.notDeepEqual(a.manifest.import, b.manifest.import);
    assert.deepEqual({root, fragments}, original);
});

test("the PI loader preserves root data, import order and duplicate option definitions", async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "maageikomi-import-order-"));
    t.after(() => fs.rm(temporary, {recursive: true, force: true}));
    const source = path.join(temporary, "interface.json");
    const root = {interface_version: 2, task: [{name: "Root", entry: "Root"}]};
    await fs.writeFile(source, JSON.stringify(root));
    assert.deepEqual(await loadInterface(source), {manifest: root, fragments: []});

    const a = {task: [{name: "A", entry: "A"}], option: {Mode: {label: "A"}}};
    const b = {option: {Mode: {label: "B"}}, preset: [{name: "B", task: []}]};
    await fs.writeFile(path.join(temporary, "interface_a.json"), JSON.stringify(a));
    await fs.writeFile(path.join(temporary, "interface_b.json"), JSON.stringify(b));
    root.import = [
        "./interface_b.json",
        "./interface_a.json",
    ];
    await fs.writeFile(source, `// 主接口\n${JSON.stringify(root)}`);
    assert.deepEqual(await loadInterface(source), {
        manifest: root,
        fragments: [
            {path: "./interface_b.json", manifest: b},
            {path: "./interface_a.json", manifest: a},
        ],
    });
});

test("the PI loader rejects invalid root JSONC and import declarations", async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "maageikomi-import-invalid-"));
    t.after(() => fs.rm(temporary, {recursive: true, force: true}));
    const source = path.join(temporary, "interface.json");
    for (const content of [
        "null",
        "[]",
        "42",
        '{"import": [}',
    ]) {
        await fs.writeFile(source, content);
        await assert.rejects(loadInterface(source), /Invalid interface JSONC/);
    }
    for (const imports of [
        null,
        "interface_a.json",
        {},
    ]) {
        await fs.writeFile(source, JSON.stringify({import: imports}));
        await assert.rejects(loadInterface(source), /imports of PI must be an array/);
    }
    for (const value of [
        "",
        "  ",
        42,
        path.join(temporary, "interface_a.json"),
    ]) {
        await fs.writeFile(source, JSON.stringify({import: [value]}));
        await assert.rejects(loadInterface(source), /local file/);
    }
});

test("import discovery accepts JSONC and rejects missing, duplicate and unsupported fragments", async (t) => {
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "maageikomi-import-"));
    t.after(() => fs.rm(temporary, {recursive: true, force: true}));
    const base = path.join(temporary, "pi");
    await fs.mkdir(path.join(base, "games"), {recursive: true});
    const source = path.join(base, "interface.json");
    const fragment = path.join(base, "interface_a.json");
    await fs.writeFile(fragment, '// 游戏声明\n{"task": []}');
    const writeRoot = (imports) => fs.writeFile(source, JSON.stringify({...manifest, import: imports}));
    await writeRoot(["./interface_a.json"]);
    assert.deepEqual((await loadInterface(source)).fragments, [{path: "./interface_a.json", manifest: {task: []}}]);
    await writeRoot(["./games/../interface_a.json"]);
    assert.deepEqual((await loadInterface(source)).fragments, [
        {path: "./games/../interface_a.json", manifest: {task: []}},
    ]);
    await writeRoot(["missing.json"]);
    await assert.rejects(loadInterface(source), /ENOENT/);
    await writeRoot([
        "interface_a.json",
        "./games/../interface_a.json",
    ]);
    await assert.rejects(loadInterface(source), /Duplicate import of PI/);
    await fs.writeFile(path.join(temporary, "outside.json"), '{"task": []}');
    await writeRoot(["../outside.json"]);
    await assert.rejects(loadInterface(source), /must resolve to a file/);
    await writeRoot(["interface_a.json"]);
    for (const text of [
        '{"import": ["nested.json"]}',
        '{"group": []}',
        "[]",
        "null",
        '{"task": [}',
    ]) {
        await fs.writeFile(fragment, text);
        await assert.rejects(loadInterface(source), /Unsupported PI fragment fields|Invalid interface JSONC/);
    }
});
