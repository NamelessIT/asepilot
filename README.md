# AsePilot

AI-assisted Aseprite coworker that turns reference images into editable pixel-art projects.

AsePilot helps artists and solo game developers convert a reference image into a structured pixel-art workflow: image analysis, target-size planning, palette reduction, layer planning, Aseprite project generation, and export.

## Status

Prototype MVP.

## What It Does

- Import a reference image.
- Choose target canvas size: 16x16, 32x32, 64x64, 128x128, or custom.
- Choose style preset: RPG item, top-down character, platformer sprite, icon, portrait.
- Generate a safe `pixel-plan.json`.
- Convert the plan into an Aseprite Lua script.
- Run Aseprite in batch mode to create `.aseprite` and `.png` outputs.
- Revise the result using user feedback.

## Core Design

AsePilot does not execute raw AI-generated code.

The AI or agent produces a constrained JSON plan. The app validates that plan, then generates Lua from trusted templates. Aseprite is used as the rendering and editing backend.

The MVP includes a deterministic local converter so the app works without API keys. Future provider adapters can integrate OpenAI, Anthropic, Codex CLI, or Claude Code, but those providers must still return validated JSON only.

## Requirements

- Windows 10/11
- Node.js 22+
- Git
- Aseprite installed locally for `.aseprite` export
- Optional: OpenAI, Anthropic, Codex CLI, or Claude Code integration

## Getting Started

```bash
git clone https://github.com/NamelessIT/asepilot.git
cd asepilot
npm install
npm run dev
```

If PowerShell blocks `npm.ps1`, use `npm.cmd`:

```powershell
npm.cmd install
npm.cmd run dev
```

Set Aseprite path in the app settings, or through:

```powershell
$env:ASEPRITE_PATH="C:\Program Files\Aseprite\Aseprite.exe"
npm.cmd run dev
```

## Commands

```bash
npm run dev
npm run lint
npm run test
npm run build
```

## Project Output

AsePilot stores generated work under:

```text
Documents/AsePilot/projects/{projectId}/
  input/
  analysis/
  plans/
  scripts/
  exports/
```

Each run produces:

- `plans/pixel-plan.json`
- `scripts/render.lua`
- `exports/preview.png`
- `exports/{outputName}.aseprite` when Aseprite is configured
- `exports/{outputName}.png` when Aseprite export succeeds

## Safety Model

- Never execute AI-generated Lua directly.
- Validate every color, coordinate, layer name, frame index, and canvas size.
- Limit canvas size in MVP to max `256x256`.
- Keep generated assets inside the project folder.
- Require explicit user confirmation before overwriting exports.

## Roadmap

- v0.1: Import image, choose target size, generate preview PNG.
- v0.2: Aseprite CLI bridge, `.aseprite` export, trusted Lua templates.
- v0.3: AI pixel-plan generation with validation.
- v0.4: Revision loop with preview comparison.
- v0.5: Packaging, settings, project history.
- v1.0: Stable desktop release.

## License

MIT
