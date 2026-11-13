'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {SUITS,RANKS,makeDeck,bestScore,evaluate,compareHands,shouldFinish}=require('../game-core');
const c=(rank,suit='♠')=>({rank,suit});

test('Bộ bài có 52 lá không trùng',()=>{
 const deck=makeDeck();assert.equal(deck.length,52);
 assert.equal(new Set(deck.map(x=>x.rank+x.suit)).size,52);
 assert.equal(SUITS.length,4);assert.equal(RANKS.length,13);
});
test('Các tổ hợp Át và mốc điểm',()=>{
 assert.equal(bestScore([c('A'),c('9')]),20);
 assert.equal(bestScore([c('A'),c('A'),c('9')]),21);
 assert.equal(bestScore([c('A'),c('9'),c('8')]),18);
 assert.equal(evaluate([c('A'),c('A')]).kind,'bang');
 assert.equal(evaluate([c('A'),c('K')]).kind,'dach');
 assert.equal(evaluate([c('A'),c('10')]).kind,'dach');
 assert.equal(evaluate([c('J'),c('Q')]).kind,'points');
 assert.equal(evaluate([c('10'),c('7')]).score,17);
});
test('Ngũ Linh thắng điểm thường, ít điểm hơn thắng Ngũ Linh',()=>{
 const nguLow=[c('2'),c('2'),c('2'),c('3'),c('3')];
 const nguHigh=[c('3'),c('3'),c('4'),c('4'),c('4')];
 const points=[c('K'),c('A'),c('2')];
 assert.equal(evaluate(nguLow).kind,'ngu');
 assert.equal(compareHands(nguLow,points),1);
 assert.equal(compareHands(nguHigh,nguLow),-1);
 assert.equal(evaluate(nguHigh).score,18);
});
test('Quắc / chưa đủ tuổi / xét hòa',()=>{
 const bust=[c('K'),c('Q'),c('6')], points=[c('9'),c('8')];
 assert.equal(evaluate(bust).kind,'bust');
 assert.equal(evaluate([c('7'),c('8')]).kind,'under');
 assert.equal(compareHands(points,bust),1);
 assert.equal(compareHands(bust,points),-1);
 assert.equal(compareHands(bust,bust),0);
 assert.equal(compareHands([c('9'),c('9')],[c('10'),c('8')]),0);
 assert.equal(compareHands(points,points,true),-1);
 assert.equal(shouldFinish([c('A'),c('A')]),true);
});
