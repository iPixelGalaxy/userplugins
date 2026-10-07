/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Divider } from "@components/Divider";
import { FormSwitch } from "@components/FormSwitch";
import { HeadingSecondary } from "@components/Heading";
import { Margins } from "@utils/margins";
import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, openModal, SearchableSelect, SelectedChannelStore, useMemo } from "@webpack/common";

import { getOutgoingMode } from "./outgoingMode";
import { settings } from "./settings";
import { getLanguages } from "./utils";

const languageSettingKeys = ["receivedInput", "receivedOutput", "sentInput", "sentOutput"] as const;

function LanguageSelect({ settingsKey, includeAuto }: { settingsKey: typeof languageSettingKeys[number]; includeAuto: boolean; }) {
    const currentValue = settings.use([settingsKey])[settingsKey];
    const options = useMemo(() => {
        const values = Object.entries(getLanguages()).map(([value, label]) => ({ value, label }));
        if (!includeAuto) values.shift();
        return values;
    }, [includeAuto]);
    return (
        <section className={Margins.bottom16}>
            <HeadingSecondary>{settings.def[settingsKey].description}</HeadingSecondary>
            <SearchableSelect options={options} value={currentValue} placeholder="Select a language" maxVisibleItems={5} closeOnSelect onChange={value => settings.store[settingsKey] = value} />
        </section>
    );
}

export function TranslateModal({ rootProps }: { rootProps: RenderModalProps; }) {
    const { rememberOutgoingModePerChannel } = settings.use(["rememberOutgoingModePerChannel"]);
    const setRememberOutgoingModePerChannel = (value: boolean) => {
        const channelId = SelectedChannelStore.getChannelId();
        const mode = getOutgoingMode(channelId);
        settings.store.rememberOutgoingModePerChannel = value;
        if (value) settings.store.outgoingModesByChannel = { ...settings.store.outgoingModesByChannel, [channelId]: mode };
        else settings.store.outgoingMode = mode;
    };
    return (
        <Modal {...rootProps} title="TranslatePlus">
            {languageSettingKeys.map(key => <LanguageSelect key={key} settingsKey={key} includeAuto={key.endsWith("Input")} />)}
            <Divider className={Margins.bottom16} />
            <FormSwitch title="Remember outgoing translation mode per channel" description={settings.def.rememberOutgoingModePerChannel.description} value={rememberOutgoingModePerChannel} onChange={setRememberOutgoingModePerChannel} hideBorder />
        </Modal>
    );
}

export function openTranslateModal() {
    openModal(props => <TranslateModal rootProps={props} />);
}
