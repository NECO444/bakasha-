// BAKASHA game engine. Pure functions over a plain-JSON game state, so the
// state can be stored in Redis and replayed on every request.
import { randomInt } from "node:crypto";

export const SUITS = ["hearts", "spades", "diamonds", "clubs"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const TURN_MS = 60000;
const TIMEOUT_GRACE_MS = 2000; // tolerate small clock/latency differences

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
  let openIndex = deck.findIndex((card) => !["A", "2", "8", "J", "JOKER"].includes(card.rank));
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
    pending: 0,
    pendingType: null,
    combo: null,
    freeSuitPlay: false,
    jokerReduced: false,
    turns: 1,
    finished: false,
    winner: null,
    turnStartedAt: now,
  };
}

export const topCard = (g) => g.discard[g.discard.length - 1];

export function isPlayable(g, card) {
  const top = topCard(g);
  if (g.pending > 0) {
    return g.pendingType === "draw-two" ? card.rank === "2" : card.rank === "JOKER" || card.rank === "2";
  }
  if (g.combo) {
    const last = g.combo.lastCard;
    if (card.rank === "J") return card.suit === last.suit || last.rank === "J";
    if (card.rank === "8") return card.suit === last.suit || card.rank === last.rank;
    return card.suit === last.suit;
  }
  if (g.freeSuitPlay) return true;
  if (card.rank === "A") return card.suit === g.activeSuit || top.rank === "A";
  if (card.rank === "J") return card.suit === g.activeSuit || top.rank === "J";
  return card.rank === "JOKER" || card.suit === g.activeSuit || card.rank === top.rank;
}

function nextIndex(g, steps) {
  const count = g.hands.length;
  return (((g.current + g.direction * steps) % count) + count) % count;
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
}

// Ends an 8/Jack chain: odd number of 8s reverses direction, then moves on.
function finishCombo(g, combo, skipNext, now) {
  let note = "";
  if (combo.eightCount % 2 === 1) {
    g.direction *= -1;
    note = " The direction reversed.";
  }
  advance(g, now, skipNext ? 2 : 1);
  return note;
}

function playCard(g, index, chosenSuit, aceAgreed, now) {
  const seat = g.current;
  const name = g.names[seat];
  const hand = g.hands[seat];
  const [card] = hand.splice(index, 1);
  const counteringJoker = g.pending > 0 && g.pendingType === "draw-four";
  g.discard.push(card);
  g.freeSuitPlay = false;
  if (chosenSuit) g.activeSuit = chosenSuit;
  else if (card.rank !== "JOKER") g.activeSuit = card.suit;

  if (hand.length === 0) {
    g.finished = true;
    g.winner = name;
    return `${name} wins!`;
  }

  if (counteringJoker && card.rank === "2") {
    g.pending = Math.max(0, g.pending - 2);
    g.jokerReduced = true;
    if (g.pending === 0) {
      g.pendingType = null;
      g.jokerReduced = false;
      advance(g, now);
      return `${name} canceled the Joker penalty with 2s.`;
    }
    return `${name} reduced the penalty. Draw ${g.pending} or counter more.`;
  }
  if (counteringJoker && card.rank === "JOKER") {
    g.pending = 0;
    g.pendingType = null;
    g.jokerReduced = false;
    g.freeSuitPlay = true;
    advance(g, now);
    return `${name} canceled the Joker penalty.`;
  }

  const players = g.hands.length;

  if (g.combo && (card.rank === "8" || card.rank === "J")) {
    g.combo.lastCard = card;
    if (card.rank === "8") g.combo.eightCount += 1;
    if (card.rank === "J" && players > 2) {
      const combo = g.combo;
      g.combo = null;
      const note = finishCombo(g, combo, true, now);
      return `${name} played a Jack. The next player is skipped.${note}`;
    }
    return `${name} added ${card.rank === "8" ? "an 8" : "a Jack"} to the chain.`;
  }
  if (g.combo) {
    const combo = g.combo;
    g.combo = null;
    let message;
    if (card.rank === "2") {
      g.pending += 2;
      g.pendingType = "draw-two";
      message = `${name} ended the chain with a 2. A 2-card penalty is on the table.`;
    } else {
      message = `${name} ended the chain.`;
    }
    return message + finishCombo(g, combo, false, now);
  }
  if (card.rank === "8" || card.rank === "J") {
    g.combo = { lastCard: card, eightCount: card.rank === "8" ? 1 : 0 };
    if (card.rank === "J" && players > 2) {
      const combo = g.combo;
      g.combo = null;
      const note = finishCombo(g, combo, true, now);
      return `${name} played a Jack. The next player is skipped.${note}`;
    }
    return `${name} played ${card.rank === "8" ? "an 8" : "a Jack"}. Add a matching support card or draw one.`;
  }

  if (card.rank === "2") {
    g.pending += 2;
    g.pendingType = "draw-two";
    advance(g, now);
    return g.pending === 2 ? `${name} played a 2. Draw two is on the table.` : `${name} stacked a 2. Penalty: ${g.pending} cards.`;
  }
  if (card.rank === "JOKER") {
    g.pending += 4;
    g.pendingType = "draw-four";
    g.jokerReduced = false;
    advance(g, now);
    return g.pending === 4 ? `${name} played a Joker! Draw four is on the table.` : `${name} played a Joker. Penalty: ${g.pending} cards.`;
  }
  if (card.rank === "K") {
    g.direction *= -1;
    advance(g, now);
    return `${name} played a King. The turn order reversed!`;
  }
  if (card.rank === "7") {
    const skipped = g.names[nextIndex(g, 1)];
    advance(g, now, 2);
    return `${name} played a 7. ${skipped} is skipped.`;
  }
  let message = `${name} played a card.`;
  if (card.rank === "A") {
    message = aceAgreed
      ? `${name} played an Ace. The suit stays ${chosenSuit}.`
      : `${name} played an Ace. Next suit: ${chosenSuit}.`;
  }
  advance(g, now);
  return message;
}

function drawTurn(g, now, rng, timedOut) {
  const seat = g.current;
  const name = g.names[seat];
  const who = timedOut ? `${name} ran out of time and` : name;
  if (g.pending > 0) {
    const amount = g.pending;
    const resolvedJoker = g.pendingType === "draw-four";
    takeCards(g, seat, amount, rng);
    g.pending = 0;
    g.pendingType = null;
    g.freeSuitPlay = resolvedJoker && !g.jokerReduced;
    g.jokerReduced = false;
    advance(g, now);
    return `${who} drew ${amount}.`;
  }
  if (g.combo) {
    const combo = g.combo;
    g.combo = null;
    takeCards(g, seat, 1, rng);
    const note = finishCombo(g, combo, false, now);
    return `${who} drew one card. Turn passed.${note}`;
  }
  g.freeSuitPlay = false;
  takeCards(g, seat, 1, rng);
  advance(g, now);
  return `${who} drew a card.`;
}

// Returns { message } on success, { ignored: true } when a timeout is not due
// yet, or { error } when the action is not allowed. Mutates `g` only on success.
export function applyAction(g, seat, action, now, rng = defaultRng) {
  if (!action || typeof action !== "object") return { error: "Invalid action." };
  if (g.finished) {
    return action.type === "timeout" ? { ignored: true } : { error: "The game is already over." };
  }
  if (action.type === "timeout") {
    if (now < g.turnStartedAt + TURN_MS - TIMEOUT_GRACE_MS) return { ignored: true };
    return { message: drawTurn(g, now, rng, true) };
  }
  if (seat !== g.current) return { error: "It is not your turn." };
  if (action.type === "draw") return { message: drawTurn(g, now, rng, false) };
  if (action.type === "play") {
    const hand = g.hands[seat];
    const index = typeof action.cardId === "string" ? hand.findIndex((card) => card.id === action.cardId) : -1;
    if (index < 0) return { error: "That card is not in your hand." };
    const card = hand[index];
    if (!isPlayable(g, card)) return { error: "That card cannot be played right now." };
    let chosenSuit;
    let aceAgreed = false;
    if (card.rank === "A") {
      if (!SUITS.includes(action.chosenSuit)) return { error: "Choose a suit for the Ace." };
      chosenSuit = action.chosenSuit;
      aceAgreed = topCard(g).rank === "A" && chosenSuit === g.activeSuit;
    }
    return { message: playCard(g, index, chosenSuit, aceAgreed, now) };
  }
  return { error: "Unknown action." };
}

// What both players may see. Hands are never included.
export function publicGame(g) {
  return {
    current: g.current,
    direction: g.direction,
    activeSuit: g.activeSuit,
    pending: g.pending,
    pendingType: g.pendingType,
    combo: g.combo,
    freeSuitPlay: g.freeSuitPlay,
    jokerReduced: g.jokerReduced,
    turns: g.turns,
    finished: g.finished,
    winner: g.winner,
    discard: [topCard(g)],
    deckCount: g.deck.length,
    turnStartedAt: g.turnStartedAt,
  };
}
