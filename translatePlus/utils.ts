/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { DeeplLanguages, deeplLanguageToGoogleLanguage, GoogleLanguages, KagiLanguages } from "@plugins/translate/languages";
import { classNameFactory } from "@utils/css";
import { copyWithToast } from "@utils/discord";
import { onlyOnce } from "@utils/onlyOnce";
import type { PluginNative } from "@utils/types";
import { Alerts, showToast, Toasts } from "@webpack/common";

import { resetLanguageDefaults, settings } from "./settings";

export const cl = classNameFactory("vc-trans-plus-");

const Native = VencordNative.pluginHelpers.TranslatePlus as PluginNative<typeof import("./native")>;

interface GoogleData { translation: string; sourceLanguage: string; }
interface DeeplData { translations: { detected_source_language: string; text: string; }[]; }
interface KagiData { translation: string; detected_language: { label: string; }; }

export interface TranslationValue { sourceLanguage: string; text: string; }

export function getLanguages() {
    if (IS_WEB) return GoogleLanguages;
    switch (settings.store.service) {
        case "google": return GoogleLanguages;
        case "kagi": return KagiLanguages;
        default: return DeeplLanguages;
    }
}

function getTranslator(service = settings.store.service ?? "google") {
    if (IS_WEB) return googleTranslate;
    switch (service) {
        case "google": return googleTranslate;
        case "kagi": return kagiTranslate;
        default: return (text: string, sourceLang: string, targetLang: string) => deeplTranslate(text, sourceLang, targetLang, service);
    }
}

export async function translate(kind: "received" | "sent", text: string, service = settings.store.service ?? "google"): Promise<TranslationValue> {
    const sourceLang = settings.store[`${kind}Input`];
    const targetLang = settings.store[`${kind}Output`];
    return translateWithLanguages(text, service === "google" ? deeplLanguageToGoogleLanguage(sourceLang) : sourceLang, service === "google" ? deeplLanguageToGoogleLanguage(targetLang) : targetLang, service);
}

export async function translateWithLanguages(text: string, sourceLang: string, targetLang: string, service = settings.store.service ?? "google"): Promise<TranslationValue> {
    try {
        return await getTranslator(service)(text, sourceLang, targetLang);
    } catch (error) {
        const message = error instanceof Error ? error.message : typeof error === "string" ? error : "Something went wrong.";
        Alerts.show({
            title: "Translation failed",
            body: message,
            confirmText: "Copy error",
            cancelText: "Close",
            onConfirm: () => copyWithToast(message, "Translation error copied.")
        });
        throw error instanceof Error ? error : new Error(message);
    }
}

async function googleTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const params = new URLSearchParams({
        "params.client": "gtx", "dataTypes": "TRANSLATION", "key": "AIzaSyDLEeFI5OtFBwYBIoK_jj5m32rZK5CkCXA",
        "query.targetLanguage": targetLang, "query.text": text,
    });
    if (sourceLang !== "auto") params.set("query.sourceLanguage", sourceLang);
    const url = "https://translate-pa.googleapis.com/v1/translate?" + params;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to translate (${sourceLang} -> ${targetLang}): ${response.status} ${response.statusText}`);
    const { sourceLanguage, translation } = await response.json() as GoogleData;
    return { sourceLanguage: GoogleLanguages[sourceLanguage as keyof typeof GoogleLanguages] ?? sourceLanguage, text: translation };
}

function fallbackToGoogle(text: string, sourceLang: string, targetLang: string) {
    return googleTranslate(text, deeplLanguageToGoogleLanguage(sourceLang), deeplLanguageToGoogleLanguage(targetLang));
}

const showDeeplApiQuotaToast = onlyOnce(() => showToast("DeepL API quota exceeded. Falling back to Google Translate.", Toasts.Type.FAILURE));

async function deeplTranslate(text: string, sourceLang: string, targetLang: string, service: string): Promise<TranslationValue> {
    if (!settings.store.deeplApiKey) {
        showToast("DeepL API key is not set. Resetting to Google Translate.", Toasts.Type.FAILURE);
        settings.store.service = "google";
        resetLanguageDefaults();
        return fallbackToGoogle(text, sourceLang, targetLang);
    }
    const payload = { text: [text], target_lang: targetLang };
    if (sourceLang && sourceLang !== "auto") Object.assign(payload, { source_lang: sourceLang.split("-")[0] });
    const { status, data } = await Native.makeDeeplTranslateRequest(service === "deepl-pro", settings.store.deeplApiKey, JSON.stringify(payload));
    if (status === -1) throw `Failed to connect to DeepL API: ${data}`;
    if (status === 403) throw "Invalid DeepL API key or version.";
    if (status === 456) { showDeeplApiQuotaToast(); return fallbackToGoogle(text, sourceLang, targetLang); }
    if (status !== 200) throw new Error(`Failed to translate (${sourceLang} -> ${targetLang}): ${status} ${data}`);
    const { translations } = JSON.parse(data) as DeeplData;
    const result = translations[0];
    if (!result) throw new Error("DeepL returned no translation.");
    return { sourceLanguage: DeeplLanguages[result.detected_source_language as keyof typeof DeeplLanguages] ?? result.detected_source_language, text: result.text };
}

async function kagiTranslate(text: string, sourceLang: string, targetLang: string): Promise<TranslationValue> {
    const { status, data } = await Native.makeKagiTranslateRequest(settings.store.kagiSession, text, sourceLang, targetLang);
    if (status === 401) throw "Invalid or expired Kagi session token.";
    if (status !== 200) throw new Error(`Failed to translate (${sourceLang} -> ${targetLang}): ${status} ${String(data)}`);
    const { detected_language, translation } = data as KagiData;
    return { sourceLanguage: detected_language.label, text: translation };
}
