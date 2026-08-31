# Scrubframe

Turn any web animation into a labeled frame sheet and a real timing spec —
ready to paste into Claude, ChatGPT, or your design doc.

> **Status: Phase 0 complete.** Scaffold, CDP session wrapper, and the ADR-002
> spike — which came back with a result that changed the ADR: see
> [`docs/ADR-ADDENDUM.md`](docs/ADR-ADDENDUM.md). Element picker, adapters,
> contact sheet and `ANIMATION.md` land in Phases 1–4. See `SPEC.md` §6.

## Why does this need the `debugger` permission?

Short answer: to pause time.

Chrome's standard extension APIs cap screenshots at roughly two per second, can
only capture the visible viewport, and give no way to freeze an animation's
timeline. The DevTools Protocol does all three. It's the same protocol the
built-in Animations panel uses.

Scrubframe attaches the debugger only while you are actively capturing, only to
the tab you clicked on, and detaches immediately after. Chrome shows a yellow
banner the whole time — that banner is your kill switch, and it's there on
purpose.

Being straight about what that restraint is: it is **self-imposed**, not enforced
by Chrome. We measured this rather than assuming it. Scrubframe's own Phase 0 spike
attached a debugger to a tab it had never been invoked on — a tab whose URL it did
not even have permission to read — and ran JavaScript inside it:

> Not enough permission to know what page you are on.
> Enough permission to run code on it.

The `debugger` permission carries the "Read and change all your data on all
websites" warning by itself, and Chrome does not check host permissions before
letting a debugger session attach. Declining `<all_urls>` narrows what Scrubframe's
*other* APIs can touch; it does not narrow the debugger.

So the honest claim is not "Scrubframe asks for little." It is: **Scrubframe can do
more than it does, and you can check that it doesn't.** The attach lasts exactly
as long as a capture. The yellow banner stays up the whole time on purpose and is
never worked around. There are zero network requests, and you can verify that in
thirty seconds — see below. That is a weaker promise and a stronger guarantee,
because every part of it is something you can go and confirm.

**Scrubframe makes zero network requests.** No accounts, no telemetry, no
uploads. Everything happens locally and the output lands in your Downloads
folder.

## Run it from source

```bash
pnpm install
pnpm build
```

Then load it unpacked:

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select `.output/chrome-mv3`

For development with hot reload, use `pnpm dev` instead — it opens its own
Chrome profile with the extension already loaded.

## Running the Phase 0 spike

ADR-002 bet that `chrome.debugger.attach()` works under `activeTab` alone, with
no fixed `host_permissions` in the manifest, and that this narrowed Scrubframe's
reach. The first half is true; the second half is not, and the spike is what
caught it. You can reproduce the run yourself.

**Result on Chrome 151:** `debugger-permission-suffices` — the control tab
attached just as easily as the invoked one. `activeTab` gates `chrome.scripting`,
not the debugger.

**Run it against a production build.** `pnpm dev` injects a `tabs` permission and
a `localhost` host permission for hot reload, both of which change the answer.
The spike detects that and refuses to give a verdict rather than give a
contaminated one.

**It needs two tabs.** Attaching to the tab you clicked the icon on proves only
that *something* allowed it — `activeTab`, or the `debugger` permission being
sufficient by itself. Those are different answers. So the spike also attaches to
a background tab you never invoked Scrubframe on, where `activeTab` is definitely
not granted. That second tab is the control, and without it there is no verdict.

1. `pnpm build`, then load `.output/chrome-mv3` unpacked.
2. Open a normal `https://` page — **not** `chrome://`, the Web Store, or a
   `file://` URL, where Chrome blocks extensions outright.
3. Open a **second** `https://` tab and leave it in the background. Do not click
   the Scrubframe icon while it is focused.
4. Make sure DevTools is **closed** on both. Only one debugger attaches at a time.
5. Back on the first tab, click the Scrubframe icon → **Run ADR-002 spike**.

The card reports one of five verdicts:

| Verdict | Meaning |
|---|---|
| **ADR-002 holds** | The invoked tab attached and the control tab was refused. `activeTab` is the real gate. Proceed to Phase 1. |
| **ADR-002 rests on a false premise** | The control tab attached too. `activeTab` gates nothing here — the operational decision stands, but §7's permission argument has to be rewritten. See `docs/ADR-ADDENDUM.md` (ADR-007). |
| **ADR-002 needs revision** | Chrome refused even the invoked tab, for lack of host access. Move to `optional_host_permissions` with a first-run prompt before Phase 1. |
| **Development build** | The loaded manifest carries permissions Scrubframe never ships. Build for production and try again. |
| **Inconclusive** | The run didn't isolate the question — most often no usable control tab was open. The rows below the verdict say which. |

**Capture frame** exercises the rest of the pipe: attach → `Page.captureScreenshot`
→ write to Downloads → detach. The file lands in
`~/Downloads/scrubframe_{hostname}_{timestamp}/frame-01.png`.

## Verify the zero-network claim yourself

Two ways, neither of which requires trusting this README:

**At runtime.** `chrome://extensions` → Developer mode → click **service
worker** under Scrubframe → the **Network** tab. It stays empty. Always.

**In the bundle.** The build is grepped for network primitives on every push,
and CI fails if one appears:

```bash
pnpm build && pnpm audit:network
```

Remote URL strings that survive minification (license banners, the SVG
namespace, React's error-docs pointer) are listed in
`scripts/network-allowlist.json`, each with a reason.

## Development

```bash
pnpm dev            # hot-reloading dev build in its own Chrome profile
pnpm compile        # typecheck, strict mode
pnpm test           # unit tests
pnpm check          # both of the above
pnpm build          # production build into .output/chrome-mv3
pnpm audit:network  # grep the built bundle for network primitives
```

## License

MIT
