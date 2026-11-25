// BAKASHA game engine. Pure functions over a plain-JSON game state, so the
// state can be stored in Redis and replayed on every request.
import { randomInt } from "node:crypto";

export const SUITS = ["hearts", "spades", "diamonds", "clubs"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SPECIAL_RANKS = ["A", "2", "8", "J", "JOKER"];
export const TURN_MS = 60000;
const TIMEOUT_GRACE_MS = 2000;

const defaultRng = () => randomInt(0, 4294967296) / 4294967296;

export function shuffle(cards, rng = defaultRng) {
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function createDeck(rng = defaultRng) {
  const cards = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) cards.push({ id: `${suit}-${rank}`, suit, rank });
  }
  cards.push({ id: "joker-1", suit: "wild", rank: "JOKER" });
  cards.push({ id: "joker-2", suit: "wild", rank: "JOKER" });
  return shuffle(cards, rng);
}

export function newGame(names, now, rng = defaultRng) {
  const deck = createDeck(rng);
  const hands = names.map(() => []);
  for (let round = 0; round < 4; round += 1) {
    for (const hand of hands) hand.push(deck.pop());
  }
  let openIndex = deck.findIndex((card) => !SPECIAL_RANKS.includes(card.rank));
  if (openIndex < 0) openIndex = 0;
  const [opening] = deck.splice(openIndex, 1);
  return {
    names: [...names],
    hands,
    deck,
    discard: [opening],
    current: 0,
    direction: 1,
    activeSuit: opening.suit,
    demandedSuit: null,
    pending: 0,
    pendingType: null,
    combo: null,
    jumpSupport: false,
    freeSuitPlay: false,
    mustDrawSeat: null,
    knocked: names.map(() => false),
    round: 1,
    roundOut: names.map(() => false),
    eliminated: names.map(() => false),
    turns: 1,
    finished: false,
    winner: null,
    turnStartedAt: now,
  };
}

export const topCard = (g) => g.discard[g.discard.length - 1];

function ensureCurrentGameState(g) {
  if (!Array.isArray(g.knocked) || g.knocked.length !== g.hands.length) {
    g.knocked = g.hands.map(() => false);
  }
  if (g.demandedSuit === undefined) g.demandedSuit = null;
  if (g.jumpSupport === undefined) {
    g.jumpSupport = g.hands.length === 2 && g.combo?.lastCard?.rank === "J";
    if (g.jumpSupport) g.combo = null;
  }
  if (g.mustDrawSeat === undefined) g.mustDrawSeat = null;
  if (!Array.isArray(g.roundOut) || g.roundOut.length !== g.hands.length) {
    g.roundOut = g.hands.map(() => false);
  }
  if (!Array.isArray(g.eliminated) || g.eliminated.length !== g.hands.length) {
    g.eliminated = g.hands.map(() => false);
  }
  if (!Number.isInteger(g.round) || g.round < 1) g.round = 1;
}

export function isPlayable(g, card) {
  const top = topCard(g);
  if (g.mustDrawSeat === g.current) return false;
  if (g.pending > 0) {
    return g.pendingType === "draw-two"
      ? card.rank === "2"
      : card.rank === "JOKER" || card.rank === "2";
  }
  if (g.combo) {
    const last = g.combo.lastCard;
    return card.rank === "8" || card.suit === last.suit;
  }
  if (g.jumpSupport) return !SPECIAL_RANKS.includes(card.rank);
  if (g.freeSuitPlay) return true;
  if (g.demandedSuit) {
    return card.rank === "A" || card.rank === "JOKER" || card.suit === g.demandedSuit;
  }
  return card.rank === "JOKER" ? top.rank !== "2" : card.suit === g.activeSuit || card.rank === top.rank;
}

function nextIndex(g, steps) {
  const count = g.hands.length;
  let index = g.current;
  for (let step = 0; step < steps; step += 1) {
    let attempts = 0;
    do {
      index = (((index + g.direction) % count) + count) % count;
      attempts += 1;
    } while ((g.eliminated[index] || g.roundOut[index]) && attempts < count);
  }
  return index;
}

function advance(g, now, steps = 1) {
  g.current = nextIndex(g, steps);
  g.turns += 1;
  g.turnStartedAt = now;
}

function recycleDeck(g, rng) {
  if (g.deck.length > 0 || g.discard.length <= 1) return;
  const top = g.discard.pop();
  g.deck = shuffle(g.discard, rng);
  g.discard = [top];
}

function takeCards(g, seat, count, rng) {
  for (let i = 0; i < count; i += 1) {
    recycleDeck(g, rng);
    if (g.deck.length === 0) break;
    g.hands[seat].push(g.deck.pop());
  }
  if (g.hands[seat].length > 1) g.knocked[seat] = false;
}

function drawTurn(g, now, rng, timedOut) {
  const seat = g.current;
  const name = g.names[seat];
  const who = timedOut ? `${name} ran out of time and` : name;
  if (g.mustDrawSeat === seat) {
    g.combo = null;
    g.jumpSupport = false;
    takeCards(g, seat, 1, rng);
    g.mustDrawSeat = null;
    advance(g, now);
    return `${who} drew one card.`;
  }
  if (g.pending > 0) {
    const amount = g.pending;
    takeCards(g, seat, amount, rng);
    g.pending = 0;
    g.pendingType = null;
    advance(g, now);
    return `${who} drew ${amount}.`;
  }
  if (g.combo) {
    g.combo = null;
    takeCards(g, seat, 1, rng);
    advance(g, now);
    return `${who} drew one card. Turn passed.`;
  }
  if (g.jumpSupport) {
    g.jumpSupport = false;
    takeCards(g, seat, 1, rng);
    advance(g, now);
    return `${who} drew one card. Turn passed.`;
  }
  takeCards(g, seat, 1, rng);
  advance(g, now);
  return `${who} drew a card.`;
}

function startPlayoffRound(g, survivors, now, rng) {
  const deck = createDeck(rng);
  for (const [seat, hand] of g.hands.entries()) {
    hand.length = 0;
    if (!survivors.includes(seat)) continue;
    for (let cardIndex = 0; cardIndex < 4; cardIndex += 1) hand.push(deck.pop());
  }
  let openIndex = deck.findIndex((card) => !SPECIAL_RANKS.includes(card.rank));
  if (openIndex < 0) openIndex = 0;
  const [opening] = deck.splice(openIndex, 1);
  g.deck = deck;
  g.discard = [opening];
  g.current = survivors[0];
  g.direction = 1;
  g.activeSuit = opening.suit;
  g.demandedSuit = null;
  g.pending = 0;
  g.pendingType = null;
  g.combo = null;
  g.jumpSupport = false;
  g.freeSuitPlay = false;
  g.mustDrawSeat = null;
  g.knocked = g.hands.map(() => false);
  g.roundOut = g.hands.map(() => false);
  g.round += 1;
  g.turns += 1;
  g.turnStartedAt = now;
  g.roundMessage = null;
}

function finishIfOut(g, seat, card, now, rng) {
  if (g.hands[seat].length !== 0) return false;
  if (SPECIAL_RANKS.includes(card.rank)) {
    g.mustDrawSeat = seat;
    return false;
  }
  if (g.hands.length > 2) {
    g.roundOut[seat] = true;
    const stillPlaying = g.hands
      .map((_, index) => index)
      .filter((index) => !g.eliminated[index] && !g.roundOut[index]);
    if (stillPlaying.length > 1) return false;
    const eliminatedSeat = stillPlaying[0];
    if (eliminatedSeat === undefined) {
      g.finished = true;
      g.winner = g.names[seat];
      return true;
    }
    g.eliminated[eliminatedSeat] = true;
    const survivors = g.hands
      .map((_, index) => index)
      .filter((index) => !g.eliminated[index]);
    if (survivors.length === 1) {
      g.finished = true;
      g.winner = g.names[survivors[0]];
      g.roundMessage = `${g.names[eliminatedSeat]} is eliminated. ${g.winner} wins!`;
      return true;
    }
    startPlayoffRound(g, survivors, now, rng);
    g.roundMessage = `${g.names[seat]} is safe. ${g.names[eliminatedSeat]} is eliminated. Round ${g.round} starts!`;
    return true;
  }
  g.finished = true;
  g.winner = g.names[seat];
  return true;
}

function playCard(g, index, chosenSuit, now, rng) {
  const seat = g.current;
  const name = g.names[seat];
  const hand = g.hands[seat];
  const [card] = hand.splice(index, 1);
  const counteringJoker = g.pendingType === "draw-four";
  const counteringDrawTwo = g.pendingType === "draw-two";
  const supportedEight = Boolean(g.combo);
  const supportedJump = g.jumpSupport;
  g.discard.push(card);
  g.freeSuitPlay = false;
  g.knocked[seat] = false;
  if (card.rank === "A") {
    g.activeSuit = chosenSuit;
    g.demandedSuit = chosenSuit;
  } else if (card.rank !== "JOKER") {
    g.activeSuit = card.suit;
  }

  if (counteringJoker && card.rank === "JOKER") {
    g.pending = 0;
    g.pendingType = null;
    g.demandedSuit = null;
    g.freeSuitPlay = true;
    if (finishIfOut(g, seat, card, now, rng)) return `${name} canceled the Joker penalty and wins!`;
    advance(g, now);
    return `${name} canceled the Joker penalty. The next player may play any card.`;
  }
  if (counteringJoker && card.rank === "2") {
    g.pending = 0;
    g.pendingType = null;
    g.demandedSuit = null;
    takeCards(g, seat, 2, rng);
    if (hand.length === 0) g.mustDrawSeat = seat;
    advance(g, now);
    return `${name} blocked 2 of the Joker penalty and drew 2.`;
  }
  if (counteringDrawTwo && card.rank === "2") {
    g.pending = 0;
    g.pendingType = null;
    if (finishIfOut(g, seat, card, now, rng)) return `${name} canceled the 2-card penalty but must draw before going out.`;
    advance(g, now);
    return `${name} canceled the 2-card penalty.`;
  }

  if (g.demandedSuit && card.rank !== "A" && card.rank !== "JOKER") g.demandedSuit = null;
  if (card.rank === "JOKER") g.demandedSuit = null;

  let reverseAfterSupport = false;
  if (supportedEight) {
    if (card.rank === "8") {
      g.combo.lastCard = card;
      g.combo.eightCount += 1;
      if (hand.length === 0) g.mustDrawSeat = seat;
      return `${name} played another 8. Add its support or draw one.`;
    }
    reverseAfterSupport = g.combo.eightCount % 2 === 1;
    g.combo = null;
    if (reverseAfterSupport) g.direction *= -1;
  } else if (supportedJump) {
    g.jumpSupport = false;
  }

  if (finishIfOut(g, seat, card, now, rng)) {
    return g.roundMessage || `${g.winner} wins!`;
  }

  if (card.rank === "8") {
    g.combo = { lastCard: card, eightCount: 1 };
    return `${name} played an 8. Add support or draw one.`;
  }
  if (card.rank === "J") {
    if (g.hands.length === 2) {
      if (hand.length === 0) g.mustDrawSeat = seat;
      else g.jumpSupport = true;
      return hand.length === 0
        ? `${name} played a Jack and must draw one on the next turn.`
        : `${name} played a Jack. Play a normal support card or draw one.`;
    }
    if (hand.length === 0) g.mustDrawSeat = seat;
    advance(g, now, 2);
    return `${name} played a Jack. The next player is skipped.`;
  }
  if (card.rank === "2") {
    g.pending = 2;
    g.pendingType = "draw-two";
    if (hand.length === 0) g.mustDrawSeat = seat;
    advance(g, now);
    return `${name} played a 2. The next player must draw two.`;
  }
  if (card.rank === "JOKER") {
    g.pending = 4;
    g.pendingType = "draw-four";
    if (hand.length === 0) g.mustDrawSeat = seat;
    advance(g, now);
    return `${name} played a Joker. The next player must draw four.`;
  }

  if (supportedEight && reverseAfterSupport) {
    g.pending = card.rank === "2" ? 2 : 0;
    g.pendingType = g.pending > 0 ? "draw-two" : null;
  } else if (card.rank === "2") {
    g.pending = 2;
    g.pendingType = "draw-two";
  }
  advance(g, now);
  return `${name} played a card.${reverseAfterSupport ? " The direction reversed." : ""}`;
}

export function applyAction(g, seat, action, now, rng = defaultRng) {
  if (!action || typeof action !== "object") return { error: "Invalid action." };
  ensureCurrentGameState(g);
  if (g.finished) {
    return action.type === "timeout" ? { ignored: true } : { error: "The game is already over." };
  }
  if (action.type === "timeout") {
    if (now < g.turnStartedAt + TURN_MS - TIMEOUT_GRACE_MS) return { ignored: true };
    return { message: drawTurn(g, now, rng, true) };
  }
  if (action.type === "knock") {
    if (seat < 0 || seat >= g.hands.length || g.hands[seat].length !== 1) {
      return { error: "You can only knock when you have one card." };
    }
    if (g.knocked[seat]) return { error: "You have already knocked." };
    g.knocked[seat] = true;
    return { message: `${g.names[seat]} knocked!` };
  }
  if (seat !== g.current) return { error: "It is not your turn." };
  if (g.hands[seat].length === 1 && !g.knocked[seat]) {
    return action.type === "draw"
      ? { error: "Knock before taking your turn." }
      : { error: "Knock before playing your last card." };
  }
  if (action.type === "draw") return { message: drawTurn(g, now, rng, false) };
  if (action.type === "play") {
    const hand = g.hands[seat];
    const index = typeof action.cardId === "string" ? hand.findIndex((card) => card.id === action.cardId) : -1;
    if (index < 0) return { error: "That card is not in your hand." };
    const card = hand[index];
    if (!isPlayable(g, card)) return { error: "That card cannot be played right now." };
    let chosenSuit;
    if (card.rank === "A") {
      if (!SUITS.includes(action.chosenSuit)) return { error: "Choose a suit for the Ace." };
      chosenSuit = action.chosenSuit;
    }
    return { message: playCard(g, index, chosenSuit, now, rng) };
  }
  return { error: "Unknown action." };
}

export function publicGame(g) {
  return {
    current: g.current,
    direction: g.direction,
    activeSuit: g.activeSuit,
    demandedSuit: g.demandedSuit,
    pending: g.pending,
    pendingType: g.pendingType,
    combo: g.combo,
    jumpSupport: g.jumpSupport,
    freeSuitPlay: g.freeSuitPlay,
    mustDrawSeat: g.mustDrawSeat,
    knocked: Array.isArray(g.knocked) ? [...g.knocked] : g.hands.map(() => false),
    round: g.round || 1,
    roundOut: Array.isArray(g.roundOut) ? [...g.roundOut] : g.hands.map(() => false),
    eliminated: Array.isArray(g.eliminated) ? [...g.eliminated] : g.hands.map(() => false),
    turns: g.turns,
    finished: g.finished,
    winner: g.winner,
    discard: [topCard(g)],
    deckCount: g.deck.length,
    turnStartedAt: g.turnStartedAt,
  };
}
