/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";

export default definePlugin({
    name: "OpenInAppNative",
    description: "Native support for the OpenInApp userplugin.",
    authors: [Devs.Ven, Devs.surgedevs],
    required: true,
    hidden: true,
});
