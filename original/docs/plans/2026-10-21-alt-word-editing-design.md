# Alt/Option terminal word editing

Base: `8d64d77` (`main`). Branch: `codex/ssh/alt-word-editing`.

## Behavior

Default-on `altWordEditing` preference maps Alt/Option + Left/Right to ESC b/f,
Backspace to ESC DEL and Delete to ESC d. The remote shell owns word boundaries
and editing; Emacs/Readline bindings are required. Existing custom hotkeys win.
Composition, AltGraph, additional modifiers and alternate-screen applications
retain their original input. Disabling the setting restores xterm's mappings.
This setting is independent of `altIsMeta`, so Option character entry is unchanged.

## Implementation

The pure keyboard mapper is called from the existing custom key handler. It
uses `terminal.input()` to enter the normal onData route once, preserving AI
input routing, transfer gates, ordered writes, input tracking and error handling.
No backend/protocol changes, new runtime dependencies or shell configuration writes.

After a word-edit sequence, the append-only input model is untrusted. Ghost and
completion suggestions stay suppressed through subsequent typing until Enter,
Ctrl+C, a known whole-line replacement or session reset. Existing echo-validated
history capture remains responsible for recording edited commands; unsupported
captures may be skipped instead of recording an inferred command.

## Validation and limitations

- Unit coverage: four mappings, repeats, modifier/composition exclusions,
  custom-hotkey and alternate-screen passthrough, preference migration/storage,
  persistent suggestion suppression and recovery.
- Browser smoke: actual PTY bytes exactly once for all four keys, setting defaults
  and persisted opt-out (`scripts/smoke_ui_settings.mjs`).
- Local Bash PTY smoke: movement, deletion and editing in the middle of a line
  (`scripts/smoke_terminal_word_editing.py`).
- Frontend typecheck/tests/build and repository consistency checks.

Real WKWebView, remote Zsh/fish/vi bindings and tmux are not covered by the local
Bash smoke. tmux can use the alternate screen even for its shell; this conservative
passthrough means shell/tmux bindings may still be needed there. Full-screen
applications that do not use the alternate screen can opt out in settings.
Installation, release packaging and host restart remain separate manual actions.

Validation on 2026-10-21: frontend typecheck passed; full Vitest suite passed
(188 files, 2025 tests), and final targeted rerun passed (4 files, 93 tests).
Vite production build passed with output directed to `/tmp/dbx-word-edit-build`;
tracked `ui/` release artifacts were not regenerated. Both UI walkthroughs passed
with `DBX_SMOKE_STRICT=1`. All five local Bash PTY cases and the repository,
vendor lockstep/integrity, connection-form and mock-registry checks passed.
Rust checks were not run for this frontend-only change.

A local macOS arm64 package `0.7.9-beta.2.alt-word.1` was also built for manual
verification. Its archive integrity, bundled UI, vendored SDK and packaged
sidecar initialization were verified. Release versions remain unchanged in this
feature PR; the local test artifact is not committed.
