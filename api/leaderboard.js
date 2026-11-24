import { handle } from "../lib/http.js";
import { handleLeaderboard } from "../lib/leaderboard.js";

export const GET = handle(handleLeaderboard);
