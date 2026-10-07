/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { updateMessage } from "@api/MessageUpdater";
import { Queue } from "@utils/Queue";
import type { Message } from "@vencord/discord-types";
import { MessageStore } from "@webpack/common";

import { settings } from "./settings";
import { translate, type TranslationValue } from "./utils";

interface CachedTranslation {
    content: string;
    key: string;
    translation: TranslationValue;
}

const activeChannelIds = new Set<string>();
const automaticTranslations = new Map<string, CachedTranslation>();
const pendingTranslations = new Set<string>();
const translationQueue = new Queue(100);
let active = false;

export function initializeAutoTranslateChannels() {
    active = true;
    activeChannelIds.clear();
    for (const channelId of settings.store.autoTranslateChannels ?? []) activeChannelIds.add(channelId);

    for (const channelId of activeChannelIds) {
        for (const message of MessageStore.getMessages(channelId)?._array ?? [])
            updateMessage(channelId, message.id);
    }
}

export function stopAutoTranslateChannels() {
    active = false;
    activeChannelIds.clear();
    automaticTranslations.clear();
    pendingTranslations.clear();
}

export function isAutoTranslateEnabled(channelId: string) {
    return activeChannelIds.has(channelId);
}

export function toggleAutoTranslateChannel(channelId: string) {
    if (activeChannelIds.has(channelId)) activeChannelIds.delete(channelId);
    else activeChannelIds.add(channelId);

    settings.store.autoTranslateChannels = [...activeChannelIds];

    for (const message of MessageStore.getMessages(channelId)?._array ?? []) {
        automaticTranslations.delete(message.id);
        updateMessage(channelId, message.id);
    }
}

export function getAutomaticTranslation(message: Message) {
    const cached = automaticTranslations.get(message.id);
    return cached?.content === message.content && cached.key === getTranslationKey() ? cached.translation : undefined;
}

export function requestAutomaticTranslation(message: Message) {
    if (!active || !isAutoTranslateEnabled(message.channel_id) || !message.content) return;
    if (getAutomaticTranslation(message) || pendingTranslations.has(message.id)) return;

    const { content } = message;
    pendingTranslations.add(message.id);
    translationQueue.push(async () => {
        try {
            const service = settings.store.autoTranslateProvider === "google" ? "google" : settings.store.service;
            const translation = await translate("received", content, service);
            if (active && isAutoTranslateEnabled(message.channel_id) && translation.text !== content)
                automaticTranslations.set(message.id, { content, key: getTranslationKey(), translation });
        } catch {
            return;
        } finally {
            pendingTranslations.delete(message.id);
            updateMessage(message.channel_id, message.id);
        }
    });
}

function getTranslationKey() {
    const service = settings.store.autoTranslateProvider === "google" ? "google" : settings.store.service;
    return `${service}:${settings.store.receivedInput}:${settings.store.receivedOutput}`;
}
