const rpc='https://api.mainnet-beta.solana.com';
const call=async(m,p)=>{const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p})});const s=await r.text();return {s,bytes:Buffer.byteLength(s),j:JSON.parse(s)}};
for (const id of ['jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9','SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf']){
 const g=await call('getSignaturesForAddress',[id,{limit:1000}]);
 const sigs=g.j.result; let tb=0,k=0;
 for(const s of sigs.slice(0,20)){const t=await call('getTransaction',[s.signature,{encoding:'json',maxSupportedTransactionVersion:0,commitment:'confirmed'}]); if(t.j.result){tb+=t.bytes;k++;} await new Promise(r=>setTimeout(r,250));}
 console.log(JSON.stringify({id,gsfa_bytes_per_sig:Math.round(g.bytes/sigs.length),getTx_avg_bytes:Math.round(tb/k),sampled:k}));
}
