const deck = [];

// Add 10 money cards
for (let i = 0; i < 10; i++) {
  deck.push({ type: "money", value: 1, name: "Money 1M" });
}

// Add 10 more
for (let i = 0; i < 10; i++) {
  deck.push({ type: "money", value: 2, name: "Money 2M" });
}

// Add some properties
deck.push({ type: "property", color: "blue", name: "Boardwalk" });
deck.push({ type: "property", color: "blue", name: "Park Place" });
deck.push({ type: "property", color: "red", name: "Kentucky Avenue" });
deck.push({ type: "property", color: "red", name: "Indiana Avenue" });

// Add some action cards
deck.push({ type: "action", name: "Rent Blue", effect: "collect rent" });
deck.push({ type: "action", name: "Rent Red", effect: "collect rent" });
deck.push({ type: "action", name: "Just Say No", effect: "cancel action" });

module.exports = deck;
