/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { IS_WINDOWS } from "@utils/constants";
import { Logger } from "@utils/Logger";
import { findByCodeLazy, findByPropsLazy } from "@webpack";
import { ApplicationStreamingSettingsStore, ApplicationStreamingStore, ChannelStore, FluxDispatcher, lodash, MediaEngineStore, PermissionsBits, PermissionStore, RTCConnectionStore, SelectedChannelStore, showToast, UserStore } from "@webpack/common";

import { settings } from "./settings";

export const FOLLOW_SOURCE_ID = "screen:vc-screenshare-plus";
export const FOLLOW_SOURCE_NAME = "Monitor under mouse";
const KEY = "ScreenSharePlus_retainedStream";
const logger = new Logger("ScreenSharePlus");

interface Source {
    id: string;
    name: string;
    url: string;
}

interface StreamStart {
    guildId?: string | null;
    channelId?: string;
    sourceId?: string;
    sourceName?: string;
    sound?: boolean;
    previewDisabled?: boolean;
}

interface RetainedStream {
    userId: string;
    guildId: string;
    source: Source;
    sourcePid: number | null;
    lastActiveAt?: number;
    options: {
        preset: number;
        resolution: number;
        fps: number;
        soundshareEnabled: boolean;
        previewDisabled: boolean;
    };
}

const getDesktopSources: (engine: ReturnType<typeof MediaEngineStore.getMediaEngine>, windows: boolean, types: string[], size: { width: number; height: number; }) => Promise<Source[]> = findByCodeLazy("Can't get desktop sources outside of native app");
const startStreamWithSource: (source: Source, options: RetainedStream["options"]) => Promise<[boolean, string | undefined]> = findByCodeLazy('"startStreamWithSource"');
const SoundshareStore: { getPidFromDesktopSource(id: string): number | null; } = findByPropsLazy("getPidFromDesktopSource");

let retained: RetainedStream | undefined;
let running = false;
let revision = 0;
let cancellation = 0;
let resumeCancellation = 0;
let attemptedChannel: string | undefined;
let resumingChannel: string | undefined;
let writes = Promise.resolve();
let heartbeat: ReturnType<typeof setInterval> | undefined;
let heartbeatChannel: string | undefined;
let expiryTimeout: ReturnType<typeof setTimeout> | undefined;

function save(value: RetainedStream | undefined) {
    if (value !== undefined && lodash.isEqual(retained, value)) return;
    retained = value;
    revision++;
    if (value === undefined && heartbeat !== undefined) {
        clearInterval(heartbeat);
        heartbeat = undefined;
        heartbeatChannel = undefined;
    }
    writes = writes.then(() => value === undefined ? DataStore.del(KEY) : DataStore.set(KEY, value))
        .catch((error: unknown) => logger.error("Could not save the retained screenshare.", error));
    updateRetentionTimeout();
}

export function updateRetentionTimeout() {
    if (expiryTimeout !== undefined) clearTimeout(expiryTimeout);
    expiryTimeout = undefined;
    if (!running || heartbeat !== undefined || !retained) return;
    const remaining = (retained.lastActiveAt ?? 0) + settings.plain.retainScreenshareTimeout * 60_000 - Date.now();
    if (remaining <= 0) {
        save(undefined);
        return;
    }
    expiryTimeout = setTimeout(() => {
        expiryTimeout = undefined;
        save(undefined);
    }, remaining);
}

function startHeartbeat(channelId: string) {
    if (expiryTimeout !== undefined) clearTimeout(expiryTimeout);
    expiryTimeout = undefined;
    heartbeatChannel = channelId;
    if (heartbeat !== undefined) return;
    heartbeat = setInterval(() => {
        if (retained) save({ ...retained, lastActiveAt: Date.now() });
    }, 5000);
}

export function pauseRetention(streamKey?: string) {
    if (streamKey) {
        const [, , channelId, ownerId] = streamKey.split(":");
        if (ownerId !== UserStore.getCurrentUser().id || channelId !== heartbeatChannel) return;
    }
    if (heartbeat === undefined) return;
    clearInterval(heartbeat);
    heartbeat = undefined;
    heartbeatChannel = undefined;
    if (retained) save({ ...retained, lastActiveAt: Date.now() });
}

export function rememberScreenshare(following: boolean, event?: StreamStart) {
    if (!running || !settings.plain.retainScreenshare) return;
    const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
    const guildId = event ? event.guildId : stream?.guildId;
    const channelId = event?.channelId ?? stream?.channelId;
    if (!guildId || !channelId || channelId !== SelectedChannelStore.getVoiceChannelId()) return;
    const metadata = ApplicationStreamingStore.getStreamerActiveStreamMetadata();
    const live = MediaEngineStore.getGoLiveSource();
    if (!event && (metadata === null || live?.desktopSource == null)) return;
    const sourceId = following ? FOLLOW_SOURCE_ID : event ? event.sourceId : live?.desktopSource?.id;
    if (!sourceId) return;
    const state = ApplicationStreamingSettingsStore.getState();
    save({
        userId: UserStore.getCurrentUser().id,
        guildId,
        source: { id: sourceId, name: following ? FOLLOW_SOURCE_NAME : event?.sourceName ?? metadata?.sourceName ?? "", url: "" },
        sourcePid: following ? null : SoundshareStore.getPidFromDesktopSource(sourceId),
        lastActiveAt: Date.now(),
        options: {
            preset: state.preset,
            resolution: state.resolution,
            fps: state.fps,
            soundshareEnabled: event?.sound ?? state.soundshareEnabled,
            previewDisabled: event?.previewDisabled ?? metadata?.previewDisabled ?? false
        }
    });
    startHeartbeat(channelId);
}

export async function startRetention(following: boolean) {
    running = true;
    const currentRevision = ++revision;
    try {
        const saved = await DataStore.get<RetainedStream>(KEY);
        if (!running || currentRevision !== revision) return;
        retained = saved;
        if (!settings.plain.retainScreenshare) {
            save(undefined);
            return;
        }
        rememberScreenshare(following);
        updateRetentionTimeout();
        queueResume();
    } catch (error) {
        logger.error("Could not load the retained screenshare.", error);
    }
}

export function stopRetention() {
    pauseRetention();
    running = false;
    updateRetentionTimeout();
    revision++;
    cancellation++;
    attemptedChannel = undefined;
}

export function changeRetention(enabled: boolean, following: boolean) {
    revision++;
    cancellation++;
    if (enabled) rememberScreenshare(following);
    else {
        pauseRetention();
        save(undefined);
    }
}

export function stopRetainedStream(streamKey: string) {
    pauseRetention(streamKey);
    const [, , channelId, ownerId] = streamKey.split(":");
    if (ownerId === UserStore.getCurrentUser().id && channelId === SelectedChannelStore.getVoiceChannelId()
        && RTCConnectionStore.isConnected()) {
        revision++;
        cancellation++;
        save(undefined);
    }
}

export function voiceChannelSelected({ channelId, currentVoiceChannelId }: { channelId: string | null; currentVoiceChannelId?: string | null; }) {
    if (channelId === currentVoiceChannelId) return;
    pauseRetention();
    cancellation++;
    if (attemptedChannel !== SelectedChannelStore.getVoiceChannelId()) attemptedChannel = undefined;
    queueResume();
}

export function canResumeInChannel(channelId: string | undefined) {
    return resumingChannel === undefined || running && settings.plain.retainScreenshare
        && resumeCancellation === cancellation
        && channelId === resumingChannel && channelId === SelectedChannelStore.getVoiceChannelId()
        && retained?.userId === UserStore.getCurrentUser().id
        && Date.now() - (retained.lastActiveAt ?? 0) < settings.plain.retainScreenshareTimeout * 60_000;
}

export function queueResume() {
    FluxDispatcher.wait(() => {
        if (heartbeatChannel !== undefined && heartbeatChannel !== SelectedChannelStore.getVoiceChannelId()) pauseRetention();
        void resumeScreenshare();
    });
}

async function resumeScreenshare() {
    if (!running || !settings.plain.retainScreenshare || !retained || !RTCConnectionStore.isConnected()) return;
    const channelId = SelectedChannelStore.getVoiceChannelId();
    if (!channelId || RTCConnectionStore.getChannelId() !== channelId) return;
    if (retained.userId !== UserStore.getCurrentUser().id) return;
    const channel = ChannelStore.getChannel(channelId);
    if (!channel || channel.guild_id !== retained.guildId) {
        save(undefined);
        return;
    }
    const stream = ApplicationStreamingStore.getCurrentUserActiveStream();
    if (stream?.channelId === channelId && MediaEngineStore.getGoLiveSource() != null) {
        startHeartbeat(channelId);
        return;
    }
    if (Date.now() - (retained.lastActiveAt ?? 0) >= settings.plain.retainScreenshareTimeout * 60_000) {
        save(undefined);
        return;
    }
    if (attemptedChannel === channelId || resumingChannel !== undefined) return;
    attemptedChannel = channelId;
    if (channel.isGuildStageVoice() || !PermissionStore.can(PermissionsBits.STREAM, channel)) return;
    const saved = retained;
    const currentRevision = revision;
    resumingChannel = channelId;
    resumeCancellation = cancellation;
    try {
        let source = saved.source;
        if (source.id !== FOLLOW_SOURCE_ID) {
            const sources = await getDesktopSources(MediaEngineStore.getMediaEngine(), IS_WINDOWS, ["screen", "window"], { width: 0, height: 0 });
            const available = sources.find(candidate => candidate.id === source.id
                && (source.id.startsWith("screen") || (saved.sourcePid !== null
                    ? SoundshareStore.getPidFromDesktopSource(candidate.id) === saved.sourcePid : candidate.name === source.name)));
            if (!available) {
                if (currentRevision === revision) showToast("ScreenSharePlus could not resume because the previous source is no longer available. Choose a source to share again.");
                return;
            }
            source = available;
        }
        if (currentRevision !== revision || !canResumeInChannel(channelId)) return;
        const [success, reason] = await startStreamWithSource(source, saved.options);
        if (!success && currentRevision === revision) {
            showToast("ScreenSharePlus could not resume your screenshare. Choose a source to share again.");
            logger.warn("Could not resume the screenshare.", reason);
        }
    } catch (error) {
        logger.error("Could not resume the screenshare.", error);
        if (currentRevision === revision) showToast("ScreenSharePlus could not resume your screenshare. Choose a source to share again.");
    } finally {
        resumingChannel = undefined;
        if (SelectedChannelStore.getVoiceChannelId() !== channelId) queueResume();
    }
}
