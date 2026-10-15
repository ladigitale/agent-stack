# Guide UI/UX pour les agents qui composent des surfaces

Parti pris : une surface A2UI/SDUI est un **outil** (mode « Operate » d'Impeccable), pas une page de marque. Elle doit être lisible d'un coup d'œil, utilisable au clavier et sans surprise. Ce guide dit aux agents quoi composer ; le rendu (échelle typographique, espacements, tailles de cibles) est tenu par `agent-stack`.

## Hiérarchie
- Une surface = un objectif. Un seul `Button` `primary` par groupe d'actions ; les alternatives sont `outline` ou `ghost`.
- Titres : `h2` pour le titre de la surface, `h3`/`h4` pour les sections. Pas de `h1` dans un chat.
- Regrouper par proximité (`Column` / `layout` des formulaires) avant d'ajouter des cartes ou des bordures.
- `caption` pour l'aide secondaire ; jamais pour une information indispensable.

## Actions
- Libellé = verbe + objet (« Envoyer la demande », « Supprimer le brouillon »), jamais « OK », « Valider » ou « Cliquer ici ».
- Action destructive : nommer l'objet et la conséquence, `variant: "danger"`, jamais en `primary` par défaut.
- Pendant l'attente d'une réponse, les boutons d'une surface sont désactivés par `sonic-chat` : inutile de gérer le double clic.

## Formulaires
- Chaque champ a un `label` persistant ; le `placeholder` n'est qu'un exemple.
- Format attendu ou contrainte dans `description`, avant la saisie.
- Erreur : `status: "error"` + `description` qui dit ce qui ne va pas et comment corriger, sans reproche.
- Choix : ≤ 4 options visibles → `ChoicePicker` (radio/cases) ; sinon liste déroulante ; `chips` pour des filtres courts.
- Conserver la saisie de l'utilisateur lors d'une erreur ; ne jamais vider un formulaire pour le recréer.

## Texte
- Phrases courtes, une idée par ligne, pas de majuscules d'emphase ni de ponctuation décorative.
- Dire chaque chose une fois : si le titre explique l'état, pas de phrase d'intro qui le répète.
- Erreur actionnable : ce qui a échoué, pourquoi si c'est connu, quoi faire ensuite. Pas de code interne en message principal.
- État vide : expliquer et proposer la prochaine action.

## Ce que fournit `agent-stack`
- Cibles tactiles ≥ 44 px (onglets, bouton de fermeture de la modale), focus visible, `Tabs` navigables aux flèches / Début / Fin.
- Texte secondaire en `color-mix` (pas d'`opacity`, qui dégrade le contraste), champs ≥ 16 px (pas de zoom iOS).
- Chat : défilement automatique seulement si l'utilisateur est en bas, Entrée IME-safe, « Réessayer » après une erreur, état vide configurable (`empty-text`), journal focusable et nommé (`log-label`).
- Thème : variables `--a2ui-gap`, `--a2ui-heading-gap`, `--a2ui-h1…h5`, `--a2ui-choice-gap`, `--a2ui-muted`, `--a2ui-field-border`.
