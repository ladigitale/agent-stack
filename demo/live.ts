/**
 * sonic-chat branché sur un vrai backend AG-UI.
 *
 *   yarn dev → http://localhost:5173/live.html?endpoint=https://api.tadaaa.space/api/agent/run&token=…
 *
 * `token` est envoyé en `Authorization: Bearer` (jeton d'accès Tadaaa). Il reste dans
 * l'URL de ta propre page : à n'utiliser qu'en local.
 */
import "@supersoniks/concorde/core/components/ui/theme/theme";
import "../src/chat/sonic-chat";

const params = new URLSearchParams(location.search);
const endpoint = params.get("endpoint") ?? "";
const token = params.get("token");
const chat = document.querySelector("sonic-chat")!;
document.querySelector("#hint")!.textContent = endpoint
  ? `Backend : ${endpoint}`
  : "Ajoute ?endpoint=<url de /api/agent/run>&token=<jeton> à l'adresse.";
if (token) chat.headers = { Authorization: `Bearer ${token}` };
if (endpoint) chat.endpoint = endpoint;
