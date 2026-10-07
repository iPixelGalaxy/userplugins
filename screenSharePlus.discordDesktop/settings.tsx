/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSetting } from "@api/Settings";
import { OptionType } from "@utils/types";

import ScreenSharePlus from "./index";
import type { CaptureMethod } from "./native/compositor";

migratePluginSetting("ScreenSharePlus", "useObsCapture", "smoothTransitions");

const ignoredMonitors: string[] = [];

export const settings = definePluginSettings({
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
    limitFrameRate: {
        type: OptionType.BOOLEAN,
        description: "Limit screen sharing to 30 FPS for more detail during movement.",
        default: false,
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
