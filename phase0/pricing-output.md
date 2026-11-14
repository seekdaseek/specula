| program | tx/day | tx/month | credits/month | marginal $/month (credits x $5/M) |
|---|---|---|---|---|
| auction-house | 2 | 60 | 17,341 | $0.09 |
| squads-v3 | 41 | 1,230 | 18,524 | $0.09 |
| jupiter-lend | 6,076 | 182,280 | 201,565 | $1.01 |
| squads-v4 | 6,214 | 186,420 | 205,751 | $1.03 |
| kamino-lend (extrap) | 75,819 | 2,274,570 | 2,316,870 | $11.58 |
| raydium-clmm (extrap) | 3,502,703 | 105,081,090 | 106,254,262 | $531.27 |

Plan fee shared (all N customers on one tier, cheapest Helius plan incl. $5/M overage; VPS $10/month ASSUMED):
| tier | N=10 | N=50 | N=200 |
|---|---|---|---|
| auction-house | $4.90 (Developer) +VPS $1.00 | $0.98 (Developer) +VPS $0.20 | $0.24 (Developer) +VPS $0.05 |
| squads-v3 | $4.90 (Developer) +VPS $1.00 | $0.98 (Developer) +VPS $0.20 | $0.24 (Developer) +VPS $0.05 |
| jupiter-lend | $4.90 (Developer) +VPS $1.00 | $0.99 (Developer) +VPS $0.20 | $1.00 (Developer) +VPS $0.05 |
| squads-v4 | $4.90 (Developer) +VPS $1.00 | $1.01 (Developer) +VPS $0.20 | $1.02 (Developer) +VPS $0.05 |
| kamino-lend (extrap) | $11.48 (Developer) +VPS $1.00 | $11.56 (Business) +VPS $0.20 | $11.58 (Business) +VPS $0.05 |
| raydium-clmm (extrap) | $531.17 (Business) +VPS $1.00 | $531.25 (Business) +VPS $0.20 | $531.27 (Business) +VPS $0.05 |

| tier | tx/month included | price/month | worst-case Helius cost at the cap | margin at cap before fixed costs |
|---|---|---|---|---|
| Starter | 100,000 | $9 | $0.59 | $8.41 |
| Growth | 1,000,000 | $39 | $5.14 | $33.86 |
| Scale | 5,000,000 | $149 | $25.36 | $123.64 |

break-even (Starter @ $9): marginal $0.59; (Helius $49 + VPS $10) / ($9 - $0.59) = 8 customers
break-even (Growth @ $39): marginal $5.14; (Helius $49 + VPS $10) / ($39 - $5.14) = 2 customers
break-even (Starter, typical load (auction-house) @ $9): marginal $0.09; (Helius $49 + VPS $10) / ($9 - $0.09) = 7 customers
break-even (Growth, typical load (jupiter-lend) @ $39): marginal $1.01; (Helius $49 + VPS $10) / ($39 - $1.01) = 2 customers
