/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

import ts from "typescript";

function loadPlugin(options = {}) {
    const sources = [];
    const calls = [];
    const timers = new Map();
    const cleanup = [];
    const live = { desktopSource: { id: "screen-handle:99" }, quality: { resolution: 720, frameRate: 30 } };
    let timerId = 0;
    let monitor = "1";
    let poll;
    const native = {
        async stopCompositor(delayed) { calls.push(["stop", delayed]); },
        async warmCompositor() {},
        async getCursorSource(previous, ignored = []) {
            const displayId = ignored.includes(monitor) ? "1" : monitor;
            return previous === displayId ? { success: true, displayId, sourceId: null }
                : { success: true, displayId, sourceId: displayId === "1" ? "screen-handle:99" : "screen-handle:100", url: "" };
        },
        async prepareCompositor(...args) {
            calls.push(["prepare", ...args]);
            return options.prepare ? options.prepare(...args) : { success: true, sourceId: "window:77:0" };
        },
        async setCompositorMonitor(...args) {
            calls.push(["move", ...args]);
            return options.move ? options.move(...args) : { success: true };
        }
    };
    const modules = {
        "@api/Settings": {
            definePluginSettings(def) {
                const values = Object.fromEntries(Object.entries(def).map(([key, option]) => [
                    key, option.options?.find(option => option.default)?.value ?? option.default
                ]));
                return { def, plain: values, store: values };
            }
        },
        "@utils/constants": { EquicordDevs: {} },
        "@utils/Logger": { Logger: class { warn() {} error() {} } },
        "@utils/types": { __esModule: true, default: value => value, OptionType: {} },
        "@webpack": {
            findByPropsLazy: () => ({ getPidFromDesktopSource: () => 0 }),
            findStoreLazy: name => new Proxy({}, { get(_, key) {
                assert.equal(name, "VideoStreamStore", "The store must exist in Discord's current client.");
                return { getStreamId: () => "self-stream" }[key];
            } })
        },
        "@webpack/common": {
            ApplicationStreamingSettingsStore: { getState: () => ({ preset: 1, soundshareEnabled: true, fps: 30, resolution: 720 }) },
            ApplicationStreamingStore: { getCurrentUserActiveStream: () => ({ guildId: "guild" }) },
            MediaEngineStore: { getGoLiveSource: () => live },
            UserStore: { getCurrentUser: () => ({ id: "self" }) },
            React: {
                useRef: value => ({ current: value }),
                useEffect(effect) { const dispose = effect(); if (dispose) cleanup.push(dispose); }
            },
            VoiceActions: {
                setGoLiveSource(source) {
                    sources.push(source);
                    if (source.desktopSettings) live.desktopSource.id = source.desktopSettings.sourceId;
                    plugin.flux.MEDIA_ENGINE_SET_GO_LIVE_SOURCE({ settings: source });
                }
            },
            showToast() {}
        },
        "./controls": {},
        "./index": { __esModule: true, default: new Proxy({}, { get: (_, key) => (...args) => plugin[key](...args) }) }
    };
    function evaluate(file) {
        const context = {
            exports: {},
            VencordNative: { pluginHelpers: { ScreenSharePlus: native } },
            require: name => name === "./settings" ? { settings } : modules[name],
            setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
            clearTimeout: id => timers.delete(id),
            setInterval(fn) { poll = fn; return ++timerId; },
            clearInterval() { poll = undefined; }
        };
        const source = readFileSync(new URL(file, import.meta.url), "utf8");
        const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
        runInNewContext(outputText, context);
        return context.exports;
    }
    const { settings } = evaluate("../settings.tsx");
    const plugin = evaluate("../index.tsx").default;
    return {
        plugin, settings, sources, calls, live,
        setMonitor(id) { monitor = id; },
        poll: () => poll(),
        async start() {
            const source = await plugin.prepareSource({ id: "screen:vc-screenshare-plus", name: "Monitor under mouse", url: "" });
            live.desktopSource.id = source.id;
            plugin.flux.MEDIA_ENGINE_SET_GO_LIVE_SOURCE({ settings: { context: "stream", desktopSettings: { sourceId: source.id } } });
            return source;
        },
        async runTimers(delay) {
            for (const [id, timer] of [...timers]) if (timer.delay <= delay && timers.delete(id)) timer.fn();
            await new Promise(resolve => setImmediate(resolve));
        },
        unmount() { for (const dispose of cleanup) dispose(); }
    };
}

function captureOptions(plugin) {
    let source = "function updateVideo(){let r=t8().videoHook,a=n_(),s=a?3:0;return {useGraphicsCapture:a,useCaptureDeviceForEncode:(0,p.isWindows)(),useLoopback:true}}";
    const patch = plugin.patches.find(patch => patch.find === '"MediaEngineStore go live"');
    for (const replacement of patch.replacement) {
        const match = new RegExp(replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"), replacement.match.flags);
        source = source.replace(match, replacement.replace.replaceAll("$self", "plugin"));
    }
    return runInNewContext(`${source};updateVideo()`, { plugin, t8: () => ({ videoHook: false }), n_: () => true, p: { isWindows: () => true } });
}

function previewProps(plugin, props) {
    const source = "function v(e){return function(e,t){let{streamId:n,paused:i=!1}=e;return e}(e,v.onContainerResized)}";
    const patch = plugin.patches.find(patch => patch.find === '"DirectVideo"');
    assert.ok(patch);
    const match = new RegExp(patch.replacement.match.source.replaceAll("\\i", "(?:[A-Za-z_$][\\w$]*)"));
    const patched = source.replace(match, patch.replacement.replace.replaceAll("$self", "plugin"));
    assert.notEqual(patched, source);
    return runInNewContext(`${patched};v(props)`, { plugin, props });
}

test("a healthy preview retains GPU capture without a compatibility setting", async () => {
    const app = loadPlugin();
    app.settings.store.keepPreview = true;
    let ready = 0;
    previewProps(app.plugin, { streamId: "self-stream", onReady: () => ready++ }).onReady();
    await app.runTimers(5000);
    assert.equal(ready, 1);
    assert.equal(captureOptions(app.plugin).useCaptureDeviceForEncode, true);
    assert.equal(app.sources.length, 0);
    assert.equal(app.settings.def.previewCompatibility, undefined);
});

test("an unready local preview automatically recaptures once with compatibility frames", async () => {
    const app = loadPlugin();
    previewProps(app.plugin, { streamId: "self-stream" });
    await app.runTimers(5000);
    assert.equal(captureOptions(app.plugin).useCaptureDeviceForEncode, false);
    assert.equal(app.sources.length, 1);
    assert.equal(app.sources[0].desktopSettings.sourceId, "screen-handle:99");
    assert.equal(app.sources[0].desktopSettings.sound, true);
    previewProps(app.plugin, { streamId: "self-stream" });
    await app.runTimers(5000);
    assert.equal(app.sources.length, 1);
    app.plugin.stop();
    assert.equal(captureOptions(app.plugin).useCaptureDeviceForEncode, true);
});

test("paused and remote previews do not change the local capture path", async () => {
    const app = loadPlugin();
    previewProps(app.plugin, { streamId: "self-stream", paused: true });
    previewProps(app.plugin, { streamId: "remote-stream" });
    await app.runTimers(5000);
    assert.equal(app.sources.length, 0);
});

test("unmounting the preview cancels automatic recovery", async () => {
    const app = loadPlugin();
    previewProps(app.plugin, { streamId: "self-stream" });
    app.unmount();
    await app.runTimers(5000);
    assert.equal(app.sources.length, 0);
});

test("sharing starts and stays on direct capture even with fades enabled", async () => {
    const app = loadPlugin();
    assert.equal((await app.start()).id, "screen-handle:99");
    await app.poll();
    await app.runTimers(250);
    assert.equal(app.calls.filter(call => call[0] === "prepare").length, 0);
});

test("a monitor switch uses the fade helper temporarily and returns to direct capture", async () => {
    const app = loadPlugin();
    await app.start();
    app.setMonitor("2");
    await app.poll();
    assert.deepEqual(app.sources.map(source => source.desktopSettings.sourceId), ["window:77:0", "screen-handle:100"]);
    assert.equal(app.calls.find(call => call[0] === "prepare")[1], "1");
    assert.deepEqual(app.calls.at(-1), ["stop", true]);
    await app.runTimers(250);
    await app.poll();
    assert.equal(app.calls.filter(call => call[0] === "prepare").length, 1);
});

test("a failed fade falls back to sharing the new monitor directly", async () => {
    const app = loadPlugin({ prepare: () => ({ success: false, error: "Unavailable" }) });
    await app.start();
    app.setMonitor("2");
    await app.poll();
    assert.equal(app.live.desktopSource.id, "screen-handle:100");
});

test("a window handle cannot be mistaken for the destination monitor handle", async () => {
    const app = loadPlugin({ prepare: () => ({ success: true, sourceId: "window:100:0" }) });
    await app.start();
    app.setMonitor("2");
    await app.poll();
    assert.equal(app.live.desktopSource.id, "screen-handle:100");
    assert.deepEqual(app.calls.at(-1), ["stop", true]);
});

test("disabled fades switch directly without starting a helper", async () => {
    const app = loadPlugin();
    app.settings.store.fadeTransitions = false;
    await app.start();
    app.setMonitor("2");
    await app.poll();
    assert.deepEqual(app.sources.map(source => source.desktopSettings.sourceId), ["screen-handle:100"]);
    assert.equal(app.calls.filter(call => call[0] === "prepare").length, 0);
});

test("stopping during a fade prevents a late source switch", async () => {
    const completion = Promise.withResolvers();
    const app = loadPlugin({ move: () => completion.promise });
    await app.start();
    app.setMonitor("2");
    const switching = app.poll();
    await new Promise(resolve => setImmediate(resolve));
    app.plugin.stop();
    const count = app.sources.length;
    completion.resolve({ success: true });
    await switching;
    assert.equal(app.sources.length, count);
});

test("the helper remains selected until the native fade finishes", async () => {
    const completion = Promise.withResolvers();
    const app = loadPlugin({ move: () => completion.promise });
    await app.start();
    app.setMonitor("2");
    const switching = app.poll();
    await new Promise(resolve => setImmediate(resolve));
    await app.runTimers(250);
    assert.equal(app.live.desktopSource.id, "window:77:0");
    completion.resolve({ success: true });
    await switching;
    assert.equal(app.live.desktopSource.id, "screen-handle:100");
});

test("turning fades off cancels the transition and keeps direct sharing", async () => {
    const completion = Promise.withResolvers();
    const app = loadPlugin({ move: () => completion.promise });
    await app.start();
    app.setMonitor("2");
    const switching = app.poll();
    await new Promise(resolve => setImmediate(resolve));
    app.settings.store.fadeTransitions = false;
    app.plugin.onFadeChange();
    await app.runTimers(250);
    assert.equal(app.live.desktopSource.id, "screen-handle:100");
    const count = app.sources.length;
    completion.resolve({ success: true });
    await switching;
    assert.equal(app.sources.length, count);
});

test("a helper that finishes preparing after sharing stops is closed", async () => {
    const preparation = Promise.withResolvers();
    const app = loadPlugin({ prepare: () => preparation.promise });
    await app.start();
    app.setMonitor("2");
    const switching = app.poll();
    await new Promise(resolve => setImmediate(resolve));
    app.plugin.stop();
    preparation.resolve({ success: true, sourceId: "window:77:0" });
    await switching;
    assert.equal(app.sources.length, 0);
    assert.deepEqual(app.calls.at(-1), ["stop", undefined]);
});

test("changing ignored monitors during a fade restores an allowed direct source", async () => {
    const completion = Promise.withResolvers();
    const app = loadPlugin({ move: () => completion.promise });
    await app.start();
    app.setMonitor("2");
    const switching = app.poll();
    await new Promise(resolve => setImmediate(resolve));
    app.settings.store.ignoredMonitors = ["2"];
    app.plugin.onIgnoredMonitorsChange();
    await new Promise(resolve => setImmediate(resolve));
    completion.resolve({ success: true });
    await switching;
    assert.equal(app.live.desktopSource.id, "screen-handle:99");
});

test("changing the frame path reopens capture while keeping the source ID", () => {
    const { plugin } = loadPlugin();
    const connection = { context: "stream", goLiveSourceIdentifier: "screen-handle:99", soundshareId: 0 };
    const source = { desktopDescription: { id: "screen-handle:99", soundshareId: 0, useGraphicsCapture: true, useCaptureDeviceForEncode: true } };
    assert.equal(plugin.sameCapture(connection, source, "screen-handle:99"), false);
    assert.equal(plugin.sameCapture(connection, source, "screen-handle:99"), true);
    source.desktopDescription.useCaptureDeviceForEncode = false;
    assert.equal(plugin.sameCapture(connection, source, "screen-handle:99"), false);
    assert.equal(plugin.sameCapture(connection, source, "screen-handle:99"), true);
    source.desktopDescription.useCaptureDeviceForEncode = true;
    assert.equal(plugin.sameCapture(connection, source, "screen-handle:99"), false);
});
