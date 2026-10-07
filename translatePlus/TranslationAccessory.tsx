/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { updateMessage } from "@api/MessageUpdater";
import type { Message } from "@vencord/discord-types";
import { Parser } from "@webpack/common";

import { getAutomaticTranslation, requestAutomaticTranslation } from "./channelState";
import { TranslateIcon } from "./TranslateIcon";
import { cl, type TranslationValue } from "./utils";

const manualTranslations = new Map<string, TranslationValue>();
const dismissedManualTranslations = new Set<string>();

export function handleTranslate(message: Message, translation: TranslationValue) {
    dismissedManualTranslations.delete(message.id);
    manualTranslations.set(message.id, translation);
    updateMessage(message.channel_id, message.id);
}

function Dismiss({ message }: { message: Message; }) {
    return <button onClick={() => {
        dismissedManualTranslations.add(message.id);
        updateMessage(message.channel_id, message.id);
    }} className={cl("dismiss")}>Dismiss</button>;
}

export function TranslationAccessory({ message }: { message: Message; }) {
    const embedded = message as Message & { vencordEmbeddedBy?: unknown; };
    if (embedded.vencordEmbeddedBy) return null;

    const automaticTranslation = getAutomaticTranslation(message);
    if (!automaticTranslation) requestAutomaticTranslation(message);

    const manualTranslation = dismissedManualTranslations.has(message.id) ? undefined : manualTranslations.get(message.id);
    const translation = manualTranslation ?? automaticTranslation;
    if (!translation) return null;

    return (
        <span className={cl("accessory")}>
            <TranslateIcon width={16} height={16} className={cl("accessory-icon")} />
            {Parser.parse(translation.text)}
            <br />
            (translated from {translation.sourceLanguage}{manualTranslation && <> - <Dismiss message={message} /></>})
        </span>
    );
}
