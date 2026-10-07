/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { BrowserWindow, type Display } from "electron";

let identification: BrowserWindow | undefined;
let timeout: ReturnType<typeof setTimeout> | undefined;

export function closeIdentification() {
    if (timeout !== undefined) clearTimeout(timeout);
    timeout = undefined;
    identification?.destroy();
    identification = undefined;
}

export async function showIdentification(display: Display, name: string, hovered: boolean) {
    closeIdentification();
    const width = Math.min(420, display.workArea.width);
    const height = Math.min(180, display.workArea.height);
    const window = new BrowserWindow({
        x: display.workArea.x + Math.round((display.workArea.width - width) / 2),
        y: display.workArea.y + Math.round((display.workArea.height - height) / 2),
        width, height, frame: false, show: false, focusable: false, skipTaskbar: true,
        resizable: false, backgroundColor: "#1e1f22",
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, javascript: false, partition: "ScreenSharePlusIdentify" }
    });
    identification = window;
    window.once("closed", () => {
        if (identification !== window) return;
        identification = undefined;
        if (timeout !== undefined) clearTimeout(timeout);
        timeout = undefined;
    });
    window.setAlwaysOnTop(true, "screen-saver");
    window.setIgnoreMouseEvents(true);
    window.setContentProtection(true);
    const label = name.replace(/[&<>]/g, (character: string) => character === "&" ? "&amp;" : character === "<" ? "&lt;" : "&gt;");
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
        .vc-screenshare-plus-identification { margin: 0; padding: 28px; box-sizing: border-box; height: 100vh; display: grid; align-content: center; text-align: center; font-family: system-ui; color: #f2f3f5; }
        .vc-screenshare-plus-identification h1 { font-size: 32px; margin: 0 0 12px; overflow-wrap: anywhere; }
        .vc-screenshare-plus-identification p { font-size: 16px; margin: 0; }
        </style></head><body class="vc-screenshare-plus-identification"><h1>${label}</h1><p>ScreenSharePlus monitor identification.</p></body></html>`;
    try {
        await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
        if (window.isDestroyed()) return;
        window.showInactive();
        if (!hovered) timeout = setTimeout(() => window.destroy(), 3000);
    } catch (error) {
        if (window.isDestroyed()) return;
        closeIdentification();
        throw error;
    }
}
