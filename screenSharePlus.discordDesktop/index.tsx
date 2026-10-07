/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { EquicordDevs } from "@utils/constants";
import { Logger } from "@utils/Logger";
import definePlugin, { PluginNative } from "@utils/types";
import type { MediaEngineConnection } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ApplicationStreamingSettingsStore, FluxDispatcher, MediaEngineStore, React, showToast, UserStore, VoiceActions } from "@webpack/common";

import { CaptureMenu } from "./controls";
import { openPreparationProgress } from "./progress";
import { settings } from "./settings";

interface StreamBitrate {
    bitrateMin: number;
    bitrateMax: number;
    bitrateTarget?: number;
    capture: { framerate: number; };
    encode: { framerate: number; };
}

interface MonitorMenuProps {
    id?: string;
    menuItemProps: {
        onMouseEnter?(event: React.MouseEvent): void;
        onMouseLeave?(event: React.MouseEvent): void;
    };
}

interface CaptureSource {
    id: string;
    name: string;
    url: string;
}

interface SourceEvent {
    settings: { context?: string; desktopSettings?: { sourceId: string; }; } | null;
}

interface StreamStartEvent {
    type: "STREAM_START";
    sourceId?: string;
    sourceName?: string;
    [key: string]: unknown;
}

const Native = VencordNative.pluginHelpers.ScreenSharePlus as PluginNative<typeof import("./native")>;
const logger = new Logger("ScreenSharePlus");
const SOURCE_ID = "screen:vc-screenshare-plus";
const SOURCE_NAME = "Monitor under mouse";
const SoundshareStore: { getPidFromDesktopSource(id: string): number | null; } = findByPropsLazy("getPidFromDesktopSource");

let following = false;
let generation = 0;
let displayId: string | undefined;
let sourceId: string | undefined;
let intervalId: ReturnType<typeof setInterval> | undefined;
let startTimeout: ReturnType<typeof setTimeout> | undefined;
let updating = false;
let videoSwitchSourceId: string | undefined;
let compositorSourceId: string | undefined;
let audioSourceId: string | undefined;

function stopFollowing() {
    following = false;
    generation++;
    displayId = undefined;
    sourceId = undefined;
    videoSwitchSourceId = undefined;
    compositorSourceId = undefined;
    audioSourceId = undefined;
    void Native.stopCompositor().catch((error: unknown) => logger.warn("Could not close the prepared screen share.", error));
    if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
    }
    if (startTimeout !== undefined) {
        clearTimeout(startTimeout);
        startTimeout = undefined;
    }
}

function stopCapture(message: string) {
    stopFollowing();
    VoiceActions.setGoLiveSource({ context: "stream" });
    showToast(message);
}

async function followCursor() {
    if (updating) return;
    updating = true;
    const currentGeneration = generation;

    try {
        const ignoredMonitors = settings.plain.ignoredMonitors;
        let result = await Native.getCursorSource(displayId, ignoredMonitors);
        if (currentGeneration !== generation || !following) return;
        if (ignoredMonitors !== settings.plain.ignoredMonitors) return;
        if (!result.success) {
            stopCapture(`ScreenSharePlus stopped sharing. ${result.error}`);
            return;
        }
        if (compositorSourceId !== undefined) {
            const transition = await Native.setCompositorMonitor(result.displayId, ignoredMonitors);
            if (currentGeneration !== generation || !following) return;
            if (transition.success) {
                displayId = result.displayId;
                return;
            }
            logger.warn(transition.error);
            result = await Native.getCursorSource(undefined, ignoredMonitors);
            if (currentGeneration !== generation || !following) return;
            if (!result.success) {
                stopCapture(`ScreenSharePlus stopped sharing. ${result.error}`);
                return;
            }
        }
        if (result.sourceId === null) return;
        const source = MediaEngineStore.getGoLiveSource();
        if (source?.desktopSource == null) {
            stopFollowing();
            return;
        }
        displayId = result.displayId;
        sourceId = result.sourceId;
        if (source.desktopSource.id.split(":")[1] === sourceId.split(":")[1]) return;

        const { preset, soundshareEnabled } = ApplicationStreamingSettingsStore.getState();
        videoSwitchSourceId = sourceId;
        VoiceActions.setGoLiveSource({
            context: "stream",
            desktopSettings: { sourceId, sound: soundshareEnabled },
            qualityOptions: { preset, ...source.quality }
        });
        if (audioSourceId !== undefined) {
            compositorSourceId = undefined;
            audioSourceId = undefined;
            void Native.stopCompositor().catch((error: unknown) => logger.warn("Could not close the prepared screen share.", error));
        }
    } catch (error) {
        if (currentGeneration !== generation) return;
        logger.error("Could not switch the shared monitor.", error);
        stopCapture("ScreenSharePlus stopped sharing because it could not switch monitors.");
    } finally {
        updating = false;
    }
}

export default definePlugin({
    name: "ScreenSharePlus",
    description: "Adds capture controls and a screen share option that follows your mouse between monitors.",
    authors: [EquicordDevs.nobody],
    tags: ["Media", "Voice"],
    settings,

    patches: [
        {
            find: '"MenuCheckboxItem"',
            replacement: {
                match: /function \i\((\i)\)\{(?=.{0,450}?"MenuCheckboxItem")/,
                replace: "$&$1=$self.monitorHoverProps(arguments[0]);"
            }
        },
        {
            find: 'navId:"manage-streams"',
            replacement: {
                match: /(\i\.\i),\{(?=[^{}]{0,250}?navId:"manage-streams")/,
                replace: "$self.CaptureMenu,{MenuComponent:$1,live:true,"
            }
        },
        {
            find: 'navId:"stream-options"',
            replacement: {
                match: /(\i\.\i),\{(?=[^{}]{0,250}?navId:"stream-options")/,
                replace: "$self.CaptureMenu,{MenuComponent:$1,live:false,"
            }
        },
        {
            find: "this.getDefaultGoliveQuality()",
            replacement: {
                match: /(?<=applyQualityConstraints\(\i,\i\)\{let \i=)this\.getQuality\(\i\)/,
                replace: "$self.overrideBitrate($&,this.isStreamContext)"
            }
        },
        {
            find: "}setDesktopEncodingOptions(",
            replacement: {
                match: /null==(\i)&&\(\i=.{0,100}?\);(?=let \i=\{width:)/,
                replace: "$&$1=$self.maximumBitrate($1);"
            }
        },
        {
            find: '"2026-09-single-cpu-copy"',
            replacement: {
                match: /(\i)(?=&&\(\i\+=",singleCpuCopy"\))/,
                replace: "($1=$self.allowSingleCpuCopy($1,this.context,this.getVoiceParticipantType()))"
            }
        },
        {
            find: "streamerPaused()",
            replacement: {
                match: /streamerPaused\(\)\{/,
                replace: "$&if($self.keepPreview())return false;"
            }
        },
        {
            find: "StreamTile",
            replacement: {
                match: /\i\.\i\.isFocused\(\)/,
                replace: "($self.keepPreview()||$&)"
            }
        },
        {
            find: "Can't get desktop sources outside of native app",
            replacement: {
                match: /Promise\.all\(\i\)\.then\(\i=>\i\(\)\(\i\)\)/,
                replace: "$self.addSources($&)"
            }
        },
        {
            find: '"startStreamWithSource"',
            replacement: {
                match: /async function \i\((\i),\i\)\{/,
                replace: "$&$1=await $self.prepareSource(arguments[0]);"
            }
        },
        {
            find: 'type:"STREAM_START"',
            replacement: {
                match: /\i\.\i\.dispatch(?=\(\{type:"STREAM_START")/,
                replace: "$self.startStream"
            }
        },
        {
            find: "this.goLiveSourceIdentifier===",
            group: true,
            replacement: [
                {
                    match: /setGoLiveSource\(\i\)\{/,
                    replace: "$&const vcScreenSharePlusKeepAudio=$self.shouldKeepAudio(this,arguments[0]);"
                },
                {
                    match: /this\.setSoundshareSource\(\i,\i\)(?=;let\[\i,\i\])/,
                    replace: "vcScreenSharePlusKeepAudio||$&"
                }
            ]
        },
        {
            find: "MEDIA_ENGINE_SET_GO_LIVE_SOURCE:function",
            replacement: {
                match: /\i\.\i\.getPidFromDesktopSource\((\i)\)/g,
                replace: "$self.getSourcePid($1,$&)"
            }
        }
    ],

    start() {
        if (!settings.store.obsCaptureAcknowledged) settings.store.useObsCapture = false;
    },

    stop: stopFollowing,

    CaptureMenu,

    monitorHoverProps<T extends MonitorMenuProps>(props: T): T {
        const prefix = "vc-screenshare-plus-ignore-";
        if (!props.id?.startsWith(prefix)) return props;
        const id = props.id.slice(prefix.length);
        return { ...props, menuItemProps: {
            ...props.menuItemProps,
            onMouseEnter(event: React.MouseEvent) {
                props.menuItemProps.onMouseEnter?.(event);
                void Native.identifyMonitor(id, true).then(result => {
                    if (!result.success) showToast(result.error);
                }).catch(() => showToast("Could not identify that monitor."));
            },
            onMouseLeave(event: React.MouseEvent) {
                props.menuItemProps.onMouseLeave?.(event);
                void Native.stopIdentification();
            }
        } };
    },

    keepPreview() {
        return settings.plain.keepPreview;
    },

    allowSingleCpuCopy(enabled: boolean, context: string, participantType: string) {
        return enabled && (context !== "stream" || participantType !== "streamer");
    },

    overrideBitrate<T extends StreamBitrate>(quality: T, streaming: boolean): T {
        if (!streaming) return quality;
        const { bitrate, limitFrameRate } = settings.store;
        const maximum = bitrate * 1_000_000;
        if (maximum === 0 && !limitFrameRate) return quality;
        return { ...quality,
            bitrateMin: maximum === 0 ? quality.bitrateMin : Math.min(quality.bitrateMin, maximum),
            bitrateMax: maximum || quality.bitrateMax,
            bitrateTarget: maximum || quality.bitrateTarget,
            capture: limitFrameRate ? { ...quality.capture, framerate: Math.min(quality.capture.framerate, 30) } : quality.capture,
            encode: limitFrameRate ? { ...quality.encode, framerate: Math.min(quality.encode.framerate, 30) } : quality.encode
        };
    },

    maximumBitrate(original: number) {
        return settings.plain.bitrate * 1_000_000 || original;
    },

    updateBitrate() {
        MediaEngineStore.getMediaEngine().eachConnection((connection: MediaEngineConnection) => {
            if (connection.context === "stream" && connection.hasDesktopSource() && connection.videoStreamParameters.length > 0)
                connection.updateVideoQuality();
        });
    },

    flux: {
        MEDIA_ENGINE_SET_GO_LIVE_SOURCE({ settings }: SourceEvent) {
            if (!following) return;
            const id = settings?.desktopSettings?.sourceId;
            if (settings?.context !== "stream" || id === undefined || id.split(":")[0] !== sourceId?.split(":")[0]
                || id.split(":")[1] !== sourceId?.split(":")[1]) {
                stopFollowing();
                return;
            }
            if (intervalId === undefined)
                intervalId = setInterval(followCursor, 50);
            if (startTimeout !== undefined) {
                clearTimeout(startTimeout);
                startTimeout = undefined;
            }
        },
        STREAM_STOP({ streamKey }: { streamKey: string; }) {
            if (streamKey.endsWith(UserStore.getCurrentUser().id)) stopFollowing();
        },
        STREAM_DELETE({ streamKey }: { streamKey: string; }) {
            if (streamKey.endsWith(UserStore.getCurrentUser().id)) stopFollowing();
        },
        LOGOUT: stopFollowing
    },

    onIgnoredMonitorsChange() {
        if (!following) return;
        generation++;
        void followCursor();
    },

    getSourcePid(id: string, pid: number | null) {
        return id === compositorSourceId && audioSourceId !== undefined ? SoundshareStore.getPidFromDesktopSource(audioSourceId) : pid;
    },

    startStream(event: StreamStartEvent) {
        if (event.sourceName === SOURCE_NAME && (!following || event.sourceId !== sourceId
            || displayId === undefined || settings.plain.ignoredMonitors.includes(displayId))) return;
        return FluxDispatcher.dispatch(event);
    },

    shouldKeepAudio(
        connection: { context: string; goLiveSourceIdentifier: string | null; soundshareId: number | null; },
        source: { desktopDescription?: { id: string; soundshareId: number | null; }; }
    ) {
        return following && connection.context === "stream" && connection.goLiveSourceIdentifier !== null
            && connection.goLiveSourceIdentifier !== videoSwitchSourceId
            && source.desktopDescription?.id === videoSwitchSourceId
            && source.desktopDescription?.soundshareId === connection.soundshareId;
    },

    async addSources(promise: Promise<CaptureSource[]>) {
        const sources = await promise;
        if (!sources.some((source: CaptureSource) => source.id.startsWith("screen"))) return sources;

        try {
            const result = await Native.getCursorSource(undefined, settings.plain.ignoredMonitors, true);
            if (!result.success || result.sourceId === null) return sources;
            return [{ id: SOURCE_ID, name: SOURCE_NAME, url: result.url }, ...sources];
        } catch (error) {
            logger.warn("Could not add the monitor under your mouse to the screen picker.", error);
        }

        return sources;
    },

    async prepareSource(source: CaptureSource | number | null) {
        stopFollowing();
        if (typeof source !== "object" || source === null) return source;
        const followsCursor = source.id === SOURCE_ID;
        if (!followsCursor && (!settings.plain.useObsCapture || !/^(?:screen|window):/.test(source.id))) return source;
        const currentGeneration = generation;
        const ignoredMonitors = settings.plain.ignoredMonitors;
        const frameRate = Math.min(ApplicationStreamingSettingsStore.getState().fps, settings.store.limitFrameRate ? 30 : 240);
        const captureMethod = settings.store.captureMethod;

        try {
            if (!followsCursor) {
                const ready = await Native.isCaptureReady();
                if (currentGeneration !== generation) return null;
                const closeProgress = ready ? undefined : openPreparationProgress(stopFollowing);
                const prepared = await Native.prepareCompositor(source.id, [], frameRate, captureMethod).finally(() => closeProgress?.());
                if (currentGeneration !== generation) return null;
                if (!prepared.success) { logger.warn(prepared.error); return source; }
                compositorSourceId = prepared.sourceId;
                audioSourceId = source.id;
                sourceId = prepared.sourceId;
                return { ...source, id: prepared.sourceId };
            }
            const result = await Native.getCursorSource(undefined, ignoredMonitors);
            if (currentGeneration !== generation) return null;
            if (ignoredMonitors !== settings.plain.ignoredMonitors) {
                stopCapture("Ignored monitors changed. Start screen sharing again.");
                return null;
            }
            if (!result.success) {
                stopCapture(`ScreenSharePlus could not start. ${result.error}`);
                return null;
            }
            if (result.sourceId === null) return null;

            let sharedSourceId = result.sourceId;
            if (settings.plain.useObsCapture) {
                const ready = await Native.isCaptureReady();
                if (currentGeneration !== generation) return null;
                const closeProgress = ready ? undefined : openPreparationProgress(stopFollowing);
                const prepared = await Native.prepareCompositor(result.displayId, ignoredMonitors, frameRate, captureMethod).finally(() => closeProgress?.());
                if (currentGeneration !== generation) return null;
                if (ignoredMonitors !== settings.plain.ignoredMonitors) {
                    stopCapture("Ignored monitors changed. Start screen sharing again.");
                    return null;
                }
                if (prepared.success) {
                    sharedSourceId = prepared.sourceId;
                    compositorSourceId = sharedSourceId;
                    audioSourceId = result.sourceId;
                } else logger.warn(prepared.error);
            }

            following = true;
            displayId = result.displayId;
            sourceId = sharedSourceId;
            startTimeout = setTimeout(() => {
                if (intervalId === undefined) stopFollowing();
            }, 30_000);
            return { ...source, id: sourceId, name: SOURCE_NAME };
        } catch (error) {
            if (currentGeneration !== generation) return null;
            logger.error("Could not read the monitor under your mouse.", error);
            showToast("ScreenSharePlus could not start. Fully restart Discord and try again.");
            return null;
        }
    }
});
