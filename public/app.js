import { enableAudioUnlock, isMuted, playSound, setMuted } from "./sound.js";

"use strict";

const SUITS = {
  hearts: { symbol: "♥", name: "Hearts" },
  spades: { symbol: "♠", name: "Spades" },
  diamonds: { symbol: "♦", name: "Diamonds" },
  clubs: { symbol: "♣", name: "Clubs" },
};
const SUIT_ORDER = ["hearts", "spades", "diamonds", "clubs"];
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
let publicRoomsTimer = null;
let publicRoomsLoading = false;
let activeRoomsLoading = false;
let friendChallengesTimer = null;
let friendsLoading = false;
let knownFriendChallengeIds = new Set();
let friendChallengesInitialized = false;
let soundMuted = isMuted();
let tutorialIndex = 0;
let tutorialShown = false;
let tutorialDismissed = false;
let statsPeriod = "all";
let renderedHandSeat = null;
const online = {
  roomCode: null,
  token: null,
  seat: -1,
  starting: false,
  publicData: null,
  ownHand: null,
  isHost: false,
  pollTimer: null,
  polling: false,
  movePending: false,
  pendingAction: null,
  chatSending: false,
  chatOpen: false,
  optimisticCard: null,
  timeoutSentAt: null,
  soundVersion: null,
  version: 0,
  clockOffset: 0,
  chatUnreadCount: 0,
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
  dealGame([accountUser.username, "Fundo"], { training: true });
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
  document.querySelector("#mode-label").textContent = trainingMode ? "Training with Fundo" : "Local game";
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
  document.querySelector("#round-player-count").textContent = `${players.length} PLAYERS`;
  renderGame();
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
  if (won) {
    playSound("win");
    showConfetti();
  } else {
    playSound("lose");
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
  if (game.jumpSupport) return game.players.length === 2 && card.suit === topCard().suit;
  if (game.freeSuitPlay) return true;
  if (game.demandedSuit) {
    return card.rank === "A" || card.rank === "JOKER" || card.suit === game.demandedSuit;
  }
  return card.rank === "JOKER"
    ? topCard().rank !== "2"
    : card.suit === game.activeSuit || card.rank === topCard().rank;
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
  chatToggle.classList.toggle("hidden", !onlineMode);
  if (!onlineMode) {
    online.chatOpen = false;
    document.querySelector("#game-chat").classList.add("hidden");
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
  const previousDiscard = elements.discard.firstElementChild;
  const visibleTopCard = online.optimisticCard || topCard();
  const playedCard = createCardElement(visibleTopCard, { interactive: false });
  if (previousDiscard && previousDiscard.dataset.cardId !== playedCard.dataset.cardId) {
    playedCard.classList.add("card-play");
  }
  elements.discard.replaceChildren(playedCard);
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

function renderHand() {
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
}

function updateMessage() {
  const player = game.players[game.current];
  const isViewerTurn = (onlineMode && game.current === onlineSeat)
    || (trainingMode && game.current === 0);
  const turnLabel = isViewerTurn ? "Your turn" : `${player.name}’s turn`;
  elements.hint.textContent = "";
  elements.handHelp.textContent = "";
  if (game.finished) {
    elements.message.textContent = `${game.winner} wins!`;
    return;
  }
  if (onlineMode && !isViewerTurn) {
    elements.message.textContent = `${player.name}’s turn`;
    return;
  }
  if (trainingMode && game.current !== 0) {
    elements.message.textContent = "Fundo is thinking…";
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
    elements.message.textContent = `${turnLabel} · Add 8 support or draw 1`;
    return;
  }
  if (game.jumpSupport) {
    elements.message.textContent = `${turnLabel} · Play a card in the same suit or draw 1`;
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

function playCard(index, chosenSuit) {
  const player = game.players[game.current];
  const [card] = player.hand.splice(index, 1);
  if (!card) return;
  playSound(card.rank === "2" || card.rank === "JOKER" ? "penalty" : "play");
  const counteringJoker = game.pending > 0 && game.pendingType === "draw-four";
  const counteringDrawTwo = game.pending > 0 && game.pendingType === "draw-two" && card.rank === "2";
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
        : "Jack played. Play a card in the same suit or draw one.");
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
  game.current = nextPlayerIndex(steps || 1);
  game.turns += 1;
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
  }, 650);
}

function playFundoTurn() {
  if (!trainingMode || !game || game.finished || game.current !== 1) return;
  const hand = game.players[1].hand;
  if (hand.length === 1 && !game.knocked[1]) {
    game.knocked[1] = true;
    renderGame();
    return;
  }

  const playableIndex = hand.findIndex(isPlayable);
  if (playableIndex < 0) {
    drawCard();
    return;
  }

  const card = hand[playableIndex];
  if (card.rank === "A") {
    const counts = SUIT_ORDER.map((suit) => ({
      suit,
      count: hand.filter((candidate) => candidate !== card && candidate.suit === suit).length,
    }));
    counts.sort((left, right) => right.count - left.count);
    playCard(playableIndex, counts[0].suit);
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
document.querySelector("#browse-games-button").addEventListener("click", () => openOnlineLobby("duel"));
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
  document.querySelector("#round-mode-label").textContent = "ONLINE GAME";
  game = null;
  document.body.classList.remove("game-active");
  hideModal(elements.suitModal);
  hideModal(elements.rematchModal);
  elements.game.classList.add("hidden");
  elements.online.classList.add("hidden");
  elements.setup.classList.remove("hidden");
  document.querySelector("#group-game-options").classList.add("hidden");
  document.querySelector("#group-game-button").classList.remove("active");
  document.querySelector("#group-game-button").setAttribute("aria-expanded", "false");
  document.querySelector("#one-v-one-button").classList.remove("active");
  document.querySelector("#training-game-button").classList.remove("active");
}
function closeGroupOptions() {
  document.querySelector("#group-game-options").classList.add("hidden");
  document.querySelector("#group-game-button").classList.remove("active");
  document.querySelector("#group-game-button").setAttribute("aria-expanded", "false");
  document.querySelector("#group-game-button").focus();
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
  if (online.chatOpen) document.querySelector("#chat-input").focus();
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

function openOnlineLobby(mode = "duel") {
  if (!accountUser) {
    showAccountGate();
    return;
  }
  onlineRoomSize = mode === "group" ? selectedCount : 2;
  elements.setup.classList.add("hidden");
  elements.online.classList.remove("hidden");
  document.querySelector("#online-back-button").classList.remove("hidden");
  document.querySelector("#mode-label").textContent = onlineRoomSize > 2 ? "Group quest" : "Quick duel";
  document.querySelector("#online-title").textContent = onlineRoomSize > 2 ? `${onlineRoomSize}-player group` : "Quick duel";
  document.querySelector("#online-subtitle").textContent = onlineRoomSize > 2
    ? `Create a game for ${onlineRoomSize} players, then invite your crew.`
    : "Create a table and send your friend a link.";
  document.querySelector("#create-room-button").innerHTML = `Create ${onlineRoomSize === 2 ? "duel" : `${onlineRoomSize}-player game`} <span aria-hidden="true">→</span>`;
  refreshPublicRooms();
  refreshActiveRooms();
  schedulePublicRoomsRefresh();
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
  document.querySelector("#active-game-count").textContent = `${rooms.length}/2`;
  list.replaceChildren();
  if (rooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "public-room-empty active-game-empty";
    empty.textContent = "No active games yet. Create a game or join one below.";
    list.append(empty);
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
    rejoin.textContent = "Rejoin";
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

async function refreshActiveRooms() {
  if (
    activeRoomsLoading
    || online.roomCode
    || elements.online.classList.contains("hidden")
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
    const failure = document.createElement("p");
    failure.className = "public-room-empty active-game-empty";
    failure.textContent = onlineErrorMessage(error);
    list.append(failure);
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
  try {
    const invite = new URL(value.trim());
    const code = invite.searchParams.get("game") || invite.searchParams.get("room");
    return code ? extractRoomCode(code) : "";
  } catch (error) {
    return "";
  }
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
  });
  updateChatUnreadBadge();
  document.querySelector("#room-wait-panel").classList.add("hidden");
  document.querySelector("#invite-result").classList.add("hidden");
  document.querySelector("#create-room-controls").classList.remove("hidden");
  document.querySelector(".room-visibility").classList.remove("hidden");
  document.querySelector(".public-rooms").classList.remove("hidden");
  document.querySelector(".active-games").classList.remove("hidden");
  document.querySelector("#online-back-button").classList.remove("hidden");
  document.querySelector("#join-room-panel").classList.remove("hidden");
  document.querySelector("#copy-invite-button").textContent = "Share invite link";
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
    title: "Match the top card",
    copy: "Play a card with the same suit or number as the card in the middle. If you cannot play, draw one card and your turn ends.",
  },
  {
    title: "Joker: pick four",
    copy: "A Joker can go on almost any card except a 2. The next player draws four; after that, the following player may play any card, ignoring the old suit. A Joker can cancel the penalty.",
  },
  {
    title: "Two: pick two",
    copy: "Play a 2 to make the next player draw two and miss their turn. They can answer with another 2 to cancel the penalty.",
  },
  {
    title: "Ace: name a suit",
    copy: "When you play an Ace, choose the suit the next player must follow. They can also answer with an Ace. A Joker clears an Ace’s suit demand.",
  },
  {
    title: "Jack: jump or support",
    copy: "In a group, a Jack skips the next player. In solo or 1v1, you get a support turn: play a card in the Jack’s suit or draw one. An 8 also needs support in its suit.",
  },
  {
    title: "One card left",
    copy: "When you have one card, you are automatically marked. You cannot finish on a special card—if your last card is an Ace, 2, 8, Jack, or Joker, draw one on your next turn.",
  },
];

function renderProgress() {
  const dashboard = document.querySelector("#progress-dashboard");
  const statsButton = document.querySelector("#stats-button");
  const user = accountUser;
  const progress = user && user.progress;
  dashboard.classList.toggle("hidden", !user);
  statsButton.classList.toggle("hidden", !user);
  if (!user) return;
  const xp = Number.isSafeInteger(progress && progress.xp) ? progress.xp : 0;
  const wins = Number.isSafeInteger(progress && progress.wins) ? progress.wins : 0;
  const streak = Number.isSafeInteger(progress && progress.streak) ? progress.streak : 0;
  const level = Math.floor(xp / 100) + 1;
  const levelXp = xp % 100;
  document.querySelector("#progress-level").textContent = `LEVEL ${level}`;
  document.querySelector("#progress-xp-label").textContent = `${levelXp} / 100 XP`;
  document.querySelector("#progress-xp-fill").style.width = `${levelXp}%`;
  document.querySelector("#xp-progress").setAttribute("aria-valuenow", String(levelXp));
  document.querySelector("#progress-streak").textContent = `${streak} win streak`;
  document.querySelector("#streak-chip").setAttribute("aria-label", `${streak} consecutive wins. View your stats.`);
  document.querySelector("#progress-wins-label").textContent = `${wins} wins · online results`;
}

function renderTutorialStep() {
  const step = tutorialSteps[tutorialIndex];
  document.querySelector("#tutorial-step").textContent = `CARD ${tutorialIndex + 1} OF ${tutorialSteps.length}`;
  document.querySelector("#tutorial-title").textContent = step.title;
  document.querySelector("#tutorial-copy").textContent = step.copy;
  document.querySelector("#tutorial-next").innerHTML = tutorialIndex === tutorialSteps.length - 1
    ? "Let’s play! <span aria-hidden=\"true\">→</span>"
    : "Next <span aria-hidden=\"true\">→</span>";
  const progress = document.querySelector("#tutorial-progress");
  progress.setAttribute("aria-valuemax", String(tutorialSteps.length));
  progress.setAttribute("aria-valuenow", String(tutorialIndex + 1));
  document.querySelector("#tutorial-progress-fill").style.width =
    `${((tutorialIndex + 1) / tutorialSteps.length) * 100}%`;
}

function startTutorial(force = false) {
  if (!accountUser) return;
  if (!force && (tutorialShown || tutorialDismissed)) return;
  if (!force && (!accountUser.progress || accountUser.progress.tutorialCompleted)) return;
  tutorialShown = true;
  tutorialDismissed = false;
  tutorialIndex = 0;
  document.querySelector("#tutorial-status").textContent = "";
  renderTutorialStep();
  document.querySelector("#tutorial-modal").classList.remove("hidden");
  document.querySelector("#tutorial-next").focus();
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
    renderProgress();
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
  renderProgress();
  return accountUser.progress;
}

function filterMatches(history, period) {
  if (period === "all") return history;
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === "week") start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  else if (period === "month") start.setDate(1);
  return history.filter((match) => Number.isFinite(match.finishedAt) && match.finishedAt >= start.getTime());
}

function renderStats() {
  const history = accountUser && accountUser.progress && accountUser.progress.history || [];
  const matches = filterMatches(history, statsPeriod)
    .slice()
    .sort((left, right) => right.finishedAt - left.finishedAt);
  const wins = matches.filter((match) => match.result === "win").length;
  const losses = matches.filter((match) => match.result === "loss").length;
  document.querySelector("#stats-wins").textContent = String(wins);
  document.querySelector("#stats-losses").textContent = String(losses);
  document.querySelector("#stats-played").textContent = String(matches.length);
  const list = document.querySelector("#match-history");
  list.replaceChildren();
  if (!matches.length) {
    const empty = document.createElement("li");
    empty.textContent = "No online matches in this period yet.";
    list.append(empty);
  }
  for (const match of matches.slice(0, 50)) {
    const item = document.createElement("li");
    const detail = document.createElement("div");
    const title = document.createElement("strong");
    const opponents = Array.isArray(match.opponents) ? match.opponents : [];
    title.textContent = opponents.length ? `vs ${opponents.join(", ")}` : "Online match";
    const date = document.createElement("time");
    date.dateTime = new Date(match.finishedAt).toISOString();
    date.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
      .format(new Date(match.finishedAt));
    detail.append(title, date);
    const result = document.createElement("span");
    result.className = `match-result${match.result === "loss" ? " is-loss" : ""}`;
    result.textContent = match.result === "win" ? "WIN" : "LOSS";
    item.append(detail, result);
    list.append(item);
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
    renderStats();
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
    knownFriendChallengeIds = new Set();
    friendChallengesInitialized = false;
  }
  accountUser = user;
  const accountButton = document.querySelector("#account-button");
  const friendsButton = document.querySelector("#friends-button");
  const closeAccount = document.querySelector("#close-account");
  const accountModal = document.querySelector("#account-modal");
  const formPanel = document.querySelector("#account-form-panel");
  const sessionPanel = document.querySelector("#account-session-panel");
  const roomNameInput = document.querySelector("#account-username");
  renderProgress();
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
    document.querySelector("#account-current-name").textContent = user.username;
    document.querySelector("#score-note").textContent = "Your username identifies your seat and tracks your online results.";
    if (pendingInviteRoom) openPendingInvite();
    else startTutorial();
    startFriendChallengePolling();
  } else {
    stopFriendChallengePolling();
    elements.setup.classList.add("hidden");
    elements.online.classList.add("hidden");
    elements.game.classList.add("hidden");
    document.querySelector("#friends-modal").classList.add("hidden");
    document.querySelector("#stats-modal").classList.add("hidden");
    document.querySelector("#tutorial-modal").classList.add("hidden");
    accountModal.classList.remove("hidden");
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
        if (document.querySelector("#online-screen").classList.contains("hidden")) startTutorial();
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
  if (!accountUser || !pendingInviteRoom) return;
  const invitedRoom = pendingInviteRoom;
  pendingInviteRoom = null;
  openOnlineLobby("invite");
  const invitedCode = extractRoomCode(invitedRoom);
  const inviteInput = document.querySelector("#invite-link-input");
  if (/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(invitedCode)) {
    inviteInput.value = makeInviteLink(invitedCode);
    if (readSavedRoom(invitedCode)) joinOnlineRoom();
    else inviteInput.focus();
  } else {
    setOnlineStatus("That invite link isn’t valid. Check it and try again.");
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
      for (const [action, label] of [["accept", "Join"], ["decline", "Decline"]]) {
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
    const newChallenges = result.challenges.filter((challenge) => !knownFriendChallengeIds.has(challenge.id));
    if (friendChallengesInitialized && newChallenges.length) {
      const first = newChallenges[0];
      showToast(`${first.fromUsername} invited you to a duel.`);
    }
    knownFriendChallengeIds = new Set(result.challenges.map((challenge) => challenge.id));
    friendChallengesInitialized = true;
    updateFriendChallengeBadge(result.challenges);
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
  }, 12_000);
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
  if (action === "accept") {
    document.querySelector("#friends-modal").classList.add("hidden");
    openOnlineLobby("duel");
    document.querySelector("#invite-link-input").value = makeInviteLink(roomCode);
    const joined = await joinOnlineRoom(false);
    if (joined) {
      try {
        await callGameApi("/api/friends", "POST", { action: "dismiss-challenge", challengeId });
      } catch (error) {
        showToast(onlineErrorMessage(error));
      }
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

async function openLeaderboard() {
  const modal = document.querySelector("#leaderboard-modal");
  const rows = document.querySelector("#leaderboard-rows");
  const status = document.querySelector("#leaderboard-status");
  modal.classList.remove("hidden");
  rows.replaceChildren();
  status.textContent = "Loading the last four weeks…";
  try {
    const result = await callGameApi("/api/leaderboard");
    if (!result.players.length) {
      status.textContent = "No ranked matches in the last four weeks yet.";
      return;
    }
    for (const player of result.players) {
      const row = document.createElement("tr");
      for (const value of [player.rank, player.username, player.wins, player.losses, `${player.winRate}%`]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      rows.append(row);
    }
    status.textContent = `Rolling 28-day standings · Updated ${new Date(result.updatedAt).toLocaleString()}`;
  } catch (error) {
    status.textContent = onlineErrorMessage(error);
  }
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
document.querySelector("#close-account").addEventListener("click", () => {
  if (accountUser) document.querySelector("#account-modal").classList.add("hidden");
});
document.querySelector("#leaderboard-button").addEventListener("click", openLeaderboard);
document.querySelector("#close-leaderboard").addEventListener("click", () => document.querySelector("#leaderboard-modal").classList.add("hidden"));
document.querySelector("#stats-button").addEventListener("click", openStats);
document.querySelector("#streak-chip").addEventListener("click", openStats);
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
  if (!control || control.matches("#sound-toggle, .playing-card, #draw-pile, .suit-option, #rematch-button")) return;
  playSound("click");
});
document.querySelector("#sound-toggle").textContent = soundMuted ? "🔇" : "🔊";
document.querySelector("#sound-toggle").setAttribute("aria-label", soundMuted ? "Turn sounds on" : "Mute sounds");
document.querySelector("#sound-toggle").setAttribute("aria-pressed", String(soundMuted));
for (const modalId of ["account-modal", "leaderboard-modal", "friends-modal", "stats-modal"]) {
  document.querySelector(`#${modalId}`).addEventListener("click", (event) => {
    if (event.target === event.currentTarget && (modalId !== "account-modal" || accountUser)) {
      event.currentTarget.classList.add("hidden");
    }
  });
}

// Waiting for the opponent needs fresher data than your own turn, so poll less when it is yours.
function pollDelay() {
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
    if (online.roomCode === code) applyRoomSnapshot(snapshot);
  } catch (error) {
    if (error.status === 404 || error.status === 403) {
      removeStored(roomStorageKey(code));
      returnToSetup();
      setOnlineStatus("That game has expired or no longer exists. Create another game.");
    } else {
      setOnlineStatus(onlineErrorMessage(error));
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
  const previousData = online.publicData;
  const first = !online.publicData;
  const changed = first || data.version !== online.version;
  const previousChatIds = new Set((previousData?.chatMessages || []).map((message) => message.id));
  const newChatMessages = first
    ? []
    : (data.chatMessages || []).filter((message) => !previousChatIds.has(message.id));
  const incomingMessages = newChatMessages.filter((message) => message.seat !== snapshot.seat);
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
  if (incomingMessages.length && !online.chatOpen) {
    online.chatUnreadCount += incomingMessages.length;
    updateChatUnreadBadge();
    const latestMessage = incomingMessages[incomingMessages.length - 1];
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
      if (!newChatMessages.length && !data.game?.finished) {
        if (/joker|draw two|skipped|jack/i.test(data.lastMessage || "")) playSound("penalty");
        else if (/draw(?:s|ing)?|pick/i.test(data.lastMessage || "")) playSound("draw");
        else playSound("play");
      }
      online.soundVersion = data.version;
    }
  }
  if (data.game) renderOnlineGame();
  else setOnlineStatus(data.queuedForNextMatch
    ? "You joined the game and are queued for the next match."
    : online.isHost
      ? `Game ready. Share the invite with ${data.maxPlayers > 2 ? "your group" : "your friend"}.`
      : "Joined. Waiting for the host to start.");
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
          : "Your challenge is open to everyone for 1 hour. You’ll be notified here when someone joins.";
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

function renderGameChat(data) {
  const panel = document.querySelector("#game-chat");
  const messages = document.querySelector("#chat-messages");
  const previousMessageIds = new Set(
    [...messages.querySelectorAll(".chat-message")].map((message) => message.dataset.messageId),
  );
  const input = document.querySelector("#chat-input");
  const send = document.querySelector("#chat-send");
  const status = document.querySelector("#chat-status");
  const active = data.status === "playing" && !data.game.finished;
  if (!active) {
    online.chatOpen = false;
    online.chatUnreadCount = 0;
  }
  if (online.chatOpen) online.chatUnreadCount = 0;
  updateChatUnreadBadge();
  panel.classList.toggle("hidden", !active || !online.chatOpen);
  chatToggle.classList.toggle("hidden", !active);
  chatToggle.disabled = !active;
  chatToggle.setAttribute("aria-expanded", String(active && online.chatOpen));
  chatToggle.setAttribute("aria-label", online.chatOpen
    ? "Close table chat"
    : online.chatUnreadCount
      ? `Open table chat, ${online.chatUnreadCount} unread message${online.chatUnreadCount === 1 ? "" : "s"}`
      : "Open table chat");
  input.disabled = !active;
  send.disabled = !active || online.chatSending;
  status.textContent = active
    ? "Messages are automatically deleted when the game ends."
    : "The game has ended. Chat messages have been deleted.";
  messages.replaceChildren();

  const chatMessages = Array.isArray(data.chatMessages) ? data.chatMessages : [];
  if (chatMessages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = active ? "No messages yet. Say hello!" : "No messages remain.";
    messages.append(empty);
    return;
  }

  for (const chatMessage of chatMessages) {
    const row = document.createElement("div");
    row.className = `chat-message${chatMessage.seat === online.seat ? " is-own-message" : ""}`;
    row.dataset.messageId = chatMessage.id;
    if (!previousMessageIds.has(chatMessage.id)) row.classList.add("chat-message-enter");
    const meta = document.createElement("div");
    meta.className = "chat-message-meta";
    const author = document.createElement("strong");
    author.textContent = chatMessage.seat === online.seat ? "You" : chatMessage.name;
    const time = document.createElement("time");
    time.dateTime = new Date(chatMessage.sentAt).toISOString();
    time.textContent = new Date(chatMessage.sentAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const text = document.createElement("p");
    text.textContent = chatMessage.text;
    meta.append(author, time);
    row.append(meta, text);
    messages.append(row);
  }
  messages.scrollTop = messages.scrollHeight;
}

function updateChatUnreadBadge() {
  const badge = document.querySelector("#chat-unread-badge");
  if (!badge) return;
  const unread = online.chatUnreadCount;
  badge.textContent = unread > 9 ? "9+" : String(unread);
  badge.classList.toggle("hidden", unread === 0);
  chatToggle.setAttribute("aria-label", online.chatOpen
    ? "Close table chat"
    : unread
      ? `Open table chat, ${unread} unread message${unread === 1 ? "" : "s"}`
      : "Open table chat");
}

function renderOnlineGame() {
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
  renderGame();
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
  onlineRoomSize = snapshot.publicData.maxPlayers || 2;
  document.querySelector("#online-title").textContent = onlineRoomSize > 2
    ? `${onlineRoomSize}-player group`
    : "Quick duel";
  writeStored(roomStorageKey(snapshot.roomCode), JSON.stringify({ token }));
  const inviteLink = makeInviteLink(snapshot.roomCode);
  window.history.replaceState(null, "", inviteLink); // reloading this page reconnects you
  document.querySelector("#create-room-controls").classList.add("hidden");
  document.querySelector(".room-visibility").classList.add("hidden");
  document.querySelector(".public-rooms").classList.add("hidden");
  document.querySelector(".active-games").classList.add("hidden");
  document.querySelector("#online-back-button").classList.add("hidden");
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
  schedulePoll();
}

async function createOnlineRoom() {
  try {
    const isPublic = document.querySelector("#public-room-checkbox").checked;
    document.querySelector("#invite-room-note").textContent = isPublic
      ? "Your challenge stays open for 1 hour, even if you leave this screen. Stay in the waiting room to be notified when someone joins."
      : "This private game link stays open until the host ends the game or it has been inactive for 24 hours. Late arrivals wait for the next match.";
    setOnlineStatus("Creating your game…");
    const snapshot = await callGameApi("/api/rooms", "POST", {
      maxPlayers: onlineRoomSize,
      isPublic,
    });
    beginRoomSession(snapshot, snapshot.token);
    setOnlineStatus(isPublic ? "Your public challenge is live for 1 hour." : "Private game created.");
  } catch (error) {
    setOnlineStatus(onlineErrorMessage(error));
  }
}

function startQuickDuel() {
  if (!accountUser) {
    showAccountGate();
    return;
  }
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
  try {
    const saved = readSavedRoom(roomCode);
    const body = publicJoin ? { publicJoin: true } : {};
    if (saved) body.token = saved.token; // you were already in this room: just reconnect
    setOnlineStatus(saved ? "Reconnecting…" : publicJoin ? "Joining public game…" : "Joining your friend’s game…");
    const snapshot = await callGameApi(`/api/rooms/${roomCode}/join`, "POST", body);
    beginRoomSession(snapshot, snapshot.token || (saved && saved.token));
    return true;
  } catch (error) {
    if (publicJoin && error.status === 404) {
      setOnlineStatus("That game isn’t open for public play. Open games have been refreshed.");
      await refreshPublicRooms();
      schedulePublicRoomsRefresh();
      return false;
    }
    setOnlineStatus(onlineErrorMessage(error));
    return false;
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
        playSound(played && (played.rank === "2" || played.rank === "JOKER") ? "penalty" : "play");
      } else if (action.type === "draw") playSound("draw");
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
document.querySelector("#public-room-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-public-room-code]");
  if (!button) return;
  document.querySelector("#invite-link-input").value = makeInviteLink(button.dataset.publicRoomCode);
  joinOnlineRoom(true);
});
document.querySelector("#start-online-game").addEventListener("click", startOnlineGame);
document.querySelector("#chat-form").addEventListener("submit", sendChatMessage);
document.querySelector("#leave-online-room").addEventListener("click", () => {
  const challengeIsLive = online.publicData?.status === "waiting"
    && Number.isFinite(online.publicData.publicChallengeExpiresAt)
    && online.publicData.serverNow < online.publicData.publicChallengeExpiresAt;
  disconnectOnlineRoom();
  setOnlineStatus(challengeIsLive
    ? "Your public challenge stays open until its 1-hour window ends."
    : "You left this game. Open its invite link to reconnect.");
  refreshActiveRooms();
  refreshPublicRooms();
  schedulePublicRoomsRefresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && online.roomCode) refreshRoomState(); // catch up right away when the tab returns
});
document.querySelector("#copy-invite-button").addEventListener("click", () => {
  shareInviteLink(document.querySelector("#copy-invite-button"));
});
for (const button of document.querySelectorAll("[data-share-invite]")) {
  button.addEventListener("click", () => shareInviteLink(button));
}
for (const button of document.querySelectorAll("[data-copy-invite]")) {
  button.addEventListener("click", () => {
    const inviteLink = online.roomCode ? makeInviteLink(online.roomCode) : "";
    void copyTextToButton(
      inviteLink,
      button,
      "Copied!",
      "Invite link copied. Send it to your friend.",
      "Could not copy the invite link. Copy it from the address bar instead.",
    );
  });
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
  if (event.key !== "Escape") return;
  if (!elements.rulesModal.classList.contains("hidden")) closeRules();
  if (!elements.suitModal.classList.contains("hidden")) cancelSuitSelection();
  for (const modalId of ["leaderboard-modal", "friends-modal", "stats-modal"]) {
    document.querySelector(`#${modalId}`).classList.add("hidden");
  }
  if (!document.querySelector("#tutorial-modal").classList.contains("hidden")) void completeTutorial();
  if (accountUser) document.querySelector("#account-modal").classList.add("hidden");
});

renderAccountMode();
const inviteParams = new URLSearchParams(window.location.search);
pendingInviteRoom = inviteParams.get("game") || inviteParams.get("room");
loadAccount();
