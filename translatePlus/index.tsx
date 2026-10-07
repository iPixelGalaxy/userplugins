/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId } from "@api/ContextMenu";
import ErrorBoundary from "@components/ErrorBoundary";
import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import type { Channel, Message } from "@vencord/discord-types";
import { ChannelStore, Menu } from "@webpack/common";

import { initializeAutoTranslateChannels, isAutoTranslateEnabled, stopAutoTranslateChannels, toggleAutoTranslateChannel } from "./channelState";
import { getOutgoingMode } from "./outgoingMode";
import { settings } from "./settings";
import { setShouldShowTranslateEnabledTooltip, TranslateChatBarIcon, TranslateIcon } from "./TranslateIcon";
import { handleTranslate, TranslationAccessory } from "./TranslationAccessory";
import { translate, translateWithLanguages } from "./utils";

const translatedLabels = new Map<string, Promise<{ original: string; translated: string; }>>();
let tooltipTimeout: ReturnType<typeof setTimeout> | undefined;

function getMessageContent(message: Message) {
    return message.content || message.messageSnapshots?.[0]?.message.content || message.embeds?.find(embed => embed.type === "auto_moderation_message")?.rawDescription || "";
}

function canTranslateChannel(channel: Channel | undefined) {
    return channel != null && !channel.isCategory() && !channel.isDirectory() && !channel.isForumChannel() && !channel.isVocal();
}

function getTranslatedLabels() {
    const key = `${settings.store.service}:${settings.store.sentOutput}`;
    let labels = translatedLabels.get(key);
    if (!labels) {
        labels = Promise.all([
            translateWithLanguages("Original", "auto", settings.store.sentOutput),
            translateWithLanguages("Translated", "auto", settings.store.sentOutput)
        ]).then(([original, translated]) => ({ original: original.text, translated: translated.text }));
        translatedLabels.set(key, labels);
    }
    return labels;
}

const TranslateAccessoryComponent = ErrorBoundary.wrap(TranslationAccessory, { noop: true });

export default definePlugin({
    name: "TranslatePlus",
    description: "Translate messages with Google Translate, DeepL, or Kagi, including per-channel Auto Translate.",
    dependencies: ["ChatInputButtonAPI", "MessageAccessoriesAPI", "MessagePopoverAPI", "MessageEventsAPI"],
    tags: ["Chat", "Utility"],
    authors: [Devs.Ven, Devs.AshtonMemer, Devs.koish1],
    settings,

    start() {
        initializeAutoTranslateChannels();
    },

    stop() {
        stopAutoTranslateChannels();
        translatedLabels.clear();
        if (tooltipTimeout !== undefined) {
            clearTimeout(tooltipTimeout);
            tooltipTimeout = undefined;
        }
    },

    contextMenus: {
        "message"(children, { message }: { message: Message; }) {
            const content = getMessageContent(message);
            if (!content) return;
            const group = findGroupChildrenByChildId("copy-text", children);
            if (!group) return;
            group.splice(group.findIndex(child => child?.props?.id === "copy-text") + 1, 0, (
                <Menu.MenuItem
                    id="vc-translate-plus-message"
                    label="Translate"
                    icon={TranslateIcon}
                    action={async () => handleTranslate(message, await translate("received", content))}
                />
            ));
        },
        "channel-context"(children, { channel }: { channel?: Channel; }) {
            const channelId = channel?.id;
            if (!channelId || !canTranslateChannel(channel)) return;
            children.push(
                <Menu.MenuCheckboxItem
                    id="vc-translate-plus-channel"
                    label="Auto Translate"
                    checked={isAutoTranslateEnabled(channelId)}
                    action={() => toggleAutoTranslateChannel(channelId)}
                />
            );
        }
    },

    translate,

    renderMessageAccessory: props => <TranslateAccessoryComponent message={props.message as Message} />,

    chatBarButton: { icon: TranslateIcon, render: TranslateChatBarIcon },

    messagePopoverButton: {
        icon: TranslateIcon,
        render(message: Message) {
            const content = getMessageContent(message);
            if (!content) return null;
            return {
                label: "Translate",
                icon: TranslateIcon,
                message,
                channel: ChannelStore.getChannel(message.channel_id),
                onClick: async () => handleTranslate(message, await translate("received", content))
            };
        }
    },

    async onBeforeMessageSend(channelId, message) {
        const mode = getOutgoingMode(channelId);
        if (mode === "off" || !message.content) return;
        setShouldShowTranslateEnabledTooltip?.(true);
        if (tooltipTimeout !== undefined) clearTimeout(tooltipTimeout);
        tooltipTimeout = setTimeout(() => setShouldShowTranslateEnabledTooltip?.(false), 2000);

        const original = message.content;
        const translation = await translate("sent", original);
        if (mode === "translated") {
            message.content = translation.text;
            return;
        }

        const labels = await getTranslatedLabels();
        message.content = `Original (${labels.original}):\n${original}\n\nTranslated (${labels.translated}):\n${translation.text}`;
    }
});
