/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { once } from "events";
import { access, mkdir, readdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { createInterface } from "readline";

import { helperSource } from "./helperSource";

export interface CaptureRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Compositor {
    sourceId: string;
    setMonitor(region: CaptureRegion): Promise<void>;
    close(): void;
}

export const captureDirectory = join(DATA_DIR, "ScreenSharePlus");
const helperDirectory = join(captureDirectory, "helper");
const helperName = `capture-${createHash("sha256").update(helperSource).digest("hex").slice(0, 16)}`;
const helperPath = join(helperDirectory, `${helperName}.exe`);
const buildScript = `param([string]$Source, [string]$Output)
$ErrorActionPreference = 'Stop'
$framework = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$metadata = Join-Path $env:SystemRoot 'System32\\WinMetadata'
$compiler = New-Object Microsoft.CSharp.CSharpCodeProvider
try {
    $options = New-Object System.CodeDom.Compiler.CompilerParameters
    $options.GenerateExecutable = $true
    $options.OutputAssembly = $Output
    $options.CompilerOptions = '/platform:x64 /optimize+ /target:winexe'
    $options.ReferencedAssemblies.AddRange([string[]]@(
        'System.dll', 'System.Core.dll', 'System.Windows.Forms.dll', 'System.Drawing.dll', 'System.Web.Extensions.dll',
        (Join-Path $framework 'System.Runtime.dll'),
        (Join-Path $framework 'System.Runtime.WindowsRuntime.dll'),
        (Join-Path $framework 'System.Runtime.InteropServices.WindowsRuntime.dll'),
        (Join-Path $metadata 'Windows.Foundation.winmd'),
        (Join-Path $metadata 'Windows.Graphics.winmd')))
    $result = $compiler.CompileAssemblyFromFile($options, [string[]]@($Source))
    if ($result.Errors.HasErrors) { throw 'Could not compile the capture helper.' }
} finally { $compiler.Dispose() }
`;

let building: Promise<void> | undefined;

async function buildHelper() {
    if (await access(helperPath).then(() => true, () => false)) return;
    await mkdir(helperDirectory, { recursive: true });
    for (const entry of await readdir(helperDirectory))
        if (!entry.startsWith(helperName)) await rm(join(helperDirectory, entry), { force: true }).catch(() => undefined);
    const source = join(helperDirectory, `${helperName}.cs`);
    const script = join(helperDirectory, `${helperName}.ps1`);
    await writeFile(source, helperSource);
    await writeFile(script, buildScript);
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, source, helperPath], {
        windowsHide: true, stdio: "ignore"
    });
    const [code] = await once(child, "exit");
    if (code !== 0) throw new Error("Could not build the capture helper.");
}

export function prepareHelper() {
    building ??= buildHelper().catch((error: unknown) => {
        building = undefined;
        throw error;
    });
    return building;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function startCompositor(monitor: CaptureRegion, width: number, height: number, fps: number, fade: number): Promise<Compositor> {
    await prepareHelper();
    const configuration = Buffer.from(JSON.stringify({ monitor, width, height, fps, fade })).toString("base64");
    const child = spawn(helperPath, [configuration], { windowsHide: true, stdio: ["pipe", "pipe", "ignore"] });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, { resolve(): void; reject(error: Error): void; timeout: ReturnType<typeof setTimeout>; }>();
    let sequence = 0;
    let alive = true;
    let readyResolve!: (sourceId: string) => void;
    let readyReject!: (error: Error) => void;
    const ready = new Promise<string>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const readyTimeout = setTimeout(() => close(), 15_000);

    function close() {
        clearTimeout(readyTimeout);
        if (!alive) return;
        alive = false;
        lines.close();
        if (child.exitCode === null && !child.killed) child.kill();
        const error = new Error("The capture helper stopped.");
        readyReject(error);
        for (const request of pending.values()) {
            clearTimeout(request.timeout);
            request.reject(error);
        }
        pending.clear();
    }

    lines.on("line", (line: string) => {
        if (!line.startsWith("ScreenSharePlus:") || line.length > 65_536) return;
        let packet: unknown;
        try { packet = JSON.parse(line.slice("ScreenSharePlus:".length)); } catch { return; }
        if (!isRecord(packet)) return;
        if (packet.type === "ready" && typeof packet.sourceId === "string" && /^window:\d{1,20}:0$/.test(packet.sourceId)) {
            clearTimeout(readyTimeout);
            readyResolve(packet.sourceId);
        } else if (typeof packet.sequence === "number") {
            const request = pending.get(packet.sequence);
            if (request) {
                pending.delete(packet.sequence);
                clearTimeout(request.timeout);
                if (packet.type === "updated") request.resolve();
                else request.reject(new Error("The capture helper could not switch monitors."));
            } else if (packet.type === "error" && packet.sequence === 0) close();
        }
    });
    child.on("error", close);
    child.on("exit", close);

    try {
        const sourceId = await ready;
        return {
            sourceId,
            setMonitor(region: CaptureRegion) {
                if (!alive) return Promise.reject(new Error("The capture helper stopped."));
                const current = ++sequence;
                return new Promise<void>((resolve, reject) => {
                    pending.set(current, {
                        resolve, reject,
                        timeout: setTimeout(() => {
                            pending.delete(current);
                            reject(new Error("The capture helper did not respond."));
                        }, 5_000)
                    });
                    child.stdin.write(JSON.stringify({ sequence: current, monitor: region }) + "\n");
                });
            },
            close
        };
    } catch (error) {
        close();
        throw error;
    }
}
