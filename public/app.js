import { enableAudioUnlock, isMuted, playSound, setMuted } from "./sound.js";

"use strict";
const PAGE_TITLE = "BAKASHA — Play together";

const SUITS = {
  hearts: { symbol: "♥", name: "Hearts" },
  spades: { symbol: "♠", name: "Spades" },
  diamonds: { symbol: "♦", name: "Diamonds" },
  clubs: { symbol: "♣", name: "Clubs" },
};
const SUIT_ORDER = ["hearts", "spades", "diamonds", "clubs"];
const QUICK_REACTION_TEXTS = new Set(["👏", "😂", "🔥", "😮", "GG"]);
const PLAYER_COLORS = ["#d3f36b", "#70a9f6", "#f17474", "#f0c95e", "#c39aef", "#6bcf9d"];
const elements = {
  setup: document.querySelector("#setup-screen"),
  online: document.querySelector("#online-screen"),
  game: document.querySelector("#game-screen"),
  start: document.querySelector("#start-button"),
  opponents: document.querySelector("#opponents"),
  hand: document.querySelector("#hand"),
  discard: document.querySelector("#discard-pile"),
  drawPile: document.querySelector("#draw-pile"),
  pileCount: document.querySelector("#pile-count"),
  supportAlert: document.querySelector("#support-alert"),
  message: document.querySelector("#turn-message"),
  hint: document.querySelector("#game-hint"),
  activeSuit: document.querySelector("#active-suit"),
  suitTitle: document.querySelector("#suit-title"),
  suitDescription: document.querySelector("#suit-description"),
  rematchModal: document.querySelector("#rematch-modal"),
  rematchWinner: document.querySelector("#rematch-winner"),
  rematch: document.querySelector("#rematch-button"),
  currentName: document.querySelector("#current-player-name"),
  currentCaption: document.querySelector("#current-player-caption"),
  playerBar: document.querySelector(".player-bar"),
  avatar: document.querySelector("#player-avatar"),
  handCount: document.querySelector("#hand-count"),
  handHelp: document.querySelector("#hand-help"),
  timer: document.querySelector("#turn-timer"),
  clock: document.querySelector("#turn-clock"),
  turnNumber: document.querySelector("#turn-number"),
  turnIndicator: document.querySelector("#turn-indicator"),
  suitModal: document.querySelector("#suit-modal"),
  rulesModal: document.querySelector("#rules-modal"),
  toast: document.querySelector("#toast"),
};
const chatToggle = document.querySelector("#game-chat-toggle");

let selectedCount = 4;
let onlineRoomSize = 2;
let game = null;
let toastTimer = null;
let turnTimer = null;
let onlineMode = false;
let onlineSeat = -1;
let trainingMode = false;
let trainingTurnTimer = null;
let accountUser = null;
let accountMode = "login";
let pendingInviteRoom = null;
let inviteAccepted = false;
let invitePreview = null;
let invitePreviewLoadingFor = null;
let publicRoomsTimer = null;
let publicRoomsLoading = false;
let activeRoomsLoading = false;
let friendChallengesTimer = null;
let presenceTimer = null;
let friendsLoading = false;
let pendingLobbyRequest = null;
let roomCreationPending = false;
let roomJoinPending = false;
let soundMuted = isMuted();
let tutorialIndex = 0;
let tutorialShown = false;
let tutorialDismissed = false;
let tutorialOpener = null;
let statsPeriod = "all";
let renderedHandSeat = null;
let duelSheetOpener = null;
let optimisticConnectionOpener = null;
let leaderboardPeriod = "weekly";
let leaderboardPreviousScreen = null;
const online = {
  roomCode: null,
  token: null,
  seat: -1,
  starting: false,
  publicData: null,
  discardHistory: [],
  ownHand: null,
  isHost: false,
  pollTimer: null,
  polling: false,
  movePending: false,
  pendingAction: null,
  chatSending: false,
  reactionSending: false,
  chatOpen: false,
  optimisticCard: null,
  timeoutSentAt: null,
  soundVersion: null,
  version: 0,
  clockOffset: 0,
  chatUnreadCount: 0,
  recentReactions: new Map(),
  reconnectAttempts: 0,
  lastAlertedTurn: null,
};

function createDeck() {
  const cards = [];
  for (const suit of SUIT_ORDER) {
    for (const rank of ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]) {
      cards.push({ id: `${suit}-${rank}`, suit, rank });
    }
  }
  cards.push({ id: "joker-1", suit: "wild", rank: "JOKER" });
  cards.push({ id: "joker-2", suit: "wild", rank: "JOKER" });
  return shuffle(cards);
}

function shuffle(cards) {
  for (let index = cards.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [cards[index], cards[other]] = [cards[other], cards[index]];
  }
  return cards;
}

function startGame() {
  if (!accountUser) {
    showAccountGate();
    return;
  }
  openOnlineLobby("group");
}

function startTrainingGame() {
  if (!accountUser) {
    showAccountGate();
    return;
  }
  dealGame([accountUser.username, "Nicole"], { training: true });
}

function dealGame(names, options = {}) {
  window.clearTimeout(trainingTurnTimer);
  trainingTurnTimer = null;
  renderedHandSeat = null;
  trainingMode = options.training === true;
  for (const selector of ["#end-online-room", "#end-room-from-game", "#end-room-from-result", "#start-queued-match"]) {
    document.querySelector(selector).classList.add("hidden");
  }
  onlineMode = false;
  onlineSeat = -1;
  online.chatOpen = false;
  online.optimisticCard = null;
  elements.rematch.disabled = false;
  elements.rematch.innerHTML = 'Play again <span aria-hidden="true">↻</span>';
  document.querySelector("#rematch-status").textContent = "Keep this table going with the same players.";
  document.querySelector("#mode-label").textContent = trainingMode ? "Training with Nicole" : "Local game";
  document.querySelector("#round-mode-label").textContent = trainingMode ? "TRAINING" : "PASS & PLAY";
  window.clearInterval(turnTimer);
  turnTimer = null;
  hideModal(elements.suitModal);
  hideModal(elements.rematchModal);
  const deck = createDeck();
  const players = names.map((name) => ({ name, hand: [] }));
  for (let cardIndex = 0; cardIndex < 4; cardIndex += 1) {
    for (const player of players) player.hand.push(deck.pop());
  }
  let firstDiscardIndex = deck.findIndex((card) => !["A", "2", "8", "J", "JOKER"].includes(card.rank));
  if (firstDiscardIndex < 0) firstDiscardIndex = 0;
  const [firstDiscard] = deck.splice(firstDiscardIndex, 1);
  game = {
    players,
    deck,
    discard: [firstDiscard],
    current: 0,
    direction: 1,
    activeSuit: firstDiscard.suit,
    demandedSuit: null,
    pending: 0,
    pendingType: null,
    combo: null,
    jumpSupport: false,
    freeSuitPlay: false,
    mustDrawSeat: null,
    knocked: names.map(() => false),
    round: 1,
    eliminated: names.map(() => false),
    roundOut: names.map(() => false),
    turns: 1,
    finished: false,
    stagedCardIndex: null,
    timeLeft: 60,
    turnDeadline: 0,
  };
  elements.setup.classList.add("hidden");
  elements.online.classList.add("hidden");
  elements.game.classList.remove("hidden");
  document.querySelector("#game-chat").classList.add("hidden");
  document.querySelector("#game-chat").hidden = true;
  document.querySelector("#round-player-count").textContent = `${players.length} PLAYERS`;
  renderGame();
  if (trainingMode) playSound("turn");
  startTurnTimer();
}

function completeLocalOut(seat) {
  game.roundOut[seat] = true;
  const stillPlaying = game.players
    .map((player, index) => index)
    .filter((index) => !game.eliminated[index] && !game.roundOut[index]);
  if (stillPlaying.length > 1) {
    showToast(`${game.players[seat].name} is safe for this round.`);
    return false;
  }

  const eliminatedSeat = stillPlaying[0];
  game.eliminated[eliminatedSeat] = true;
  const survivors = game.players
    .map((player, index) => index)
    .filter((index) => !game.eliminated[index]);
  showToast(`${game.players[eliminatedSeat].name} is eliminated.`);
  if (survivors.length === 1) {
    finishLocalGame(survivors[0]);
    return true;
  }
  startPlayoffRound(survivors);
  return true;
}

function finishLocalGame(winnerSeat) {
  game.finished = true;
  game.winner = game.players[winnerSeat].name;
  window.clearTimeout(trainingTurnTimer);
  trainingTurnTimer = null;
  window.clearInterval(turnTimer);
  turnTimer = null;
  renderGame();
  presentGameResult(game.winner);
  document.querySelector("#rematch-status").textContent = "Last player standing wins the playoff.";
  elements.rematchModal.classList.remove("hidden");
  elements.rematch.focus();
}

function updateResultScore() {
  const progress = accountUser && accountUser.progress;
  document.querySelector("#result-score").textContent = progress
    ? `Score: ${progress.wins} points · ${progress.xp} XP`
    : "Sign in to save your online progress.";
}

function presentGameResult(winner) {
  const won = Boolean(accountUser && winner === accountUser.username);
  elements.rematchWinner.textContent = won ? "You" : winner;
  document.querySelector("#result-word").textContent = won ? "won!" : "wins!";
  document.querySelector("#rematch-modal .eyebrow").textContent = won ? "YOU DID IT!" : "GOOD GAME";
  updateResultScore();
  updateTurnNotificationControl();
  playSound(won ? "win" : "lose");
  if (won) {
    showConfetti();
  }
}

function updateTurnNotificationControl() {
  const button = document.querySelector("#turn-notifications-button");
  const status = document.querySelector("#turn-notifications-status");
  const supported = "Notification" in window;
  button.classList.toggle(
    "hidden",
    !game?.finished || !accountUser || !supported || Notification.permission !== "default",
  );
  if (!supported) status.textContent = "";
  else if (Notification.permission === "granted") status.textContent = "Turn notifications are enabled.";
  else if (Notification.permission === "denied") status.textContent = "Notifications are blocked in your browser settings.";
}

function alertForTurn(state) {
  if (!state || state.finished || state.current !== online.seat) {
    online.lastAlertedTurn = null;
    document.title = PAGE_TITLE;
    return;
  }
  const turnKey = `${online.roomCode}:${state.turnStartedAt}:${state.current}`;
  if (online.lastAlertedTurn === turnKey) return;
  online.lastAlertedTurn = turnKey;
  playSound("turn");
  if (!document.hidden) return;
  document.title = "Your turn! | BAKASHA";
  if (typeof navigator.vibrate === "function") navigator.vibrate([120, 80, 120]);
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification("Your turn in BAKASHA", { body: "Tap to return to your game." });
  }
}

function showConfetti() {
  const colors = ["#58cc02", "#1cb0f6", "#ffc800", "#ff4b4b", "#fff"];
  const confetti = document.createElement("div");
  confetti.className = "confetti-burst";
  confetti.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 36; index += 1) {
    const piece = document.createElement("span");
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.setProperty("--confetti-color", colors[index % colors.length]);
    piece.style.setProperty("--confetti-delay", `${Math.random() * 260}ms`);
    piece.style.setProperty("--confetti-drift", `${Math.round(Math.random() * 180 - 90)}px`);
    piece.style.setProperty("--confetti-rotate", `${Math.round(Math.random() * 720 - 360)}deg`);
    confetti.append(piece);
  }
  document.body.append(confetti);
  window.setTimeout(() => confetti.remove(), 2200);
}

function startPlayoffRound(survivors) {
  const deck = createDeck();
  for (const [index, player] of game.players.entries()) {
    player.hand = [];
    if (!game.eliminated[index]) {
      for (let cardIndex = 0; cardIndex < 4; cardIndex += 1) player.hand.push(deck.pop());
    }
  }
  let firstDiscardIndex = deck.findIndex((card) => !["A", "2", "8", "J", "JOKER"].includes(card.rank));
  if (firstDiscardIndex < 0) firstDiscardIndex = 0;
  const [firstDiscard] = deck.splice(firstDiscardIndex, 1);
  game.deck = deck;
  game.discard = [firstDiscard];
  game.current = survivors[0];
  game.direction = 1;
  game.activeSuit = firstDiscard.suit;
  game.demandedSuit = null;
  game.pending = 0;
  game.pendingType = null;
  game.combo = null;
  game.jumpSupport = false;
  game.freeSuitPlay = false;
  game.mustDrawSeat = null;
  game.knocked = game.players.map(() => false);
  game.roundOut = game.players.map(() => false);
  game.round += 1;
  game.turns += 1;
  renderGame();
  startTurnTimer();
}

function topCard() {
  return game.discard[game.discard.length - 1];
}

function isPlayable(card) {
  if (game.mustDrawSeat === game.current) return false;
  if (game.pending > 0) {
    return game.pendingType === "draw-two"
      ? card.rank === "2"
      : card.rank === "JOKER" || card.rank === "2";
  }
  if (game.combo) {
    return card.rank === "8" || card.suit === game.combo.lastCard.suit;
  }
  if (game.jumpSupport) return game.players.length === 2 && (card.rank === "J" || card.suit === topCard().suit);
  if (game.freeSuitPlay) return true;
  if (game.demandedSuit) {
    return card.rank === "A" || card.rank === "JOKER" || card.suit === game.demandedSuit;
  }
  return card.rank === "JOKER" ||
    card.suit === game.activeSuit || card.rank === topCard().rank;
}

function getCardColor(suit) {
  return { hearts: "red", spades: "blue", diamonds: "yellow", clubs: "green", wild: "wild" }[suit];
}

function createCardElement(card, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = options.interactive ? "playing-card" : "playing-card";
  button.dataset.suit = card.suit;
  button.dataset.cardId = card.id;
  if (options.interactive) {
    const playable = isPlayable(card);
    const turnBlocked = game.finished ||
      (onlineMode && (game.current !== onlineSeat || online.movePending)) ||
      (trainingMode && game.current !== 0);
    button.disabled = turnBlocked;
    button.classList.toggle("is-playable", playable);
    button.classList.toggle("is-unplayable", !playable);
    button.setAttribute("aria-disabled", String(turnBlocked));
    const description = card.rank === "JOKER" ? "Joker, draw four and change suit" : `${card.rank} of ${SUITS[card.suit].name}`;
    button.setAttribute("aria-label", playable ? description : `${description}, not playable right now`);
    button.addEventListener("click", () => selectCard(options.index));
  }
  const corner = document.createElement("span");
  corner.className = "card-corner";
  const cornerRank = document.createElement("span");
  cornerRank.className = "card-rank";
  cornerRank.textContent = card.rank === "JOKER" ? "JOKER" : card.rank;
  const cornerSuit = document.createElement("span");
  cornerSuit.className = "card-suit";
  cornerSuit.textContent = card.suit === "wild" ? "✳" : SUITS[card.suit].symbol;
  corner.append(cornerRank, cornerSuit);
  const face = document.createElement("span");
  face.className = "card-face";
  face.textContent = card.suit === "wild" ? "🤡" : SUITS[card.suit].symbol;
  const bottomCorner = corner.cloneNode(true);
  bottomCorner.classList.add("card-corner-bottom");
  button.append(corner, face, bottomCorner);
  return button;
}

function animatePlayedCard(index) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const card = game.players[game.current].hand[index];
  if (!card) return;
  const source = [...elements.hand.querySelectorAll("[data-card-id]")].find((item) => item.dataset.cardId === card.id);
  if (!source) return;
  const sourceRect = source.getBoundingClientRect();
  const targetRect = elements.discard.getBoundingClientRect();
  const flight = source.cloneNode(true);
  flight.className = "playing-card card-flight";
  flight.setAttribute("aria-hidden", "true");
  flight.removeAttribute("tabindex");
  flight.disabled = true;
  flight.style.position = "fixed";
  flight.style.left = `${sourceRect.left}px`;
  flight.style.top = `${sourceRect.top}px`;
  flight.style.width = `${sourceRect.width}px`;
  flight.style.height = `${sourceRect.height}px`;
  flight.style.margin = "0";
  flight.style.zIndex = "20";
  flight.style.pointerEvents = "none";
  flight.style.setProperty("--tilt", "0deg");
  document.body.append(flight);
  const moveX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
  const moveY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
  if (typeof flight.animate !== "function") {
    flight.remove();
    return;
  }
  const animation = flight.animate([
    { transform: "translate(0, 0) rotate(0deg) scale(1)" },
    { transform: `translate(${moveX}px, ${moveY}px) rotate(220deg) scale(.86)` },
  ], { duration: 280, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" });
  animation.onfinish = () => flight.remove();
  animation.oncancel = () => flight.remove();
}

function animateDrawnCard(cardElement) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    cardElement.classList.remove("card-draw-arrival");
    return;
  }
  const sourceRect = elements.drawPile.getBoundingClientRect();
  const targetRect = cardElement.getBoundingClientRect();
  const flight = cardElement.cloneNode(true);
  flight.className = "playing-card card-flight";
  flight.setAttribute("aria-hidden", "true");
  flight.removeAttribute("tabindex");
  flight.disabled = true;
  Object.assign(flight.style, {
    position: "fixed",
    left: `${sourceRect.left}px`,
    top: `${sourceRect.top}px`,
    width: `${sourceRect.width}px`,
    height: `${sourceRect.height}px`,
    margin: "0",
    zIndex: "20",
    pointerEvents: "none",
  });
  document.body.append(flight);
  const moveX = targetRect.left + targetRect.width / 2 - (sourceRect.left + sourceRect.width / 2);
  const moveY = targetRect.top + targetRect.height / 2 - (sourceRect.top + sourceRect.height / 2);
  if (typeof flight.animate !== "function") {
    flight.remove();
    cardElement.classList.remove("card-draw-arrival");
    return;
  }
  const animation = flight.animate([
    { transform: "translate(0, 0) scale(.8)", opacity: .8 },
    { transform: `translate(${moveX}px, ${moveY}px) scale(1)`, opacity: 1 },
  ], { duration: 300, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "forwards" });
  animation.onfinish = () => {
    flight.remove();
    cardElement.classList.remove("card-draw-arrival");
  };
  animation.oncancel = animation.onfinish;
}

function renderGame() {
  if (!game) return;
  document.body.classList.toggle("game-active", !game.finished);
  const liveOnlineGame = onlineMode && !game.finished;
  chatToggle.classList.toggle("hidden", !onlineMode);
  chatToggle.disabled = !liveOnlineGame;
  chatToggle.setAttribute("aria-label", online.chatOpen ? "Close table chat" : "Open table chat");
  chatToggle.setAttribute("aria-expanded", String(liveOnlineGame && online.chatOpen));
  if (!onlineMode) {
    online.chatOpen = false;
    document.querySelector("#game-chat").classList.add("hidden");
    document.querySelector("#game-chat").hidden = true;
    chatToggle.setAttribute("aria-expanded", "false");
    chatToggle.setAttribute("aria-label", "Open table chat");
  }
  const viewIndex = onlineMode ? onlineSeat : trainingMode ? 0 : game.current;
  const player = game.players[viewIndex];
  elements.currentName.textContent = player.name;
  elements.currentCaption.textContent = trainingMode
    ? "YOUR HAND"
    : onlineMode && game.current === onlineSeat ? "YOUR TURN" : "YOUR HAND";
  elements.avatar.textContent = player.name.trim().charAt(0).toUpperCase();
  elements.avatar.style.color = PLAYER_COLORS[viewIndex % PLAYER_COLORS.length];
  const ownReaction = online.recentReactions.get(onlineSeat);
  const ownReactionElement = document.querySelector("#player-reaction");
  ownReactionElement.textContent = ownReaction ? ownReaction.emoji : "";
  ownReactionElement.classList.toggle("hidden", !ownReaction);
  elements.handCount.textContent = `${player.hand.length} ${player.hand.length === 1 ? "card" : "cards"}`;
  elements.turnNumber.textContent = onlineMode ? `TURN ${game.turns}` : `ROUND ${game.round} · TURN ${game.turns}`;
  elements.timer.classList.toggle("timer-warning", game.timeLeft <= 10 && !game.finished);
  elements.clock.textContent = game.finished ? "—" : String(game.timeLeft);
  elements.timer.setAttribute("aria-label", game.finished ? "Game over" : `${game.timeLeft} seconds remaining`);
  elements.pileCount.textContent = `${game.deckCount === undefined ? game.deck.length : game.deckCount} LEFT`;
  elements.drawPile.setAttribute("aria-label", game.pending > 0
    ? `Draw ${game.pending} penalty cards`
    : game.mustDrawSeat === game.current ? "Draw one card" : "Draw a card");
  elements.drawPile.classList.toggle("is-drawing", online.movePending && online.pendingAction === "draw");
  elements.drawPile.disabled = (onlineMode && (game.current !== onlineSeat || online.movePending))
    || (trainingMode && game.current !== 0);
  elements.supportAlert.classList.toggle("hidden", !game.combo && !game.jumpSupport);
  const isViewerTurn = onlineMode
    ? game.current === onlineSeat
    : trainingMode
      ? game.current === 0
      : true;
  elements.turnIndicator.classList.toggle("is-your-turn", isViewerTurn && !game.finished);
  elements.turnIndicator.querySelector("span").textContent = game.direction === 1 ? "↻" : "↺";
  const previousDiscard = elements.discard.lastElementChild;
  const visibleTopCard = online.optimisticCard || topCard();
  const discardCards = (onlineMode
    ? [...online.discardHistory.slice(-2), visibleTopCard]
    : game.discard.slice(-3));
  const discardElements = discardCards.map((card, index) => {
    const cardElement = createCardElement(card, { interactive: false });
    const isTopCard = index === discardCards.length - 1;
    cardElement.classList.add("discard-stack-card");
    cardElement.classList.toggle("discard-stack-top", isTopCard);
    cardElement.disabled = true;
    cardElement.setAttribute("aria-hidden", "true");
    cardElement.style.zIndex = String(index + 1);
    const depth = discardCards.length - 1 - index;
    const side = index % 2 === 0 ? -1 : 1;
    cardElement.style.setProperty("--stack-x", `${side * (4 + depth * 4)}px`);
    cardElement.style.setProperty("--stack-y", `${depth * 2}px`);
    cardElement.style.setProperty("--stack-tilt", `${side * (2 + depth * 2)}deg`);
    if (isTopCard && previousDiscard && previousDiscard.dataset.cardId !== cardElement.dataset.cardId) {
      cardElement.classList.add("card-play");
    }
    return cardElement;
  });
  elements.discard.replaceChildren(...discardElements);
  const winningCard = document.querySelector("#winning-card");
  winningCard.replaceChildren();
  winningCard.classList.toggle("hidden", !game.finished);
  if (game.finished) winningCard.append(createCardElement(topCard(), { interactive: false }));
  const jokerSuitPending = game.pendingType === "draw-four";
  if (game.freeSuitPlay || jokerSuitPending || game.activeSuit === "wild") {
    elements.activeSuit.classList.add("hidden");
  } else {
    elements.activeSuit.classList.remove("hidden");
    elements.activeSuit.textContent = SUITS[game.activeSuit].symbol;
    elements.activeSuit.style.color = getCardColor(game.activeSuit) === "red" || getCardColor(game.activeSuit) === "yellow" ? "#e83f37" : getCardColor(game.activeSuit) === "blue" ? "#70a9f6" : "#6bcf9d";
  }
  renderOpponents();
  if (game.current === viewIndex) {
    elements.playerBar.insertBefore(elements.timer, elements.handCount);
  } else {
    const activeOpponent = elements.opponents.querySelector(`[data-seat="${game.current}"]`);
    if (activeOpponent) activeOpponent.append(elements.timer);
  }
  renderHand();
  updateMessage();
  scheduleFundoTurn();
}

function renderOpponents() {
  elements.opponents.replaceChildren();
  game.players.forEach((player, index) => {
    const viewerSeat = onlineMode ? onlineSeat : trainingMode ? 0 : game.current;
    if (index === viewerSeat) return;
    const opponent = document.createElement("div");
    opponent.className = "opponent";
    opponent.dataset.seat = String(index);
    const reaction = online.recentReactions.get(index);
    if (reaction) {
      const reactionBadge = document.createElement("span");
      reactionBadge.className = "opponent-reaction";
      reactionBadge.textContent = reaction.emoji;
      opponent.append(reactionBadge);
    }
    const name = document.createElement("span");
    name.className = "opponent-name";
    name.textContent = player.name;
    const cardRow = document.createElement("div");
    cardRow.className = "opponent-cards";
    for (let cardIndex = 0; cardIndex < Math.min(player.hand.length, 7); cardIndex += 1) {
      const card = document.createElement("span");
      card.className = "opponent-back";
      card.setAttribute("aria-hidden", "true");
      cardRow.append(card);
    }
    const count = document.createElement("span");
    count.className = "opponent-count";
    count.textContent = game.eliminated?.[index]
      ? "Eliminated"
      : game.roundOut?.[index]
        ? "Round safe"
        : `${player.hand.length} ${player.hand.length === 1 ? "card" : "cards"}`;
    opponent.append(name, cardRow, count);
    elements.opponents.append(opponent);
  });
}

function showQuickReaction(seat, emoji) {
  const id = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  online.recentReactions.set(seat, { emoji, id });
  const reactionFloats = document.querySelector("#reaction-floats");
  const floatingReaction = document.createElement("span");
  floatingReaction.className = "live-reaction-float";
  floatingReaction.textContent = emoji;
  floatingReaction.style.left = `${15 + Math.random() * 70}%`;
  reactionFloats.append(floatingReaction);
  window.setTimeout(() => floatingReaction.remove(), 1800);
  if (game && onlineMode) {
    if (seat === onlineSeat) renderGame();
    else renderOpponents();
  }
  window.setTimeout(() => {
    if (online.recentReactions.get(seat)?.id !== id) return;
    online.recentReactions.delete(seat);
    if (game && onlineMode) {
      if (seat === onlineSeat) renderGame();
      else renderOpponents();
    }
  }, 2600);
}

function renderHand() {
  const previousScrollLeft = elements.hand.scrollLeft;
  const wasScrolledToEnd = previousScrollLeft + elements.hand.clientWidth
    >= elements.hand.scrollWidth - 2;
  const previousCards = new Set(
    [...elements.hand.querySelectorAll("[data-card-id]")].map((card) => card.dataset.cardId),
  );
  elements.hand.replaceChildren();
  const seat = onlineMode ? onlineSeat : trainingMode ? 0 : game.current;
  const sameSeat = renderedHandSeat === seat;
  renderedHandSeat = seat;
  const hand = game.players[seat].hand
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => !onlineMode || !online.optimisticCard || card.id !== online.optimisticCard.id);
  hand.forEach(({ card, index }, position) => {
    const cardElement = createCardElement(card, { interactive: true, index });
    cardElement.style.zIndex = String(position + 1);
    if (hand.length === 1 && !game.knocked?.[seat]) cardElement.disabled = true;
    const spread = hand.length > 9 ? 0 : (index - (hand.length - 1) / 2) * 1.4;
    cardElement.style.setProperty("--tilt", `${spread}deg`);
    if (!previousCards.has(card.id)) {
      if (sameSeat) {
        cardElement.classList.add("card-draw-arrival");
        elements.hand.append(cardElement);
        animateDrawnCard(cardElement);
        return;
      }
      cardElement.classList.add("card-deal");
      cardElement.style.animationDelay = `${Math.min(position, 8) * 24}ms`;
    }
    elements.hand.append(cardElement);
  });
  if (onlineMode && online.movePending && online.pendingAction === "draw") {
    const pendingCard = document.createElement("div");
    pendingCard.className = "playing-card pending-draw-card";
    pendingCard.setAttribute("aria-hidden", "true");
    pendingCard.textContent = "DRAWING";
    elements.hand.append(pendingCard);
  }
  elements.hand.scrollLeft = wasScrolledToEnd
    ? elements.hand.scrollWidth
    : previousScrollLeft;
  const handOverflows = elements.hand.scrollWidth > elements.hand.clientWidth + 2;
  elements.handHelp.textContent = handOverflows ? "Swipe or scroll sideways to see all your cards." : "";
  elements.handHelp.classList.toggle("hidden", !handOverflows);
  elements.hand.setAttribute("aria-label", handOverflows
    ? "Your cards. Swipe or scroll horizontally to see your full hand."
    : "Your cards.");
}

function updateMessage() {
  const player = game.players[game.current];
  const isViewerTurn = (onlineMode && game.current === onlineSeat)
    || (trainingMode && game.current === 0);
  const turnLabel = isViewerTurn ? "Your turn" : `${player.name}’s turn`;
  elements.hint.textContent = "";
  if (game.finished) {
    elements.message.textContent = `${game.winner} wins!`;
    return;
  }
  if (onlineMode && !isViewerTurn) {
    elements.message.textContent = `${player.name}’s turn`;
    return;
  }
  if (trainingMode && game.current !== 0) {
    elements.message.textContent = "Nicole is thinking…";
    return;
  }
  if (game.pending > 0) {
    elements.message.textContent = isViewerTurn ? `Your turn · Draw ${game.pending}` : `Draw ${game.pending}`;
    return;
  }
  if (game.mustDrawSeat === game.current) {
    elements.message.textContent = isViewerTurn ? "Your turn · Draw 1" : `${player.name} must draw 1`;
    return;
  }
  if (game.demandedSuit) {
    elements.message.textContent = `${isViewerTurn ? "Your turn · " : ""}Play ${SUITS[game.demandedSuit].name} or an Ace`;
    return;
  }
  if (game.freeSuitPlay) {
    elements.message.textContent = turnLabel;
    return;
  }
  if (game.combo) {
    elements.message.textContent = "SUPPORT!";
    return;
  }
  if (game.jumpSupport) {
    elements.message.textContent = "SUPPORT!";
    return;
  }
  elements.message.textContent = turnLabel;
}

function selectCard(index) {
  if (!game || game.finished) return;
  if (onlineMode && (game.current !== onlineSeat || online.movePending)) return;
  if (trainingMode && game.current !== 0) return;
  const card = game.players[game.current].hand[index];
  if (!card) return;
  if (!isPlayable(card)) {
    const button = [...elements.hand.querySelectorAll("[data-card-id]")]
      .find((item) => item.dataset.cardId === card.id);
    if (button) {
      button.classList.remove("is-illegal");
      void button.offsetWidth;
      button.classList.add("is-illegal");
      window.setTimeout(() => button.classList.remove("is-illegal"), 400);
    }
    playSound("error");
    showToast("Not quite! Pick a card that matches the suit or number.");
    return;
  }
  if (card.rank === "A") {
    game.stagedCardIndex = index;
    elements.suitTitle.textContent = "Name a suit";
    elements.suitDescription.textContent = "The next player must play this suit or an Ace.";
    for (const option of elements.suitModal.querySelectorAll(".suit-option")) option.disabled = false;
    elements.suitModal.classList.remove("hidden");
    const firstOption = elements.suitModal.querySelector(".suit-option");
    if (firstOption) firstOption.focus();
    return;
  }
  if (onlineMode) {
    animatePlayedCard(index);
    submitOnlineMove({ type: "play", cardId: card.id });
    return;
  }
  animatePlayedCard(index);
  playLocalTurnCard(index);
}

function cardSoundName(card) {
  if (!card) return "play";
  return {
    A: "ace",
    2: "two",
    J: "jack",
    JOKER: "joker",
  }[card.rank] || "play";
}

function playCard(index, chosenSuit) {
  const player = game.players[game.current];
  const [card] = player.hand.splice(index, 1);
  if (!card) return;
  const counteringJoker = game.pending > 0 && game.pendingType === "draw-four";
  const counteringDrawTwo = game.pending > 0 && game.pendingType === "draw-two" && card.rank === "2";
  const opponentTurn = trainingMode && game.current !== 0;
  playSound(cardSoundName(card), { volumeScale: opponentTurn ? 0.62 : 1 });
  if (counteringJoker || counteringDrawTwo) {
    playSound("block", { volumeScale: opponentTurn ? 0.72 : 1 });
  }
  if (player.hand.length === 1) {
    playSound("lastCard", { volumeScale: opponentTurn ? 0.72 : 1 });
  }
  const supportedEight = Boolean(game.combo);
  const supportedJump = game.jumpSupport;
  game.discard.push(card);
  game.freeSuitPlay = false;
  game.knocked[game.current] = player.hand.length === 1;
  if (card.rank === "A") {
    game.activeSuit = chosenSuit;
    game.demandedSuit = chosenSuit;
  } else if (card.rank !== "JOKER") game.activeSuit = card.suit;

  if (counteringJoker && card.rank === "JOKER") {
    game.pending = 0;
    game.pendingType = null;
    game.demandedSuit = null;
    game.freeSuitPlay = true;
    if (player.hand.length === 0) game.mustDrawSeat = game.current;
    showToast(`${player.name} canceled the Joker penalty. The next player may play anything.`);
    advanceTurn();
    return;
  }
  if (counteringJoker && card.rank === "2") {
    game.pending = 0;
    game.pendingType = null;
    game.demandedSuit = null;
    takeCards(player, 2);
    if (player.hand.length === 0) game.mustDrawSeat = game.current;
    showToast(`${player.name} blocked 2 of the Joker penalty and drew 2.`);
    advanceTurn();
    return;
  }
  if (counteringDrawTwo) {
    game.pending = 0;
    game.pendingType = null;
    if (player.hand.length === 0) game.mustDrawSeat = game.current;
    showToast(`${player.name} canceled the 2-card penalty.`);
    advanceTurn();
    return;
  }

  if (game.demandedSuit && card.rank !== "A" && card.rank !== "JOKER") game.demandedSuit = null;
  if (card.rank === "JOKER") game.demandedSuit = null;

  let reverseAfterSupport = false;

  if (supportedEight) {
    if (card.rank === "8") {
      game.combo.lastCard = card;
      game.combo.eightCount += 1;
      if (player.hand.length === 0) game.mustDrawSeat = game.current;
      showToast("Another 8 needs its own support.");
      renderGame();
      return;
    }
    reverseAfterSupport = game.combo.eightCount % 2 === 1;
    game.combo = null;
    if (reverseAfterSupport) game.direction *= -1;
  } else if (supportedJump) {
    game.jumpSupport = false;
  }

  if (player.hand.length === 0 && !["A", "2", "8", "J", "JOKER"].includes(card.rank)) {
    if (completeLocalOut(game.current)) return;
    advanceTurn();
    return;
  }

  if (card.rank === "8") {
    game.combo = { lastCard: card, eightCount: 1 };
    if (player.hand.length === 0) game.mustDrawSeat = game.current;
    showToast("8 played. Add support or draw one.");
    renderGame();
    return;
  }
  if (card.rank === "J") {
    if (player.hand.length === 0) game.mustDrawSeat = game.current;
    if (game.players.length === 2) {
      if (player.hand.length > 0) game.jumpSupport = true;
      showToast(player.hand.length === 0
        ? "Jack played. Draw one on your next turn."
        : "Jack played. Play another Jack or a card in the same suit, or draw one.");
      if (player.hand.length === 0) {
        renderGame();
        startTurnTimer();
      }
      else renderGame();
      return;
    }
    showToast("Jack played. The next player is skipped.");
    advanceTurn(2);
    return;
  }
  let message = `Played.${reverseAfterSupport ? " The direction reversed." : ""}`;
  if (card.rank === "2") {
    game.pending = 2;
    game.pendingType = "draw-two";
    if (player.hand.length === 0) game.mustDrawSeat = game.current;
    message = "The next player must draw two.";
  } else if (card.rank === "JOKER") {
    game.pending = 4;
    game.pendingType = "draw-four";
    if (player.hand.length === 0) game.mustDrawSeat = game.current;
    message = "Joker! The next player must draw four.";
  } else {
    if (card.rank === "A") {
      message = `Next suit: ${SUITS[chosenSuit].name}.`;
      if (player.hand.length === 0) game.mustDrawSeat = game.current;
    }
  }
  if (reverseAfterSupport) message += " The direction reversed.";
  showToast(message);
  advanceTurn();
}

function playLocalTurnCard(index, chosenSuit) {
  playCard(index, chosenSuit);
}

function nextPlayerIndex(steps) {
  const count = game.players.length;
  let index = game.current;
  for (let step = 0; step < steps; step += 1) {
    let attempts = 0;
    do {
      index = (index + game.direction + count) % count;
      attempts += 1;
    } while ((game.eliminated?.[index] || game.roundOut?.[index]) && attempts < count);
  }
  return index;
}

function advanceTurn(steps) {
  const previousPlayer = game.current;
  game.current = nextPlayerIndex(steps || 1);
  game.turns += 1;
  if (trainingMode && previousPlayer !== 0 && game.current === 0) playSound("turn");
  if (game.mustDrawSeat === game.current) {
    renderGame();
    startTurnTimer();
    return;
  }
  renderGame();
  startTurnTimer();
}

function recycleDeck() {
  if (game.deck.length > 0 || game.discard.length <= 1) return;
  const top = game.discard.pop();
  game.deck = shuffle(game.discard);
  game.discard = [top];
  playSound("shuffle");
}

function takeCards(player, count) {
  for (let cardIndex = 0; cardIndex < count; cardIndex += 1) {
    recycleDeck();
    if (game.deck.length === 0) break;
    player.hand.push(game.deck.pop());
  }
  if (player.hand.length > 1) game.knocked[game.players.indexOf(player)] = false;
}

function drawCard(timedOut = false) {
  if (!game || game.finished) return;
  if (onlineMode) {
    if (game.current === onlineSeat) {
      showToast("Drawing card…");
      submitOnlineMove({ type: "draw" });
    }
    return;
  }
  playSound("draw");
  const player = game.players[game.current];
  const prefix = timedOut ? `${player.name} ran out of time and drew` : `${player.name} draws`;
  if (game.mustDrawSeat === game.current) {
    game.combo = null;
    game.jumpSupport = false;
    game.freeSuitPlay = false;
    takeCards(player, 1);
    game.mustDrawSeat = null;
    showToast(`${prefix} one card.`);
    advanceTurn();
    return;
  }
  if (game.pending > 0) {
    const amount = game.pending;
    const jokerPenalty = game.pendingType === "draw-four";
    takeCards(player, amount);
    game.pending = 0;
    game.pendingType = null;
    game.freeSuitPlay = jokerPenalty;
    showToast(`${prefix} ${amount}.`);
    advanceTurn();
    return;
  }
  if (game.combo) {
    game.combo = null;
    takeCards(player, 1);
    showToast(`${prefix} one card. Turn passed.`);
    advanceTurn();
    return;
  }
  if (game.jumpSupport) {
    game.jumpSupport = false;
    takeCards(player, 1);
    showToast(`${prefix} one card. Turn passed.`);
    advanceTurn();
    return;
  }
  game.freeSuitPlay = false;
  takeCards(player, 1);
  showToast(`${prefix} a card.`);
  advanceTurn();
}

function startTurnTimer() {
  window.clearInterval(turnTimer);
  if (!game || game.finished) return;
  if (!onlineMode) {
    game.turnStartedAt = Date.now();
    game.turnDeadline = game.turnStartedAt + 60000;
  }
  updateTurnTimer();
  turnTimer = window.setInterval(updateTurnTimer, 250);
}

function scheduleFundoTurn() {
  if (!trainingMode || !game || game.finished || game.current !== 1 || trainingTurnTimer !== null) return;
  trainingTurnTimer = window.setTimeout(() => {
    trainingTurnTimer = null;
    playFundoTurn();
  }, 900 + Math.random() * 1600);
}

function playFundoTurn() {
  if (!trainingMode || !game || game.finished || game.current !== 1) return;
  const hand = game.players[1].hand;
  if (hand.length === 1 && !game.knocked[1]) {
    game.knocked[1] = true;
    renderGame();
    return;
  }

  const playableIndices = hand
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => isPlayable(card));
  if (!playableIndices.length) {
    drawCard();
    return;
  }

  const opponentCardsLeft = game.players[0].hand.length;
  const choices = playableIndices.map(({ card, index }) => {
    const remaining = hand.filter((_, cardIndex) => cardIndex !== index);
    const followUpOptions = remaining.filter((nextCard) =>
      nextCard.suit === card.suit || nextCard.rank === card.rank
    ).length;
    let score = followUpOptions + Math.random() * 2;
    if (card.rank === "A") score -= 2;
    if (card.rank === "2" || card.rank === "JOKER") {
      score += opponentCardsLeft <= 2 ? 3 : -1;
    }
    return { card, index, score };
  });
  choices.sort((left, right) => right.score - left.score);
  const { card, index: playableIndex } = choices[0];
  if (card.rank === "A") {
    const counts = SUIT_ORDER.map((suit) => ({
      suit,
      count: hand.filter((candidate) => candidate !== card && candidate.suit === suit).length,
    }));
    counts.sort((left, right) => right.count - left.count);
    const bestSuitCount = counts[0].count;
    const bestSuits = counts.filter(({ count }) => count === bestSuitCount);
    playCard(playableIndex, bestSuits[Math.floor(Math.random() * bestSuits.length)].suit);
    return;
  }
  playCard(playableIndex);
}

function updateTurnTimer() {
  if (!game || game.finished) {
    window.clearInterval(turnTimer);
    turnTimer = null;
    return;
  }
  game.timeLeft = Math.max(0, Math.ceil((game.turnDeadline - Date.now()) / 1000));
  elements.clock.textContent = String(game.timeLeft);
  elements.timer.classList.toggle("timer-warning", game.timeLeft <= 10);
  elements.timer.setAttribute("aria-label", `${game.timeLeft} seconds remaining`);
  if (game.timeLeft === 0) {
    window.clearInterval(turnTimer);
    turnTimer = null;
    timeOutTurn();
  }
}

function timeOutTurn() {
  if (!game || game.finished) return;
  if (onlineMode) {
    if (online.movePending) {
      retryTimeoutSoon();
    } else if (online.timeoutSentAt !== game.turnStartedAt) {
      online.timeoutSentAt = game.turnStartedAt;
      submitOnlineMove({ type: "timeout" });
    }
    return;
  }
  hideModal(elements.suitModal);
  game.stagedCardIndex = null;
  drawCard(true);
}

function hideModal(element) {
  element.classList.add("hidden");
}

function cancelSuitSelection() {
  if (!game || game.stagedCardIndex === null) return;
  const stagedCard = game.players[game.current].hand[game.stagedCardIndex];
  game.stagedCardIndex = null;
  hideModal(elements.suitModal);
  const stagedButton = [...elements.hand.querySelectorAll("[data-card-id]")]
    .find((button) => button.dataset.cardId === stagedCard.id);
  if (stagedButton) stagedButton.focus();
}

function friendlyToastMessage(message) {
  if (/draw (?:four|4)|draw-four|joker penalty/i.test(message)) return "Opponent draws 4! The next player picks four.";
  if (/draw (?:two|2)|two-card penalty|2-card penalty/i.test(message)) return "Draw 2! The next player picks two.";
  if (/skipped|is skipped|jack played.*next player/i.test(message)) return "Skip! The next player misses a turn.";
  if (/cancel(?:ed|led)|blocked .*joker penalty/i.test(message)) return "Cancelled! That penalty is cleared.";
  return message;
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  if (/knocked!/i.test(message)) {
    elements.toast.classList.remove("visible", "toast-knock", "toast-special");
    return;
  }
  const friendlyMessage = friendlyToastMessage(message);
  elements.toast.textContent = friendlyMessage;
  elements.toast.classList.remove("toast-knock");
  elements.toast.classList.toggle("toast-special", friendlyMessage !== message || /draw|skip|cancel/i.test(message));
  elements.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("visible"), 2300);
}

function openRules() {
  elements.rulesModal.classList.remove("hidden");
  document.querySelector("#close-rules").focus();
}

function closeRules() {
  hideModal(elements.rulesModal);
  document.querySelector("#game-rules-button").focus();
}

document.querySelector("#count-picker").addEventListener("click", (event) => {
  const button = event.target.closest("[data-count]");
  if (!button) return;
  selectedCount = Number(button.dataset.count);
  for (const item of document.querySelectorAll(".count-button")) {
    item.classList.toggle("active", item === button);
    item.setAttribute("aria-pressed", String(item === button));
  }
});
elements.start.addEventListener("click", startGame);
document.querySelector("#one-v-one-button").addEventListener("click", startQuickDuel);
document.querySelector("#browse-games-button").addEventListener("click", () => {
  openOnlineLobby("duel", "join");
});
document.querySelector("#training-game-button").addEventListener("click", startTrainingGame);
document.querySelector("#group-game-button").addEventListener("click", () => {
  const options = document.querySelector("#group-game-options");
  if (!options.classList.contains("hidden")) {
    closeGroupOptions();
    return;
  }
  options.classList.remove("hidden");
  document.querySelector("#group-game-button").classList.add("active");
  document.querySelector("#group-game-button").setAttribute("aria-expanded", "true");
  document.querySelector("#one-v-one-button").classList.remove("active");
  document.querySelector("#training-game-button").classList.remove("active");
});
document.querySelector("#cancel-group-setup").addEventListener("click", closeGroupOptions);
document.querySelector("#online-back-button").addEventListener("click", returnToSetup);
document.querySelector("#close-online").addEventListener("click", closeDuelSheet);
document.querySelector("#duel-create-tab").addEventListener("click", () => setDuelTab("create"));
document.querySelector("#duel-join-tab").addEventListener("click", () => setDuelTab("join"));
document.querySelector("#online-screen").addEventListener("click", (event) => {
  if (event.target === elements.online && !online.roomCode) closeDuelSheet();
});
elements.drawPile.addEventListener("click", () => {
  drawCard();
});
elements.rematch.addEventListener("click", async () => {
  if (!game) return;
  if (onlineMode) {
    if (!online.roomCode || !game.finished) return;
    elements.rematch.disabled = true;
    try {
      const snapshot = await callGameApi(`/api/rooms/${online.roomCode}/rematch`, "POST", {});
      applyRoomSnapshot(snapshot);
    } catch (error) {
      elements.rematch.disabled = false;
      showToast(onlineErrorMessage(error));
    }
    return;
  }
  const names = game.players.map((player) => player.name);
  dealGame(names, { training: trainingMode });
});
document.querySelector("#close-suit").addEventListener("click", cancelSuitSelection);
function returnToSetup() {
  hideOptimisticConnection();
  window.clearInterval(turnTimer);
  turnTimer = null;
  window.clearTimeout(trainingTurnTimer);
  trainingTurnTimer = null;
  trainingMode = false;
  renderedHandSeat = null;
  online.soundVersion = null;
  for (const selector of ["#end-online-room", "#end-room-from-game", "#end-room-from-result", "#start-queued-match"]) {
    document.querySelector(selector).classList.add("hidden");
  }
  disconnectOnlineRoom();
  onlineMode = false;
  onlineSeat = -1;
  online.chatOpen = false;
  online.optimisticCard = null;
  document.querySelector("#mode-label").textContent = "Choose game";
  document.title = PAGE_TITLE;
  document.querySelector("#round-mode-label").textContent = "ONLINE GAME";
  game = null;
  document.body.classList.remove("game-active");
  hideModal(elements.suitModal);
  hideModal(elements.rematchModal);
  elements.game.classList.add("hidden");
  elements.online.classList.add("hidden");
  elements.online.classList.remove("is-duel-sheet");
  elements.online.removeAttribute("role");
  elements.online.removeAttribute("aria-modal");
  elements.setup.classList.remove("hidden");
  document.querySelector("#leaderboard-modal").classList.add("hidden");
  setActiveNavigation("nav-play-button");
  document.querySelector("#group-game-options").classList.add("hidden");
  document.querySelector("#group-game-button").classList.remove("active");
  document.querySelector("#group-game-button").setAttribute("aria-expanded", "false");
  document.querySelector("#one-v-one-button").classList.remove("active");
  document.querySelector("#training-game-button").classList.remove("active");
}
function setDuelTab(tab) {
  const createTab = document.querySelector("#duel-create-tab");
  const joinTab = document.querySelector("#duel-join-tab");
  const createPanel = document.querySelector("#duel-create-panel");
  const joinPanel = document.querySelector("#duel-join-panel");
  const isCreate = tab === "create";
  createTab.classList.toggle("active", isCreate);
  joinTab.classList.toggle("active", !isCreate);
  createTab.setAttribute("aria-selected", String(isCreate));
  joinTab.setAttribute("aria-selected", String(!isCreate));
  createPanel.classList.toggle("hidden", !isCreate);
  joinPanel.classList.toggle("hidden", isCreate);
}
function closeDuelSheet() {
  if (online.roomCode || !elements.online.classList.contains("is-duel-sheet")) return;
  stopPublicRoomsRefresh();
  elements.online.classList.add("hidden");
  elements.online.classList.remove("is-duel-sheet");
  elements.online.removeAttribute("role");
  elements.online.removeAttribute("aria-modal");
  if (duelSheetOpener instanceof HTMLElement) duelSheetOpener.focus();
}
function closeGroupOptions() {
  document.querySelector("#group-game-options").classList.add("hidden");
  document.querySelector("#group-game-button").classList.remove("active");
  document.querySelector("#group-game-button").setAttribute("aria-expanded", "false");
  document.querySelector("#group-game-button").focus();
}
function showOptimisticConnection() {
  optimisticConnectionOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  elements.setup.classList.add("hidden");
  elements.online.classList.add("hidden");
  elements.game.classList.remove("hidden");
  document.querySelector(".game-heading").classList.add("hidden");
  document.querySelector(".table-surface").classList.add("hidden");
  document.querySelector(".game-chat").classList.add("hidden");
  document.querySelector(".game-footer").classList.add("hidden");
  document.querySelector("#reconnecting-banner").classList.add("hidden");
  document.querySelector("#optimistic-connection").classList.remove("hidden");
  document.querySelector("#optimistic-connection h2").focus();
}
function hideOptimisticConnection(restoreFocus = false) {
  const placeholder = document.querySelector("#optimistic-connection");
  if (!placeholder) return false;
  const wasConnecting = !placeholder.classList.contains("hidden");
  placeholder.classList.add("hidden");
  document.querySelector(".game-heading").classList.remove("hidden");
  document.querySelector(".table-surface").classList.remove("hidden");
  document.querySelector(".game-footer").classList.remove("hidden");
  if (restoreFocus && optimisticConnectionOpener?.isConnected && !optimisticConnectionOpener.closest(".hidden")) {
    optimisticConnectionOpener.focus();
  }
  optimisticConnectionOpener = null;
  return wasConnecting;
}
function setActiveNavigation(activeId) {
  for (const button of document.querySelectorAll(".primary-nav .nav-link")) {
    const active = button.id === activeId;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}
document.querySelector("#back-button").addEventListener("click", returnToSetup);
document.querySelector("#new-table-button").addEventListener("click", returnToSetup);
document.querySelector("#nav-play-button").addEventListener("click", returnToSetup);
document.querySelector("#brand-home-link").addEventListener("click", (event) => {
  event.preventDefault();
  returnToSetup();
});
chatToggle.addEventListener("click", () => {
  const data = online.publicData;
  if (!data || data.status !== "playing" || !data.game || data.game.finished) return;
  online.chatOpen = !online.chatOpen;
  renderGameChat(data);
});

// ---------- Online play (Vercel API) ----------
const roomStorageKey = (code) => `bakasha:room:${code}`;

function readStored(key) {
  try { return window.localStorage.getItem(key); } catch (error) { return null; }
}
function writeStored(key, value) {
  try { window.localStorage.setItem(key, value); } catch (error) { /* storage blocked: reconnect links just won't remember you */ }
}
function removeStored(key) {
  try { window.localStorage.removeItem(key); } catch (error) { /* ignore */ }
}
function readSavedRoom(code) {
  try {
    const saved = JSON.parse(readStored(roomStorageKey(code)) || "null");
    return saved && typeof saved.token === "string" ? saved : null;
  } catch (error) {
    return null;
  }
}

function openOnlineLobby(mode = "duel", tab = "create") {
  if (!accountUser) {
    pendingLobbyRequest = { mode, tab };
    showAccountGate();
    return;
  }
  const isDuel = mode !== "group";
  if (isDuel && elements.online.classList.contains("hidden")) duelSheetOpener = document.activeElement;
  onlineRoomSize = mode === "group" ? selectedCount : 2;
  elements.setup.classList.toggle("hidden", !isDuel);
  elements.online.classList.remove("hidden");
  elements.online.classList.toggle("is-duel-sheet", isDuel);
  if (isDuel) {
    elements.online.setAttribute("role", "dialog");
    elements.online.setAttribute("aria-modal", "true");
    elements.online.setAttribute("aria-labelledby", "online-title");
  } else {
    elements.online.removeAttribute("role");
    elements.online.removeAttribute("aria-modal");
    elements.online.removeAttribute("aria-labelledby");
  }
  document.querySelector("#online-back-button").classList.toggle("hidden", isDuel);
  document.querySelector("#close-online").classList.toggle("hidden", !isDuel);
  document.querySelector("#duel-tabs").classList.toggle("hidden", !isDuel);
  document.querySelector("#duel-create-panel").classList.remove("hidden");
  document.querySelector("#duel-join-panel").classList.toggle("hidden", isDuel);
  if (isDuel) setDuelTab(tab);
  document.querySelector("#mode-label").textContent = onlineRoomSize > 2 ? "Group quest" : "Duel a friend";
  document.querySelector("#online-title").textContent = onlineRoomSize > 2 ? `${onlineRoomSize}-player group` : "Duel a friend";
  document.querySelector("#online-subtitle").textContent = onlineRoomSize > 2
    ? `Create a game for ${onlineRoomSize} players, then invite your crew.`
    : "Create a table and invite a friend by link.";
  document.querySelector("#create-room-button").innerHTML = `Create ${onlineRoomSize === 2 ? "duel" : `${onlineRoomSize}-player game`} <span aria-hidden="true">→</span>`;
  refreshPublicRooms();
  refreshActiveRooms();
  schedulePublicRoomsRefresh();
  if (isDuel) document.querySelector(tab === "join" ? "#duel-join-tab" : "#duel-create-tab").focus();
}

function stopPublicRoomsRefresh() {
  window.clearTimeout(publicRoomsTimer);
  publicRoomsTimer = null;
}

function schedulePublicRoomsRefresh() {
  stopPublicRoomsRefresh();
  if (elements.online.classList.contains("hidden") || online.roomCode) return;
  publicRoomsTimer = window.setTimeout(async () => {
    await Promise.all([refreshPublicRooms(), refreshActiveRooms()]);
    schedulePublicRoomsRefresh();
  }, 6000);
}

function renderPublicRooms(rooms) {
  const list = document.querySelector("#public-room-list");
  list.replaceChildren();
  if (rooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "public-room-empty";
    empty.textContent = "No open challenges.";
    list.append(empty);
    return;
  }
  for (const room of rooms) {
    const item = document.createElement("article");
    item.className = "public-room-item";
    const details = document.createElement("div");
    details.className = "public-room-details";
    const host = document.createElement("strong");
    host.textContent = room.hostName;
    const state = document.createElement("span");
    const maxPlayers = Number.isInteger(room.maxPlayers) ? room.maxPlayers : 2;
    state.textContent = `${room.playerCount}/${maxPlayers} players · waiting to start`;
    const join = document.createElement("button");
    join.className = "secondary-button public-room-join";
    join.type = "button";
    join.dataset.publicRoomCode = room.roomCode;
    join.textContent = "Join";
    details.append(host, state);
    item.append(details, join);
    list.append(item);
  }
}

function renderActiveRooms(rooms) {
  const list = document.querySelector("#active-game-list");
  const section = document.querySelector(".active-games");
  const homeResume = document.querySelector("#home-resume-card");
  section.classList.toggle("hidden", rooms.length === 0);
  homeResume.classList.toggle("hidden", rooms.length === 0);
  document.querySelector("#active-game-count").textContent = `${rooms.length}/2`;
  list.replaceChildren();
  renderHomeResume(rooms);
  if (rooms.length === 0) {
    return;
  }
  for (const room of rooms) {
    const item = document.createElement("article");
    item.className = "active-game-item";
    const details = document.createElement("div");
    details.className = "public-room-details";
    const title = document.createElement("strong");
    title.textContent = `${room.isHost ? "You created" : `Hosted by ${room.hostName}`} · ${room.roomCode}`;
    const state = document.createElement("span");
    state.textContent = room.queuedForNextMatch
      ? "Waiting for the next match"
      : room.status === "playing"
        ? `In progress · ${room.playerCount}/${room.maxPlayers} players`
        : room.status === "finished"
          ? "Match finished · rematch available"
          : `${room.isPublic ? "Public challenge" : "Private game"} · ${room.playerCount}/${room.maxPlayers} players`;
    details.append(title, state);

    const actions = document.createElement("div");
    actions.className = "active-game-actions";
    const rejoin = document.createElement("button");
    rejoin.className = "secondary-button";
    rejoin.type = "button";
    rejoin.dataset.activeRoomCode = room.roomCode;
    rejoin.textContent = "Resume";
    actions.append(rejoin);
    if (room.canEnd || room.canLeave) {
      const finish = document.createElement("button");
      finish.className = "secondary-button";
      finish.type = "button";
      finish.dataset.activeRoomAction = room.canEnd ? "end" : "leave";
      finish.dataset.activeRoomCode = room.roomCode;
      finish.textContent = room.canEnd ? "End game" : "Leave";
      actions.append(finish);
    }
    item.append(details, actions);
    list.append(item);
  }
}

function renderHomeResume(rooms) {
  const card = document.querySelector("#home-resume-card");
  const button = document.querySelector("#home-resume-button");
  const details = document.querySelector("#home-resume-details");
  const room = rooms[0];
  if (!room) {
    card.classList.add("hidden");
    button.removeAttribute("data-active-room-code");
    return;
  }
  details.textContent = room.status === "playing"
    ? `Your game with ${room.playerCount} player${room.playerCount === 1 ? "" : "s"} is in progress.`
    : room.status === "finished"
      ? "Your last game has a rematch ready."
      : "Your game is waiting for players.";
  button.dataset.activeRoomCode = room.roomCode;
  card.classList.remove("hidden");
}

async function refreshActiveRooms() {
  if (
    activeRoomsLoading
    || online.roomCode
    || (elements.online.classList.contains("hidden") && elements.setup.classList.contains("hidden"))
    || !accountUser
  ) return;
  activeRoomsLoading = true;
  try {
    const result = await callGameApi("/api/rooms/active");
    if (!Array.isArray(result.rooms)) throw new Error("The game server returned an invalid active game list.");
    renderActiveRooms(result.rooms);
  } catch (error) {
    const list = document.querySelector("#active-game-list");
    list.replaceChildren();
    document.querySelector(".active-games").classList.add("hidden");
    if (!roomJoinPending && !roomCreationPending && !online.roomCode) {
      setOnlineStatus(onlineErrorMessage(error));
    }
  } finally {
    activeRoomsLoading = false;
  }
}

async function refreshPublicRooms() {
  if (publicRoomsLoading || online.roomCode || elements.online.classList.contains("hidden")) return;
  publicRoomsLoading = true;
  const refresh = document.querySelector("#refresh-public-rooms");
  refresh.disabled = true;
  try {
    const result = await callGameApi("/api/rooms");
    if (!Array.isArray(result.rooms)) throw new Error("The game server returned an invalid public game list.");
    renderPublicRooms(result.rooms);
  } catch (error) {
    const list = document.querySelector("#public-room-list");
    list.replaceChildren();
    const failure = document.createElement("p");
    failure.className = "public-room-empty";
    failure.textContent = onlineErrorMessage(error);
    list.append(failure);
  } finally {
    publicRoomsLoading = false;
    refresh.disabled = false;
  }
}

function setOnlineStatus(message) {
  document.querySelector("#online-status").textContent = message;
}

function onlineErrorMessage(error) {
  return (error && error.message) || "Online play could not connect. Check your connection and try again.";
}

function extractRoomCode(value) {
  const input = value.trim();
  if (!input) return "";
  if (input.includes("://") || input.startsWith("file:")) {
    try {
      const params = new URL(input).searchParams;
      const codeFromLink = params.get("game") || params.get("room");
      if (codeFromLink) return codeFromLink.trim().toUpperCase();
    } catch (error) {
      return "";
    }
  }
  return input.toUpperCase().replace(/[\s-]/g, "");
}

function extractInviteRoomCode(value) {
  const input = value.trim();
  if (!input) return "";
  try {
    const invite = new URL(input, window.location.href);
    const code = invite.searchParams.get("game") || invite.searchParams.get("room");
    if (code) return extractRoomCode(code);
  } catch (error) {
    // Continue with the room-code form below.
  }
  return /^[a-z0-9\s-]{4,8}$/i.test(input) ? extractRoomCode(input) : "";
}

function makeInviteLink(roomCode) {
  const invite = new URL(window.location.href);
  invite.search = "";
  invite.hash = "";
  invite.searchParams.set("game", roomCode);
  return invite.href;
}

const copyFeedbackTimers = new WeakMap();
function showCopySuccess(button, copiedLabel) {
  const originalLabel = button.dataset.originalLabel || button.textContent;
  button.dataset.originalLabel = originalLabel;
  button.textContent = copiedLabel;
  button.classList.add("is-copied");
  window.clearTimeout(copyFeedbackTimers.get(button));
  copyFeedbackTimers.set(button, window.setTimeout(() => {
    button.textContent = originalLabel;
    button.classList.remove("is-copied");
  }, 2200));
}

function announceCopyStatus(message) {
  if (onlineMode && !elements.game.classList.contains("hidden")) showToast(message);
  else setOnlineStatus(message);
}

async function copyTextToButton(value, button, copiedLabel, successMessage, errorMessage) {
  if (!value) {
    announceCopyStatus("Create a game before copying an invite.");
    return;
  }
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") {
    announceCopyStatus("Clipboard access is unavailable. Select and copy the invite manually.");
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showCopySuccess(button, copiedLabel);
    announceCopyStatus(successMessage);
  } catch (error) {
    announceCopyStatus(errorMessage);
  }
}

function disconnectOnlineRoom() {
  window.clearTimeout(online.pollTimer);
  stopPublicRoomsRefresh();
  Object.assign(online, {
    pollTimer: null,
    polling: false,
    roomCode: null,
    token: null,
    seat: -1,
    starting: false,
    publicData: null,
    ownHand: null,
    isHost: false,
    movePending: false,
    pendingAction: null,
    optimisticCard: null,
    timeoutSentAt: null,
    version: 0,
    clockOffset: 0,
    chatUnreadCount: 0,
    chatOpen: false,
    recentReactions: new Map(),
    reconnectAttempts: 0,
    lastAlertedTurn: null,
  });
  updateChatUnreadBadge();
  document.querySelector("#room-wait-panel").classList.add("hidden");
  document.querySelector("#invite-result").classList.add("hidden");
  document.querySelector("#create-room-controls").classList.remove("hidden");
  document.querySelector(".account-panel").classList.remove("hidden");
  document.querySelector(".room-visibility").classList.remove("hidden");
  document.querySelector(".public-rooms").classList.remove("hidden");
  document.querySelector(".active-games").classList.remove("hidden");
  document.querySelector("#duel-tabs").classList.toggle("hidden", !elements.online.classList.contains("is-duel-sheet"));
  document.querySelector("#online-back-button").classList.toggle("hidden", elements.online.classList.contains("is-duel-sheet"));
  document.querySelector("#close-online").classList.toggle("hidden", !elements.online.classList.contains("is-duel-sheet"));
  document.querySelector("#join-room-panel").classList.remove("hidden");
  document.querySelector("#copy-invite-button").textContent = "Copy link";
  if (elements.online.classList.contains("is-duel-sheet")) setDuelTab("create");
  else {
    document.querySelector("#duel-create-panel").classList.remove("hidden");
    document.querySelector("#duel-join-panel").classList.remove("hidden");
  }
}

async function callGameApi(path, method, body, token) {
  const headers = {};
  const authToken = token || (path.startsWith("/api/rooms/") ? online.token : null);
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const options = { method: method || "GET", headers, cache: "no-store", credentials: "same-origin" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(path, options);
  } catch (error) {
    throw new Error("Could not reach the game server. Check your connection.");
  }
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error("The game server returned an invalid response.");
  }
  if (!response.ok) {
    if (response.status === 401 && accountUser && /^\/api\/(rooms|friends)/.test(path)) {
      returnToSetup();
      updateAccountUI(null);
      setAccountStatus("Your sign-in expired. Sign in again to continue playing.");
    }
    const failure = new Error(result.error || "The game server could not complete that request.");
    failure.status = response.status;
    throw failure;
  }
  return result;
}

function setAccountStatus(message) {
  document.querySelector("#account-status").textContent = message;
}

function renderAccountMode() {
  const registering = accountMode === "register";
  const signedIn = Boolean(accountUser);
  const tabs = document.querySelector("#account-tabs");
  const loginTab = document.querySelector("#account-login-tab");
  const registerTab = document.querySelector("#account-register-tab");
  document.querySelector("#account-title").textContent = signedIn ? "Your account" : registering ? "Create account" : "Sign in";
  document.querySelector("#account-description").textContent = signedIn
    ? "Your public leaderboard name and match history."
    : registering
      ? "Choose a unique username and password. There is no email or password recovery."
      : "Use your Bakasha username and password. No Vercel account or email is needed.";
  document.querySelector("#account-submit").textContent = registering ? "Create account" : "Sign in";
  tabs.classList.toggle("hidden", signedIn);
  loginTab.classList.toggle("active", !registering);
  registerTab.classList.toggle("active", registering);
  loginTab.setAttribute("aria-pressed", String(!registering));
  registerTab.setAttribute("aria-pressed", String(registering));
  document.querySelector("#auth-password").autocomplete = registering ? "new-password" : "current-password";
}

const tutorialSteps = [
  {
    title: "Match suit or rank",
    copy: "The top card is 7♥. Choose either a heart (same suit) or another 7 (same rank).",
    options: [
      { label: "Play 4♥", valid: true },
      { label: "Play 7♣", valid: true },
      { label: "Play 9♣", valid: false },
    ],
  },
  {
    title: "Draw when you cannot play",
    copy: "Your hand has no match for the top card. Drawing one card ends your turn; you cannot play that drawn card right away.",
    options: [{ label: "Draw one card", valid: true }],
  },
  {
    title: "A 2 starts a draw penalty",
    copy: "The top card is 5♦. A 2 can match by suit or rank and makes the next player draw two; another 2 can cancel it.",
    options: [
      { label: "Play 2♦", valid: true },
      { label: "Play 2♠", valid: false },
    ],
  },
  {
    title: "Joker: draw four",
    copy: "A Joker can be played on most cards, but not on a 2. The next player draws four; another Joker can cancel that penalty.",
    options: [{ label: "Play Joker", valid: true }],
  },
  {
    title: "Ace: choose a suit",
    copy: "Playing an Ace lets you name the suit the next player must follow. Choose the suit you want.",
    options: [
      { label: "Choose ♥ Hearts", valid: true },
      { label: "Choose ♠ Spades", valid: true },
      { label: "Choose ♦ Diamonds", valid: true },
      { label: "Choose ♣ Clubs", valid: true },
    ],
  },
  {
    title: "Jack: skip or support",
    copy: "In a group, a Jack skips the next player. In solo or 1v1, play a card in the Jack’s suit to support it, or draw one card.",
    options: [
      { label: "Play 3♥", valid: true },
      { label: "Draw one card", valid: true },
      { label: "Play 5♠", valid: false },
    ],
  },
];
let tutorialActionComplete = false;

function updateStatsButton() {
  document.querySelector("#stats-button").classList.toggle("hidden", !accountUser);
}

function renderTutorialStep() {
  const step = tutorialSteps[tutorialIndex];
  tutorialActionComplete = false;
  document.querySelector("#tutorial-step").textContent = `CARD ${tutorialIndex + 1} OF ${tutorialSteps.length}`;
  document.querySelector("#tutorial-title").textContent = step.title;
  document.querySelector("#tutorial-copy").textContent = step.copy;
  const next = document.querySelector("#tutorial-next");
  next.innerHTML = tutorialIndex === tutorialSteps.length - 1
    ? "Finish practice <span aria-hidden=\"true\">→</span>"
    : "Next <span aria-hidden=\"true\">→</span>";
  next.disabled = true;
  const practice = document.querySelector("#tutorial-practice");
  practice.replaceChildren();
  for (const option of step.options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tutorial-practice-choice";
    button.dataset.valid = String(option.valid);
    button.textContent = option.label;
    practice.append(button);
  }
  const progress = document.querySelector("#tutorial-progress");
  progress.setAttribute("aria-valuemax", String(tutorialSteps.length));
  progress.setAttribute("aria-valuenow", String(tutorialIndex + 1));
  document.querySelector("#tutorial-progress-fill").style.width =
    `${((tutorialIndex + 1) / tutorialSteps.length) * 100}%`;
  document.querySelector("#tutorial-status").textContent = "Choose a move to continue.";
}

document.querySelector("#tutorial-practice").addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest(".tutorial-practice-choice") : null;
  if (!button || tutorialActionComplete) return;
  if (button.dataset.valid !== "true") {
    document.querySelector("#tutorial-status").textContent = "That move does not match. Try again.";
    return;
  }
  tutorialActionComplete = true;
  document.querySelector("#tutorial-status").textContent = "Nice move. Continue when you are ready.";
  document.querySelector("#tutorial-next").disabled = false;
});

function startTutorial(force = false) {
  if (!accountUser) return;
  if (!force && (tutorialShown || tutorialDismissed)) return;
  if (!force && (!accountUser.progress || accountUser.progress.tutorialCompleted)) return;
  tutorialShown = true;
  tutorialDismissed = false;
  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  tutorialOpener = activeElement && activeElement !== document.body && !activeElement.closest(".hidden")
    ? activeElement
    : null;
  tutorialIndex = 0;
  document.querySelector("#tutorial-status").textContent = "";
  renderTutorialStep();
  document.querySelector("#tutorial-modal").classList.remove("hidden");
  document.querySelector("#tutorial-practice .tutorial-practice-choice")?.focus();
}

async function completeTutorial() {
  const button = document.querySelector("#tutorial-next");
  button.disabled = true;
  document.querySelector("#tutorial-status").textContent = "Saving your progress…";
  try {
    const result = await callGameApi("/api/account", "POST", {});
    if (accountUser) accountUser.progress = result.progress;
    tutorialDismissed = true;
    document.querySelector("#tutorial-modal").classList.add("hidden");
    const returnTarget = tutorialOpener;
    tutorialOpener = null;
    if (returnTarget && returnTarget.isConnected && !returnTarget.closest(".hidden")) returnTarget.focus();
    else document.querySelector("#game-rules-button").focus();
  } catch (error) {
    document.querySelector("#tutorial-status").textContent = onlineErrorMessage(error);
    if (error.status === 401) {
      document.querySelector("#tutorial-modal").classList.add("hidden");
      updateAccountUI(null);
      renderAccountMode();
      setAccountStatus("Your sign-in expired. Sign in again to save your tutorial progress.");
    }
  } finally {
    button.disabled = false;
  }
}

async function refreshAccountProgress() {
  if (!accountUser) return null;
  const result = await callGameApi("/api/account");
  if (!result.user) {
    updateAccountUI(null);
    renderAccountMode();
    setAccountStatus("Your sign-in expired. Sign in again to continue.");
    throw new Error("Your sign-in expired. Sign in again to continue.");
  }
  accountUser = result.user;
  return accountUser.progress;
}

async function renderStats() {
  try {
    const { renderStats: renderStatsView } = await import("./stats-ui.js");
    renderStatsView(accountUser && accountUser.progress, statsPeriod);
  } catch (error) {
    document.querySelector("#stats-status").textContent = onlineErrorMessage(error);
  }
}

async function openStats() {
  statsPeriod = "all";
  for (const button of document.querySelectorAll(".stats-filter")) {
    const active = button.dataset.period === statsPeriod;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  document.querySelector("#stats-modal").classList.remove("hidden");
  document.querySelector("#stats-status").textContent = "Loading your matches…";
  try {
    await refreshAccountProgress();
    await renderStats();
    document.querySelector("#stats-status").textContent = "";
  } catch (error) {
    document.querySelector("#stats-status").textContent = onlineErrorMessage(error);
  }
}

function updateAccountUI(user) {
  const previousUser = accountUser;
  if (!user || (previousUser && previousUser.username !== user.username)) {
    tutorialShown = false;
    tutorialDismissed = false;
  }
  accountUser = user;
  const accountButton = document.querySelector("#account-button");
  const friendsButton = document.querySelector("#friends-button");
  const closeAccount = document.querySelector("#close-account");
  const accountModal = document.querySelector("#account-modal");
  const formPanel = document.querySelector("#account-form-panel");
  const sessionPanel = document.querySelector("#account-session-panel");
  const roomNameInput = document.querySelector("#account-username");
  updateStatsButton();
  accountButton.textContent = user ? user.username : "Sign in";
  accountButton.title = user ? `Signed in as ${user.username}` : "Sign in or create an account";
  friendsButton.classList.toggle("hidden", !user);
  closeAccount.classList.toggle("hidden", !user);
  formPanel.classList.toggle("hidden", Boolean(user));
  sessionPanel.classList.toggle("hidden", !user);
  roomNameInput.disabled = Boolean(user);
  if (user) {
    elements.setup.classList.remove("hidden");
    elements.online.classList.add("hidden");
    elements.game.classList.add("hidden");
    accountModal.classList.add("hidden");
    roomNameInput.value = user.username;
    document.querySelector("#duel-playing-name").textContent = user.username;
    document.querySelector("#account-current-name").textContent = user.username;
    void refreshActiveRooms();
    void heartbeatPresence();
    schedulePresenceHeartbeat();
    if (pendingInviteRoom && inviteAccepted) openPendingInvite();
    else if (pendingInviteRoom) showInviteLanding();
    else if (pendingLobbyRequest) {
      const request = pendingLobbyRequest;
      pendingLobbyRequest = null;
      openOnlineLobby(request.mode, request.tab);
    } else if (
      user.progress
      && user.progress.wins + user.progress.losses === 0
      && !user.progress.tutorialCompleted
    ) {
      startTrainingGame();
      startTutorial();
    } else startTutorial();
    startFriendChallengePolling();
  } else {
    stopFriendChallengePolling();
    window.clearTimeout(presenceTimer);
    presenceTimer = null;
    document.querySelector("#game-invite-alert").classList.add("hidden");
    elements.setup.classList.add("hidden");
    elements.online.classList.add("hidden");
    elements.game.classList.add("hidden");
    document.querySelector("#friends-modal").classList.add("hidden");
    document.querySelector("#stats-modal").classList.add("hidden");
    document.querySelector("#tutorial-modal").classList.add("hidden");
    if (pendingInviteRoom && !inviteAccepted) {
      accountModal.classList.add("hidden");
      showInviteLanding();
    } else {
      accountModal.classList.remove("hidden");
    }
    document.querySelector("#score-note").textContent = "Sign in is required to play and track your results.";
    if (previousUser) roomNameInput.value = "";
  }
}

async function submitAccountForm(event) {
  event.preventDefault();
  const button = document.querySelector("#account-submit");
  button.disabled = true;
  setAccountStatus(accountMode === "register" ? "Creating your account…" : "Signing in…");
  try {
    const result = await callGameApi(`/api/account/${accountMode}`, "POST", {
      username: document.querySelector("#auth-username").value,
      password: document.querySelector("#auth-password").value,
    });
    updateAccountUI(result.user);
    renderAccountMode();
    document.querySelector("#auth-password").value = "";
    setAccountStatus(`Signed in as ${result.user.username}.`);
    void refreshAccountProgress()
      .then(() => {
        if (elements.online.classList.contains("hidden") && elements.game.classList.contains("hidden")) {
          startTutorial();
        }
      })
      .catch((error) => showToast(onlineErrorMessage(error)));
  } catch (error) {
    setAccountStatus(onlineErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function signOutAccount() {
  const button = document.querySelector("#account-signout");
  button.disabled = true;
  try {
    await callGameApi("/api/account", "DELETE");
    returnToSetup();
    updateAccountUI(null);
    renderAccountMode();
    setAccountStatus("You are signed out. Sign in again to play.");
  } catch (error) {
    setAccountStatus(onlineErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function loadAccount() {
  try {
    const result = await callGameApi("/api/account");
    updateAccountUI(result.user);
    renderAccountMode();
  } catch (error) {
    updateAccountUI(null);
    renderAccountMode();
    setAccountStatus(onlineErrorMessage(error));
  }
}

function showAccountGate() {
  accountMode = "login";
  renderAccountMode();
  document.querySelector("#account-status").textContent = "";
  document.querySelector("#account-modal").classList.remove("hidden");
}

function openPendingInvite() {
  if (!accountUser || !pendingInviteRoom || !inviteAccepted) return;
  const invitedCode = extractRoomCode(pendingInviteRoom);
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(invitedCode)) {
    document.querySelector("#invite-landing-status").textContent = "That invite link isn’t valid. Check it and try again.";
    document.querySelector("#accept-invite-button").disabled = true;
    document.querySelector("#invite-landing").classList.remove("hidden");
    return;
  }
  pendingInviteRoom = invitedCode;
  pendingLobbyRequest = null;
  document.querySelector("#invite-landing").classList.add("hidden");
  openOnlineLobby("duel", "join");
  const inviteInput = document.querySelector("#invite-link-input");
  inviteInput.value = makeInviteLink(invitedCode);
  void joinOnlineRoom();
}

function showInviteLanding() {
  if (!pendingInviteRoom || inviteAccepted) return;
  document.querySelector("#invite-landing").classList.remove("hidden");
  const code = extractRoomCode(pendingInviteRoom);
  const acceptButton = document.querySelector("#accept-invite-button");
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(code)) {
    document.querySelector("#invite-landing-status").textContent = "That invite link isn’t valid. Check it and try again.";
    acceptButton.disabled = true;
    return;
  }
  if (invitePreview?.roomCode === code || invitePreviewLoadingFor === code) return;
  void loadInvitePreview(code);
}

async function loadInvitePreview(code) {
  invitePreviewLoadingFor = code;
  const acceptButton = document.querySelector("#accept-invite-button");
  const status = document.querySelector("#invite-landing-status");
  acceptButton.disabled = true;
  status.textContent = "Checking your invite…";
  try {
    const preview = await callGameApi(`/api/rooms/${code}/invite`);
    if (extractRoomCode(pendingInviteRoom || "") !== code || inviteAccepted) return;
    invitePreview = preview;
    document.querySelector("#invite-host-name").textContent = preview.hostName;
    document.querySelector("#invite-host-mark").textContent =
      preview.hostName.trim().charAt(0).toUpperCase() || "♠";
    const isDuel = preview.maxPlayers === 2;
    document.querySelector("#invite-details").textContent = isDuel
      ? "1-on-1 · 4 cards each · first player out wins"
      : `${preview.maxPlayers}-player game · 4 cards each · last player standing wins`;
    status.textContent = preview.status === "playing"
      ? "The game is in progress. Accept to join the next match."
      : preview.status === "finished"
        ? "That match is over. Accept to join the next match."
        : preview.playerCount >= preview.maxPlayers
          ? "This table is full. Accept to queue for the next match."
          : `${preview.hostName} is waiting for you to join.`;
    acceptButton.textContent = preview.status === "playing" || preview.status === "finished"
      ? "Join next match"
      : "Accept and play";
    acceptButton.disabled = false;
  } catch (error) {
    if (extractRoomCode(pendingInviteRoom || "") !== code || inviteAccepted) return;
    const unavailable = error.status === 404 || error.status === 410;
    status.textContent = unavailable
      ? "This invite has expired or is no longer available."
      : "Couldn’t load the invite details. You can still try joining.";
    acceptButton.disabled = unavailable;
  } finally {
    if (invitePreviewLoadingFor === code) invitePreviewLoadingFor = null;
  }
}

function acceptGameInvite() {
  if (!pendingInviteRoom || document.querySelector("#accept-invite-button").disabled) return;
  inviteAccepted = true;
  document.querySelector("#invite-landing").classList.add("hidden");
  if (!accountUser) {
    showAccountGate();
    setAccountStatus("Sign in or create an account to accept this invite.");
    return;
  }
  openPendingInvite();
}

function dismissGameInvite() {
  pendingInviteRoom = null;
  inviteAccepted = false;
  invitePreview = null;
  invitePreviewLoadingFor = null;
  document.querySelector("#invite-landing").classList.add("hidden");
  const url = new URL(window.location.href);
  url.searchParams.delete("game");
  url.searchParams.delete("room");
  if (/^#\/c\//i.test(url.hash)) url.hash = "";
  window.history.replaceState(null, "", url);
  if (accountUser) {
    document.querySelector("#account-modal").classList.add("hidden");
    elements.setup.classList.remove("hidden");
    startTutorial();
  } else {
    document.querySelector("#account-modal").classList.remove("hidden");
  }
}

function setFriendsStatus(message) {
  document.querySelector("#friends-status").textContent = message;
}

function renderFriendEntries(container, entries, section) {
  container.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "friend-empty";
    empty.textContent = section === "friends"
      ? "No friends yet."
      : section === "challenges"
        ? "No game invites right now."
        : "No pending requests.";
    container.append(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const name = document.createElement("strong");
    name.textContent = section === "challenges" ? entry.fromUsername : entry.username;
    row.append(name);

    if (section === "friends") {
      const presence = document.createElement("span");
      presence.className = `friend-presence${entry.online ? " is-online" : ""}`;
      presence.setAttribute("aria-label", entry.online ? "Online" : "Offline");
      presence.title = entry.online ? "Online" : "Offline";
      row.append(presence);
      const challenge = document.createElement("button");
      challenge.type = "button";
      challenge.className = "friend-action friend-challenge-action";
      challenge.dataset.friendChallenge = entry.username;
      challenge.textContent = "Challenge";
      challenge.disabled = hasActiveOnlineRoom();
      challenge.title = challenge.disabled ? "Return to games before starting another duel." : `Start a private duel with ${entry.username}`;
      row.append(challenge);

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "friend-action";
      remove.dataset.friendAction = "remove";
      remove.dataset.friendUsername = entry.username;
      remove.textContent = "Remove";
      row.append(remove);
    } else if (section === "challenges") {
      const details = document.createElement("span");
      details.className = "friend-challenge-copy";
      details.textContent = "invited you to a duel";
      row.append(details);
      for (const [action, label] of [["accept", "Join game"], ["decline", "Decline"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `friend-action${action === "accept" ? " friend-challenge-action" : ""}`;
        button.dataset.challengeAction = action;
        button.dataset.challengeId = entry.id;
        button.dataset.roomCode = entry.roomCode;
        button.textContent = label;
        button.disabled = action === "accept" && hasActiveOnlineRoom();
        if (button.disabled) button.title = "Return to games before joining another duel.";
        row.append(button);
      }
    } else if (section === "incoming") {
      for (const [action, label] of [["accept", "Accept"], ["decline", "Decline"]]) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "friend-action";
        button.dataset.friendAction = action;
        button.dataset.friendUsername = entry.username;
        button.textContent = label;
        row.append(button);
      }
    } else {
      const pending = document.createElement("span");
      pending.className = "friend-pending";
      pending.textContent = "Pending";
      row.append(pending);
    }
    container.append(row);
  }
}

function updateFriendChallengeBadge(challenges) {
  const badge = document.querySelector("#friends-challenge-badge");
  badge.textContent = challenges.length ? String(challenges.length) : "";
  badge.classList.toggle("hidden", challenges.length === 0);
  badge.setAttribute("aria-label", `${challenges.length} incoming game challenge${challenges.length === 1 ? "" : "s"}`);
}

function renderIncomingGameInvite(challenges) {
  const alert = document.querySelector("#game-invite-alert");
  const challenge = challenges[0];
  if (!challenge) {
    alert.classList.add("hidden");
    return;
  }
  document.querySelector("#game-invite-from").textContent = challenge.fromUsername;
  document.querySelector("#game-invite-copy").textContent = hasActiveOnlineRoom()
    ? "Finish or leave your current game before joining."
    : "invited you to play.";
  for (const button of alert.querySelectorAll("[data-challenge-action]")) {
    button.dataset.challengeId = challenge.id;
    button.dataset.roomCode = challenge.roomCode;
    button.disabled = button.dataset.challengeAction === "accept" && hasActiveOnlineRoom();
  }
  alert.classList.remove("hidden");
}

async function heartbeatPresence() {
  if (!accountUser) return;
  try {
    const result = await callGameApi("/api/presence", "POST", {});
    if (!Number.isSafeInteger(result.onlineCount) || result.onlineCount < 1) {
      throw new Error("The server returned an invalid online count.");
    }
    document.querySelector("#online-now-count").textContent = String(result.onlineCount);
    document.querySelector("#presence-status").textContent = "";
  } catch (error) {
    if (error.status !== 429) {
      document.querySelector("#online-now-count").textContent = "—";
      document.querySelector("#presence-status").textContent = onlineErrorMessage(error);
    }
  }
}

function schedulePresenceHeartbeat() {
  window.clearTimeout(presenceTimer);
  if (!accountUser) return;
  presenceTimer = window.setTimeout(async () => {
    await heartbeatPresence();
    schedulePresenceHeartbeat();
  }, 25_000);
}

async function loadFriends(silent = false) {
  if (friendsLoading || !accountUser) return;
  friendsLoading = true;
  const status = document.querySelector("#friends-status");
  if (!silent) status.textContent = "Loading friends…";
  try {
    const result = await callGameApi("/api/friends");
    for (const key of ["friends", "incoming", "outgoing", "challenges"]) {
      if (!Array.isArray(result[key])) throw new Error("The server returned an invalid friends list.");
    }
    updateFriendChallengeBadge(result.challenges);
    renderIncomingGameInvite(result.challenges);
    renderFriendEntries(document.querySelector("#friend-list"), result.friends, "friends");
    renderFriendEntries(document.querySelector("#friend-challenges"), result.challenges, "challenges");
    renderFriendEntries(document.querySelector("#friend-incoming"), result.incoming, "incoming");
    renderFriendEntries(document.querySelector("#friend-outgoing"), result.outgoing, "outgoing");
    if (!silent) status.textContent = "";
  } catch (error) {
    status.textContent = onlineErrorMessage(error);
  } finally {
    friendsLoading = false;
  }
}

function stopFriendChallengePolling() {
  window.clearTimeout(friendChallengesTimer);
  friendChallengesTimer = null;
}

function scheduleFriendChallengePolling() {
  stopFriendChallengePolling();
  if (!accountUser) return;
  friendChallengesTimer = window.setTimeout(async () => {
    if (!document.hidden) await loadFriends(true);
    scheduleFriendChallengePolling();
  }, document.hidden ? 20_000 : 6_000);
}

function startFriendChallengePolling() {
  stopFriendChallengePolling();
  if (!accountUser) return;
  void loadFriends(true);
  scheduleFriendChallengePolling();
}

function openFriends() {
  if (!accountUser) {
    showAccountGate();
    return;
  }
  document.querySelector("#friends-modal").classList.remove("hidden");
  setFriendsStatus("");
  loadFriends();
}

function hasActiveOnlineRoom() {
  return Boolean(online.roomCode && online.publicData?.status !== "finished");
}

async function challengeFriend(username, button) {
  if (hasActiveOnlineRoom()) {
    setFriendsStatus("Return to games before starting another duel.");
    return;
  }
  button.disabled = true;
  document.querySelector("#friends-modal").classList.add("hidden");
  document.querySelector("#public-room-checkbox").checked = false;
  openOnlineLobby("duel");
  setOnlineStatus(`Creating a private duel for you and ${username}…`);
  try {
    const snapshot = await callGameApi("/api/rooms", "POST", { maxPlayers: 2, isPublic: false });
    beginRoomSession(snapshot, snapshot.token);
    await callGameApi("/api/friends", "POST", {
      action: "challenge",
      username,
      roomCode: snapshot.roomCode,
    });
    setOnlineStatus(`Game invite sent to ${username}. Waiting for them to join…`);
    document.querySelector("#room-wait-message").textContent = `Challenge sent to ${username}. Waiting for them to join…`;
  } catch (error) {
    setOnlineStatus(onlineErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function respondToFriendChallenge(button) {
  if (button.dataset.challengeAction === "accept" && hasActiveOnlineRoom()) {
    setFriendsStatus("Return to games before joining this duel.");
    return;
  }
  button.disabled = true;
  const challengeId = button.dataset.challengeId;
  const roomCode = button.dataset.roomCode;
  const action = button.dataset.challengeAction;
  document.querySelector("#game-invite-alert").classList.add("hidden");
  if (action === "accept") {
    document.querySelector("#friends-modal").classList.add("hidden");
    openOnlineLobby("duel", "join");
    document.querySelector("#invite-link-input").value = makeInviteLink(roomCode);
    const joined = await joinOnlineRoom(false);
    if (joined) {
      try {
        await callGameApi("/api/friends", "POST", { action: "dismiss-challenge", challengeId });
        await loadFriends(true);
      } catch (error) {
        showToast(onlineErrorMessage(error));
      }
    } else {
      await loadFriends(true);
    }
    button.disabled = false;
    return;
  }
  try {
    await callGameApi("/api/friends", "POST", { action: "dismiss-challenge", challengeId });
    await loadFriends();
  } catch (error) {
    setFriendsStatus(onlineErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function submitFriendRequest(event) {
  event.preventDefault();
  const button = document.querySelector("#friend-submit");
  const usernameInput = document.querySelector("#friend-username");
  button.disabled = true;
  setFriendsStatus("Sending request…");
  try {
    const result = await callGameApi("/api/friends", "POST", {
      action: "request",
      username: usernameInput.value,
    });
    usernameInput.value = "";
    renderFriendEntries(document.querySelector("#friend-list"), result.friends, "friends");
    renderFriendEntries(document.querySelector("#friend-incoming"), result.incoming, "incoming");
    renderFriendEntries(document.querySelector("#friend-outgoing"), result.outgoing, "outgoing");
    setFriendsStatus("Friend request sent.");
  } catch (error) {
    setFriendsStatus(onlineErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function updateFriendRequest(action, username) {
  const method = action === "remove" ? "DELETE" : "POST";
  try {
    await callGameApi("/api/friends", method, { action, username });
    setFriendsStatus(action === "accept" ? `You and ${username} are now friends.` : action === "decline" ? "Friend request declined." : "Friend removed.");
    await loadFriends();
  } catch (error) {
    setFriendsStatus(onlineErrorMessage(error));
  }
}

async function openLeaderboard(period = leaderboardPeriod) {
  const modal = document.querySelector("#leaderboard-modal");
  if (modal.classList.contains("hidden")) {
    leaderboardPreviousScreen = elements.game.classList.contains("hidden")
      ? elements.online.classList.contains("hidden") ? "setup" : "online"
      : "game";
  }
  leaderboardPeriod = period;
  for (const screen of [elements.setup, elements.online, elements.game]) screen.classList.add("hidden");
  modal.classList.remove("hidden");
  setActiveNavigation("leaderboard-button");
  document.querySelector("#leaderboard-eyebrow").textContent = period === "all-time"
    ? "ALL-TIME STANDINGS"
    : period === "friends"
      ? "YOUR FRIEND CIRCLE"
      : "ROLLING 28-DAY STANDINGS";
  document.querySelector("#leaderboard-description").textContent = period === "friends"
    ? "Your friends and your own results, ranked by wins and win rate."
    : "Ranked by wins, with win rate as the tiebreaker. Anyone can view these standings.";
  for (const tab of document.querySelectorAll(".leaderboard-tab")) {
    const active = tab.dataset.period === period;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  }
  try {
    const { renderLeaderboard } = await import("./leaderboard-ui.js");
    await renderLeaderboard({ period, callGameApi });
  } catch (error) {
    document.querySelector("#leaderboard-status").textContent = onlineErrorMessage(error);
  }
}

function closeLeaderboard() {
  document.querySelector("#leaderboard-modal").classList.add("hidden");
  const screen = leaderboardPreviousScreen === "game" && game
    ? elements.game
    : leaderboardPreviousScreen === "online" && online.roomCode
      ? elements.online
      : elements.setup;
  screen.classList.remove("hidden");
  setActiveNavigation("nav-play-button");
  document.querySelector("#leaderboard-button").focus();
}

document.querySelector("#account-button").addEventListener("click", () => {
  if (accountUser) {
    renderAccountMode();
    document.querySelector("#account-status").textContent = "";
    document.querySelector("#account-modal").classList.remove("hidden");
    return;
  }
  showAccountGate();
});
document.querySelector("#change-duel-name").addEventListener("click", () => {
  renderAccountMode();
  document.querySelector("#account-status").textContent = "Your username is fixed to your account. Sign out to use another account.";
  document.querySelector("#account-modal").classList.remove("hidden");
  document.querySelector("#account-signout").focus();
});
document.querySelector("#account-login-tab").addEventListener("click", () => {
  accountMode = "login";
  renderAccountMode();
  setAccountStatus("");
});
document.querySelector("#account-register-tab").addEventListener("click", () => {
  accountMode = "register";
  renderAccountMode();
  setAccountStatus("");
});
document.querySelector("#account-form-panel").addEventListener("submit", submitAccountForm);
document.querySelector("#account-signout").addEventListener("click", signOutAccount);
document.querySelector("#friends-button").addEventListener("click", openFriends);
document.querySelector("#close-friends").addEventListener("click", () => document.querySelector("#friends-modal").classList.add("hidden"));
document.querySelector("#friend-form").addEventListener("submit", submitFriendRequest);
document.querySelector("#friends-modal").addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const challengeButton = event.target.closest("[data-friend-challenge]");
  if (challengeButton) {
    void challengeFriend(challengeButton.dataset.friendChallenge, challengeButton);
    return;
  }
  const responseButton = event.target.closest("[data-challenge-action]");
  if (responseButton) {
    void respondToFriendChallenge(responseButton);
    return;
  }
  const button = event.target.closest("[data-friend-action]");
  if (button) void updateFriendRequest(button.dataset.friendAction, button.dataset.friendUsername);
});
document.querySelector("#game-invite-alert").addEventListener("click", (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-challenge-action]") : null;
  if (button) void respondToFriendChallenge(button);
});
document.querySelector("#close-account").addEventListener("click", () => {
  if (accountUser) document.querySelector("#account-modal").classList.add("hidden");
});
document.querySelector("#leaderboard-button").addEventListener("click", openLeaderboard);
document.querySelector("#close-leaderboard").addEventListener("click", closeLeaderboard);
document.querySelector("#leaderboard-tabs").addEventListener("click", (event) => {
  const tab = event.target instanceof Element ? event.target.closest("[data-period]") : null;
  if (tab && tab.dataset.period !== leaderboardPeriod) void openLeaderboard(tab.dataset.period);
});
document.querySelector("#leaderboard-invite-button").addEventListener("click", () => {
  closeLeaderboard();
  openOnlineLobby("duel");
});
document.querySelector("#turn-notifications-button").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    document.querySelector("#turn-notifications-status").textContent = permission === "granted"
      ? "Turn notifications are enabled."
      : permission === "denied"
        ? "Notifications are blocked in your browser settings."
        : "Notifications were not enabled.";
    updateTurnNotificationControl();
  } catch (error) {
    document.querySelector("#turn-notifications-status").textContent = onlineErrorMessage(error);
  } finally {
    button.disabled = false;
  }
});
document.querySelector("#stats-button").addEventListener("click", openStats);
document.querySelector("#close-stats").addEventListener("click", () => document.querySelector("#stats-modal").classList.add("hidden"));
document.querySelector("#stats-modal").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.classList.add("hidden");
});
for (const button of document.querySelectorAll(".stats-filter")) {
  button.addEventListener("click", () => {
    statsPeriod = button.dataset.period;
    for (const filter of document.querySelectorAll(".stats-filter")) {
      const active = filter === button;
      filter.classList.toggle("active", active);
      filter.setAttribute("aria-pressed", String(active));
    }
    renderStats();
  });
}
document.querySelector("#tutorial-replay").addEventListener("click", () => startTutorial(true));
document.querySelector("#tutorial-skip").addEventListener("click", completeTutorial);
document.querySelector("#tutorial-next").addEventListener("click", () => {
  if (tutorialIndex === tutorialSteps.length - 1) {
    void completeTutorial();
    return;
  }
  tutorialIndex += 1;
  renderTutorialStep();
});
document.querySelector("#sound-toggle").addEventListener("click", () => {
  soundMuted = setMuted(!soundMuted);
  const toggle = document.querySelector("#sound-toggle");
  toggle.textContent = soundMuted ? "🔇" : "🔊";
  toggle.setAttribute("aria-label", soundMuted ? "Turn sounds on" : "Mute sounds");
  toggle.setAttribute("aria-pressed", String(soundMuted));
  if (!soundMuted) playSound("click");
});
document.addEventListener("click", (event) => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const control = target && target.closest("button, a");
  if (!control || control.matches("#sound-toggle, .playing-card, #draw-pile, .suit-option")) return;
  playSound("click");
});
document.querySelector("#sound-toggle").textContent = soundMuted ? "🔇" : "🔊";
document.querySelector("#sound-toggle").setAttribute("aria-label", soundMuted ? "Turn sounds on" : "Mute sounds");
document.querySelector("#sound-toggle").setAttribute("aria-pressed", String(soundMuted));
for (const modalId of ["account-modal", "friends-modal", "stats-modal"]) {
  document.querySelector(`#${modalId}`).addEventListener("click", (event) => {
    if (event.target === event.currentTarget && (modalId !== "account-modal" || accountUser)) {
      event.currentTarget.classList.add("hidden");
    }
  });
}

// Waiting for the opponent needs fresher data than your own turn, so poll less when it is yours.
function pollDelay() {
  if (online.reconnectAttempts > 0) {
    return Math.min(30_000, 1000 * (2 ** Math.min(online.reconnectAttempts - 1, 5)));
  }
  const data = online.publicData;
  if (!data || !data.game) return 3000; // lobby: waiting for a friend or for the host to start
  if (data.game.finished) return 1500;
  return data.game.current === online.seat ? 5000 : 2000;
}

function schedulePoll() {
  window.clearTimeout(online.pollTimer);
  if (!online.roomCode) return;
  online.pollTimer = window.setTimeout(async () => {
    await refreshRoomState();
    schedulePoll();
  }, pollDelay());
}

async function refreshRoomState() {
  if (!online.roomCode || online.polling || document.hidden) return;
  online.polling = true;
  const code = online.roomCode;
  try {
    const snapshot = await callGameApi(`/api/rooms/${code}/state`);
    if (online.roomCode === code) {
      online.reconnectAttempts = 0;
      document.querySelector("#reconnecting-banner").classList.add("hidden");
      applyRoomSnapshot(snapshot);
    }
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      online.reconnectAttempts = 0;
      document.querySelector("#reconnecting-banner").classList.add("hidden");
      removeStored(roomStorageKey(code));
      returnToSetup();
      setOnlineStatus("That game has expired or no longer exists. Create another game.");
    } else {
      online.reconnectAttempts += 1;
      if (!elements.game.classList.contains("hidden")) {
        document.querySelector("#reconnecting-banner").classList.remove("hidden");
        document.querySelector("#reconnecting-banner").textContent =
          `Reconnecting… (attempt ${online.reconnectAttempts})`;
      } else {
        setOnlineStatus(onlineErrorMessage(error));
      }
    }
  } finally {
    online.polling = false;
  }
}

function applyRoomSnapshot(snapshot) {
  if (!snapshot || !snapshot.publicData) throw new Error("The game server returned an invalid game state.");
  const data = snapshot.publicData;
  if (data.status === "closed") {
    removeStored(roomStorageKey(snapshot.roomCode));
    returnToSetup();
    window.history.replaceState(null, "", window.location.pathname);
    showToast("The game host ended this game.");
    return;
  }
  if (online.publicData && data.version < online.version) return; // an older response arrived late
  online.reconnectAttempts = 0;
  document.querySelector("#reconnecting-banner").classList.add("hidden");
  const previousData = online.publicData;
  const first = !online.publicData;
  const changed = first || data.version !== online.version;
  const previousChatIds = new Set((previousData?.chatMessages || []).map((message) => message.id));
  const newChatMessages = first
    ? []
    : (data.chatMessages || []).filter((message) => !previousChatIds.has(message.id));
  const incomingMessages = newChatMessages.filter((message) => message.seat !== snapshot.seat);
  const previousGame = previousData && previousData.game;
  const nextGame = data.game;
  if (nextGame) {
    if (!previousGame || previousGame.round !== nextGame.round) {
      online.discardHistory = [];
    } else {
      const previousTopCard = previousGame.discard && previousGame.discard[0];
      const nextTopCard = nextGame.discard && nextGame.discard[0];
      if (
        previousTopCard
        && nextTopCard
        && previousTopCard.id !== nextTopCard.id
        && nextGame.turns > previousGame.turns
      ) {
        online.discardHistory = [...online.discardHistory, previousTopCard].slice(-2);
      }
    }
  }
  const challengeJoiner = !first
    && online.isHost
    && previousData.isPublic
    && previousData.status === "waiting"
    && data.players.length > previousData.players.length
    ? data.players.find((player) => !previousData.players.some((previousPlayer) => previousPlayer.name === player.name))
    : null;
  online.clockOffset = data.serverNow - Date.now();
  online.version = data.version;
  online.publicData = data;
  online.ownHand = Array.isArray(snapshot.ownHand) ? snapshot.ownHand : [];
  online.seat = snapshot.seat;
  online.isHost = snapshot.seat === 0;
  updateRoomLobby(data);
  if (
    online.isHost
    && data.status === "waiting"
    && data.maxPlayers === 2
    && data.players.length === 2
  ) {
    setOnlineStatus("Your friend is here. Starting the game…");
    void startOnlineGame();
  }
  if (!changed) return;
  if (!first && data.players.length > previousData.players.length) playSound("join");
  if (previousGame && nextGame) {
    const sameRound = previousGame.round === nextGame.round;
    if (sameRound && nextGame.deckCount > previousGame.deckCount) playSound("shuffle");
    const lastCardReached = data.players.some((player, index) =>
      previousData.players[index]
      && previousData.players[index].handCount > 1
      && player.handCount === 1
    );
    if (lastCardReached) playSound("lastCard");
  }
  for (const message of newChatMessages) {
    if (QUICK_REACTION_TEXTS.has(message.text)) showQuickReaction(message.seat, message.text);
  }
  const incomingChatMessages = incomingMessages.filter((message) => !QUICK_REACTION_TEXTS.has(message.text));
  if (incomingChatMessages.length) {
    const latestMessage = incomingChatMessages[incomingChatMessages.length - 1];
    const preview = latestMessage.text.length > 72
      ? `${latestMessage.text.slice(0, 69)}…`
      : latestMessage.text;
    showToast(`${latestMessage.name}: ${preview}`);
    playSound("click");
  }
  if (!first && data.version !== previousData.version) {
    if (!newChatMessages.length && challengeJoiner) {
      showToast(`${challengeJoiner.name} answered your public challenge!`);
    } else if (
      !newChatMessages.length
      && data.lastMessage
      && data.lastMessage !== previousData.lastMessage
    ) {
      showToast(data.lastMessage);
    }
    if (online.soundVersion !== data.version) {
      if (!newChatMessages.length && previousGame && nextGame) {
        const previousCard = previousGame.discard && previousGame.discard[0];
        const playedCard = nextGame.discard && nextGame.discard[0];
        const cardWasPlayed = previousGame.round === nextGame.round
          && nextGame.turns > previousGame.turns
          && previousCard?.id !== playedCard?.id;
        if (cardWasPlayed) {
          playSound(cardSoundName(playedCard), { volumeScale: 0.62 });
          if (/cancel|block/i.test(data.lastMessage || "")) {
            playSound("block", { volumeScale: 0.72 });
          }
        } else if (
          !nextGame.finished
          && nextGame.turns > previousGame.turns
          && /drew|draw(?:s|ing)?|pick/i.test(data.lastMessage || "")
        ) playSound("draw");
      }
      online.soundVersion = data.version;
    }
  }
  if (data.game) renderOnlineGame();
  else {
    const wasConnecting = hideOptimisticConnection();
    elements.game.classList.add("hidden");
    elements.online.classList.remove("hidden");
    if (wasConnecting) document.querySelector("#leave-online-room").focus();
    setOnlineStatus(data.queuedForNextMatch
      ? "You joined the game and are queued for the next match."
      : online.isHost
        ? `Game ready. Share the invite with ${data.maxPlayers > 2 ? "your group" : "your friend"}.`
        : "Joined. Waiting for the host to start.");
  }
}

function updateRoomLobby(data) {
  const startButton = document.querySelector("#start-online-game");
  const endButton = document.querySelector("#end-online-room");
  const message = document.querySelector("#room-wait-message");
  const players = document.querySelector("#room-players");
  document.querySelector("#room-wait-panel").classList.remove("hidden");
  endButton.classList.toggle("hidden", !online.isHost || data.status === "closed");
  players.replaceChildren();
  data.players.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "room-player";
    const name = document.createElement("span");
    name.textContent = `${player.name}${index === online.seat ? " (you)" : ""}`;
    const presence = document.createElement("span");
    presence.className = `room-player-presence${player.online ? " is-online" : ""}`;
    presence.textContent = player.online ? "Online" : "Away";
    row.append(name, presence);
    players.append(row);
  });
  const waitingNext = Array.isArray(data.nextMatchPlayers) ? data.nextMatchPlayers : [];
  waitingNext.forEach((player) => {
    const row = document.createElement("div");
    row.className = "room-player room-player-queued";
    const name = document.createElement("span");
    name.textContent = `${player.name}${data.queuedName === player.name ? " (you)" : ""}`;
    const presence = document.createElement("span");
    presence.className = `room-player-presence${player.online ? " is-online" : ""}`;
    presence.textContent = "Next match";
    row.append(name, presence);
    players.append(row);
  });
  const maxPlayers = data.maxPlayers || 2;
  const isFull = data.players.length === maxPlayers;
  startButton.classList.toggle("hidden", !online.isHost || !isFull || data.status !== "waiting");
  document.querySelector("#end-room-from-game").classList.toggle("hidden", !online.isHost || data.status === "closed");
  if (data.queuedForNextMatch) {
    message.textContent = "You’re in the game and queued for the next match.";
    return;
  }
  if (data.status === "waiting") {
    if (online.isHost && Number.isFinite(data.publicChallengeExpiresAt)) {
      message.textContent = data.serverNow >= data.publicChallengeExpiresAt
        ? "Your public challenge has expired. Create a new one to invite more players."
        : isFull
          ? "Your challenge is full. Start the game when you’re ready."
          : "Your challenge is open to everyone for up to 1 hour and closes after 5 minutes without activity.";
    } else if (online.isHost && isFull) {
      message.textContent = waitingNext.length
        ? `This match is ready. ${waitingNext.length} more player${waitingNext.length === 1 ? "" : "s"} queued for the next match.`
        : "Everyone is here! Start when you’re ready.";
    } else if (online.isHost) {
      message.textContent = `Waiting for ${maxPlayers - data.players.length} more player${maxPlayers - data.players.length === 1 ? "" : "s"}…`;
    } else {
      message.textContent = `Connected to ${data.players[0].name}’s game. Waiting for the host to start.`;
    }
    return;
  }
  message.textContent = data.status === "closed" ? "The game host ended this game." : "Game connected.";
}

function renderChatMessages(messages) {
  const list = document.querySelector("#chat-messages");
  list.replaceChildren();
  if (!messages.length) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "Say hello to your table.";
    list.append(empty);
    return;
  }

  for (const message of messages) {
    const item = document.createElement("article");
    const isReaction = QUICK_REACTION_TEXTS.has(message.text);
    item.className = `chat-message${message.seat === online.seat ? " is-own-message" : ""}${isReaction ? " chat-message-reaction" : ""}`;
    const meta = document.createElement("div");
    meta.className = "chat-message-meta";
    const name = document.createElement("strong");
    name.textContent = message.name;
    const time = document.createElement("time");
    time.dateTime = new Date(message.sentAt).toISOString();
    time.textContent = new Date(message.sentAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    const text = document.createElement("p");
    text.textContent = message.text;
    meta.append(name, time);
    item.append(meta, text);
    list.append(item);
  }
  list.scrollTop = list.scrollHeight;
}

function renderGameChat(data) {
  const panel = document.querySelector("#game-chat");
  const active = data.status === "playing" && !data.game.finished;
  if (!active) online.chatOpen = false;
  panel.hidden = !active || !online.chatOpen;
  panel.classList.toggle("hidden", !active || !online.chatOpen);
  chatToggle.classList.toggle("hidden", !active);
  chatToggle.disabled = !active;
  chatToggle.setAttribute("aria-expanded", String(active && online.chatOpen));
  chatToggle.setAttribute("aria-label", online.chatOpen ? "Close table chat" : "Open table chat");
  renderChatMessages(data.chatMessages || []);
}

function updateChatUnreadBadge() {
  const badge = document.querySelector("#chat-unread-badge");
  if (!badge) return;
  badge.classList.add("hidden");
}

function renderOnlineGame() {
  const wasConnecting = hideOptimisticConnection();
  const data = online.publicData;
  if (!data || !data.game || online.seat < 0) return;
  const state = data.game;
  const previous = game;
  const wasFinished = Boolean(previous && previous.finished);
  if (!previous || previous.turnStartedAt !== state.turnStartedAt) online.timeoutSentAt = null;
  onlineSeat = online.seat;
  onlineMode = true;
  const turnDeadline = state.turnStartedAt + 60000 - online.clockOffset;
  game = {
    ...state,
    players: data.players.map((player, index) => ({
      name: player.name,
      hand: index === online.seat ? online.ownHand : Array.from({ length: player.handCount }, () => null),
    })),
    deck: Array.from({ length: state.deckCount }, () => null),
    turnDeadline,
    timeLeft: Math.max(0, Math.ceil((turnDeadline - Date.now()) / 1000)),
    stagedCardIndex: previous ? previous.stagedCardIndex : null,
  };
  document.querySelector("#mode-label").textContent = "Online game";
  document.querySelector("#round-mode-label").textContent = data.players.length > 2 ? "GROUP QUEST" : "ONLINE DUEL";
  elements.setup.classList.add("hidden");
  elements.online.classList.add("hidden");
  elements.game.classList.remove("hidden");
  document.querySelector("#round-player-count").textContent = `${data.players.length} PLAYERS · ROUND ${state.round || 1}`;
  if (state.current !== online.seat || state.finished) {
    hideModal(elements.suitModal);
    game.stagedCardIndex = null;
  }
  alertForTurn(state);
  renderGame();
  if (wasConnecting) document.querySelector("#back-button").focus();
  renderGameChat(data);
  startTurnTimer();
  if (game.finished && !wasFinished) {
    window.clearInterval(turnTimer);
    turnTimer = null;
    presentGameResult(game.winner);
    elements.rematchModal.classList.remove("hidden");
    elements.rematch.focus();
    void refreshAccountProgress()
      .then(() => updateResultScore())
      .catch((error) => showToast(onlineErrorMessage(error)));
  } else if (!game.finished) {
    hideModal(elements.rematchModal);
  }
  if (game.finished) updateRematchControls(data);
  else {
    elements.rematch.disabled = false;
    elements.rematch.innerHTML = 'Play again <span aria-hidden="true">↻</span>';
    document.querySelector("#rematch-status").textContent = "Keep this table going with the same players.";
  }
}

function updateRematchControls(data) {
  const requests = Array.isArray(data.rematchRequests)
    ? data.rematchRequests
    : data.players.map(() => false);
  const button = elements.rematch;
  const message = document.querySelector("#rematch-status");
  const startQueued = document.querySelector("#start-queued-match");
  const endRoom = document.querySelector("#end-room-from-result");
  const waitingCount = Array.isArray(data.nextMatchPlayers) ? data.nextMatchPlayers.length : 0;
  startQueued.classList.toggle("hidden", !online.isHost || data.status !== "finished" || waitingCount === 0);
  endRoom.classList.toggle("hidden", !online.isHost);
  if (requests[online.seat]) {
    button.textContent = "Waiting for a reply…";
    button.disabled = true;
    const waitingOn = data.players
      .filter((_, index) => index !== online.seat && !requests[index])
      .map((player) => player.name);
    message.textContent = waitingOn.length
      ? `Waiting for ${waitingOn.join(", ")} to accept.`
      : "Waiting for everyone to accept.";
  } else if (requests.some(Boolean)) {
    button.textContent = "Play again";
    button.disabled = false;
    const requestedBy = data.players
      .filter((_, index) => requests[index])
      .map((player) => player.name);
    message.textContent = `${requestedBy.join(", ")} want${requestedBy.length === 1 ? "s" : ""} a rematch.`;
  } else {
    button.innerHTML = 'Play again <span aria-hidden="true">↻</span>';
    button.disabled = false;
    message.textContent = waitingCount
      ? `${waitingCount} player${waitingCount === 1 ? "" : "s"} waiting for the next match.`
      : "Keep this table going with the same players.";
  }
}

function beginRoomSession(snapshot, token) {
  disconnectOnlineRoom();
  online.roomCode = snapshot.roomCode;
  online.token = token;
  online.discardHistory = [];
  onlineRoomSize = snapshot.publicData.maxPlayers || 2;
  document.querySelector("#online-title").textContent = onlineRoomSize > 2
    ? `${onlineRoomSize}-player group`
    : "Duel a friend";
  writeStored(roomStorageKey(snapshot.roomCode), JSON.stringify({ token }));
  const inviteLink = makeInviteLink(snapshot.roomCode);
  window.history.replaceState(null, "", inviteLink); // reloading this page reconnects you
  document.querySelector("#create-room-controls").classList.add("hidden");
  document.querySelector(".account-panel").classList.add("hidden");
  document.querySelector(".room-visibility").classList.add("hidden");
  document.querySelector(".public-rooms").classList.add("hidden");
  document.querySelector(".active-games").classList.add("hidden");
  document.querySelector("#online-back-button").classList.add("hidden");
  document.querySelector("#close-online").classList.add("hidden");
  document.querySelector("#duel-tabs").classList.add("hidden");
  document.querySelector("#duel-create-panel").classList.remove("hidden");
  document.querySelector("#duel-join-panel").classList.add("hidden");
  document.querySelector("#join-room-panel").classList.add("hidden");
  applyRoomSnapshot(snapshot);
  document.querySelector("#online-subtitle").textContent = onlineRoomSize > 2
    ? online.isHost ? "Invite your crew to join the game." : `You joined a ${onlineRoomSize}-player group game.`
    : online.isHost ? "Send your friend the invite link." : `You joined ${snapshot.publicData.players[0].name}’s game.`;
  if (online.isHost) {
    document.querySelector("#invite-result").classList.remove("hidden");
    const headline = document.querySelector(".invite-ready-heading div > span");
    headline.textContent = onlineRoomSize > 2 ? "Share the invite with your crew." : "Send your friend an invite.";
  }
  playSound("join");
  schedulePoll();
}

async function createOnlineRoom() {
  if (roomCreationPending) return;
  roomCreationPending = true;
  const createButton = document.querySelector("#create-room-button");
  createButton.disabled = true;
  try {
    const isPublic = document.querySelector("#public-room-checkbox").checked;
    document.querySelector("#invite-room-note").textContent = isPublic
      ? "Your challenge can be open for up to 1 hour, but the room closes after 5 minutes without activity."
      : "This private game link closes after 5 minutes without activity. Late arrivals wait for the next match.";
    showOptimisticConnection();
    setOnlineStatus("Creating your game…");
    const snapshot = await callGameApi("/api/rooms", "POST", {
      maxPlayers: onlineRoomSize,
      isPublic,
    });
    beginRoomSession(snapshot, snapshot.token);
    setOnlineStatus(isPublic
      ? "Your public challenge closes after 5 minutes without activity."
      : "Private game created.");
  } catch (error) {
    elements.online.classList.remove("hidden");
    hideOptimisticConnection(true);
    elements.game.classList.add("hidden");
    if (elements.online.classList.contains("is-duel-sheet")) elements.setup.classList.remove("hidden");
    setOnlineStatus(onlineErrorMessage(error));
  } finally {
    roomCreationPending = false;
    createButton.disabled = false;
  }
}

function startQuickDuel() {
  document.querySelector("#public-room-checkbox").checked = false;
  openOnlineLobby("duel");
}

async function shareInviteLink(button) {
  const inviteLink = online.roomCode ? makeInviteLink(online.roomCode) : "";
  if (!inviteLink) {
    announceCopyStatus("Create a game before sharing an invite.");
    return;
  }
  if (typeof navigator.share === "function") {
    try {
      await navigator.share({
        title: "Join my BAKASHA game",
        text: "Come play a card game with me!",
        url: inviteLink,
      });
      showCopySuccess(button, "Invite shared!");
      announceCopyStatus("Invite shared.");
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }
  await copyTextToButton(
    inviteLink,
    button,
    "Link copied!",
    "Invite link copied. Send it to your friend.",
    "Could not copy the invite link. Copy it from the address bar instead.",
  );
}

async function joinOnlineRoom(publicJoin = false) {
  if (roomJoinPending) return false;
  const inviteInput = document.querySelector("#invite-link-input");
  const roomCode = extractInviteRoomCode(inviteInput.value);
  if (!roomCode) {
    setOnlineStatus("Paste your friend’s invite link first.");
    inviteInput.focus();
    return false;
  }
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(roomCode)) {
    setOnlineStatus("That invite link isn’t valid. Check it and try again.");
    inviteInput.focus();
    return false;
  }
  roomJoinPending = true;
  const joinButton = document.querySelector("#join-room-button");
  joinButton.disabled = true;
  pendingInviteRoom = roomCode;
  inviteAccepted = true;
  try {
    const saved = readSavedRoom(roomCode);
    const body = publicJoin ? { publicJoin: true } : {};
    if (saved) body.token = saved.token; // you were already in this room: just reconnect
    showOptimisticConnection();
    setOnlineStatus(saved ? "Reconnecting…" : publicJoin ? "Joining public game…" : "Joining your friend’s game…");
    const snapshot = await callGameApi(`/api/rooms/${roomCode}/join`, "POST", body);
    beginRoomSession(snapshot, snapshot.token || (saved && saved.token));
    pendingInviteRoom = null;
    inviteAccepted = false;
    invitePreview = null;
    document.querySelector("#game-invite-alert").classList.add("hidden");
    return true;
  } catch (error) {
    delete inviteInput.dataset.autoJoinValue;
    if (error.status !== 401) {
      pendingInviteRoom = null;
      inviteAccepted = false;
    }
    elements.online.classList.remove("hidden");
    hideOptimisticConnection(true);
    elements.game.classList.add("hidden");
    if (elements.online.classList.contains("is-duel-sheet")) elements.setup.classList.remove("hidden");
    if (publicJoin && error.status === 404) {
      setOnlineStatus("That game isn’t open for public play. Open games have been refreshed.");
      await refreshPublicRooms();
      schedulePublicRoomsRefresh();
      return false;
    }
    setOnlineStatus(onlineErrorMessage(error));
    return false;
  } finally {
    roomJoinPending = false;
    joinButton.disabled = false;
  }
}

async function startOnlineGame() {
  if (!online.roomCode || !online.isHost || online.starting) return;
  online.starting = true;
  try {
    applyRoomSnapshot(await callGameApi(`/api/rooms/${online.roomCode}/start`, "POST", {}));
  } catch (error) {
    if (onlineMode) showToast(onlineErrorMessage(error));
    else setOnlineStatus(onlineErrorMessage(error));
  } finally {
    online.starting = false;
  }
}

async function endOnlineRoom() {
  if (!online.roomCode || !online.isHost) return;
  if (!window.confirm("End this game for everyone? Its invite link will stop working.")) return;
  const code = online.roomCode;
  try {
    await callGameApi(`/api/rooms/${code}/end`, "POST", {});
    removeStored(roomStorageKey(code));
    returnToSetup();
    window.history.replaceState(null, "", window.location.pathname);
    showToast("Game ended. The invite link is closed.");
  } catch (error) {
    showToast(onlineErrorMessage(error));
  }
}

async function finishActiveRoom(action, roomCode) {
  const prompt = action === "end"
    ? "End this game for everyone? Its invite link will stop working."
    : "Leave this waiting game? You can start or join another one afterward.";
  if (!window.confirm(prompt)) return;
  try {
    const result = await callGameApi("/api/rooms/active", "POST", { action, roomCode });
    await Promise.all([refreshActiveRooms(), refreshPublicRooms()]);
    setOnlineStatus(result.ended
      ? "Game ended. Your other active games are still available to rejoin."
      : "You left this game. Your other active games are still available to rejoin.");
  } catch (error) {
    setOnlineStatus(onlineErrorMessage(error));
  }
}

async function startQueuedMatch() {
  const button = document.querySelector("#start-queued-match");
  if (!online.roomCode || !online.isHost || button.disabled) return;
  button.disabled = true;
  try {
    applyRoomSnapshot(await callGameApi(`/api/rooms/${online.roomCode}/start`, "POST", {}));
  } catch (error) {
    showToast(onlineErrorMessage(error));
  } finally {
    button.disabled = false;
  }
}

async function sendChatMessage(event) {
  event.preventDefault();
  const input = document.querySelector("#chat-input");
  const send = document.querySelector("#chat-send");
  const text = input.value.trim();
  if (!text || !online.roomCode || !onlineMode || online.chatSending) return;

  online.chatSending = true;
  send.disabled = true;
  document.querySelector("#chat-status").textContent = "Sending…";
  try {
    const snapshot = await callGameApi(`/api/rooms/${online.roomCode}/chat`, "POST", { message: text });
    applyRoomSnapshot(snapshot);
    input.value = "";
    document.querySelector("#chat-status").textContent = "Messages are automatically deleted when the game ends.";
  } catch (error) {
    document.querySelector("#chat-status").textContent = onlineErrorMessage(error);
  } finally {
    online.chatSending = false;
    send.disabled = !game || game.finished;
  }
}

function retryTimeoutSoon() {
  window.setTimeout(() => {
    if (onlineMode && game && game.timeLeft === 0) startTurnTimer();
  }, 1000);
}

async function submitOnlineMove(action) {
  if (!onlineMode || !online.roomCode || online.movePending) return;
  if (action.type !== "timeout" && action.type !== "knock" && game.current !== onlineSeat) return;
  online.optimisticCard = action.type === "play"
    ? online.ownHand.find((card) => card.id === action.cardId) || null
    : null;
  online.movePending = true;
  online.pendingAction = action.type;
  const actionId = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  renderGame();
  try {
    const snapshot = await callGameApi(`/api/rooms/${online.roomCode}/action`, "POST", { ...action, actionId });
    online.movePending = false;
    online.pendingAction = null;
    if (!snapshot.ignored) {
      if (action.type === "play") {
        const played = online.optimisticCard;
        playSound(cardSoundName(played));
        if (/cancel|block/i.test(snapshot.publicData.lastMessage || "")) playSound("block");
      } else if (action.type === "draw") playSound("draw");
      else if (action.type === "timeout") playSound("draw");
      online.soundVersion = snapshot.publicData.version;
    }
    online.optimisticCard = null;
    applyRoomSnapshot(snapshot);
    if (game) renderGame();
    if (snapshot.ignored) {
      online.timeoutSentAt = null;
      retryTimeoutSoon();
    }
  } catch (error) {
    online.movePending = false;
    online.pendingAction = null;
    online.optimisticCard = null;
    if (action.type === "play" && error.status === 400) playSound("error");
    showToast(onlineErrorMessage(error));
    if (game) renderGame();
    if (action.type === "timeout") {
      online.timeoutSentAt = null;
      retryTimeoutSoon();
    }
  }
}

document.querySelector("#create-room-button").addEventListener("click", createOnlineRoom);
document.querySelector("#join-room-button").addEventListener("click", () => joinOnlineRoom(false));
document.querySelector("#invite-link-input").addEventListener("input", (event) => {
  const inviteInput = event.currentTarget;
  const value = inviteInput.value.trim();
  const roomCode = extractInviteRoomCode(value);
  if (
    !value
    || !roomCode
    || !/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(roomCode)
    || inviteInput.dataset.autoJoinValue === value
  ) return;
  inviteInput.dataset.autoJoinValue = value;
  void joinOnlineRoom(false);
});
document.querySelector("#end-online-room").addEventListener("click", endOnlineRoom);
document.querySelector("#end-room-from-game").addEventListener("click", endOnlineRoom);
document.querySelector("#end-room-from-result").addEventListener("click", endOnlineRoom);
document.querySelector("#start-queued-match").addEventListener("click", startQueuedMatch);
document.querySelector("#refresh-public-rooms").addEventListener("click", refreshPublicRooms);
document.querySelector("#active-game-list").addEventListener("click", (event) => {
  const action = event.target.closest("[data-active-room-action]");
  if (action) {
    finishActiveRoom(action.dataset.activeRoomAction, action.dataset.activeRoomCode);
    return;
  }
  const rejoin = event.target.closest("[data-active-room-code]");
  if (rejoin) {
    document.querySelector("#invite-link-input").value = makeInviteLink(rejoin.dataset.activeRoomCode);
    joinOnlineRoom(false);
  }
});
document.querySelector("#home-resume-button").addEventListener("click", (event) => {
  const code = event.currentTarget.dataset.activeRoomCode;
  if (!code) return;
  openOnlineLobby("duel", "join");
  document.querySelector("#invite-link-input").value = makeInviteLink(code);
  void joinOnlineRoom(false);
});
document.querySelector("#public-room-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-public-room-code]");
  if (!button) return;
  document.querySelector("#invite-link-input").value = makeInviteLink(button.dataset.publicRoomCode);
  joinOnlineRoom(true);
});
document.querySelector("#start-online-game").addEventListener("click", startOnlineGame);
document.querySelector("#chat-form").addEventListener("submit", sendChatMessage);
document.querySelector("#chat-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    document.querySelector("#chat-form").requestSubmit();
  }
});
document.querySelector("#game-reactions").addEventListener("click", async (event) => {
  const button = event.target instanceof Element ? event.target.closest("[data-reaction]") : null;
  const reaction = button?.dataset.reaction;
  if (!reaction || !online.roomCode || online.reactionSending) return;
  online.reactionSending = true;
  for (const reactionButton of document.querySelectorAll("#game-reactions button")) {
    reactionButton.disabled = true;
  }
  try {
    const snapshot = await callGameApi(`/api/rooms/${online.roomCode}/reaction`, "POST", { reaction });
    applyRoomSnapshot(snapshot);
    renderGameChat(online.publicData);
  } catch (error) {
    showToast(onlineErrorMessage(error));
  } finally {
    online.reactionSending = false;
    for (const reactionButton of document.querySelectorAll("#game-reactions button")) {
      reactionButton.disabled = false;
    }
  }
});
document.querySelector("#leave-online-room").addEventListener("click", () => {
  const challengeIsLive = online.publicData?.status === "waiting"
    && Number.isFinite(online.publicData.publicChallengeExpiresAt)
    && online.publicData.serverNow < online.publicData.publicChallengeExpiresAt;
  disconnectOnlineRoom();
  setOnlineStatus(challengeIsLive
    ? "Your public challenge stays open for up to 1 hour while active."
    : "You left this game. Open its invite link to reconnect.");
  refreshActiveRooms();
  refreshPublicRooms();
  schedulePublicRoomsRefresh();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    alertForTurn(online.publicData?.game);
  } else {
    document.title = PAGE_TITLE;
    if (online.roomCode) refreshRoomState();
    if (accountUser) {
      void loadFriends(true);
      scheduleFriendChallengePolling();
    }
  }
});
document.querySelector("#copy-invite-button").addEventListener("click", () => {
  const inviteLink = online.roomCode ? makeInviteLink(online.roomCode) : "";
  void copyTextToButton(
    inviteLink,
    document.querySelector("#copy-invite-button"),
    "Copied!",
    "Invite link copied. Send it to your friend.",
    "Could not copy the invite link. Copy it from the address bar instead.",
  );
});
document.querySelector("#share-invite-button").addEventListener("click", () => {
  shareInviteLink(document.querySelector("#share-invite-button"));
});
for (const button of document.querySelectorAll("[data-share-invite]")) {
  button.addEventListener("click", () => shareInviteLink(button));
}
document.querySelector("#mode-label").textContent = "Choose game";
enableAudioUnlock();
window.setTimeout(() => document.querySelector("#loading-screen").classList.add("loading-screen-done"), 850);
for (const button of document.querySelectorAll(".suit-option")) {
  button.addEventListener("click", () => {
    if (!game || game.stagedCardIndex === null) return;
    const index = game.stagedCardIndex;
    animatePlayedCard(index);
    game.stagedCardIndex = null;
    hideModal(elements.suitModal);
    if (onlineMode) {
      submitOnlineMove({
        type: "play",
        cardId: game.players[game.current].hand[index].id,
        chosenSuit: button.dataset.suit,
      });
      return;
    }
    playLocalTurnCard(index, button.dataset.suit);
  });
}
document.querySelector("#game-rules-button").addEventListener("click", openRules);
document.querySelector("#close-rules").addEventListener("click", closeRules);
for (const modal of [elements.rulesModal, elements.suitModal]) {
  modal.addEventListener("click", (event) => {
    if (event.target !== modal) return;
    if (modal === elements.rulesModal) closeRules();
    else cancelSuitSelection();
  });
}
document.addEventListener("keydown", (event) => {
  const activeDialogs = [...document.querySelectorAll('.modal-backdrop[role="dialog"][aria-modal="true"]:not(.hidden)')];
  const activeDialog = activeDialogs[activeDialogs.length - 1];
  if (event.key === "Tab" && activeDialog) {
    const focusable = [...activeDialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.closest(".hidden"));
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !activeDialog.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !activeDialog.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }
  if (event.key !== "Escape") return;
  if (elements.online.classList.contains("is-duel-sheet") && !online.roomCode) closeDuelSheet();
  if (!elements.rulesModal.classList.contains("hidden")) closeRules();
  if (!elements.suitModal.classList.contains("hidden")) cancelSuitSelection();
  if (!document.querySelector("#leaderboard-modal").classList.contains("hidden")) closeLeaderboard();
  for (const modalId of ["friends-modal", "stats-modal"]) {
    document.querySelector(`#${modalId}`).classList.add("hidden");
  }
  if (!document.querySelector("#tutorial-modal").classList.contains("hidden")) void completeTutorial();
  if (accountUser) document.querySelector("#account-modal").classList.add("hidden");
});

document.querySelector("#accept-invite-button").addEventListener("click", acceptGameInvite);
document.querySelector("#decline-invite-button").addEventListener("click", dismissGameInvite);
renderAccountMode();
const inviteParams = new URLSearchParams(window.location.search);
const hashInviteCode = /^#\/c\/([a-z0-9]{4})$/i.exec(window.location.hash)?.[1];
pendingInviteRoom = inviteParams.get("game") || inviteParams.get("room") || hashInviteCode;
if (pendingInviteRoom) {
  document.querySelector("#account-modal").classList.add("hidden");
  showInviteLanding();
}
loadAccount();
