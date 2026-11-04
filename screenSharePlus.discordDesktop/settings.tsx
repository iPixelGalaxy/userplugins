/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSetting, SettingsStore } from "@api/Settings";
import { OptionType } from "@utils/types";

import ScreenSharePlus from "./index";
import { isIgnoredMonitor, monitorKey } from "./monitors";
import type { Monitor } from "./native";
import type { CaptureMethod } from "./native/compositor";

migratePluginSetting("ScreenSharePlus", "useObsCapture", "smoothTransitions");

const savedSettings = SettingsStore.plain.plugins.ScreenSharePlus;
if (savedSettings && ("mobileCompatibility" in savedSettings || "limitFrameRate" in savedSettings)) {
    delete savedSettings.mobileCompatibility;
    delete savedSettings.limitFrameRate;
    SettingsStore.markAsChanged();
}

const ignoredMonitors: string[] = [];

export const settings = definePluginSettings({
    codec: {
        type: OptionType.SELECT,
        description: "Video codec used for screen sharing. Restart sharing after changing this.",
        options: [
            { label: "H264", value: "H264", default: true },
            { label: "H265", value: "H265" },
            { label: "AV1", value: "AV1" },
            { label: "VP8", value: "VP8" },
            { label: "VP9", value: "VP9" }
        ],
        hidden: true
    },
    retainScreenshare: {
        type: OptionType.BOOLEAN,
        description: "Resume your last screenshare when rejoining voice in the same server, including after a crash or reload.",
        default: false,
        onChange(value: boolean) { ScreenSharePlus.onRetainChange(value); }
    },
    retainScreenshareTimeout: {
        type: OptionType.SLIDER,
        description: "Minutes after leaving voice before your saved screenshare expires.",
        markers: [1, 5, 10, 15, 30],
        default: 5,
        stickToMarkers: false,
        hidden: true,
        onChange() { ScreenSharePlus.onRetainTimeoutChange(); }
    },
    useObsCapture: {
        type: OptionType.BOOLEAN,
        description: "Use OBS libraries for monitor and application capture.",
        default: false,
        hidden: true
    },
    obsCaptureAcknowledged: {
        type: OptionType.BOOLEAN,
        description: "The capture download and removal notice has been accepted.",
        default: false,
        hidden: true
    },
    captureMethod: {
        type: OptionType.SELECT,
        description: "Capture method used by the monitor fade compositor.",
        options: [
            { label: "WGC with DXGI fallback", value: "wgc" satisfies CaptureMethod, default: true },
            { label: "OBS Automatic", value: "obs" satisfies CaptureMethod },
            { label: "DXGI Desktop", value: "dxgi" satisfies CaptureMethod }
        ],
        hidden: true
    },
    bitrate: {
        type: OptionType.SLIDER,
        description: "Maximum video bitrate in Mbps. Zero uses Discord's automatic limit.",
        markers: [0, 1, 2, 4, 6, 8, 10, 15, 20],
        default: 0,
        stickToMarkers: false,
        hidden: true,
        onChange() { ScreenSharePlus.updateBitrate(); }
    },
    keepPreview: {
        type: OptionType.BOOLEAN,
        description: "Keep your local stream preview playing.",
        default: false,
        hidden: true
    },
    ignoredMonitors: {
        type: OptionType.CUSTOM,
        description: "Monitors excluded from automatic switching.",
        default: ignoredMonitors,
        hidden: true,
        onChange() { ScreenSharePlus.onIgnoredMonitorsChange(); }
    }
});

export function rememberIgnoredMonitors(monitors: Monitor[]) {
    const ignored = settings.store.ignoredMonitors;
    const remembered = [...new Set([
        ...ignored.filter(key => !monitors.some(monitor => isIgnoredMonitor(monitor, [key], monitors))),
        ...monitors.filter(monitor => isIgnoredMonitor(monitor, ignored, monitors)).map(monitorKey)
    ])];
    if (remembered.length !== ignored.length || remembered.some(key => !ignored.includes(key)))
        settings.store.ignoredMonitors = remembered;
}
