# extensions/ — the drop-in sockets

One folder per extension; a folder with an `extension.json` loads at
startup. The full contract (manifest fields, `register(ctx)`, the seat
preset API, per-extension runtime state, directory picker, dock-tab
registration, and live-reload semantics) is documented in
`../floorplan.md` § Extensions — read that before writing one.

A bare shell runs fine with this folder empty. Add one subfolder per local
extension; machine-specific and tree-specific things live HERE, never in
shell core. Keep an extension in Git only when it is meant to travel with
this installation.

