/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import { writeFile } from "fs/promises";
import { createInterface } from "readline";
import { setTimeout as sleep } from "timers/promises";

import { buildCaptureHost, installObs, obsPath, type ReportProgress } from "./obsSetup";

export interface CaptureMonitor {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export type CaptureMethod = "obs" | "wgc" | "dxgi";

export interface Compositor {
    sourceId: string;
    setMonitor(id: string, monitors: CaptureMonitor[]): Promise<void>;
    close(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startCompositor(monitors: CaptureMonitor[], initialId: string, signal: AbortSignal, report: ReportProgress, windowHandle?: string, frameRate = 60, captureMethod: CaptureMethod = "wgc"): Promise<Compositor> {
    await installObs(signal, report);
    await buildCaptureHost(signal, report);
    signal.throwIfAborted();
    const configuration = obsPath("capture.json");
    await writeFile(configuration, JSON.stringify({ root: obsPath(""), id: initialId, monitors, window: windowHandle, fps: frameRate,
        method: captureMethod === "obs" ? 0 : captureMethod === "dxgi" ? 1 : 2 }));
    const child = spawn(obsPath("bin/64bit/ScreenSharePlusCapture.exe"), [configuration], {
        cwd: obsPath("bin/64bit"), windowsHide: true, stdio: ["pipe", "pipe", "ignore"]
    });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, {
        resolve(): void;
        reject(error: Error): void;
        timeout: ReturnType<typeof setTimeout>;
    }>();
    let sequence = 0;
    let alive = true;
    let readyResolve: (sourceId: string) => void;
    let readyReject: (error: Error) => void;
    const ready = new Promise<string>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

    function close() {
        signal.removeEventListener("abort", close);
        if (!alive) return;
        alive = false;
        lines.close();
        if (child.exitCode === null && !child.killed) child.kill();
        const error = new Error("The background capture helper disconnected.");
        readyReject(error);
        for (const request of pending.values()) {
            clearTimeout(request.timeout);
            request.reject(error);
        }
        pending.clear();
    }

    function message(line: string) {
        if (!line.startsWith("ScreenSharePlus:") || line.length > 65_536) return;
        let packet: unknown;
        try { packet = JSON.parse(line.slice("ScreenSharePlus:".length)); } catch { return close(); }
        if (!isRecord(packet)) return close();
        if (packet.type === "progress" && typeof packet.status === "string" && typeof packet.completed === "number" && typeof packet.total === "number")
            report({ status: packet.status, completed: packet.completed + 4, totalSteps: packet.total + 4 });
        else if (packet.type === "ready" && typeof packet.sourceId === "string" && /^window:\d{1,20}:0$/.test(packet.sourceId))
            readyResolve(packet.sourceId);
        else if (typeof packet.sequence === "number") {
            const request = pending.get(packet.sequence);
            if (request) {
                pending.delete(packet.sequence);
                clearTimeout(request.timeout);
                if (packet.type === "updated") request.resolve();
                else request.reject(new Error("Could not switch the prepared monitor."));
            } else if (packet.type === "error") close();
        }
    }

    lines.on("line", message);
    child.on("error", close);
    child.on("exit", close);
    signal.addEventListener("abort", close, { once: true });
    if (signal.aborted) close();
    try {
        const sourceId = await ready;
        let switching = Promise.resolve();
        let currentSelection = JSON.stringify({ id: initialId, monitors });
        return {
            sourceId,
            setMonitor(id: string, allowed: CaptureMonitor[]) {
                const selection = JSON.stringify({ id, monitors: allowed });
                if (selection === currentSelection && alive) return Promise.resolve();
                const next = switching.then(async () => {
                    signal.throwIfAborted();
                    if (!alive) throw new Error("The background capture helper disconnected.");
                    const currentSequence = ++sequence;
                    await new Promise<void>((resolve, reject) => {
                        pending.set(currentSequence, {
                            resolve, reject,
                            timeout: setTimeout(() => {
                                pending.delete(currentSequence);
                                reject(new Error("The background capture helper did not respond."));
                            }, 10_000)
                        });
                        child.stdin.write(JSON.stringify({ id, monitors: allowed, sequence: currentSequence }) + "\n");
                    });
                    await sleep(120, undefined, { signal });
                    currentSelection = selection;
                });
                switching = next.catch(() => undefined);
                return next;
            },
            close
        };
    } catch (error) {
        close();
        throw error;
    }
}
