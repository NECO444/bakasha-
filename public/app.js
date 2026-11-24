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
  playerFields: document.querySelector("#player-fields"),
  start: document.querySelector("#start-button"),
  opponents: document.querySelector("#opponents"),
  hand: document.querySelector("#hand"),
  discard: document.querySelector("#discard-pile"),
  drawPile: document.querySelector("#draw-pile"),
  pileCount: document.querySelector("#pile-count"),
  message: document.querySelector("#turn-message"),
  hint: document.querySelector("#game-hint"),
  activeSuit: document.querySelector("#active-suit"),
  suitTitle: document.querySelector("#suit-title"),
  suitDescription: document.querySelector("#suit-description"),
  agreeSuit: document.querySelector("#agree-suit"),
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

let selectedCount = 4;
let game = null;
let toastTimer = null;
let turnTimer = null;
let onlineMode = false;
let onlineSeat = -1;
let accountUser = null;
let accountMode = "login";
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
  chatSending: false,
  timeoutSentAt: null,
  version: 0,
  clockOffset: 0,
};

function renderPlayerFields() {
  elements.playerFields.replaceChildren();
  for (let index = 0; index < selectedCount; index += 1) {
    const wrapper = document.createElement("label");
    wrapper.className = "player-field";
    const number = document.createElement("span");
    number.className = "player-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 16;
    input.autocomplete = "off";
    input.placeholder = `Player ${index + 1}`;
    input.setAttribute("aria-label", `Name for player ${index + 1}`);
    wrapper.append(number, input);
    elements.playerFields.append(wrapper);
  }
}

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
  const names = [...elements.playerFields.querySelectorAll("input")].map((input, index) => {
    const value = input.value.trim().replace(/\s+/g, " ");
    return value || `Player ${index + 1}`;
  });
  dealGame(names);
}

function dealGame(names) {
  onlineMode = false;
  onlineSeat = -1;
  document.querySelector("#mode-label").textContent = "Local game";
  document.querySelector("#round-mode-label").textContent = "PASS & PLAY";
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
    pending: 0,
    pendingType: null,
    combo: null,
    freeSuitPlay: false,
    jokerReduced: false,
    turns: 1,
    finished: false,
    stagedCardIndex: null,
    timeLeft: 60,
    turnDeadline: 0,
  };
  elements.setup.classList.add("hidden");
  elements.game.classList.remove("hidden");
  document.querySelector("#game-chat").classList.add("hidden");
  document.querySelector("#round-player-count").textContent = `${players.length} PLAYERS`;
  renderGame();
  startTurnTimer();
}

function topCard() {
  return game.discard[game.discard.length - 1];
}

function isPlayable(card) {
  if (game.pending > 0) {
    return game.pendingType === "draw-two"
      ? card.rank === "2"
      : card.rank === "JOKER" || card.rank === "2";
  }
  if (game.combo) {
    if (card.rank === "J") return card.suit === game.combo.lastCard.suit || game.combo.lastCard.rank === "J";
    if (card.rank === "8") return card.suit === game.combo.lastCard.suit || card.rank === game.combo.lastCard.rank;
    return card.suit === game.combo.lastCard.suit;
  }
  if (game.freeSuitPlay) return true;
  if (card.rank === "A") return card.suit === game.activeSuit || topCard().rank === "A";
  if (card.rank === "J") return card.suit === game.activeSuit || topCard().rank === "J";
  return card.rank === "JOKER" || card.suit === game.activeSuit || card.rank === topCard().rank;
}

function getCardColor(suit) {
  return { hearts: "red", spades: "blue", diamonds: "yellow", clubs: "green", wild: "wild" }[suit];
}

function createCardElement(card, options) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = options.interactive ? "playing-card" : "playing-card";
  button.dataset.suit = card.suit;
  if (options.interactive) {
    button.disabled = !isPlayable(card) || game.finished ||
      (onlineMode && (game.current !== onlineSeat || online.movePending));
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

function renderGame() {
  if (!game) return;
  const viewIndex = onlineMode ? onlineSeat : game.current;
  const player = game.players[viewIndex];
  elements.currentName.textContent = player.name;
  elements.currentCaption.textContent = onlineMode && game.current === onlineSeat ? "YOUR TURN" : "YOUR HAND";
  elements.avatar.textContent = player.name.trim().charAt(0).toUpperCase();
  elements.avatar.style.color = PLAYER_COLORS[viewIndex % PLAYER_COLORS.length];
  elements.handCount.textContent = `${player.hand.length} ${player.hand.length === 1 ? "card" : "cards"}`;
  elements.turnNumber.textContent = `TURN ${game.turns}`;
  elements.timer.classList.toggle("timer-warning", game.timeLeft <= 10 && !game.finished);
  elements.clock.textContent = game.finished ? "—" : String(game.timeLeft);
  elements.timer.setAttribute("aria-label", game.finished ? "Game over" : `${game.timeLeft} seconds remaining`);
  elements.pileCount.textContent = `${game.deckCount === undefined ? game.deck.length : game.deckCount} LEFT`;
  elements.drawPile.setAttribute("aria-label", game.pending > 0 ? `Draw ${game.pending} penalty cards` : "Draw a card");
  elements.drawPile.disabled = onlineMode && (game.current !== onlineSeat || online.movePending);
  elements.turnIndicator.querySelector("span").textContent = game.direction === 1 ? "↻" : "↺";
  elements.discard.replaceChildren(createCardElement(topCard(), { interactive: false }));
  const jokerSuitPending = game.pendingType === "draw-four" && !game.jokerReduced;
  if (game.freeSuitPlay || jokerSuitPending || game.activeSuit === "wild") {
    elements.activeSuit.classList.add("hidden");
  } else {
    elements.activeSuit.classList.remove("hidden");
    elements.activeSuit.textContent = SUITS[game.activeSuit].symbol;
    elements.activeSuit.style.color = getCardColor(game.activeSuit) === "red" || getCardColor(game.activeSuit) === "yellow" ? "#f0c95e" : getCardColor(game.activeSuit) === "blue" ? "#70a9f6" : "#6bcf9d";
  }
  renderOpponents();
  renderHand();
  updateMessage();
}

function renderOpponents() {
  elements.opponents.replaceChildren();
  game.players.forEach((player, index) => {
    if (index === (onlineMode ? onlineSeat : game.current)) return;
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
    count.textContent = `${player.hand.length} ${player.hand.length === 1 ? "card" : "cards"}`;
    opponent.append(name, cardRow, count);
    elements.opponents.append(opponent);
  });
}

function renderHand() {
  elements.hand.replaceChildren();
  const hand = game.players[onlineMode ? onlineSeat : game.current].hand;
  hand.forEach((card, index) => {
    const cardElement = createCardElement(card, { interactive: true, index });
    const spread = hand.length > 9 ? 0 : (index - (hand.length - 1) / 2) * 1.4;
    cardElement.style.setProperty("--tilt", `${spread}deg`);
    elements.hand.append(cardElement);
  });
}

function updateMessage() {
  const player = game.players[game.current];
  if (game.finished) {
    elements.message.textContent = `${game.winner} wins!`;
    elements.hint.textContent = "A lovely hand. Ready for another round?";
    elements.handHelp.textContent = "Start a new game to deal again";
    return;
  }
  if (onlineMode && game.current !== onlineSeat) {
    elements.message.textContent = `${player.name}’s turn`;
    elements.hint.textContent = "Waiting for your friend to play.";
    elements.handHelp.textContent = `Waiting for ${player.name} to play`;
    return;
  }
  if (game.pending > 0) {
    const count = game.pending;
    elements.message.textContent = game.pendingType === "draw-four"
      ? `${player.name}, draw ${count}, reduce it with a 2, or cancel it with a Joker.`
      : `${player.name}, draw ${count} or cancel the penalty with a 2.`;
    elements.hint.textContent = game.pendingType === "draw-four"
      ? game.jokerReduced
        ? "Each 2 cancels two cards. If you draw the remainder, the next play follows the last 2’s suit."
        : "Each 2 cancels two cards; a Joker cancels the remainder. Drawing all 4 lets the next player play any suit."
      : "Play a 2 to cancel the penalty—or take the cards.";
    elements.handHelp.textContent = game.pendingType === "draw-four"
      ? "Play a 2 to reduce the draw, or a Joker to cancel it"
      : "Play a 2 to cancel the penalty or draw 2";
    return;
  }
  if (game.freeSuitPlay) {
    elements.message.textContent = `${player.name}, play any suit.`;
    elements.hint.textContent = "The Joker penalty was resolved. Your card sets the next suit.";
    elements.handHelp.textContent = "Any card can be played this turn";
    return;
  }
  if (game.combo) {
    const count = game.combo.eightCount;
    const countLabel = count === 0 ? "No 8s" : `${count} ${count === 1 ? "eight" : "eights"}`;
    const direction = count % 2 === 1 ? "will reverse" : "will keep";
    const jackRule = game.players.length > 2
      ? "A Jack ends the chain and skips the next player. "
      : "A Jack still needs support. ";
    elements.message.textContent = `${player.name}, ${countLabel} in the chain.`;
    elements.hint.textContent = `${direction} direction when the chain ends. ${jackRule}Chain an 8 by suit or rank, a Jack by suit (or another Jack after a Jack), add same-suit support (a 2 passes its penalty on), or draw one.`;
    elements.handHelp.textContent = game.players.length > 2
      ? "Support matches the last suit; a Jack skips the next player"
      : "Support must match the last suit and cannot be a Jack";
    return;
  }
  elements.message.textContent = `${player.name}’s turn`;
  const playable = player.hand.some((card) => card && isPlayable(card));
  elements.hint.textContent = playable ? "Match the suit or number. A wild card can change everything." : "No match in hand? Draw a card to keep things moving.";
  elements.handHelp.innerHTML = playable ? "Tap a card to play it <span>·</span> Draw if you’re stuck" : "No playable cards <span>·</span> Tap the deck to draw";
}

function selectCard(index) {
  if (!game || game.finished) return;
  if (onlineMode && (game.current !== onlineSeat || online.movePending)) return;
  const card = game.players[game.current].hand[index];
  if (!card || !isPlayable(card)) return;
  if (card.rank === "A") {
    game.stagedCardIndex = index;
    const aceOnAce = card.rank === "A" && topCard().rank === "A";
    elements.suitTitle.textContent = aceOnAce ? "Agree or object?" : "Pick the next suit";
    elements.suitDescription.textContent = aceOnAce
      ? `Keep ${SUITS[game.activeSuit].name} as the active suit, or choose another suit.`
      : "Which suit should everyone play next?";
    elements.agreeSuit.classList.toggle("hidden", !aceOnAce);
    for (const option of elements.suitModal.querySelectorAll(".suit-option")) {
      option.disabled = aceOnAce && option.dataset.suit === game.activeSuit;
    }
    elements.suitModal.classList.remove("hidden");
    if (aceOnAce) {
      elements.agreeSuit.textContent = `Agree — keep ${SUITS[game.activeSuit].name} ${SUITS[game.activeSuit].symbol}`;
      elements.agreeSuit.focus();
    } else {
      const firstOption = elements.suitModal.querySelector(".suit-option");
      if (firstOption) firstOption.focus();
    }
    return;
  }
  if (onlineMode) {
    submitOnlineMove({ type: "play", cardId: card.id });
    return;
  }
  playLocalTurnCard(index);
}

function playCard(index, chosenSuit, aceAgreed) {
  const player = game.players[game.current];
  const [card] = player.hand.splice(index, 1);
  if (!card) return;
  const counteringJoker = game.pending > 0 && game.pendingType === "draw-four";
  const counteringDrawTwo = game.pending > 0 && game.pendingType === "draw-two" && card.rank === "2";
  game.discard.push(card);
  game.freeSuitPlay = false;
  if (chosenSuit) game.activeSuit = chosenSuit;
  else if (card.rank !== "JOKER") game.activeSuit = card.suit;

  if (player.hand.length === 0) {
    game.finished = true;
    game.winner = player.name;
    window.clearInterval(turnTimer);
    turnTimer = null;
    renderGame();
    elements.rematchWinner.textContent = player.name;
    elements.rematchModal.classList.remove("hidden");
    elements.rematch.focus();
    return;
  }

  if (counteringJoker && card.rank === "2") {
    game.pending = Math.max(0, game.pending - 2);
    game.jokerReduced = true;
    if (game.pending === 0) {
      game.pendingType = null;
      game.jokerReduced = false;
      showToast(`${player.name} canceled the Joker penalty with 2s.`);
      advanceTurn();
      return;
    }
    showToast(`${player.name} reduced the penalty. Draw ${game.pending} or counter more.`);
    renderGame();
    return;
  }
  if (counteringJoker && card.rank === "JOKER") {
    game.pending = 0;
    game.pendingType = null;
    game.jokerReduced = false;
    game.freeSuitPlay = true;
    showToast(`${player.name} canceled the Joker penalty.`);
    advanceTurn();
    return;
  }
  if (counteringDrawTwo) {
    game.pending = 0;
    game.pendingType = null;
    game.jokerReduced = false;
    showToast(`${player.name} canceled the 2-card penalty.`);
    advanceTurn();
    return;
  }

  if (game.combo && (card.rank === "8" || card.rank === "J")) {
    game.combo.lastCard = card;
    if (card.rank === "8") game.combo.eightCount += 1;
    if (card.rank === "J" && game.players.length > 2) {
      const combo = game.combo;
      game.combo = null;
      showToast("Jack played. The next player is skipped.");
      finishComboTurn(combo, true);
      return;
    }
    showToast(`${card.rank === "8" ? "8" : "Jack"} added. Play another 8/Jack or the support card.`);
    renderGame();
    return;
  }
  if (game.combo) {
    const combo = game.combo;
    game.combo = null;
    if (card.rank === "2") {
      game.pending += 2;
      game.pendingType = "draw-two";
      showToast("The 2-card penalty is on the table.");
    } else {
      showToast("Support added. Turn passed.");
    }
    finishComboTurn(combo);
    return;
  }
  if (card.rank === "8" || card.rank === "J") {
    game.combo = {
      lastCard: card,
      eightCount: card.rank === "8" ? 1 : 0,
    };
    if (card.rank === "J" && game.players.length > 2) {
      const combo = game.combo;
      game.combo = null;
      showToast("Jack played. The next player is skipped.");
      finishComboTurn(combo, true);
      return;
    }
    showToast(`${card.rank === "8" ? "8" : "Jack"} played. Add a matching support card or draw one.`);
    renderGame();
    return;
  }

  if (card.rank === "2") {
    game.pending += 2;
    game.pendingType = "draw-two";
    showToast("Draw two is on the table.");
    advanceTurn();
  } else if (card.rank === "JOKER") {
    game.pending += 4;
    game.pendingType = "draw-four";
    game.jokerReduced = false;
    showToast(game.pending === 4 ? "Joker! Draw four is on the table." : `Penalty stacked: ${game.pending} cards.`);
    advanceTurn();
  } else if (card.rank === "K") {
    game.direction *= -1;
    showToast("The turn order reversed!");
    advanceTurn();
  } else if (card.rank === "7") {
    showToast(`${game.players[nextPlayerIndex(1)].name} is skipped.`);
    advanceTurn(2);
  } else {
    if (card.rank === "A") {
      showToast(aceAgreed ? `${SUITS[game.activeSuit].name} stays active.` : `Next suit: ${SUITS[chosenSuit].name}.`);
    }
    advanceTurn();
  }
}

function playLocalTurnCard(index, chosenSuit, aceAgreed) {
  playCard(index, chosenSuit, aceAgreed);
}

function finishComboTurn(combo, skipNext) {
  if (combo.eightCount % 2 === 1) {
    game.direction *= -1;
    if (skipNext) showToast("The direction reversed; the next player is skipped.");
    else showToast("The direction reversed.");
  }
  if (skipNext) {
    advanceTurn(2);
    return;
  }
  advanceTurn();
}

function nextPlayerIndex(steps) {
  const count = game.players.length;
  return (game.current + game.direction * steps % count + count) % count;
}

function advanceTurn(steps) {
  game.current = nextPlayerIndex(steps || 1);
  game.turns += 1;
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
}

function drawCard() {
  if (!game || game.finished) return;
  if (onlineMode) {
    if (game.current === onlineSeat) submitOnlineMove({ type: "draw" });
    return;
  }
  const player = game.players[game.current];
  if (game.pending > 0) {
    const amount = game.pending;
    const resolvedJoker = game.pendingType === "draw-four";
    takeCards(player, amount);
    game.pending = 0;
    game.pendingType = null;
    game.freeSuitPlay = resolvedJoker && !game.jokerReduced;
    game.jokerReduced = false;
    showToast(`${player.name} draws ${amount}.`);
    advanceTurn();
    return;
  }
  if (game.combo) {
    const combo = game.combo;
    game.combo = null;
    takeCards(player, 1);
    showToast(`${player.name} draws one card. Turn passed.`);
    finishComboTurn(combo);
    return;
  }
  game.freeSuitPlay = false;
  takeCards(player, 1);
  if (player.hand.length > 0) {
    const drawn = player.hand[player.hand.length - 1];
    showToast(isPlayable(drawn) ? `${player.name} drew a card. You can play it next turn.` : `${player.name} drew a card.`);
  }
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
  const player = game.players[game.current];
  if (game.pending > 0) {
    const amount = game.pending;
    const resolvedJoker = game.pendingType === "draw-four";
    takeCards(player, amount);
    game.pending = 0;
    game.pendingType = null;
    game.freeSuitPlay = resolvedJoker && !game.jokerReduced;
    game.jokerReduced = false;
    showToast(`${player.name} ran out of time and drew ${amount}.`);
    advanceTurn();
    return;
  }
  if (game.freeSuitPlay) {
    game.freeSuitPlay = false;
    takeCards(player, 1);
    showToast(`${player.name} ran out of time and drew a card.`);
    advanceTurn();
    return;
  }
  if (game.combo) {
    const combo = game.combo;
    game.combo = null;
    takeCards(player, 1);
    showToast(`${player.name} ran out of time and drew one card.`);
    finishComboTurn(combo);
    return;
  }
  takeCards(player, 1);
  showToast(`${player.name} ran out of time and drew a card.`);
  advanceTurn();
}

function hideModal(element) {
  element.classList.add("hidden");
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
  document.querySelector("#rules-button").focus();
}

document.querySelector("#count-picker").addEventListener("click", (event) => {
  const button = event.target.closest("[data-count]");
  if (!button) return;
  selectedCount = Number(button.dataset.count);
  for (const item of document.querySelectorAll(".count-button")) item.classList.toggle("active", item === button);
  renderPlayerFields();
});
elements.start.addEventListener("click", startGame);
elements.drawPile.addEventListener("click", () => {
  drawCard();
});
elements.rematch.addEventListener("click", () => {
  if (!game) return;
  if (onlineMode) {
    if (online.isHost) startOnlineGame();
    else showToast("Ask the room creator to start the rematch.");
    return;
  }
  const names = game.players.map((player) => player.name);
  dealGame(names);
});
elements.agreeSuit.addEventListener("click", () => {
  if (!game || game.stagedCardIndex === null) return;
  const index = game.stagedCardIndex;
  game.stagedCardIndex = null;
  hideModal(elements.suitModal);
  if (onlineMode) {
    submitOnlineMove({
      type: "play",
      cardId: game.players[game.current].hand[index].id,
      chosenSuit: game.activeSuit,
      aceAgreed: true,
    });
    return;
  }
  playLocalTurnCard(index, game.activeSuit, true);
});
function returnToSetup() {
  window.clearInterval(turnTimer);
  turnTimer = null;
  disconnectOnlineRoom();
  onlineMode = false;
  onlineSeat = -1;
  document.querySelector("#mode-label").textContent = "Online play";
  document.querySelector("#round-mode-label").textContent = "ONLINE GAME";
  game = null;
  hideModal(elements.suitModal);
  hideModal(elements.rematchModal);
  elements.game.classList.add("hidden");
  elements.setup.classList.add("hidden");
  elements.online.classList.remove("hidden");
}
document.querySelector("#back-button").addEventListener("click", returnToSetup);
document.querySelector("#new-table-button").addEventListener("click", returnToSetup);

// ---------- Online play (Vercel API) ----------
const NAME_KEY = "bakasha:name";
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

function openOnlineLobby() {
  elements.setup.classList.add("hidden");
  elements.online.classList.remove("hidden");
  const input = document.querySelector("#account-username");
  if (!input.value) input.value = readStored(NAME_KEY) || "";
  if (!input.value) input.focus();
}

function setOnlineStatus(message) {
  document.querySelector("#online-status").textContent = message;
}

function onlineErrorMessage(error) {
  return (error && error.message) || "Online play could not connect. Check your connection and try again.";
}

function playerName() {
  const name = document.querySelector("#account-username").value.trim().replace(/\s+/g, " ");
  if (!name || name.length > 16) throw new Error("Choose a name between 1 and 16 characters.");
  writeStored(NAME_KEY, name);
  return name;
}

function extractRoomCode(value) {
  const input = value.trim();
  if (!input) return "";
  if (input.includes("://") || input.startsWith("file:")) {
    try {
      const codeFromLink = new URL(input).searchParams.get("room");
      if (codeFromLink) return codeFromLink.trim().toUpperCase();
    } catch (error) {
      return "";
    }
  }
  return input.toUpperCase().replace(/[\s-]/g, "");
}

function makeInviteLink(roomCode) {
  const invite = new URL(window.location.href);
  invite.search = "";
  invite.hash = "";
  invite.searchParams.set("room", roomCode);
  return invite.href;
}

function updateRoomShareLinks(roomCode) {
  const inviteLink = makeInviteLink(roomCode);
  const message = `Join my Bakasha game: ${inviteLink} (Room code: ${roomCode})`;
  const whatsappLink = `https://wa.me/?text=${encodeURIComponent(message)}`;
  document.querySelector("#lobby-whatsapp-invite").href = whatsappLink;
  document.querySelector("#lobby-room-whatsapp").href = whatsappLink;
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
    announceCopyStatus("Create a room before copying an invite.");
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
    timeoutSentAt: null,
    version: 0,
    clockOffset: 0,
  });
  document.querySelector("#room-wait-panel").classList.add("hidden");
  document.querySelector("#invite-result").classList.add("hidden");
}

async function callGameApi(path, method, body, token) {
  const headers = {};
  const authToken = token || online.token;
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  const options = { method: method || "GET", headers, cache: "no-store" };
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
  document.querySelector("#account-title").textContent = signedIn ? "Your account" : registering ? "Create account" : "Sign in";
  document.querySelector("#account-description").textContent = signedIn
    ? "Your public leaderboard name and match history."
    : registering
      ? "Choose a unique username and password. There is no email or password recovery."
      : "Use your Bakasha username and password. No Vercel account or email is needed.";
  document.querySelector("#account-submit").textContent = registering ? "Create account" : "Sign in";
  document.querySelector("#account-mode-toggle").textContent = registering ? "Already have an account? Sign in" : "Create an account";
  document.querySelector("#account-mode-toggle").classList.toggle("hidden", signedIn);
  document.querySelector("#auth-password").autocomplete = registering ? "new-password" : "current-password";
}

function updateAccountUI(user) {
  const previousUser = accountUser;
  accountUser = user;
  const accountButton = document.querySelector("#account-button");
  const formPanel = document.querySelector("#account-form-panel");
  const sessionPanel = document.querySelector("#account-session-panel");
  const roomNameInput = document.querySelector("#account-username");
  accountButton.textContent = user ? user.username : "Sign in";
  accountButton.title = user ? `Signed in as ${user.username}` : "Sign in or create an account";
  formPanel.classList.toggle("hidden", Boolean(user));
  sessionPanel.classList.toggle("hidden", !user);
  roomNameInput.disabled = Boolean(user);
  if (user) {
    roomNameInput.value = user.username;
    document.querySelector("#account-current-name").textContent = user.username;
    document.querySelector("#score-note").textContent = "Signed in. Your opponent must also sign in before the game starts for it to count.";
  } else {
    document.querySelector("#score-note").textContent = "Guests can play. Sign in before the game starts; both players must be signed in for a match to count.";
    if (previousUser) roomNameInput.value = readStored(NAME_KEY) || "";
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
    updateAccountUI(null);
    renderAccountMode();
    setAccountStatus("You are signed out. You can still play as a guest.");
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
  } catch (error) {
    setAccountStatus(onlineErrorMessage(error));
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
  accountMode = "login";
  renderAccountMode();
  document.querySelector("#account-status").textContent = "";
  document.querySelector("#account-modal").classList.remove("hidden");
});
document.querySelector("#account-mode-toggle").addEventListener("click", () => {
  accountMode = accountMode === "login" ? "register" : "login";
  renderAccountMode();
  setAccountStatus("");
});
document.querySelector("#account-form-panel").addEventListener("submit", submitAccountForm);
document.querySelector("#account-signout").addEventListener("click", signOutAccount);
document.querySelector("#close-account").addEventListener("click", () => document.querySelector("#account-modal").classList.add("hidden"));
document.querySelector("#leaderboard-button").addEventListener("click", openLeaderboard);
document.querySelector("#close-leaderboard").addEventListener("click", () => document.querySelector("#leaderboard-modal").classList.add("hidden"));
for (const modalId of ["account-modal", "leaderboard-modal"]) {
  document.querySelector(`#${modalId}`).addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.classList.add("hidden");
  });
}

// Waiting for the opponent needs fresher data than your own turn, so poll less when it is yours.
function pollDelay() {
  const data = online.publicData;
  if (!data || !data.game) return 3000; // lobby: waiting for a friend or for the host to start
  if (data.game.finished) return 4000;
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
      setOnlineStatus("That room has expired or no longer exists. Create a new one.");
    } else {
      setOnlineStatus(onlineErrorMessage(error));
    }
  } finally {
    online.polling = false;
  }
}

function applyRoomSnapshot(snapshot) {
  if (!snapshot || !snapshot.publicData) throw new Error("The game server returned an invalid room state.");
  const data = snapshot.publicData;
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
  else setOnlineStatus(online.isHost ? "Room ready. Share the invite link with your friend." : "Joined. Waiting for the host to start.");
}

function updateRoomLobby(data) {
  const startButton = document.querySelector("#start-online-game");
  const message = document.querySelector("#room-wait-message");
  const players = document.querySelector("#room-players");
  document.querySelector("#room-wait-panel").classList.remove("hidden");
  document.querySelector("#current-room-code").textContent = online.roomCode;
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
  const hasGuest = data.players.length === 2;
  startButton.classList.toggle("hidden", !online.isHost || !hasGuest || data.status === "playing");
  if (data.status === "waiting") {
    message.textContent = online.isHost
      ? hasGuest
        ? `${data.players[1].name} joined. Start when you’re ready.`
        : "Waiting for your friend to join. Share the invite link or room code."
      : `Connected to ${data.players[0].name}’s room. Waiting for the host to start.`;
    return;
  }
  message.textContent = "Game connected.";
}

function renderGameChat(data) {
  const panel = document.querySelector("#game-chat");
  const messages = document.querySelector("#chat-messages");
  const input = document.querySelector("#chat-input");
  const send = document.querySelector("#chat-send");
  const status = document.querySelector("#chat-status");
  const active = data.status === "playing" && !data.game.finished;
  panel.classList.remove("hidden");
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
  document.querySelector("#round-mode-label").textContent = "ONLINE GAME";
  elements.setup.classList.add("hidden");
  elements.online.classList.add("hidden");
  elements.game.classList.remove("hidden");
  document.querySelector("#round-player-count").textContent = "2 PLAYERS";
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
}

function beginRoomSession(snapshot, token) {
  disconnectOnlineRoom();
  online.roomCode = snapshot.roomCode;
  online.token = token;
  writeStored(roomStorageKey(snapshot.roomCode), JSON.stringify({ token }));
  const inviteLink = makeInviteLink(snapshot.roomCode);
  window.history.replaceState(null, "", inviteLink); // reloading this page reconnects you
  document.querySelector("#generated-invite-link").value = inviteLink;
  document.querySelector("#current-room-code").textContent = snapshot.roomCode;
  updateRoomShareLinks(snapshot.roomCode);
  applyRoomSnapshot(snapshot);
  if (online.isHost) document.querySelector("#invite-result").classList.remove("hidden");
  schedulePoll();
}

async function createOnlineRoom() {
  try {
    const name = playerName();
    setOnlineStatus("Creating your room…");
    const snapshot = await callGameApi("/api/rooms", "POST", { name });
    beginRoomSession(snapshot, snapshot.token);
    setOnlineStatus("Room created. Share the invite link with your friend.");
  } catch (error) {
    setOnlineStatus(onlineErrorMessage(error));
  }
}

async function joinOnlineRoom() {
  const inviteInput = document.querySelector("#invite-link-input");
  const roomCode = extractRoomCode(inviteInput.value);
  if (!roomCode) {
    setOnlineStatus("Paste your friend’s invite link or room code first.");
    inviteInput.focus();
    return;
  }
  if (!/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/.test(roomCode)) {
    setOnlineStatus("That invite link or room code is not valid.");
    inviteInput.focus();
    return;
  }
  try {
    const saved = readSavedRoom(roomCode);
    const body = {};
    if (saved) body.token = saved.token; // you were already in this room: just reconnect
    if (document.querySelector("#account-username").value.trim() || !saved) body.name = playerName();
    setOnlineStatus(saved ? "Reconnecting to your room…" : "Joining your friend’s room…");
    const snapshot = await callGameApi(`/api/rooms/${roomCode}/join`, "POST", body);
    beginRoomSession(snapshot, snapshot.token || (saved && saved.token));
  } catch (error) {
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
  if (action.type !== "timeout" && game.current !== onlineSeat) return;
  online.movePending = true;
  const actionId = window.crypto && window.crypto.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  renderGame();
  try {
    const snapshot = await callGameApi(`/api/rooms/${online.roomCode}/action`, "POST", { ...action, actionId });
    online.movePending = false;
    applyRoomSnapshot(snapshot);
    if (game) renderGame();
    if (snapshot.ignored) {
      online.timeoutSentAt = null;
      retryTimeoutSoon();
    }
  } catch (error) {
    online.movePending = false;
    showToast(onlineErrorMessage(error));
    if (game) renderGame();
    if (action.type === "timeout") {
      online.timeoutSentAt = null;
      retryTimeoutSoon();
    }
  }
}

document.querySelector("#online-launch-button").addEventListener("click", openOnlineLobby);
document.querySelector("#create-room-button").addEventListener("click", createOnlineRoom);
document.querySelector("#join-room-button").addEventListener("click", joinOnlineRoom);
document.querySelector("#start-online-game").addEventListener("click", startOnlineGame);
document.querySelector("#chat-form").addEventListener("submit", sendChatMessage);
document.querySelector("#leave-online-room").addEventListener("click", () => {
  disconnectOnlineRoom();
  setOnlineStatus("You left this room view. Open its invite link to reconnect.");
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && online.roomCode) refreshRoomState(); // catch up right away when the tab returns
});
document.querySelector("#copy-invite-button").addEventListener("click", () => {
  const inviteLink = document.querySelector("#generated-invite-link").value;
  copyTextToButton(inviteLink, document.querySelector("#copy-invite-button"), "✓ Copied!", "Invite link copied.", "Could not copy the invite link. Select and copy it manually.");
});
for (const selector of ["#lobby-copy-code", "#game-copy-code"]) {
  document.querySelector(selector).addEventListener("click", (event) => {
    copyTextToButton(online.roomCode, event.currentTarget, "✓ Copied!", "Room code copied.", "Could not copy the room code. Please copy it manually.");
  });
}
document.querySelector("#mode-label").textContent = "Online play";
for (const button of document.querySelectorAll(".suit-option")) {
  button.addEventListener("click", () => {
    if (!game || game.stagedCardIndex === null) return;
    const index = game.stagedCardIndex;
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
document.querySelector("#rules-button").addEventListener("click", openRules);
document.querySelector("#game-rules-button").addEventListener("click", openRules);
document.querySelector("#close-rules").addEventListener("click", closeRules);
for (const modal of [elements.rulesModal, elements.suitModal]) {
  modal.addEventListener("click", (event) => {
    if (event.target !== modal) return;
    if (modal === elements.rulesModal) closeRules();
  });
}
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!elements.rulesModal.classList.contains("hidden")) closeRules();
  for (const modalId of ["account-modal", "leaderboard-modal"]) {
    document.querySelector(`#${modalId}`).classList.add("hidden");
  }
});

renderPlayerFields();
document.querySelector("#account-username").value = readStored(NAME_KEY) || "";
renderAccountMode();
loadAccount();
const invitedRoom = new URLSearchParams(window.location.search).get("room");
if (invitedRoom) {
  openOnlineLobby();
  const invitedCode = extractRoomCode(invitedRoom);
  const inviteInput = document.querySelector("#invite-link-input");
  inviteInput.value = invitedCode;
  if (readSavedRoom(invitedCode)) joinOnlineRoom(); // reload or return visit: reconnect automatically
  else inviteInput.focus();
}
