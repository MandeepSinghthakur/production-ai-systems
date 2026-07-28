const res = await fetch('http://localhost:8080/ledger');
console.log(await res.text());
