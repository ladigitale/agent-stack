# Contrat backend (AG-UI)

Ce que le backend PHP doit faire pour piloter `sonic-chat`. Le serveur n'émet que des messages : aucun rendu côté serveur.

## Requête

`POST <endpoint>`, avec `Content-Type: application/json` et `Accept: text/event-stream`. Le corps est un `RunAgentInput` AG-UI :

```json
{
  "threadId": "…",
  "runId": "…",
  "messages": [{ "id": "…", "role": "user", "content": "places pour samedi" }],
  "context": [],
  "forwardedProps": {
    "a2uiClientCapabilities": {
      "supportedCatalogIds": ["https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json"]
    }
  }
}
```

L'historique (`messages`) est renvoyé à chaque run. Par défaut, les cookies de session sont envoyés (`credentials: "same-origin"`).

### Actions de l'utilisateur

Un clic sur une action déclenche un nouveau run, sans nouveau message utilisateur. L'action est placée dans `forwardedProps` :

| Origine | Clé | Contenu |
| --- | --- | --- |
| Surface A2UI | `a2uiAction` | `{ "version": "v0.9", "action": { name, surfaceId, sourceComponentId, timestamp, context } }`, avec les liaisons du `context` déjà résolues |
| Bloc SDUI | `sduiAction` | `{ name, context, sourceNodeId? }`, le `detail` de `sdui-action` |

### Erreurs de rendu A2UI

Les erreurs (composant non supporté, surface inconnue, chemin invalide…) ne déclenchent pas de run. Elles sont jointes au run suivant dans `forwardedProps.a2uiErrors`, sous forme de tableau d'erreurs A2UI : `{ code, surfaceId, message, path? }`.

### Contexte de l'application

`sonic-chat` fusionne sa propriété `forwardedProps` dans chaque run : l'application y place son contexte (par exemple l'artefact en cours d'édition, `{"artifact": {"slug": "…"}}`).

## Réponse

C'est un flux SSE : un événement AG-UI JSON par `data:`, séparé par une ligne vide. `data: [DONE]` est toléré en fin de flux.

```
data: {"type":"RUN_STARTED","threadId":"…","runId":"…"}

data: {"type":"TEXT_MESSAGE_START","messageId":"m1","role":"assistant"}

data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m1","delta":"Il reste des places"}

data: {"type":"TEXT_MESSAGE_END","messageId":"m1"}

data: {"type":"RUN_FINISHED","threadId":"…","runId":"…"}
```

Événements pris en compte :

- `TEXT_MESSAGE_START`, `TEXT_MESSAGE_CONTENT`, `TEXT_MESSAGE_END` et `TEXT_MESSAGE_CHUNK`. Le texte est toujours affiché en texte brut.
- `TOOL_CALL_START` et `TOOL_CALL_END`, qui affichent une ligne d'état discrète.
- `RUN_ERROR`, qui affiche un message d'erreur.
- Les blocs d'interface décrits ci-dessous.

Les autres événements sont ignorés sans erreur. Un `CUSTOM` d'un autre nom que `a2ui` / `sdui` est remonté à l'application par l'événement DOM `chat-custom` (`detail: {name, value}`) : c'est le canal des charges propres à l'application (aperçu d'un document, navigation…).

## Blocs d'interface

### A2UI (format d'échange recommandé)

```json
{ "type": "CUSTOM", "name": "a2ui", "value": [ /* messages A2UI v0.9 */ ] }
```

`value` peut être un message unique ou un tableau. La forme `ACTIVITY_SNAPSHOT` est aussi acceptée : `{ "activityType": "a2ui", "content": { "messages": [ … ] } }`.

- `createSurface` crée le bloc à l'endroit où il arrive dans la conversation. Une surface peut ensuite être mise à jour dans les runs suivants, avec le même `surfaceId`.
- Les composants peuvent être envoyés dans n'importe quel ordre. Rien ne s'affiche tant que `root` n'existe pas.
- Composants supportés : voir le README. Les autres renvoient une erreur `UNSUPPORTED_COMPONENT` dans `a2uiErrors`.

### SDUI (composition directe avec les libraries)

```json
{ "type": "CUSTOM", "name": "sdui", "value": { "nodes": [ { "libraryKey": "chat:confirm", "nodes": [ … ] } ] } }
```

`value` est un `SDUIDescriptor` Concorde. Il est rendu en `profile="safe"`, avec les libraries `a2ui-basic` et `chat` déjà chargées. `markup`, `innerHTML`, `prefix`, `suffix` et `js` sont refusés.

Gabarits `chat:*` :

| Clé | Rôle | Où vont les enfants |
| --- | --- | --- |
| `chat:answer` | Bloc de réponse | Dedans |
| `chat:result-card` | Carte de résultat | Corps de la carte. Titre via `parentElementSelector: "sonic-card-header"`, pied via `"sonic-card-footer"` |
| `chat:confirm` | Confirmation | Corps de la carte. Boutons via `parentElementSelector: "sonic-form-actions"` |
| `chat:short-form` | Formulaire court | Grille de champs. Boutons via `parentElementSelector: "sonic-form-actions"`. Placer `formDataProvider` dans `attributes` |
| `chat:actions` | Rangée de boutons | Dedans |

Les boutons portent une `action: { name, context }`, qui revient en `forwardedProps.sduiAction`.

## Implémentation de référence

Tadaaa (`apps/api/src/Agent`, `POST /api/agent/run`) : boucle d'agent avec les outils MCP de Tadaaa exécutés dans le process, l'outil `render_ui` (composants A2UI validés côté serveur avec les règles des artefacts, puis émis en `CUSTOM a2ui`) et un client LLM (Messages API d'Anthropic). Sans Symfony AI ni Node.

Pour essayer `sonic-chat` contre un backend réel : `yarn dev`, puis `http://localhost:5173/live.html?endpoint=<url>&token=<jeton>`.
