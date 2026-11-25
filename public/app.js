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
  knockButton: document.querySelector("#knock-button"),
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
const online = {
  roomCode: null,
  token: null,
  seat: -1,
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
  version: 0,
  clockOffset: 0,
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
  trainingMode = options.training === true;
  for (const selector of ["#end-online-room", "#end-room-from-game", "#end-room-from-result", "#start-queued-match"]) {
    document.querySelector(selector).classList.add("hidden");
  }
  onlineMode = false;
  onlineSeat = -1;
  online.chatOpen = false;
  online.optimisticCard = null;
  elements.rematch.disabled = false;
  elements.rematch.innerHTML = 'Rematch <span aria-hidden="true">↻</span>';
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
  elements.rematchWinner.textContent = game.winner;
  document.querySelector("#rematch-status").textContent = "Last player standing wins the playoff.";
  elements.rematchModal.classList.remove("hidden");
  elements.rematch.focus();
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
  if (game.jumpSupport) return !["A", "2", "8", "J", "JOKER"].includes(card.rank);
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
    button.disabled = !isPlayable(card) || game.finished ||
      (onlineMode && (game.current !== onlineSeat || online.movePending)) ||
      (trainingMode && game.current !== 0);
    button.setAttribute("aria-label", card.rank === "JOKER" ? "Joker, draw four and change suit" : `${card.rank} of ${SUITS[card.suit].name}`);
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
  ], { duration: 420, easing: "cubic-bezier(.2, .75, .25, 1)", fill: "forwards" });
  animation.onfinish = () => flight.remove();
  animation.oncancel = () => flight.remove();
}

function renderGame() {
  if (!game) return;
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
    || (trainingMode && game.current !== 0)
    || (player.hand.length === 1 && !game.knocked?.[viewIndex] && (!onlineMode || game.current === onlineSeat));
  elements.supportAlert.classList.toggle("hidden", !game.combo && !game.jumpSupport);
  const canKnock = player.hand.length === 1 && !game.knocked?.[viewIndex] && !game.finished
    && (!trainingMode || game.current === 0);
  elements.knockButton.classList.toggle("hidden", !canKnock);
  elements.knockButton.disabled = (onlineMode && online.movePending) || (trainingMode && game.current !== 0);
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
  const hand = game.players[seat].hand;
  hand.forEach((card, index) => {
    const cardElement = createCardElement(card, { interactive: true, index });
    if (hand.length === 1 && !game.knocked?.[seat]) cardElement.disabled = true;
    const spread = hand.length > 9 ? 0 : (index - (hand.length - 1) / 2) * 1.4;
    cardElement.style.setProperty("--tilt", `${spread}deg`);
    if (!previousCards.has(card.id)) {
      cardElement.classList.add("card-deal");
      cardElement.style.animationDelay = `${Math.min(index, 8) * 24}ms`;
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
    elements.message.textContent = `${turnLabel} · Play a normal support or draw 1`;
    return;
  }
  elements.message.textContent = turnLabel;
}

function selectCard(index) {
  if (!game || game.finished) return;
  if (onlineMode && (game.current !== onlineSeat || online.movePending)) return;
  if (trainingMode && game.current !== 0) return;
  const card = game.players[game.current].hand[index];
  if (!card || !isPlayable(card) || (game.players[game.current].hand.length === 1 && !game.knocked[game.current])) return;
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
  const counteringJoker = game.pending > 0 && game.pendingType === "draw-four";
  const counteringDrawTwo = game.pending > 0 && game.pendingType === "draw-two" && card.rank === "2";
  const supportedEight = Boolean(game.combo);
  const supportedJump = game.jumpSupport;
  game.discard.push(card);
  game.freeSuitPlay = false;
  game.knocked[game.current] = false;
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
        : "Jack played. Play a normal support card or draw one.");
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
  const player = game.players[game.current];
  const prefix = timedOut ? `${player.name} ran out of time and drew` : `${player.name} draws`;
  if (game.mustDrawSeat === game.current) {
    game.combo = null;
    game.jumpSupport = false;
    takeCards(player, 1);
    game.mustDrawSeat = null;
    showToast(`${prefix} one card.`);
    advanceTurn();
    return;
  }
  if (game.pending > 0) {
    const amount = game.pending;
    takeCards(player, amount);
    game.pending = 0;
    game.pendingType = null;
    game.freeSuitPlay = false;
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
    showToast("Fundo knocked!");
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

function showToast(message) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
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
document.querySelector("#one-v-one-button").addEventListener("click", () => openOnlineLobby("duel"));
document.querySelector("#training-game-button").addEventListener("click", startTrainingGame);
document.querySelector("#group-game-button").addEventListener("click", () => {
  document.querySelector("#group-game-options").classList.remove("hidden");
  document.querySelector("#group-game-button").classList.add("active");
  document.querySelector("#one-v-one-button").classList.remove("active");
  document.querySelector("#training-game-button").classList.remove("active");
});
elements.drawPile.addEventListener("click", () => {
  drawCard();
});
elements.knockButton.addEventListener("click", () => {
  if (!game || game.finished) return;
  if (onlineMode) {
    submitOnlineMove({ type: "knock" });
    return;
  }
  const seat = game.current;
  if (game.players[seat].hand.length !== 1 || game.knocked[seat]) return;
  game.knocked[seat] = true;
  showToast(`${game.players[seat].name} knocked!`);
  renderGame();
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
  hideModal(elements.suitModal);
  hideModal(elements.rematchModal);
  elements.game.classList.add("hidden");
  elements.online.classList.add("hidden");
  elements.setup.classList.remove("hidden");
  document.querySelector("#group-game-options").classList.add("hidden");
  document.querySelector("#group-game-button").classList.remove("active");
  document.querySelector("#one-v-one-button").classList.remove("active");
  document.querySelector("#training-game-button").classList.remove("active");
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
  document.querySelector("#mode-label").textContent = onlineRoomSize > 2 ? "Group quest" : "Quick duel";
  document.querySelector("#online-title").textContent = onlineRoomSize > 2 ? `${onlineRoomSize}-player group` : "Quick duel";
  document.querySelector("#online-subtitle").textContent = onlineRoomSize > 2
    ? `Create a game for ${onlineRoomSize} players, then invite your crew.`
    : "Create a table and send your friend a link.";
  document.querySelector("#create-room-button").innerHTML = `Create ${onlineRoomSize === 2 ? "duel" : `${onlineRoomSize}-player game`} <span aria-hidden="true">→</span>`;
  refreshPublicRooms();
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
    await refreshPublicRooms();
    schedulePublicRoomsRefresh();
  }, 6000);
}

function renderPublicRooms(rooms) {
  const list = document.querySelector("#public-room-list");
  list.replaceChildren();
  if (rooms.length === 0) {
    const empty = document.createElement("p");
    empty.className = "public-room-empty";
    empty.textContent = "No open games.";
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

function updateRoomShareLinks(roomCode) {
  const inviteLink = makeInviteLink(roomCode);
  const message = `Join my Bakasha game: ${inviteLink}`;
  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(message)}`;
  document.querySelector("#lobby-whatsapp-invite").href = whatsappLink;
  document.querySelector("#game-whatsapp-invite").href = whatsappLink;
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
    publicData: null,
    ownHand: null,
    isHost: false,
    movePending: false,
    pendingAction: null,
    optimisticCard: null,
    timeoutSentAt: null,
    version: 0,
    clockOffset: 0,
  });
  document.querySelector("#room-wait-panel").classList.add("hidden");
  document.querySelector("#invite-result").classList.add("hidden");
  document.querySelector("#create-room-controls").classList.remove("hidden");
  document.querySelector(".room-visibility").classList.remove("hidden");
  document.querySelector(".public-rooms").classList.remove("hidden");
  document.querySelector("#join-room-panel").classList.remove("hidden");
  document.querySelector("#copy-invite-button").textContent = "Copy invite link";
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

function updateAccountUI(user) {
  const previousUser = accountUser;
  accountUser = user;
  const accountButton = document.querySelector("#account-button");
  const friendsButton = document.querySelector("#friends-button");
  const closeAccount = document.querySelector("#close-account");
  const accountModal = document.querySelector("#account-modal");
  const formPanel = document.querySelector("#account-form-panel");
  const sessionPanel = document.querySelector("#account-session-panel");
  const roomNameInput = document.querySelector("#account-username");
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
  } else {
    elements.setup.classList.add("hidden");
    elements.online.classList.add("hidden");
    elements.game.classList.add("hidden");
    document.querySelector("#friends-modal").classList.add("hidden");
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
    empty.textContent = section === "friends" ? "No friends yet." : "No pending requests.";
    container.append(empty);
    return;
  }

  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "friend-row";
    const name = document.createElement("strong");
    name.textContent = entry.username;
    row.append(name);

    if (section === "friends") {
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "friend-action";
      remove.dataset.friendAction = "remove";
      remove.dataset.friendUsername = entry.username;
      remove.textContent = "Remove";
      row.append(remove);
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

async function loadFriends() {
  const status = document.querySelector("#friends-status");
  status.textContent = "Loading friends…";
  try {
    const result = await callGameApi("/api/friends");
    for (const key of ["friends", "incoming", "outgoing"]) {
      if (!Array.isArray(result[key])) throw new Error("The server returned an invalid friends list.");
    }
    renderFriendEntries(document.querySelector("#friend-list"), result.friends, "friends");
    renderFriendEntries(document.querySelector("#friend-incoming"), result.incoming, "incoming");
    renderFriendEntries(document.querySelector("#friend-outgoing"), result.outgoing, "outgoing");
    status.textContent = "";
  } catch (error) {
    status.textContent = onlineErrorMessage(error);
  }
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
  const button = event.target.closest("[data-friend-action]");
  if (button) updateFriendRequest(button.dataset.friendAction, button.dataset.friendUsername);
});
document.querySelector("#close-account").addEventListener("click", () => {
  if (accountUser) document.querySelector("#account-modal").classList.add("hidden");
});
document.querySelector("#leaderboard-button").addEventListener("click", openLeaderboard);
document.querySelector("#close-leaderboard").addEventListener("click", () => document.querySelector("#leaderboard-modal").classList.add("hidden"));
for (const modalId of ["account-modal", "leaderboard-modal", "friends-modal"]) {
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
  online.clockOffset = data.serverNow - Date.now();
  online.version = data.version;
  online.publicData = data;
  online.ownHand = Array.isArray(snapshot.ownHand) ? snapshot.ownHand : [];
  online.seat = snapshot.seat;
  online.isHost = snapshot.seat === 0;
  updateRoomLobby(data);
  if (!changed) return;
  if (!first && data.lastMessage && data.lastMessage !== previousData.lastMessage) showToast(data.lastMessage);
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
    message.textContent = online.isHost
      ? isFull
        ? waitingNext.length
          ? `This match is ready. ${waitingNext.length} more player${waitingNext.length === 1 ? "" : "s"} queued for the next match.`
          : "Everyone is here! Start when you’re ready."
        : `Waiting for ${maxPlayers - data.players.length} more player${maxPlayers - data.players.length === 1 ? "" : "s"}…`
      : `Connected to ${data.players[0].name}’s game. Waiting for the host to start.`;
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
  if (!active) online.chatOpen = false;
  panel.classList.toggle("hidden", !active || !online.chatOpen);
  chatToggle.classList.toggle("hidden", !active);
  chatToggle.disabled = !active;
  chatToggle.setAttribute("aria-expanded", String(active && online.chatOpen));
  chatToggle.setAttribute("aria-label", online.chatOpen ? "Close table chat" : "Open table chat");
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
    elements.rematchWinner.textContent = game.winner;
    elements.rematchModal.classList.remove("hidden");
    elements.rematch.focus();
  } else if (!game.finished) {
    hideModal(elements.rematchModal);
  }
  if (game.finished) updateRematchControls(data);
  else {
    elements.rematch.disabled = false;
    elements.rematch.innerHTML = 'Rematch <span aria-hidden="true">↻</span>';
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
    button.textContent = "Rematch requested";
    button.disabled = true;
    const waitingOn = data.players
      .filter((_, index) => index !== online.seat && !requests[index])
      .map((player) => player.name);
    message.textContent = waitingOn.length
      ? `Waiting for ${waitingOn.join(", ")} to accept.`
      : "Waiting for everyone to accept.";
  } else if (requests.some(Boolean)) {
    button.textContent = "Accept rematch";
    button.disabled = false;
    const requestedBy = data.players
      .filter((_, index) => requests[index])
      .map((player) => player.name);
    message.textContent = `${requestedBy.join(", ")} want${requestedBy.length === 1 ? "s" : ""} a rematch.`;
  } else {
    button.textContent = "Rematch";
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
  updateRoomShareLinks(snapshot.roomCode);
  document.querySelector("#create-room-controls").classList.add("hidden");
  document.querySelector(".room-visibility").classList.add("hidden");
  document.querySelector(".public-rooms").classList.add("hidden");
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
      ? "Public games are listed while seats are open. Late arrivals wait for the next match."
      : "This private game link stays open until the host ends the game or it has been inactive for 24 hours. Late arrivals wait for the next match.";
    setOnlineStatus("Creating your game…");
    const snapshot = await callGameApi("/api/rooms", "POST", {
      maxPlayers: onlineRoomSize,
      isPublic,
    });
    beginRoomSession(snapshot, snapshot.token);
    setOnlineStatus(isPublic ? "Public game created." : "Private game created.");
  } catch (error) {
    setOnlineStatus(onlineErrorMessage(error));
  }
}

async function joinOnlineRoom(publicJoin = false) {
  const inviteInput = document.querySelector("#invite-link-input");
  const roomCode = extractInviteRoomCode(inviteInput.value);
  if (!roomCode) {
    setOnlineStatus("Paste your friend’s invite link first.");
    inviteInput.focus();
    return;
  }
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(roomCode)) {
    setOnlineStatus("That invite link isn’t valid. Check it and try again.");
    inviteInput.focus();
    return;
  }
  try {
    const saved = readSavedRoom(roomCode);
    const body = publicJoin ? { publicJoin: true } : {};
    if (saved) body.token = saved.token; // you were already in this room: just reconnect
    setOnlineStatus(saved ? "Reconnecting…" : publicJoin ? "Joining public game…" : "Joining your friend’s game…");
    const snapshot = await callGameApi(`/api/rooms/${roomCode}/join`, "POST", body);
    beginRoomSession(snapshot, snapshot.token || (saved && saved.token));
  } catch (error) {
    if (publicJoin && error.status === 404) {
      setOnlineStatus("That game isn’t open for public play. Open games have been refreshed.");
      await refreshPublicRooms();
      schedulePublicRoomsRefresh();
      return;
    }
    setOnlineStatus(onlineErrorMessage(error));
  }
}

async function startOnlineGame() {
  if (!online.roomCode || !online.isHost) return;
  try {
    applyRoomSnapshot(await callGameApi(`/api/rooms/${online.roomCode}/start`, "POST", {}));
  } catch (error) {
    if (onlineMode) showToast(onlineErrorMessage(error));
    else setOnlineStatus(onlineErrorMessage(error));
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
document.querySelector("#join-room-button").addEventListener("click", joinOnlineRoom);
document.querySelector("#end-online-room").addEventListener("click", endOnlineRoom);
document.querySelector("#end-room-from-game").addEventListener("click", endOnlineRoom);
document.querySelector("#end-room-from-result").addEventListener("click", endOnlineRoom);
document.querySelector("#start-queued-match").addEventListener("click", startQueuedMatch);
document.querySelector("#refresh-public-rooms").addEventListener("click", refreshPublicRooms);
document.querySelector("#public-room-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-public-room-code]");
  if (!button) return;
  document.querySelector("#invite-link-input").value = makeInviteLink(button.dataset.publicRoomCode);
  joinOnlineRoom(true);
});
document.querySelector("#start-online-game").addEventListener("click", startOnlineGame);
document.querySelector("#chat-form").addEventListener("submit", sendChatMessage);
document.querySelector("#leave-online-room").addEventListener("click", () => {
  disconnectOnlineRoom();
  setOnlineStatus("You left this game. Open its invite link to reconnect.");
  refreshPublicRooms();
  schedulePublicRoomsRefresh();
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && online.roomCode) refreshRoomState(); // catch up right away when the tab returns
});
document.querySelector("#copy-invite-button").addEventListener("click", () => {
  const inviteLink = online.roomCode ? makeInviteLink(online.roomCode) : "";
  copyTextToButton(inviteLink, document.querySelector("#copy-invite-button"), "✓ Copied!", "Invite link copied.", "Could not copy the invite link. Select and copy it manually.");
});
document.querySelector("#mode-label").textContent = "Choose game";
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
  for (const modalId of ["leaderboard-modal", "friends-modal"]) {
    document.querySelector(`#${modalId}`).classList.add("hidden");
  }
  if (accountUser) document.querySelector("#account-modal").classList.add("hidden");
});

renderAccountMode();
const inviteParams = new URLSearchParams(window.location.search);
pendingInviteRoom = inviteParams.get("game") || inviteParams.get("room");
loadAccount();
