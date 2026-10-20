/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DATA_DIR } from "@main/utils/constants";
import { ensureSafePath } from "@main/utils/ensureSafePath";
import { spawn } from "child_process";
import { createHash } from "crypto";
import { once } from "events";
import { access, mkdir, open, readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";

import type { PreparationProgress } from "../native";
import { captureBindings } from "./captureBindings";
import { captureHost } from "./captureHost";

export type ReportProgress = (progress: Partial<PreparationProgress>) => void;

const OBS_VERSION = "32.2.2";
const OBS_SHA256 = "4d6e40e3ab155f56b30de517380566a206d74b63cdf5ad49aa596924768f97e1";
const ARCHIVE_BYTES = 187_851_583;
const root = join(DATA_DIR, "ScreenSharePlus", `obs-${OBS_VERSION}`);
const DOWNLOAD = `https://github.com/obsproject/obs-studio/releases/download/${OBS_VERSION}/OBS-Studio-${OBS_VERSION}-Windows-x64.zip`;
const captureDigest = createHash("sha256").update(captureBindings + captureHost).digest("hex");

export function captureDirectory() {
    return join(DATA_DIR, "ScreenSharePlus");
}

export async function isCaptureConfigured() {
    try {
        const [archive, build] = await Promise.all([readFile(obsPath("ready"), "utf8"), readFile(obsPath("capture-build"), "utf8")]);
        await Promise.all([access(obsPath("bin/64bit/obs.dll")), access(obsPath("bin/64bit/ScreenSharePlusCapture.exe"))]);
        return archive === OBS_SHA256 && build === captureDigest;
    } catch {
        return false;
    }
}

export function obsPath(relative: string) {
    const path = ensureSafePath(root, relative);
    if (!path) throw new Error("Invalid screen share helper path.");
    return path;
}

export async function installObs(signal: AbortSignal, report: ReportProgress) {
    await mkdir(root, { recursive: true });
    const marker = obsPath("ready");
    report({ phase: "download", downloaded: 0, totalBytes: ARCHIVE_BYTES, status: "Downloading capture libraries." });
    const ready = await readFile(marker, "utf8").catch(() => "");
    if (ready === OBS_SHA256) {
        report({ downloaded: ARCHIVE_BYTES, phase: "configure", status: "Capture libraries are already installed." });
        return;
    }

    let url = DOWNLOAD;
    let response: Response | undefined;
    for (let redirect = 0; redirect <= 4; redirect++) {
        const parsed = new URL(url);
        if (parsed.protocol !== "https:" || !["github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(parsed.hostname))
            throw new Error("Invalid screen share helper download.");
        response = await fetch(url, { signal, redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location) throw new Error("Could not download the screen share helper.");
            url = new URL(location, url).href;
            continue;
        }
        break;
    }
    if (!response?.ok || !response.body) throw new Error("Could not download the screen share helper.");

    const archive = obsPath("obs.zip");
    const output = await open(archive, "w");
    const reader = response.body.getReader();
    const hash = createHash("sha256");
    let size = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            size += chunk.value.length;
            if (size > 256 * 1024 * 1024) throw new Error("The screen share helper download is too large.");
            hash.update(chunk.value);
            await output.writeFile(chunk.value);
            report({ downloaded: size });
        }
    } finally {
        try {
            await reader.cancel();
        } finally {
            await output.close();
        }
    }
    report({ phase: "configure", status: "Verifying capture libraries.", completed: 0 });
    if (hash.digest("hex") !== OBS_SHA256) throw new Error("Could not verify the screen share helper download.");

    report({ status: "Extracting capture libraries.", completed: 1 });
    const script = obsPath("extract.ps1");
    await writeFile(script, "param([string]$Archive,[string]$Destination)\n$ErrorActionPreference = 'Stop'\nExpand-Archive -LiteralPath $Archive -DestinationPath $Destination -Force\n");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, archive, root], {
        windowsHide: true, stdio: "ignore", signal
    });
    const [code] = await once(child, "exit", { signal });
    if (code !== 0) throw new Error("Could not unpack the screen share helper.");
    await writeFile(marker, OBS_SHA256);
}

export async function buildCaptureHost(signal: AbortSignal, report: ReportProgress) {
    const marker = obsPath("capture-build");
    const ready = await readFile(marker, "utf8").catch(() => "");
    report({ phase: "configure", completed: 2, status: "Preparing the background capture helper." });
    if (ready === captureDigest) return;
    const executable = obsPath("bin/64bit/ScreenSharePlusCapture.exe");
    await unlink(executable).catch((error: unknown) => {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
    await writeFile(obsPath("captureBindings.cs"), captureBindings);
    await writeFile(obsPath("captureHost.cs"), captureHost);
    const script = obsPath("build-capture.ps1");
    await writeFile(script, "param([string]$Root)\n$ErrorActionPreference = 'Stop'\n$compiler = New-Object Microsoft.CSharp.CSharpCodeProvider\ntry {\n    $options = New-Object System.CodeDom.Compiler.CompilerParameters\n    $options.GenerateExecutable = $true\n    $options.OutputAssembly = Join-Path $Root 'bin/64bit/ScreenSharePlusCapture.exe'\n    $options.CompilerOptions = '/platform:x64'\n    $options.ReferencedAssemblies.AddRange([string[]]@('System.dll','System.Windows.Forms.dll','System.Drawing.dll','System.Web.Extensions.dll','System.Core.dll'))\n    $result = $compiler.CompileAssemblyFromFile($options, [string[]]@((Join-Path $Root 'captureBindings.cs'),(Join-Path $Root 'captureHost.cs')))\n    if ($result.Errors.HasErrors) { throw 'Could not compile the capture helper.' }\n} finally { $compiler.Dispose() }\n");
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, obsPath("")], {
        windowsHide: true, stdio: "ignore", signal
    });
    const [code] = await once(child, "exit", { signal });
    if (code !== 0) throw new Error("Could not build the background capture helper.");
    await writeFile(marker, captureDigest);
}
