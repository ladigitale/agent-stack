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
| `/libraries` | Libraries SDUI `a2ui-basic` (catalogue de base A2UI) et `chat` (gabarits) | phase 1 |
| `/chat` | `sonic-chat`, session et transports AG-UI (HTTP SSE, rejeu) | phase 1 |
| `/catalog` | Export du catalogue Concorde vers A2UI et schéma d'outil `render_ui` | à faire |

Les recommandations UI/UX à donner aux agents sont dans [`docs/ui-guidelines.md`](docs/ui-guidelines.md).

Le contrat attendu du backend PHP est décrit dans [`docs/backend-contract.md`](docs/backend-contract.md).

## Démo

```sh
yarn dev
```

Lance un `sonic-chat` branché sur un flux AG-UI rejoué localement, sans backend. Le scénario enchaîne une carte A2UI avec un champ lié et un bouton, puis une confirmation SDUI `chat:confirm`.

## Utilisation de `/chat`

```html
<sonic-chat endpoint="/agent"></sonic-chat>
<script type="module">
  import "@ladigitale/agent-stack/chat";
</script>
```

Pour un autre transport ou des en-têtes :

```ts
import { ReplayTransport } from "@ladigitale/agent-stack/chat";
chat.headers = { Authorization: "Bearer …" };
chat.transport = new ReplayTransport(script); // ou toute implémentation de AgentTransport
```

Le texte des messages est toujours affiché en texte brut. Les blocs d'interface passent par `sonic-sdui` en `profile="safe"`.

## Libraries

`@ladigitale/agent-stack/libraries` exporte `a2uiBasicLibrary`, `chatLibrary` et `agentStackLibrary` (les deux fusionnées), à utiliser dans `descriptor.library`. Les JSON sont aussi exportés tels quels : `…/libraries/a2ui-basic.json` et `…/libraries/chat.json`.

La mise en page passe par des attributs `data-a2ui*` et `data-chat`, avec une CSS de spécificité nulle (`:where()`), injectée une seule fois. Les variables `--a2ui-gap` et les jetons `--sc-*` de Concorde permettent de la thémer.

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

`resolveContainer: (surfaceId) => HTMLElement` remplace `container` pour placer chaque surface où l'on veut. C'est ce que fait `sonic-chat`.

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
| `CheckBox`, `ChoicePicker` (exclusif), `Slider` | champ Concorde (`sonic-checkbox` / `sonic-switch`, `sonic-radio` ou `sonic-button` en chips, `sonic-input type=range`) sur un provider de travail, et `<a2ui-bridge>` qui convertit (booléen, liste d'une valeur, nombre) |
| `ChoicePicker` (tous) | `sonic-fieldset` qui porte le label et la description ; les options sont dans un `div[data-a2ui-choices]` |
| `ChoicePicker` (`multipleSelection`) | `sonic-checkbox` liés directement (tableau de valeurs) |
| `DateTimeInput` | `sonic-input` `date` / `time` / `datetime-local` |
| `Tabs`, `Modal` | `<a2ui-tabs>` / `<a2ui-modal>` : les enfants restent gérés par `sonic-sdui`, l'élément les répartit dans les slots de son shadow DOM |
| `children: {path, componentId}` (gabarit) | une instance du sous-arbre par élément du tableau (ids `<id>@<liste>/<i>`, chemins relatifs rendus absolus), réémise quand la longueur change ; listes imbriquées possibles |

### Composants supportés (catalogue de base)

Supportés : `Row`, `Column`, `List` (enfants statiques ou gabarit), `Text`, `Card`, `Divider`, `Icon`, `Image`, `Button`, `TextField`, `CheckBox`, `ChoicePicker`, `Slider`, `DateTimeInput`, `Tabs`, `Modal`.

Pas encore supportés, avec une erreur `UNSUPPORTED_COMPONENT` renvoyée à l'agent : `Video`, `AudioPlayer`, les `checks` (ignorés, avec un avertissement), les fonctions (`formatString`…) et les liaisons sur les props autres que du texte.

Les libellés passés à des attributs que Concorde rend en HTML (`label`, `description`) sont échappés : ils s'affichent toujours en texte.

### Props étendues (Concorde)

Le catalogue de base A2UI ne connaît que quelques props par composant. L'adaptateur accepte en plus ces props **optionnelles**, qui reprennent les noms des attributs Concorde. Un agent qui ne les connaît pas obtient le rendu de base ; une valeur hors liste est ignorée avec un avertissement (`onWarning`). Ce sont des littéraux : une liaison `{"path": …}` sur ces props renvoie une erreur à l'agent, comme ailleurs.

| Composant | Props | Rendu Concorde |
| --- | --- | --- |
| `Button` | `variant` : `primary`, `borderless` (A2UI) ou `outline`, `ghost`, `link` | `sonic-button` `type` / `variant` |
| `Button` | `type` : `primary`, `neutral`, `warning`, `danger`, `success`, `info` ; `size` : `2xs`…`2xl` ; `shape` : `circle`, `square`, `block` | attributs du même nom ; `type` l'emporte sur `variant: "primary"` |
| `Button` | `loading`, `disabled`, `active` (état sélectionné) | attributs booléens du même nom |
| `TextField`, `Slider`, `DateTimeInput` | `description`, `placeholder`, `size`, `status` (`success`, `error`, `warning`, `info`), `required`, `readonly`, `disabled` | attributs du même nom (`description` échappée) |
| `CheckBox` | `description`, `disabled`, `variant: "switch"` | `sonic-checkbox` ou `sonic-switch` |
| `ChoicePicker` | `description`, `disabled`, `size` ; `displayStyle: "chips"` | `sonic-fieldset` (label, description, groupe natif) ; chips = `sonic-button` cochables (`radio` si exclusif) |
| `Column` | `layout: "form"` | `sonic-form-layout` (grille 2 colonnes responsive) |
| `Row` | `layout: "actions"` (+ `justify`, `align`) | `sonic-form-actions` |
| `Row` | `layout: "group"` (+ `label`, `description`, `align`) | `sonic-group` |

`layout` est explicite, pas déduit du contenu : en streaming, les enfants d'une `Column` arrivent après elle, et un type de conteneur qui changerait en cours de route ferait clignoter la surface.

Le focus (clic, clavier) est géré par le navigateur et par les styles de Concorde : il n'est pas pilotable par l'agent. Pour l'adapter, surchargez les jetons `--sc-*`.

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
yarn dev        # démo
yarn build:demo
```
