# Rebuild the TUI with OpenTUI components

The current TUI builds terminal frames, cursor movement, borders, input handling, and modal widgets manually. Replace every interactive surface with supported OpenTUI components while preserving implemented behavior and applicable acceptance requirements.

The authoritative change contract is [opentui-component-tui.feature](../../specs/opentui-component-tui.feature). Existing capability features remain authoritative for their behavior. Markdown explains the implementation direction; it does not replace acceptance scenarios.

The baseline is commit `2afc270`, which contains the consolidated requirement catalog. Work proceeds on `feature/opentui-component-tui-rewrite`. Completion requires an inventory of migrated surfaces, behavioral traceability, distribution compatibility, and the existing evidence policy. This proposal records the intended rewrite; it does not claim that product implementation has started or passed verification.
