import test from "node:test";
import assert from "node:assert/strict";
import { applyAction, isPlayable, newGame, publicGame, TURN_MS } from "../lib/engine.js";

const c = (suit, rank) => ({ id: suit === "wild" ? `joker-${rank}` : `${suit}-${rank}`, suit, rank });
const joker = (n = 1) => ({ id: `joker-${n}`, suit: "wild", rank: "JOKER" });
let seed = 12345;
const rng = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

function table({ names = ["Ann", "Ben"], hands, top = c("hearts", "5"), deck } = {}) {
  const g = newGame(names, 1000, rng);
  g.hands = hands;
  g.discard = [top];
  g.activeSuit = top.suit;
  g.deck = deck || Array.from({ length: 20 }, (_, i) => c("clubs", `${(i % 10) + 3}`));
  g.knocked = names.map(() => false);
  return g;
}

function play(g, seat, card, action = {}) {
  if (g.hands[seat].length === 1 && !g.knocked[seat]) {
    applyAction(g, seat, { type: "knock" }, 2000);
  }
  return applyAction(g, seat, { type: "play", cardId: card.id, ...action }, 2000);
}

test("deals four cards each and an ordinary opening card", () => {
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
  for (const card of [...g.hands[0], ...g.hands[1]]) {
    assert.ok(!text.includes(`"${card.id}"`) || card.id === g.discard[0].id);
  }
});

test("ordinary cards match suit or rank and Joker cannot cover a 2", () => {
  const g = table({ hands: [[c("spades", "7")], [c("clubs", "5")]], top: c("hearts", "5") });
  assert.equal(isPlayable(g, c("spades", "7")), false);
  assert.equal(isPlayable(g, c("clubs", "5")), true);
  g.discard = [c("diamonds", "2")];
  assert.equal(isPlayable(g, joker()), false);
});

test("drawing ends the turn and the drawn card cannot be played immediately", () => {
  const drawn = c("clubs", "5");
  const g = table({ hands: [[c("spades", "7")], [c("clubs", "9")]], deck: [drawn] });
  applyAction(g, 0, { type: "knock" }, 1500);
  applyAction(g, 0, { type: "draw" }, 2000);
  assert.equal(g.current, 1);
  assert.deepEqual(g.hands[0].at(-1), drawn);
});

test("Ace demand persists after a player draws and clears on a suit answer", () => {
  const g = table({
    names: ["Ann", "Ben", "Cal"],
    hands: [[c("hearts", "A"), c("clubs", "3")], [c("spades", "9"), c("spades", "8")], [c("clubs", "6"), c("clubs", "7")]],
  });
  assert.match(play(g, 0, c("hearts", "A"), { chosenSuit: "clubs" }).message, /played/);
  assert.equal(g.demandedSuit, "clubs");
  assert.equal(isPlayable(g, c("spades", "9")), false);
  applyAction(g, 1, { type: "draw" }, 2100);
  assert.equal(g.current, 2);
  assert.equal(g.demandedSuit, "clubs");
  assert.equal(play(g, 2, c("clubs", "6")).error, undefined);
  assert.equal(g.demandedSuit, null);
});

test("a last Ace names a suit, then its owner draws one and loses that turn", () => {
  const g = table({
    names: ["Ann", "Ben", "Cal"],
    hands: [[c("hearts", "A")], [c("spades", "9"), c("spades", "8")], [c("diamonds", "6"), c("diamonds", "7")]],
  });

  play(g, 0, c("hearts", "A"), { chosenSuit: "clubs" });
  assert.equal(g.finished, false);
  assert.equal(g.winner, null);
  assert.equal(g.current, 1);
  assert.equal(g.mustDrawSeat, 0);
  assert.equal(g.demandedSuit, "clubs");

  applyAction(g, 1, { type: "draw" }, 2100);
  applyAction(g, 2, { type: "draw" }, 2200);
  assert.equal(g.current, 0);
  assert.equal(g.mustDrawSeat, 0);

  applyAction(g, 0, { type: "draw" }, 2300);
  assert.equal(g.finished, false);
  assert.equal(g.hands[0].length, 1);
  assert.equal(g.mustDrawSeat, null);
  assert.equal(g.current, 1);
  assert.equal(g.demandedSuit, "clubs");
});

test("Joker clears an Ace demand and starts the pick-four penalty", () => {
  const g = table({ hands: [[c("hearts", "A"), c("clubs", "3")], [joker(), c("spades", "7")]] });
  play(g, 0, c("hearts", "A"), { chosenSuit: "clubs" });
  play(g, 1, joker());
  assert.equal(g.demandedSuit, null);
  assert.equal(g.pendingType, "draw-four");
  assert.equal(g.pending, 4);
});

test("Jack skips the opponent in a group and gives a 1v1 player a support turn", () => {
  const group = table({
    names: ["Ann", "Ben", "Cal"],
    hands: [[c("hearts", "J"), c("clubs", "3")], [c("hearts", "9")], [c("spades", "9")]],
  });
  play(group, 0, c("hearts", "J"));
  assert.equal(group.current, 2);

  const duel = table({ hands: [[c("hearts", "J"), c("hearts", "3"), c("hearts", "4")], [c("clubs", "9"), c("clubs", "8")]] });
  play(duel, 0, c("hearts", "J"));
  assert.equal(duel.current, 0);
  assert.equal(duel.jumpSupport, true);
  assert.equal(isPlayable(duel, c("hearts", "3")), true);
  assert.equal(isPlayable(duel, c("spades", "3")), false);
  play(duel, 0, c("hearts", "3"));
  assert.equal(duel.current, 1);
  assert.equal(duel.jumpSupport, false);
});

test("a Jack supporting an 8 in 1v1 requires its suit and allows a matching Jack chain", () => {
  const g = table({
    hands: [[c("hearts", "8"), c("hearts", "J"), c("hearts", "J"), c("hearts", "9"), c("spades", "3")], [c("clubs", "9"), c("clubs", "8")]],
  });
  play(g, 0, c("hearts", "8"));
  assert.equal(isPlayable(g, c("hearts", "J")), true);
  play(g, 0, c("hearts", "J"));
  assert.equal(g.direction, -1);
  assert.equal(g.jumpSupport, true);
  assert.equal(isPlayable(g, c("hearts", "9")), true);
  assert.equal(isPlayable(g, c("spades", "3")), false);
  assert.equal(isPlayable(g, c("hearts", "J")), true);

  play(g, 0, c("hearts", "J"));
  assert.equal(g.jumpSupport, true);
  assert.equal(g.current, 0);
  play(g, 0, c("hearts", "9"));
  assert.equal(g.jumpSupport, false);
  assert.equal(g.current, 1);
});

test("a Jack supporting an 8 in a group reverses play and skips the next player", () => {
  const g = table({
    names: ["Ann", "Ben", "Cal", "Dee"],
    hands: [
      [c("hearts", "8"), c("hearts", "J"), c("clubs", "3")],
      [c("hearts", "9"), c("spades", "6")],
      [c("clubs", "9"), c("spades", "7")],
      [c("diamonds", "9"), c("clubs", "6")],
    ],
  });
  play(g, 0, c("hearts", "8"));
  play(g, 0, c("hearts", "J"));
  assert.equal(g.direction, -1);
  assert.equal(g.current, 2);
  assert.equal(g.jumpSupport, false);
  assert.equal(g.combo, null);
  assert.equal(applyAction(g, 0, { type: "play", cardId: "clubs-3" }, 2100).error, "It is not your turn.");
});

test("an 8 needs same-suit support and reverses play when supported", () => {
  const g = table({
    names: ["Ann", "Ben", "Cal"],
    hands: [[c("hearts", "8"), c("hearts", "9"), c("spades", "6")], [c("spades", "9")], [c("clubs", "9")]],
  });
  play(g, 0, c("hearts", "8"));
  assert.ok(g.combo);
  assert.equal(g.current, 0);
  play(g, 0, c("hearts", "9"));
  assert.equal(g.combo, null);
  assert.equal(g.direction, -1);
  assert.equal(g.current, 2);
});

test("group games continue through playoff rounds until one player remains", () => {
  const g = table({
    names: ["Ann", "Ben", "Cal"],
    hands: [[c("hearts", "3")], [c("hearts", "4")], [c("spades", "9"), c("spades", "8")]],
  });

  play(g, 0, c("hearts", "3"));
  assert.equal(g.finished, false);
  assert.equal(g.roundOut[0], true);
  assert.equal(g.current, 1);
  play(g, 1, c("hearts", "4"));
  assert.equal(g.round, 2);
  assert.deepEqual(g.eliminated, [false, false, true]);
  assert.equal(g.current, 0);
  assert.equal(g.hands[0].length, 4);
  assert.equal(g.hands[1].length, 4);
  assert.equal(g.hands[2].length, 0);

  g.hands[0] = [c("hearts", "3")];
  g.hands[1] = [c("hearts", "4")];
  g.current = 0;
  g.direction = 1;
  g.discard = [c("hearts", "5")];
  g.activeSuit = "hearts";
  g.roundOut = [false, false, false];
  play(g, 0, c("hearts", "3"));
  assert.equal(g.finished, true);
  assert.equal(g.winner, "Ann");
});

test("a last 8 still requires its owner to draw and does not leave a stale support chain", () => {
  const g = table({ hands: [[c("hearts", "8")], [c("clubs", "9"), c("spades", "4")]] });
  play(g, 0, c("hearts", "8"));
  assert.equal(g.finished, false);
  assert.equal(g.mustDrawSeat, 0);
  assert.ok(g.combo);
  applyAction(g, 0, { type: "draw" }, 2100);
  assert.equal(g.mustDrawSeat, null);
  assert.equal(g.combo, null);
  assert.equal(g.current, 1);
});

test("a 2 penalty is canceled by another 2", () => {
  const g = table({ hands: [[c("hearts", "2"), c("clubs", "3")], [c("clubs", "2"), c("spades", "K")]] });
  play(g, 0, c("hearts", "2"));
  assert.equal(g.pending, 2);
  play(g, 1, c("clubs", "2"));
  assert.equal(g.pending, 0);
  assert.equal(g.current, 0);
});

test("a 2 blocks a Joker penalty and the responding player draws two", () => {
  const g = table({
    hands: [[joker(), c("hearts", "K")], [c("spades", "2"), c("clubs", "9"), c("clubs", "10")]],
  });
  play(g, 0, joker());
  assert.equal(g.pending, 4);
  const previousCount = g.hands[1].length;
  play(g, 1, c("spades", "2"));
  assert.equal(g.pending, 0);
  assert.equal(g.hands[1].length, previousCount + 1);
  assert.equal(g.current, 0);
  assert.equal(g.activeSuit, "spades");
  assert.equal(g.freeSuitPlay, false);
  assert.equal(isPlayable(g, c("spades", "9")), true);
  assert.equal(isPlayable(g, c("clubs", "9")), false);
});

test("drawing a Joker penalty passes a free-choice turn to the next player", () => {
  const g = table({
    hands: [[joker(), c("hearts", "K"), c("diamonds", "9")], [c("clubs", "9"), c("clubs", "10")]],
    top: c("hearts", "5"),
  });
  play(g, 0, joker());
  applyAction(g, 1, { type: "draw" }, 2100);
  assert.equal(g.hands[1].length, 6);
  assert.equal(g.current, 0);
  assert.equal(g.pending, 0);
  assert.equal(g.freeSuitPlay, true);
  assert.equal(isPlayable(g, c("diamonds", "9")), true);

  const freeChoice = c("diamonds", "9");
  const result = play(g, 0, freeChoice);
  assert.equal(result.error, undefined);
  assert.equal(g.discard.at(-1).id, freeChoice.id);
  assert.equal(g.freeSuitPlay, false);
});

test("Joker response cancels the penalty and grants the following player any play", () => {
  const g = table({ hands: [[joker(), c("spades", "4")], [joker(2), c("clubs", "9")]] });
  play(g, 0, joker());
  assert.equal(g.pending, 4);
  play(g, 1, joker(2));
  assert.equal(g.pending, 0);
  assert.equal(g.current, 0);
  assert.equal(g.freeSuitPlay, true);
  assert.equal(isPlayable(g, c("diamonds", "9")), true);
});

test("a special last card does not win and forces its owner to draw on their next turn", () => {
  const g = table({ hands: [[c("hearts", "2")], [c("clubs", "9"), c("spades", "4")]] });
  play(g, 0, c("hearts", "2"));
  assert.equal(g.finished, false);
  assert.equal(g.mustDrawSeat, 0);
  assert.equal(g.current, 1);
  applyAction(g, 1, { type: "draw" }, 2100);
  assert.equal(g.current, 0);
  applyAction(g, 0, { type: "draw" }, 2200);
  assert.equal(g.mustDrawSeat, null);
  assert.equal(g.hands[0].length, 1);
});

test("Jacks, Aces, and Jokers also cannot finish a hand", () => {
  for (const card of [c("hearts", "J"), c("hearts", "A"), joker()]) {
    const g = table({ hands: [[card], [c("clubs", "9"), c("spades", "4")]] });
    const action = { type: "play", cardId: card.id };
    if (card.rank === "A") action.chosenSuit = "clubs";
    applyAction(g, 0, { type: "knock" }, 1500);
    const result = applyAction(g, 0, action, 2000);
    assert.ok(result.message);
    assert.equal(g.finished, false);
    assert.equal(g.mustDrawSeat, 0);
  }
});

test("knock is independent of the turn and required before playing with one card", () => {
  const g = table({ hands: [[c("hearts", "9")], [c("clubs", "9"), c("spades", "4")]] });
  assert.match(applyAction(g, 0, { type: "play", cardId: "hearts-9" }, 2000).error, /Knock/);
  assert.match(applyAction(g, 1, { type: "knock" }, 2000).error, /one card/);
  assert.match(applyAction(g, 0, { type: "knock" }, 2000).message, /knocked/);
  assert.equal(g.current, 0);
  assert.equal(publicGame(g).knocked[0], true);
  assert.equal(play(g, 0, c("hearts", "9")).message, "Ann wins!");
});

test("timeouts draw one card and the first player out wins 1v1", () => {
  const g = table({ hands: [[c("clubs", "3")], [c("clubs", "9")]] });
  assert.ok(applyAction(g, 0, { type: "timeout" }, 1000 + 5000).ignored);
  assert.equal(g.hands[0].length, 1);
  applyAction(g, 0, { type: "knock" }, 2000);
  assert.ok(applyAction(g, 0, { type: "timeout" }, 1000 + TURN_MS).message.includes("ran out of time"));
  assert.equal(g.hands[0].length, 2);
  assert.equal(g.current, 1);
});

test("fuzz: legal play keeps all 54 cards", () => {
  for (let game = 0; game < 100; game += 1) {
    let now = 1000;
    const g = newGame(["Ann", "Ben"], now, rng);
    for (let step = 0; step < 400 && !g.finished; step += 1) {
      now += 1000;
      const seat = g.current;
      if (g.hands[seat].length === 1 && !g.knocked[seat]) {
        assert.ok(applyAction(g, seat, { type: "knock" }, now).message);
      }
      const playable = g.hands[seat].filter((card) => isPlayable(g, card));
      const action = playable.length && rng() < 0.8
        ? { type: "play", cardId: playable[Math.floor(rng() * playable.length)].id, chosenSuit: "clubs" }
        : { type: "draw" };
      const result = applyAction(g, seat, action, now, rng);
      assert.ok(!result.error, `${JSON.stringify(action)} -> ${result.error}`);
      const cards = [...g.hands.flat(), ...g.deck, ...g.discard];
      assert.equal(cards.length, 54);
      assert.equal(new Set(cards.map((card) => card.id)).size, 54);
    }
  }
});
