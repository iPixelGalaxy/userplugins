/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings, migratePluginSetting } from "@api/Settings";
import { Button } from "@components/Button";
import { OptionType } from "@utils/types";

import { openTranslateModal } from "./TranslateModal";

migratePluginSetting("TranslatePlus", "rememberOutgoingModePerChannel", "rememberAutoTranslateChannels");

export const settings = definePluginSettings({
    receivedInput: { type: OptionType.STRING, description: "Language incoming messages are translated from.", default: "auto", hidden: true },
    receivedOutput: { type: OptionType.STRING, description: "Language incoming messages are translated to.", default: "en", hidden: true },
    sentInput: { type: OptionType.STRING, description: "Language your messages are translated from.", default: "auto", hidden: true },
    sentOutput: { type: OptionType.STRING, description: "Language your messages are translated to.", default: "en", hidden: true },
    service: {
        type: OptionType.SELECT,
        description: IS_WEB ? "Translation provider is not available on web." : "Translation provider.",
        hidden: IS_WEB,
        options: [
            { label: "Google Translate", value: "google", default: true },
            { label: "DeepL Free, API key required", value: "deepl" },
            { label: "DeepL Pro, API key required", value: "deepl-pro" },
            { label: "Kagi Translate, API key required", value: "kagi" }
        ] as const,
        onChange: resetLanguageDefaults
    },
    autoTranslateProvider: {
        type: OptionType.SELECT,
        description: "Provider used for automatic channel translations.",
        options: [
            { label: "Google Translate", value: "google", default: true },
            { label: "Selected translation provider", value: "selected" }
        ] as const
    },
    deeplApiKey: { type: OptionType.STRING, displayName: "DeepL API Key", description: "Your DeepL API key from deepl.com/your-account.", default: "" },
    kagiSession: { type: OptionType.STRING, description: "Your Kagi session token from kagi.com/settings?p=user_details.", default: "" },
    outgoingMode: {
        type: OptionType.SELECT,
        description: "How your messages are translated before sending.",
        options: [
            { label: "Off", value: "off", default: true },
            { label: "Translated only", value: "translated" },
            { label: "Both original and translated", value: "both" }
        ] as const
    },
    rememberOutgoingModePerChannel: { type: OptionType.BOOLEAN, description: "Remember outgoing translation mode for each channel.", default: false },
    showAutoTranslateTooltip: { type: OptionType.BOOLEAN, description: "Show a tooltip when an outgoing message is automatically translated.", default: true },
    manageTranslateSettings: {
        type: OptionType.COMPONENT,
        component: () => <Button onClick={openTranslateModal}>Customize translation languages and modes</Button>
    }
}, {
    deeplApiKey: { hidden() { return this.store.service !== "deepl" && this.store.service !== "deepl-pro"; } },
    kagiSession: { hidden() { return this.store.service !== "kagi"; } }
}).withPrivateSettings<{
    autoTranslateChannels?: string[];
    outgoingModesByChannel?: Record<string, "off" | "translated" | "both">;
}>();

export function resetLanguageDefaults() {
    if (IS_WEB || settings.store.service === "google" || settings.store.service === "kagi") {
        settings.store.receivedInput = "auto";
        settings.store.receivedOutput = "en";
        settings.store.sentInput = "auto";
        settings.store.sentOutput = "en";
    } else {
        settings.store.receivedInput = "";
        settings.store.receivedOutput = "en-us";
        settings.store.sentInput = "";
        settings.store.sentOutput = "en-us";
    }
}
