# BetterFolders userplugin

Local fork of Equicord's bundled BetterFolders. Keep this directory in
`src/userplugins` and build Equicord normally.

The plugin keeps the name `BetterFolders`. Equicord registers userplugins after
bundled plugins, so this copy replaces the bundled registration and uses the
existing enabled state and settings. Leave BetterFolders enabled. No edits to
`src/plugins/betterFolders` are needed.

The sidebar filters the server tree to expanded folders before rendering. Folder
contents render only in the secondary rail, while the primary rail retains the
configured folder icon appearance. Both rails reserve space for their scrollbars.
Sidebar animation follows the nav's CSS width without measuring the document.

The imported `https://abbie.github.io/discord-css/import.css` sets the server rail
to 56px with 8px padding when `--\\--compact-server-list` is true. This reduces
scrollbar clearance, but CSS does not create duplicate folder components. The
fork retains that compact width for server items and adds scrollbar space beside
them. The other supplied imports target profiles, account controls, messages,
direct message buttons, or search.

Build output must be used by your Discord installation, then Discord must reload
to apply the webpack patches. A successful build does not verify the running
client's layout or patch matches.
