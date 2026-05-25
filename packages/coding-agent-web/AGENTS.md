# Coding Agent Web UI Notes

This package is the SDK-backed browser UI for the Pi coding agent runtime. It is not the reusable `packages/web-ui` package and should stay focused on running real Pi sessions in a browser.

## Runtime Scope

- Preserve full `AgentSessionRuntime` behavior: bash/read/edit/write tools, configured extensions, MCP-backed extensions, skills, prompt slash commands, session history, model registry, thinking levels, and tree/fork operations.
- Do not replace Pi runtime behavior with a separate web-only protocol unless the CLI/runtime cannot support the feature.
- Multiple browser sessions may run in parallel; keep per-session state keyed by session ID.

## Frontend Constraints

- `src/static.ts` is a TypeScript template literal containing the entire HTML/CSS/browser script. Escape backticks and template-literal-sensitive regex carefully.
- Keep completed transcript entries stable during streaming. Avoid full transcript re-renders that reload existing artifact iframes or cause scroll jumps.
- User prompts should clear immediately on send and render as local pending messages until the backend session entry appears.
- Stop controls should use the existing abort endpoint. Preserve Escape behavior for autocomplete/dialog dismissal; double Escape can be used as a stronger stop gesture.

## Artifact Previews

- Parse `::preview ...::` directives only from completed assistant messages. Do not preview user messages, tool output, or live streaming text.
- The directive must stay a full line outside fenced code blocks.
- Keep explicit previews ahead of auto-detected paths and dedupe by path.
- HTML previews currently run in unrestricted iframes for compatibility with generated Plotly/Recharts/static app artifacts. Do not reintroduce iframe sandboxing or CSP until those cases are manually validated.
- If adding restrictions later, add them one at a time and verify generated HTML artifacts still render before committing.

## Checks

- After code changes, run `npm run check` from the repo root.
- For quick browser-script syntax validation, parse the inline script from `INDEX_HTML` with `tsx` before running the full check.
