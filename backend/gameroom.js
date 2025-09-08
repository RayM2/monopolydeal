class GameRoom {
  constructor(id) {
    this.id = id;
    this.players = {}; // { playerId: { hand, bank, properties } }
    this.turnOrder = [];
    this.currentTurnIndex = 0;
    this.deck = [];
    this.discardPile = [];
  }

  /** Add a new player to the game */
  addPlayer(playerId) {
    if (this.players[playerId]) {
      throw new Error(`Player ${playerId} already exists`);
    }

    this.players[playerId] = {
      id: playerId,
      hand: [],
      bank: [],
      properties: [],
    };

    this.turnOrder.push(playerId);
  }

  /** Deal initial cards */
  dealInitialCards(cardsPerPlayer = 5) {
    this.turnOrder.forEach((playerId) => {
      for (let i = 0; i < cardsPerPlayer; i++) {
        this.drawCard(playerId);
      }
    });
  }
  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
    }

  /** Draw card */
  drawCard(playerId) {
    if (this.deck.length === 0) {
      this.reshuffleDiscardIntoDeck();
    }
    if (this.deck.length === 0) return null;
    const card = this.deck.pop();
    this.players[playerId].hand.push(card);
    return card;
  }

  /** Play a card from hand */
  playCard(playerId, cardIndex) {
    const player = this.players[playerId];
    if (!player) throw new Error("Invalid player");
    if (cardIndex < 0 || cardIndex >= player.hand.length) {
        console.warn(`Invalid card index from ${playerId}: ${cardIndex}`);
        return null;
        }

    const card = player.hand.splice(cardIndex, 1)[0];
    this.discardPile.push(card);
    return card;
  }

  /** Next turn */
  nextTurn() {
    this.currentTurnIndex =
      (this.currentTurnIndex + 1) % this.turnOrder.length;
    return this.turnOrder[this.currentTurnIndex];
  }

  /** Shuffle discard pile back into deck */
  reshuffleDiscardIntoDeck() {
    if (this.discardPile.length === 0) return;
    this.deck = this.discardPile;
    this.discardPile = [];
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  /** Custom serializer (don't try to store WebSocket objects) */
  toJSON() {
    return {
      id: this.id,
      players: this.players,
      turnOrder: this.turnOrder,
      currentTurnIndex: this.currentTurnIndex,
      deck: this.deck,
      discardPile: this.discardPile,
    };
  }

  /** Save state into Redis */
  async saveToRedis(redis) {
    await redis.set(`game:${this.id}`, JSON.stringify(this.toJSON()));
  }

  /** Load state from Redis */
  static async loadFromRedis(redis, id) {
    const data = await redis.get(`game:${id}`);
    if (!data) return null;
    const obj = JSON.parse(data);
    const gameRoom = new GameRoom(obj.id);
    Object.assign(gameRoom, obj);
    return gameRoom;
  }
}

module.exports = GameRoom;
