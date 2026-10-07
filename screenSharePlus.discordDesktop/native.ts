/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { desktopCapturer, type DesktopCapturerSource, type Display, type IpcMainInvokeEvent, screen } from "electron";

import { type CaptureMonitor, type Compositor, startCompositor } from "./native/compositor";
import { closeIdentification, showIdentification } from "./native/identify";
import { captureDirectory, isCaptureConfigured } from "./native/obsSetup";

let identificationRevision = 0;

export function getCaptureDirectory(_: IpcMainInvokeEvent) {
    return captureDirectory();
}

export function isCaptureReady(_: IpcMainInvokeEvent) {
    return isCaptureConfigured();
}

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

export interface PreparationProgress {
    phase: "download" | "configure" | "ready" | "error";
    downloaded: number;
    totalBytes: number;
    completed: number;
    totalSteps: number;
    status: string;
}

let preparationProgress: PreparationProgress = {
    phase: "download", downloaded: 0, totalBytes: 0, completed: 0, totalSteps: 1, status: "Starting screen share preparation."
};

export function getPreparationProgress(_: IpcMainInvokeEvent) {
    return preparationProgress;
}

let sourceCache: Promise<MonitorSource[]> | undefined;
let displayLayout: string | undefined;
let compositor: Compositor | undefined;
let compositorAbort: AbortController | undefined;
let compositorGeneration = 0;

function captureMonitors(ignored: string[]): CaptureMonitor[] {
    return screen.getAllDisplays().filter((display: Display) => !ignored.includes(String(display.id))).map((display: Display) => {
        const bounds = screen.dipToScreenRect(null, display.bounds);
        return { id: String(display.id), x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
}

function closeCompositor() {
    compositorGeneration++;
    compositorAbort?.abort();
    compositorAbort = undefined;
    compositor?.close();
    compositor = undefined;
}

function isDisplayId(value: unknown): value is string {
    return typeof value === "string" && /^-?\d{1,20}$/.test(value);
}

export async function prepareCompositor(_: IpcMainInvokeEvent, displayId: unknown, ignored: unknown, frameRate: unknown = 60, captureMethod: unknown = "wgc"): Promise<
    | { success: true; sourceId: string; }
    | { success: false; error: string; }
> {
    const followCursor = isDisplayId(displayId);
    if ((!followCursor && !(typeof displayId === "string" && /^(?:screen|window):\d{1,20}:\d+$/.test(displayId)))
        || !Array.isArray(ignored) || ignored.length > 64 || !ignored.every(isDisplayId))
        return { success: false, error: "Invalid monitor selection." };
    if (typeof frameRate !== "number" || !Number.isInteger(frameRate) || frameRate < 1 || frameRate > 240)
        return { success: false, error: "Invalid capture frame rate." };
    if (captureMethod !== "obs" && captureMethod !== "wgc" && captureMethod !== "dxgi")
        return { success: false, error: "Invalid capture method." };
    if (process.platform !== "win32" || process.arch !== "x64")
        return { success: false, error: "Prepared transitions are not available on this platform." };
    closeCompositor();
    const generation = compositorGeneration;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    compositorAbort = controller;
    try {
        let monitors = captureMonitors(ignored);
        let initialId = String(displayId);
        let windowHandle: string | undefined;
        if (!followCursor) {
            const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 0, height: 0 } });
            const source = sources.find((source: DesktopCapturerSource) => source.id === displayId);
            if (!source) return { success: false, error: "That capture source is no longer available." };
            if (source.id.startsWith("window:")) {
                windowHandle = source.id.split(":")[1];
                initialId = "window";
                monitors = [];
            } else {
                initialId = source.display_id;
                monitors = captureMonitors([]).filter((monitor: CaptureMonitor) => monitor.id === initialId);
            }
        }
        if (windowHandle === undefined && !monitors.some((monitor: CaptureMonitor) => monitor.id === initialId))
            return { success: false, error: "The selected monitor is ignored or unavailable." };
        preparationProgress = { phase: "download", downloaded: 0, totalBytes: 0, completed: 0, totalSteps: monitors.length + 9, status: "Starting screen share preparation." };
        const prepared = await startCompositor(monitors, initialId, controller.signal, (update: Partial<PreparationProgress>) => {
            if (generation === compositorGeneration) preparationProgress = { ...preparationProgress, ...update };
        }, windowHandle, frameRate, captureMethod);
        if (generation !== compositorGeneration) {
            prepared.close();
            return { success: false, error: "Screen share preparation was cancelled." };
        }
        compositor = prepared;
        preparationProgress = { ...preparationProgress, phase: "ready", completed: preparationProgress.totalSteps, status: "Ready to share." };
        return { success: true, sourceId: prepared.sourceId };
    } catch {
        if (generation === compositorGeneration) {
            preparationProgress = { ...preparationProgress, phase: "error", status: "Capture setup failed. Native monitor switching is still available." };
            closeCompositor();
        }
        return { success: false, error: "Could not prepare smooth transitions. Native monitor switching is still available." };
    } finally {
        clearTimeout(timeout);
    }
}

export async function setCompositorMonitor(_: IpcMainInvokeEvent, displayId: unknown, ignored: unknown) {
    if (!isDisplayId(displayId) || !Array.isArray(ignored) || ignored.length > 64 || !ignored.every(isDisplayId))
        return { success: false, error: "Invalid monitor selection." };
    if (!compositor) return { success: false, error: "The prepared screen share is not available." };
    try {
        const monitors = captureMonitors(ignored);
        if (!monitors.some((monitor: CaptureMonitor) => monitor.id === displayId))
            return { success: false, error: "The selected monitor is ignored or unavailable." };
        await compositor.setMonitor(displayId, monitors);
        return { success: true };
    } catch {
        return { success: false, error: "Could not update the prepared screen share." };
    }
}

export function stopCompositor(_: IpcMainInvokeEvent) {
    stopIdentification(_);
    closeCompositor();
    return { success: true };
}

function getCaptureSources() {
    const layout = screen.getAllDisplays().map((display: Display) => [
        display.id, display.bounds.x, display.bounds.y, display.bounds.width, display.bounds.height, display.scaleFactor, display.rotation
    ].join(":")).join(",");

    if (sourceCache === undefined || displayLayout !== layout) {
        displayLayout = layout;
        sourceCache = desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 0, height: 0 } })
            .then((sources: DesktopCapturerSource[]) => sources.map((source: DesktopCapturerSource) => ({
                id: source.id,
                displayId: source.display_id,
                name: source.name
            })));
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
