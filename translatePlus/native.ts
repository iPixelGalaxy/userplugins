/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IpcMainInvokeEvent } from "electron";

export async function makeDeeplTranslateRequest(_: IpcMainInvokeEvent, pro: boolean, apiKey: string, payload: string) {
    const url = pro ? "https://api.deepl.com/v2/translate" : "https://api-free.deepl.com/v2/translate";
    try {
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `DeepL-Auth-Key ${apiKey}` }, body: payload });
        return { status: response.status, data: await response.text() };
    } catch (error) {
        return { status: -1, data: String(error) };
    }
}

export async function makeKagiTranslateRequest(_: IpcMainInvokeEvent, token: string, text: string, sourceLang: string, targetLang: string) {
    try {
        const response = await fetch("https://translate.kagi.com/api/translate", { method: "POST", headers: { "Content-Type": "application/json", Cookie: `kagi_session=${token}` }, body: JSON.stringify({ text, from: sourceLang, to: targetLang, model: "standard" }) });
        return { status: response.status, data: await response.json() };
    } catch (error) {
        return { status: -1, data: String(error) };
    }
}
