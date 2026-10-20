/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import ScreenSharePlus from "./index";
import { isIgnoredMonitor, monitorKey } from "./monitors";
import type { Monitor } from "./native";

const ignoredMonitors: string[] = [];

export type CaptureApi = "wgc" | "dxgi";
export type Degradation = "disabled" | "balanced" | "framerate" | "resolution";

export const settings = definePluginSettings({
    mobileCompatibility: {
        type: OptionType.BOOLEAN,
        description: "Use H.264 or VP8 for screen sharing, including when another plugin disables these codecs. Applies to new shares.",
        default: true,
        hidden: true
    },
    retainScreenshare: {
        type: OptionType.BOOLEAN,
        description: "Resume your last screenshare when joining another voice channel in the same server, including after a crash or reload.",
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

export function rememberIgnoredMonitors(monitors: Monitor[]) {
    const ignored = settings.store.ignoredMonitors;
    const remembered = [...new Set([
        ...ignored.filter(key => !monitors.some(monitor => isIgnoredMonitor(monitor, [key], monitors))),
        ...monitors.filter(monitor => isIgnoredMonitor(monitor, ignored, monitors)).map(monitorKey)
    ])];
    if (remembered.length !== ignored.length || remembered.some(key => !ignored.includes(key)))
        settings.store.ignoredMonitors = remembered;
}
