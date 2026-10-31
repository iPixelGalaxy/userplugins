/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent, shell } from "electron";
import { request } from "https";

const validRedirectUrls = /^https:\/\/(spotify\.link|s\.team)\/.+$/;
const redirectHosts = new Set([
    "spotify.link", "spotify.app.link", "open.spotify.com", "spotify.com", "www.spotify.com",
    "s.team", "steamcommunity.com", "store.steampowered.com", "help.steampowered.com"
]);

function getRedirect(url: string, hops = 0): Promise<string> {
    return new Promise(resolve => {
        const req = request(url, { method: "HEAD" }, res => {
            res.resume();
            const location = res.headers.location;
            if (!location || hops >= 5 || !res.statusCode || res.statusCode < 300 || res.statusCode >= 400) {
                resolve(url);
                return;
            }

            try {
                const next = new URL(location, url);
                resolve(next.protocol === "https:" && redirectHosts.has(next.hostname) && !next.username && !next.password && !next.port
                    ? getRedirect(next.href, hops + 1)
                    : url);
            } catch {
                resolve(url);
            }
        });
        req.setTimeout(5000, () => req.destroy());
        req.on("error", () => resolve(url));
        req.end();
    });
}

export async function resolveRedirect(_: IpcMainInvokeEvent, url: string) {
    if (typeof url !== "string" || url.length > 4096 || !validRedirectUrls.test(url)) return "";
    return getRedirect(url);
}

export async function openLyssna(_: IpcMainInvokeEvent, url: string) {
    if (typeof url !== "string" || url.length > 4096 || !/^lyssna:\/\/(track|album|artist|playlist|user|episode|show)\/[A-Za-z0-9._~%\-]+$/.test(url))
        return { success: false, error: "Invalid Lyssna link." } as const;

    try {
        await shell.openExternal(url);
        return { success: true } as const;
    } catch {
        return { success: false, error: "Could not open Lyssna. Install a version that supports lyssna:// links." } as const;
    }
}
