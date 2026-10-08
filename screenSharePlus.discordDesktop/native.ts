/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { execFile } from "child_process";
import { desktopCapturer, type DesktopCapturerSource, type Display, type IpcMainInvokeEvent, screen } from "electron";
import { readdir, rm } from "fs/promises";
import { join } from "path";
import { promisify } from "util";

import { captureDirectory, type Compositor, prepareHelper, startCompositor } from "./native/compositor";
import { closeIdentification, showIdentification } from "./native/identify";

let identificationRevision = 0;

export function stopIdentification(_: IpcMainInvokeEvent) {
    identificationRevision++;
    closeIdentification();
}

type CursorSourceResult =
    | { success: true; displayId: string; sourceId: null; }
    | { success: true; displayId: string; sourceId: string; url: string; }
    | { success: false; error: string; };

interface MonitorSource {
    id: string;
    displayId: string;
    name: string;
}

export interface Monitor {
    id: string;
    name: string;
}

let sourceCache: Promise<MonitorSource[]> | undefined;
let displayLayout: string | undefined;

interface CaptureMonitor {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

function captureMonitors(ignored: string[]): CaptureMonitor[] {
    return screen.getAllDisplays().filter((display: Display) => !ignored.includes(String(display.id))).map((display: Display) => {
        const bounds = screen.dipToScreenRect(null, display.bounds);
        return { id: String(display.id), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
}

function isDisplayId(value: unknown): value is string {
    return typeof value === "string" && /^-?\d{1,20}$/.test(value);
}

let compositor: Compositor | undefined;
let compositorGeneration = 0;
const retiringCompositors = new Set<Compositor>();

function closeCompositor() {
    compositorGeneration++;
    compositor?.close();
    compositor = undefined;
    for (const retiring of retiringCompositors) retiring.close();
    retiringCompositors.clear();
}

// Keeps the previous helper alive briefly so Discord can switch to the replacement without a gap.
function retireCompositor(previous: Compositor) {
    retiringCompositors.add(previous);
    setTimeout(() => {
        if (retiringCompositors.delete(previous)) previous.close();
    }, 3_000);
}

function canvasSize(monitors: CaptureMonitor[], resolution: number) {
    const largest = monitors.reduce((best, monitor) => monitor.width * monitor.height > best.width * best.height ? monitor : best);
    const shortest = Math.min(largest.width, largest.height);
    const scale = resolution > 0 && shortest > resolution ? resolution / shortest : 1;
    return { width: Math.max(2, Math.floor(largest.width * scale) & ~1), height: Math.max(2, Math.floor(largest.height * scale) & ~1) };
}

function isIgnoredList(value: unknown): value is string[] {
    return Array.isArray(value) && value.length <= 64 && value.every(isDisplayId);
}

export function warmCompositor(_: IpcMainInvokeEvent) {
    if (process.platform === "win32") void prepareHelper().catch(() => undefined);
}

export async function prepareCompositor(_: IpcMainInvokeEvent, displayId: unknown, ignored: unknown, frameRate: unknown, resolution: unknown, replace: unknown = false): Promise<
    | { success: true; sourceId: string; }
    | { success: false; error: string; }
> {
    if (!isDisplayId(displayId) || !isIgnoredList(ignored)) return { success: false, error: "Invalid monitor selection." };
    if (typeof frameRate !== "number" || !Number.isInteger(frameRate) || frameRate < 1 || frameRate > 240)
        return { success: false, error: "Invalid capture frame rate." };
    if (typeof resolution !== "number" || !Number.isInteger(resolution) || resolution < 0 || resolution > 4320)
        return { success: false, error: "Invalid capture resolution." };
    if (typeof replace !== "boolean") return { success: false, error: "Invalid capture replacement option." };
    if (process.platform !== "win32") return { success: false, error: "Monitor fades are only available on Windows." };
    if (replace) compositorGeneration++;
    else closeCompositor();
    const generation = compositorGeneration;
    try {
        const monitors = captureMonitors(ignored);
        const monitor = monitors.find(monitor => monitor.id === displayId);
        if (!monitor) return { success: false, error: "The selected monitor is ignored or unavailable." };
        const { width, height } = canvasSize(monitors, resolution);
        const started = await startCompositor(monitor, width, height, frameRate, 250);
        if (generation !== compositorGeneration) {
            started.close();
            return { success: false, error: "Monitor fade preparation was cancelled." };
        }
        if (compositor) retireCompositor(compositor);
        compositor = started;
        return { success: true, sourceId: started.sourceId };
    } catch {
        return { success: false, error: "Could not start the monitor fade helper." };
    }
}

export async function setCompositorMonitor(_: IpcMainInvokeEvent, displayId: unknown, ignored: unknown) {
    if (!isDisplayId(displayId) || !isIgnoredList(ignored)) return { success: false, error: "Invalid monitor selection." };
    if (!compositor) return { success: false, error: "The monitor fade helper is not running." };
    const monitor = captureMonitors(ignored).find(monitor => monitor.id === displayId);
    if (!monitor) return { success: false, error: "The selected monitor is ignored or unavailable." };
    try {
        await compositor.setMonitor(monitor);
        return { success: true };
    } catch {
        return { success: false, error: "The monitor fade helper could not switch monitors." };
    }
}

export function stopCompositor(_: IpcMainInvokeEvent, delayed: unknown = false) {
    if (delayed === true) {
        compositorGeneration++;
        if (compositor) retireCompositor(compositor);
        compositor = undefined;
    } else closeCompositor();
}

// Older versions downloaded OBS into this folder for fade transitions. The helper now uses Windows Graphics Capture directly.
export async function removeLegacyCapture(_: IpcMainInvokeEvent) {
    try {
        for (const entry of await readdir(captureDirectory))
            if (entry.startsWith("obs-")) await rm(join(captureDirectory, entry), { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
            console.warn("[ScreenSharePlus] Could not remove the old OBS capture files.", error);
    }
}

function getCaptureSources() {
    const layout = screen.getAllDisplays().map((display: Display) => [
        display.id, display.bounds.x, display.bounds.y, display.bounds.width, display.bounds.height, display.scaleFactor, display.rotation
    ].join(":")).join(",");

    if (sourceCache === undefined || displayLayout !== layout) {
        displayLayout = layout;
        sourceCache = desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
            .then(async (sources: DesktopCapturerSource[]) => {
                const monitors = process.platform === "win32" ? captureMonitors([]) : [];
                let handles: string[] = [];
                if (monitors.length > 0) {
                    const points = monitors.map(monitor => `${Math.round(monitor.x + monitor.width / 2)},${Math.round(monitor.y + monitor.height / 2)}`).join(",");
                    const script = `Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ScreenSharePlusMonitor {
    [StructLayout(LayoutKind.Sequential)] public struct Point { public int X, Y; }
    [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(Point point, uint flags);
    public static void Print(int[] points) {
        IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
        try {
            for (int i = 0; i < points.Length; i += 2)
                Console.WriteLine(MonitorFromPoint(new Point { X = points[i], Y = points[i + 1] }, 0).ToInt64());
        } finally { SetThreadDpiAwarenessContext(previous); }
    }
}
'@
[ScreenSharePlusMonitor]::Print([int[]]@(${points}))`;
                    const { stdout } = await promisify(execFile)("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
                        windowsHide: true, timeout: 10_000
                    });
                    handles = stdout.trim().split(/\r?\n/);
                    if (handles.length !== monitors.length || handles.some(handle => !/^[1-9]\d{0,19}$/.test(handle)))
                        throw new Error("Could not resolve Windows monitor handles.");
                }
                return sources.map((source: DesktopCapturerSource) => {
                    const index = monitors.findIndex(monitor => monitor.id === source.display_id);
                    if (process.platform === "win32" && index < 0)
                        throw new Error("Could not match a Windows capture monitor.");
                    return {
                        id: process.platform === "win32" ? `screen-handle:${handles[index]}` : source.id,
                        displayId: source.display_id,
                        name: source.name
                    };
                });
            });
    }

    return sourceCache;
}

export async function getMonitors(_: IpcMainInvokeEvent): Promise<
    | { success: true; monitors: Monitor[]; }
    | { success: false; error: string; }
> {
    try {
        const sources = await getCaptureSources();
        const displays = screen.getAllDisplays();
        return {
            success: true,
            monitors: sources.filter((source: MonitorSource) => isDisplayId(source.displayId)).map((source: MonitorSource) => {
                const display = displays.find((display: Display) => String(display.id) === source.displayId);
                return {
                    id: source.displayId,
                    name: display?.label ? `${source.name} (${display.label})` : source.name
                };
            })
        };
    } catch {
        sourceCache = undefined;
        return { success: false, error: "Could not read your monitors. Check screen recording permissions." };
    }
}

export async function identifyMonitor(event: IpcMainInvokeEvent, displayId: unknown, hovered: unknown = false): Promise<
    | { success: true; }
    | { success: false; error: string; }
> {
    if (!isDisplayId(displayId) || typeof hovered !== "boolean") return { success: false, error: "Invalid monitor selection." };
    const revision = ++identificationRevision;
    try {
        const result = await getMonitors(event);
        if (revision !== identificationRevision) return { success: true };
        if (!result.success) return result;
        const monitor = result.monitors.find((monitor: Monitor) => monitor.id === displayId);
        const display = screen.getAllDisplays().find((display: Display) => String(display.id) === displayId);
        if (!monitor || !display) return { success: false, error: "That monitor is no longer available." };
        await showIdentification(display, monitor.name, hovered);
        return { success: true };
    } catch {
        return { success: false, error: "Could not identify that monitor." };
    }
}

export async function getCursorSource(
    _: IpcMainInvokeEvent,
    previousDisplayId?: unknown,
    ignoredDisplayIds: unknown = [],
    includePreview: unknown = false
): Promise<CursorSourceResult> {
    if (previousDisplayId !== undefined && !isDisplayId(previousDisplayId))
        return { success: false, error: "Invalid monitor identifier." };

    if (!Array.isArray(ignoredDisplayIds) || ignoredDisplayIds.length > 64 || !ignoredDisplayIds.every(isDisplayId))
        return { success: false, error: "Invalid ignored monitor list." };

    if (typeof includePreview !== "boolean")
        return { success: false, error: "Invalid monitor preview option." };

    if (process.platform === "linux" && (process.env.XDG_SESSION_TYPE === "wayland" || process.env.WAYLAND_DISPLAY))
        return { success: false, error: "Following the mouse is not supported on Wayland." };

    try {
        let display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
        if (ignoredDisplayIds.includes(String(display.id))) {
            const allowed = screen.getAllDisplays().filter((display: Display) => !ignoredDisplayIds.includes(String(display.id)));
            const fallback = allowed.find((display: Display) => String(display.id) === previousDisplayId) ?? allowed[0];
            if (!fallback)
                return { success: false, error: "Every monitor is ignored. Allow at least one monitor before sharing." };
            display = fallback;
        }

        const displayId = String(display.id);
        if (displayId === previousDisplayId)
            return { success: true, displayId, sourceId: null };

        const sources = await getCaptureSources();
        const source = sources.find((source: MonitorSource) => source.displayId === displayId);
        if (!source)
            return { success: false, error: "Could not find the monitor under your mouse. Check screen recording permissions." };

        let url = "";
        if (includePreview) {
            const previews = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 447, height: 251 } });
            const preview = previews.find((source: DesktopCapturerSource) => source.display_id === displayId);
            if (preview) url = preview.thumbnail.toDataURL();
        }

        return { success: true, displayId, sourceId: source.id, url };
    } catch {
        sourceCache = undefined;
        return { success: false, error: "Could not read your monitors. Check screen recording permissions." };
    }
}
