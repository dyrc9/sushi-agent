# Maintenance Plan

This project is maintained as a compact, production-minded agent runtime.

## Weekly

- Run the scheduled maintenance workflow.
- Check dependency drift for npm, Cargo, and GitHub Actions.
- Add or improve one integration example.
- Review open issues for unclear abstractions or provider-specific leakage.

## Monthly

- Add one focused benchmark or regression case.
- Exercise at least one MCP server integration.
- Review the public API surface and remove accidental complexity before it sticks.
- Update the README with the current supported providers, tools, and examples.

## Release Checklist

- `npm run check`
- `npm test`
- `cargo test --workspace`
- `cargo clippy --workspace --all-targets -- -D warnings`
- Update changelog or release notes.
- Tag with semver once packages are publishable.

## Roadmap

- Provider adapters for OpenAI-compatible, Anthropic-compatible, local HTTP, and custom in-process models.
- Skill registry loading from local folders and package manifests.
- MCP tool discovery and execution with traceable calls.
- Rust-backed utilities for search, diff, file stats, and structured extraction.
- Replayable run traces for evaluation and debugging.
