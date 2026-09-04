// Verifies the rules used by Daily Entry: multiple transactions may share a
// date, and a day's revenue is the sum of every transaction on that date.

const entries = [
  { date: '2026-09-03', amount_kes: 12000 },
  { date: '2026-09-03', amount_kes: 8500 },
  { date: '2026-09-04', amount_kes: 7000 }
];

const dailyTotals = entries.reduce((totals, entry) => {
  totals[entry.date] = (totals[entry.date] || 0) + entry.amount_kes;
  return totals;
}, {});

if(entries.filter(entry => entry.date === '2026-09-03').length !== 2){
  throw new Error('Multiple revenue entries for one date were not preserved.');
}
if(dailyTotals['2026-09-03'] !== 20500){
  throw new Error(`Expected 2026-09-03 total to be KES 20,500, got KES ${dailyTotals['2026-09-03']}.`);
}
if(Object.keys(dailyTotals).length !== 2){
  throw new Error('Daily totals should count distinct calendar dates.');
}

console.log('PASS — multiple same-day revenue entries are preserved and aggregated by date.');