import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, isPlayable, newGame, publicGame, TURN_MS } from "../lib/engine.js";

const c = (suit, rank) => ({ id: suit === "wild" ? `joker-${rank}` : `${suit}-${rank}`, suit, rank });
const joker = (n = 1) => ({ id: `joker-${n}`, suit: "wild", rank: "JOKER" });
let seed = 12345;
const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

function table({ hands, top = c("hearts", "5"), deck } = {}) {
  const g = newGame(["Ann", "Ben"], 1000, rng);
  g.hands = hands;
  g.discard = [top];
  g.activeSuit = top.suit;
  g.deck = deck || [c("clubs", "3"), c("clubs", "4"), c("clubs", "5"), c("clubs", "6"), c("clubs", "9"), c("clubs", "10")];
  return g;
}

test("deals 4 cards each and a plain opening card", () => {
  for (let i = 0; i < 50; i += 1) {
    const g = newGame(["Ann", "Ben"], 0, rng);
    assert.equal(g.hands[0].length, 4);
    assert.equal(g.hands[1].length, 4);
    assert.ok(!["A", "2", "8", "J", "JOKER"].includes(g.discard[0].rank));
    assert.equal(g.hands[0].length + g.hands[1].length + g.deck.length + g.discard.length, 54);
  }
});

test("public state never contains hands", () => {
  const g = newGame(["Ann", "Ben"], 0, rng);
  const text = JSON.stringify(publicGame(g));
  assert.ok(!text.includes("hands"));
  for (const card of [...g.hands[0], ...g.hands[1]]) assert.ok(!text.includes(`"${card.id}"`) || card.id === g.discard[0].id);
});

test("a 2 forces a penalty that can be drawn", () => {
  const g = table({ hands: [[c("hearts", "2"), c("clubs", "3")], [c("clubs", "7"), c("spades", "K")]] });
  assert.ok(applyAction(g, 0, { type: "play", cardId: "hearts-2" }, 2000).message);
  assert.equal(g.pending, 2);
  assert.equal(g.current, 1);
  assert.ok(applyAction(g, 1, { type: "play", cardId: "clubs-7" }, 2100).error);
  applyAction(g, 1, { type: "draw" }, 2200);
  assert.equal(g.hands[1].length, 4);
  assert.equal(g.pending, 0);
  assert.equal(g.current, 0);
});

test("a second 2 cancels the 2-card penalty instead of stacking it", () => {
  const g = table({ hands: [[c("hearts", "2"), c("clubs", "3")], [c("clubs", "2"), c("spades", "K")]] });
  applyAction(g, 0, { type: "play", cardId: "hearts-2" }, 2000);
  const result = applyAction(g, 1, { type: "play", cardId: "clubs-2" }, 2100);
  assert.match(result.message, /canceled the 2-card penalty/);
  assert.equal(g.pending, 0);
  assert.equal(g.pendingType, null);
  assert.equal(g.current, 0);
});

test("it is not your turn", () => {
  const g = table({ hands: [[c("hearts", "9")], [c("hearts", "3")]] });
  assert.match(applyAction(g, 1, { type: "draw" }, 2000).error, /not your turn/);
});

test("Joker penalty reduced by 2s keeps the turn, then drawing the rest gives no free suit", () => {
  const g = table({ hands: [[joker(), c("hearts", "K")], [c("spades", "2"), c("clubs", "9"), c("clubs", "10")]] });
  applyAction(g, 0, { type: "play", cardId: "joker-1" }, 2000);
  assert.equal(g.pending, 4);
  assert.equal(g.pendingType, "draw-four");
  applyAction(g, 1, { type: "play", cardId: "spades-2" }, 2100);
  assert.equal(g.pending, 2);
  assert.equal(g.current, 1);
  assert.equal(g.activeSuit, "spades");
  applyAction(g, 1, { type: "draw" }, 2200);
  assert.equal(g.hands[1].length, 4);
  assert.equal(g.freeSuitPlay, false);
  assert.equal(g.current, 0);
});

test("drawing a whole Joker penalty lets the next player play anything", () => {
  const g = table({ hands: [[joker(), c("hearts", "K")], [c("clubs", "9")]] });
  applyAction(g, 0, { type: "play", cardId: "joker-1" }, 2000);
  applyAction(g, 1, { type: "draw" }, 2100);
  assert.equal(g.freeSuitPlay, true);
  assert.ok(isPlayable(g, c("diamonds", "9")));
});

test("an Ace needs a chosen suit and sets it", () => {
  const g = table({ hands: [[c("hearts", "A"), c("clubs", "3")], [c("clubs", "9")]] });
  assert.match(applyAction(g, 0, { type: "play", cardId: "hearts-A" }, 2000).error, /suit/);
  assert.ok(applyAction(g, 0, { type: "play", cardId: "hearts-A", chosenSuit: "clubs" }, 2000).message);
  assert.equal(g.activeSuit, "clubs");
});

test("a King reverses and a 7 skips (two players: the same player goes again)", () => {
  const g = table({ hands: [[c("hearts", "7"), c("clubs", "3")], [c("clubs", "9")]] });
  applyAction(g, 0, { type: "play", cardId: "hearts-7" }, 2000);
  assert.equal(g.current, 0);
});

test("8 chain with an odd count reverses direction when it ends", () => {
  const g = table({ hands: [[c("hearts", "8"), c("hearts", "9"), c("clubs", "3")], [c("clubs", "9")]] });
  applyAction(g, 0, { type: "play", cardId: "hearts-8" }, 2000);
  assert.ok(g.combo);
  assert.equal(g.current, 0);
  applyAction(g, 0, { type: "play", cardId: "hearts-9" }, 2100);
  assert.equal(g.combo, null);
  assert.equal(g.direction, -1);
  assert.equal(g.current, 1);
});

test("timeouts are ignored early and draw once the 60 seconds are up", () => {
  const g = table({ hands: [[c("clubs", "3")], [c("clubs", "9")]] });
  assert.ok(applyAction(g, 1, { type: "timeout" }, 1000 + 5000).ignored);
  assert.equal(g.hands[0].length, 1);
  assert.ok(applyAction(g, 1, { type: "timeout" }, 1000 + TURN_MS).message.includes("ran out of time"));
  assert.equal(g.hands[0].length, 2);
  assert.equal(g.current, 1);
});

test("emptying your hand wins", () => {
  const g = table({ hands: [[c("hearts", "9")], [c("clubs", "9")]] });
  applyAction(g, 0, { type: "play", cardId: "hearts-9" }, 2000);
  assert.equal(g.finished, true);
  assert.equal(g.winner, "Ann");
  assert.ok(applyAction(g, 1, { type: "draw" }, 2100).error);
});

test("fuzz: random legal play keeps all 54 cards and never errors", () => {
  for (let game = 0; game < 300; game += 1) {
    let now = 1000;
    const g = newGame(["Ann", "Ben"], now, rng);
    for (let step = 0; step < 400 && !g.finished; step += 1) {
      now += 1000;
      const seat = g.current;
      const playable = g.hands[seat].filter((card) => isPlayable(g, card));
      let action;
      const roll = rng();
      if (roll < 0.03) {
        now = g.turnStartedAt + TURN_MS + 1;
        action = { type: "timeout" };
      } else if (playable.length && roll < 0.9) {
        const card = playable[Math.floor(rng() * playable.length)];
        action = { type: "play", cardId: card.id, chosenSuit: ["hearts", "spades", "diamonds", "clubs"][Math.floor(rng() * 4)] };
      } else {
        action = { type: "draw" };
      }
      const result = applyAction(g, seat, action, now, rng);
      assert.ok(!result.error, `${JSON.stringify(action)} -> ${result.error}`);
      const total = g.hands[0].length + g.hands[1].length + g.deck.length + g.discard.length;
      assert.equal(total, 54);
      const ids = new Set([...g.hands[0], ...g.hands[1], ...g.deck, ...g.discard].map((card) => card.id));
      assert.equal(ids.size, 54);
    }
  }
});
