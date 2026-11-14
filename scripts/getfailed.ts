import fs from 'node:fs';
const rpc='https://api.mainnet-beta.solana.com';
const call=async(m:string,p:unknown[])=>{for(let a=0;a<6;a++){const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})});if(r.status===429){await new Promise(r=>setTimeout(r,2000));continue}return (await r.json() as any).result}};
const sigs=await call('getSignaturesForAddress',['jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9',{limit:1000}]);
const f=sigs.filter((s:any)=>s.err).slice(0,3);
for(const s of f){const tx=await call('getTransaction',[s.signature,{encoding:'json',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);if(tx){fs.writeFileSync(`phase0/jl-candidates/FAILED-${s.signature}.json`,JSON.stringify(tx));console.log('failed saved',s.signature.slice(0,10),JSON.stringify(s.err))}await new Promise(r=>setTimeout(r,500))}
