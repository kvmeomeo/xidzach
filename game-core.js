'use strict';
const { randomInt } = require('node:crypto');

const SUITS = ['♠','♥','♣','♦'];
const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const MAX_PLAYERS = 7; // 1 nhà cái + tối đa 6 nhà con; 52 lá đủ khi mỗi người kéo tối đa 5 lá.

function makeDeck() {
  const cards = SUITS.flatMap(suit => RANKS.map(rank => ({rank, suit})));
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}
function bestScore(cards) {
  let totals = new Set([0]);
  for (const card of cards) {
    const options = card.rank === 'A' ? [1,10,11] : ['J','Q','K'].includes(card.rank) ? [10] : [Number(card.rank)];
    const next = new Set();
    for (const t of totals) for (const val of options) next.add(t + val);
    totals = next;
  }
  const sorted = [...totals].sort((a,b)=>a-b);
  return sorted.filter(n => n <= 21).at(-1) ?? sorted[0] ?? 0;
}
function evaluate(cards) {
  const score = bestScore(cards);
  if (!cards || cards.length < 2) return {kind:'none',score,rank:-2,label:'Chưa chia'};
  const isAce = c => c.rank === 'A';
  const isTen = c => ['10','J','Q','K'].includes(c.rank);
  if (cards.length === 2 && cards.every(isAce)) return {kind:'bang',score,rank:5,label:'Xì Bàng'};
  if (cards.length === 2 && ((isAce(cards[0]) && isTen(cards[1])) || (isTen(cards[0]) && isAce(cards[1])))) return {kind:'dach',score,rank:4,label:'Xì Dách'};
  if (score > 21) return {kind:'bust',score,rank:0,label:'Quắc'};
  if (cards.length === 5) return {kind:'ngu',score,rank:3,label:'Ngũ Linh'};
  if (score >= 16) return {kind:'points',score,rank:2,label:score + ' điểm'};
  return {kind:'under',score,rank:1,label:score+' điểm · chưa đủ tuổi'};
}
// Return 1=nhà con thắng; 0=hòa; -1=nhà cái thắng.
function compareHands(childCards, dealerCards, childFold = false) {
  if (childFold) return -1;
  const child = evaluate(childCards), dealer = evaluate(dealerCards);
  if (child.kind === 'bust' && dealer.kind === 'bust') return 0; // Luật tùy chỉnh của bàn: cùng quắc hòa.
  if (child.rank !== dealer.rank) return child.rank > dealer.rank ? 1 : -1;
  if (child.kind === 'ngu') return child.score === dealer.score ? 0 : child.score < dealer.score ? 1 : -1;
  if (child.kind === 'points' || child.kind === 'under') return Math.sign(child.score - dealer.score);
  return 0;
}
function isNatural(cards) { return ['bang','dach'].includes(evaluate(cards).kind); }
function shouldFinish(cards) { return cards.length >= 5 || evaluate(cards).kind === 'bust' || isNatural(cards); }
module.exports = {SUITS,RANKS,MAX_PLAYERS,makeDeck,bestScore,evaluate,compareHands,isNatural,shouldFinish};
