/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { settings } from "./settings";

export type OutgoingMode = "off" | "translated" | "both";

export function getOutgoingMode(channelId: string): OutgoingMode {
    return settings.store.rememberOutgoingModePerChannel
        ? settings.store.outgoingModesByChannel?.[channelId] ?? "off"
        : settings.store.outgoingMode ?? "off";
}

export function setOutgoingMode(channelId: string, mode: OutgoingMode) {
    if (!settings.store.rememberOutgoingModePerChannel) {
        settings.store.outgoingMode = mode;
        return;
    }

    const modes = { ...settings.store.outgoingModesByChannel };
    if (mode === "off") delete modes[channelId];
    else modes[channelId] = mode;
    settings.store.outgoingModesByChannel = modes;
}
