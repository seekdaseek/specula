D=30
tiers=[("low: auction-house",2),("low: squads-v3",55),("mid: jupiter-lend",6147),("mid: squads-v4",6512),("MEDIAN of 6",(6147+6512)/2),("high: kamino-lend (extrap)",120368),("high: raydium-clmm (extrap, wild)",6283636)]
POLL=4*60*24*D   # 15 s polling calls/month
GSFA_B=226; TX_B=8327; LOG_B=4551
def usd(x): return f"${x:,.2f}" if x>=0.01 else f"${x:.4f}"
rows=[]
for name,d in tiers:
    n=d*D
    # Helius @ $5 per M credits
    H=5e-6
    a=n*1*H
    b=(n*LOG_B/1e6*20 + n*1)*H
    c=(POLL*1 + n*1)*H
    # QuickNode Solana 30 credits/call @ $0.43/M credits (Build, lowest listed)
    Q=0.43e-6*30
    q_c=(POLL+n)*Q
    q_b_noWS=n*Q   # getTransaction only; WS price UNVERIFIED
    # Triton $10/M calls + $0.08/GB
    T=10e-6; GB=0.08/1e9
    t_c=(POLL+n)*T + (POLL*0 + 0)  # bandwidth below
    t_c+= (POLL*0 + 0)
    # bandwidth for C: each poll returns new sigs only (~226B each) + empty poll ~ 40B (assumed) ; plus tx bytes
    t_c+= (n*GSFA_B + POLL*40 + n*TX_B)*GB
    t_b=n*T + (n*LOG_B + n*TX_B)*GB
    # Chainstack Growth $49/20M RU = $2.45/M RU (included rate; overage UNVERIFIED). gSFA 2 RU, getTx 1 RU
    CS=49/20e6
    cs_c=(POLL*2 + n*1)*CS
    rows.append((name,d,n,a,b,c,q_c,q_b_noWS,t_b,t_c,cs_c))
print("| tier | tx/day | tx/month | A Helius webhook | B Helius WSS logs + getTx | C Helius poll 15s | C QuickNode poll | B QuickNode getTx only (WS UNVERIFIED) | B Triton | C Triton | C Chainstack |")
print("|---|---|---|---|---|---|---|---|---|---|---|")
for r in rows:
    print(f"| {r[0]} | {r[1]:,.0f} | {r[2]:,.0f} | "+" | ".join(usd(x) for x in r[3:])+" |")
print("poll calls/mo",POLL)
