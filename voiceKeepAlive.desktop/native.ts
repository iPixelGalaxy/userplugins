/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { IpcMainInvokeEvent, powerSaveBlocker } from "electron";

interface KeepAliveState {
    blocker?: number;
    release: () => void;
}

const activeWindows = new Map<number, KeepAliveState>();

export function setActive({ sender }: IpcMainInvokeEvent, active: boolean, preventSleep: boolean) {
    if (typeof active !== "boolean" || typeof preventSleep !== "boolean")
        return { success: false, error: "Invalid keepalive options." } as const;

    if (sender.isDestroyed())
        return { success: false, error: "Discord's window is no longer available." } as const;

    const id = sender.id;
    let state = activeWindows.get(id);

    try {
        if (!active) {
            state?.release();
            return { success: true } as const;
        }

        if (!state) {
            const backgroundThrottling = sender.getBackgroundThrottling();
            const entry: KeepAliveState = {
                release() {
                    activeWindows.delete(id);
                    sender.removeListener("destroyed", entry.release);
                    sender.removeListener("render-process-gone", entry.release);
                    sender.removeListener("did-navigate", entry.release);
                    if (entry.blocker !== undefined) {
                        powerSaveBlocker.stop(entry.blocker);
                        entry.blocker = undefined;
                    }
                    if (!sender.isDestroyed()) sender.setBackgroundThrottling(backgroundThrottling);
                }
            };
            state = entry;
            activeWindows.set(id, entry);
            sender.on("destroyed", entry.release);
            sender.on("render-process-gone", entry.release);
            sender.on("did-navigate", entry.release);
        }

        sender.setBackgroundThrottling(false);
        if (preventSleep && state.blocker === undefined)
            state.blocker = powerSaveBlocker.start("prevent-app-suspension");
        else if (!preventSleep && state.blocker !== undefined) {
            powerSaveBlocker.stop(state.blocker);
            state.blocker = undefined;
        }

        return { success: true } as const;
    } catch {
        state?.release();
        return { success: false, error: "Could not change Discord's power management settings." } as const;
    }
}
