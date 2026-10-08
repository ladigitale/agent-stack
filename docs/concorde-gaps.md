# Manques constatés dans Concorde 5.1.0

Ce que l'adaptateur A2UI a rencontré en s'appuyant uniquement sur l'API publique de Concorde.
Les points 3 et 5 sont vérifiés par `test/concorde-gaps.spec.ts`. Ces tests décrivent le comportement **actuel** : ils échoueront le jour où Concorde corrigera, ce qui servira de signal pour retirer le contournement.

## 1. Les types SDUI ne sont pas exportés explicitement

La page des points d'extension annonce `…/sdui/types`, mais `package.json` n'a pas d'entrée explicite pour ce chemin.
Aujourd'hui, on passe par l'export joker `./*` : `@supersoniks/concorde/core/components/functional/sdui/types`. Ça fonctionne, mais le chemin est interne.

**Proposition :** ajouter `"./sdui/types"` dans `exports`.

## 2. Les fichiers de test sont publiés dans les exports

Plusieurs `*.spec.ts` (par exemple `./sdui-safe.spec`) apparaissent dans `exports`. Ce n'est pas bloquant, mais c'est du bruit dans l'API publique.

## 3. Un enfant inséré avant son parent est rendu en double

Scénario : `upsertNode(leaf, parentId: "box")` alors que `box` n'existe pas encore, puis `upsertNode(box { childNodeIds: ["leaf"] }, parentId: "root")`.

Résultat : `leaf` apparaît deux fois. Une fois dans `box`, et une fois à la racine. Comme `box` n'existait pas dans le DOM au moment du premier upsert, `leaf` a été ajouté à la racine et n'en a jamais été retiré.

**Contournement dans agent-stack :** `A2uiSurface` ne pousse un nœud qu'une fois son parent poussé. Concorde n'a donc jamais à créer de parent provisoire.

**Proposition :** quand le parent est inconnu, garder le nœud dans `nodeById` sans l'insérer dans le DOM. Il serait rendu quand un parent le référence via `childNodeIds`.

## 4. Pas de liaison générique d'un attribut à une donnée

Les `attributes` d'un nœud SDUI sont des chaînes fixes. La liaison aux données passe par des composants dédiés (`sonic-value`, `formDataProvider` + `name`, `sonic-list`).
A2UI permet de lier n'importe quelle prop (`{"path": "/x"}`). Pour l'instant, agent-stack refuse donc ces liaisons sur les props qui ne sont pas du texte, avec une erreur explicite : `Image.url`, `Icon.name`, etc.

**Proposition :** une forme déclarative, par exemple `boundAttributes: { src: "provider.path" }`, autorisée en `profile="safe"`.

## 5. `sonic-value` rend sa valeur en HTML, y compris en profil safe

`sonic-value` utilise `unsafeHTML` sur la donnée. Avec `profile="safe"`, le descripteur est filtré, mais une donnée injectée par le data model (`<img src=x onerror=…>`) est quand même interprétée comme du HTML.

Pour un agent, c'est une faille : le data model est contrôlé par l'agent, au même titre que le descripteur.

**Contournement dans agent-stack :** l'élément `<a2ui-text>` affiche la valeur via `textContent`.

**Proposition :** en `profile="safe"`, soit interdire `sonic-value`, soit lui ajouter un mode texte (`as="text"`) et l'imposer dans ce profil.

## 6. `descriptor.css` est chargé en profil safe

Le profil safe refuse `js`, mais charge toujours les feuilles de style listées dans `descriptor.css`. Si un agent fournit un descripteur entier (bloc `sdui` du chat), il peut donc charger une CSS externe : c'est du suivi possible, voire de l'exfiltration par sélecteurs d'attributs.

**Proposition :** en `profile="safe"`, ignorer `css`, avec un avertissement, comme pour `js`.

## 7. Pas de moyen synchrone de fournir une library en mode incrémental

À la première opération, Concorde clone le descripteur courant, et y met la library par défaut s'il n'y en a pas. Si on passe une library via `props` juste avant, elle n'est prise en compte qu'après le `willUpdate` de Lit, et `updateContents` peut encore effacer le DOM après les premières opérations.

**Contournement dans agent-stack :** l'adaptateur A2UI développe les entrées de la library directement dans les nœuds, au lieu de passer par `libraryKey`.

**Proposition :** une propriété `library` sur `sonic-sdui`, lue par `beginIncremental`.

## 8. Les composants référencés ne sont pas enregistrés par `sonic-sdui`

C'est attendu : SDUI ne fait que créer des balises. agent-stack enregistre donc lui-même les composants utilisés par ses libraries (`src/libraries/components.ts`). Ce point est noté parce qu'un catalogue (`component-catalog.json`) pourrait indiquer le module à importer pour chaque tag.

## 9. `label` et `description` des composants de formulaire sont rendus en HTML

`sonic-input`, `sonic-textarea`, `sonic-checkbox`, `sonic-select`, `sonic-divider`, `sonic-card-header`, `sonic-legend`, `sonic-group` passent `label` / `description` à `unsafeHTML`. Ce sont des attributs : le profil safe ne les filtre pas. Un libellé fourni par un agent (`<img src=x onerror=…>`) est donc interprété.

**Contournement dans agent-stack :** les libellés A2UI sont échappés avant d'être posés en attribut (`escapeHtml`).

**Proposition :** en `profile="safe"`, faire de même dans `sonic-sdui` (échapper ces attributs), ou ajouter aux composants un mode texte.
