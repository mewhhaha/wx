# @mewhhaha/wx-controller

Stateful editor controller for the wx editor stack.

The controller owns editor state transitions, command handling, language-service orchestration, viewport state, search, registers, jumps, buffers, host services, and presentation updates. Renderers subscribe to the controller instead of mutating editor state directly.

## Usage

```ts
import { createEditorController } from "@mewhhaha/wx-controller";

const controller = createEditorController({
  value: "let message = 'hello';\n",
  filePath: "src/main.ts"
});

controller.inputKey({ key: "i" });
controller.subscribe((update) => {
  console.log(update.nextState.mode);
});
```

## Exports

- `createEditorController(...)`
- `createSnapshotHistory(...)`
- `normalizeLanguageServices(...)`
- controller, update, presentation, command, buffer, host, history, and viewport types

## Development

```bash
pnpm --filter @mewhhaha/wx-controller build
```
