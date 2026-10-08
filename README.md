# agent-stack

Branche des agents IA sur le SDUI de [`@supersoniks/concorde`](https://concorde.supersoniks.org/).

- **SDUI** est le modèle interne.
- **A2UI** est le format d'échange.
- **AG-UI** est le transport.

Le dépôt ne s'appuie que sur les [points d'extension publics de Concorde 5.1](https://concorde.supersoniks.org/crawl/core/components/functional/sdui/sdui-extension-points.html). Ce qui manque côté Concorde est listé dans [`docs/concorde-gaps.md`](docs/concorde-gaps.md).

## État

| Module | Contenu | État |
| --- | --- | --- |
| `/a2ui` | Rendu A2UI v0.9 vers `sonic-sdui` (safe + partial + ops incrémentales) | phase 1 |
| `/libraries` | Libraries SDUI `a2ui-basic` et `chat` | à faire |
| `/catalog` | Export du catalogue Concorde vers A2UI et schéma d'outil `render_ui` | à faire |
| `/chat` | `sonic-chat`, client AG-UI | à faire |

## Utilisation de `/a2ui`

```ts
import { A2uiRenderer } from "@ladigitale/agent-stack/a2ui";

const renderer = new A2uiRenderer({
  container: document.querySelector("#surfaces")!,
  onClientMessage: (msg) => sendToAgent(msg), // actions et erreurs, au format A2UI
  onWarning: (w) => console.warn(w),
});

renderer.handle(message);   // un message A2UI (objet)
renderer.handleText(chunk); // ou des lignes JSONL
```

Chaque surface A2UI devient un `<sonic-sdui profile="safe" partial>`. Son data model vit dans le dataProvider `a2ui_<surfaceId>`.

### Correspondances

| A2UI | Concorde |
| --- | --- |
| `updateComponents` | `upsertNode` (parent d'abord, enfants manquants en placeholder) |
| `updateDataModel` | `setData` (JSON Pointer vers chemin Concorde) |
| `createSurface` / `deleteSurface` | création / suppression du `sonic-sdui` et de son dataProvider |
| `action.event` | `action` sur le nœud, puis `sdui-action`, puis message `action` A2UI avec un `context` résolu |
| `Text` lié à un chemin | `<a2ui-text>`, toujours en texte brut |
| `TextField` lié à un chemin | `sonic-input` / `sonic-textarea` + `formDataProvider` + `name` |

### Composants supportés (catalogue de base)

Supportés : `Row`, `Column`, `List` (enfants statiques), `Text`, `Card`, `Divider`, `Icon`, `Image`, `Button`, `TextField`.

Pas encore supportés, avec une erreur `UNSUPPORTED_COMPONENT` renvoyée à l'agent : `CheckBox`, `ChoicePicker`, `DateTimeInput`, `Slider`, `Tabs`, `Modal`, `Video`, `AudioPlayer`, les listes avec template, les `checks` (ignorés, avec un avertissement), les fonctions (`formatString`…) et les liaisons sur les props autres que du texte.

Tout problème est signalé, à l'agent sous forme d'erreur A2UI ou à l'application via `onWarning`. Rien n'échoue en silence.

## Intégration Vite

Concorde publie ses sources TypeScript avec des décorateurs « legacy ». Un projet consommateur doit forcer les options suivantes :

```ts
esbuild: {
  tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
},
```

## Développement

```sh
yarn install
yarn test
yarn typecheck
```
