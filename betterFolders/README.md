# BetterFolders userplugin

Local fork of Equicord's bundled BetterFolders. Keep this directory in
`src/userplugins` and build Equicord normally.

The plugin keeps the name `BetterFolders`. Equicord registers userplugins after
bundled plugins, so this copy replaces the bundled registration and uses the
existing enabled state and settings. Leave BetterFolders enabled. No edits to
`src/plugins/betterFolders` are needed.

Find the existing BetterFolders entry under **Show UserPlugins** in plugin
settings. Its card displays the **User Plugin** badge and identifies the local
fork in its description. There is no second BetterFolders entry.

The sidebar filters the server tree to expanded folders before rendering. Folder
contents render only in the secondary rail, while the primary rail retains the
configured folder icon appearance. Both rails hide their scrollbars while
retaining mouse wheel and trackpad scrolling, without reserving scrollbar space.
Sidebar animation uses the nav's measured pixel width through Discord's resize
observer hook, so a compact rail still opens to its actual width.

The imported `https://abbie.github.io/discord-css/import.css` sets the server rail
to 56px with 8px padding when `--\\--compact-server-list` is true. CSS does not
create duplicate folder components. The fork retains that compact width without
adding extra space on the right. In compact mode, server icons use 40px and folder
previews use 48px instead of the larger sizes in Discord's default density. The other supplied imports
target profiles, account controls, messages, direct message buttons, or search.

Build output must be used by your Discord installation, then Discord must reload
to apply the webpack patches. A successful build does not verify the running
client's layout or patch matches.
