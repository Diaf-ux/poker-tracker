var SUPABASE_URL = window.location.origin;
var SUPABASE_KEY = "local-dev";

var APP_PASSWORD = "2769allin";
var AUTH_KEY = "pokerauthv1";
var PLAYERS_KEY = "pokerlastplayersv1";

console.log(`Local config used, SUPABASE_URL=${SUPABASE_URL}`);

var tg = window.Telegram && window.Telegram.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}
