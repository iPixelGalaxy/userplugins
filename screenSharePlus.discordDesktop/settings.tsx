/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import ScreenSharePlus from "./index";

const ignoredMonitors: string[] = [];

export type CaptureApi = "wgc" | "dxgi";
export type Degradation = "disabled" | "balanced" | "framerate" | "resolution";

export const settings = definePluginSettings({
    captureApi: {
        type: OptionType.SELECT,
        description: "Windows API Discord uses to capture your screen.",
        options: [
            { label: "Windows Graphics Capture", value: "wgc" as const satisfies CaptureApi, default: true },
            { label: "DXGI Desktop Duplication", value: "dxgi" as const satisfies CaptureApi }
        ],
        hidden: true,
        onChange() { ScreenSharePlus.onCaptureApiChange(); }
    },
    fadeTransitions: {
        type: OptionType.BOOLEAN,
        description: "Fade between monitors when Monitor under mouse switches.",
        default: true,
        hidden: true,
        onChange() { ScreenSharePlus.onFadeChange(); }
    },
    bitrate: {
        type: OptionType.SLIDER,
        description: "Maximum video bitrate in Mbps. Zero uses Discord's automatic limit.",
        markers: [0, 2, 5, 10, 15, 20, 30, 40, 50],
        default: 0,
        stickToMarkers: false,
        hidden: true,
        onChange() { ScreenSharePlus.updateBitrate(); }
    },
    lockBitrate: {
        type: OptionType.BOOLEAN,
        description: "Never let the video bitrate drop below the maximum.",
        default: false,
        hidden: true,
        onChange() { ScreenSharePlus.updateBitrate(); }
    },
    limitFrameRate: {
        type: OptionType.BOOLEAN,
        description: "Limit screen sharing to 30 FPS for more detail during movement.",
        default: false,
        hidden: true,
        onChange() {
            ScreenSharePlus.updateBitrate();
            ScreenSharePlus.onFrameRateLimitChange();
        }
    },
    degradation: {
        type: OptionType.SELECT,
        description: "What WebRTC gives up first when your upload cannot keep up.",
        options: [
            { label: "Never lower", value: "disabled" as const satisfies Degradation, default: true },
            { label: "Balanced", value: "balanced" as const satisfies Degradation },
            { label: "Keep frame rate", value: "framerate" as const satisfies Degradation },
            { label: "Keep sharpness", value: "resolution" as const satisfies Degradation }
        ],
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
