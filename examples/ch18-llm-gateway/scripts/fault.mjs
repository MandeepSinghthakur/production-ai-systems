const args = process.argv.slice(2).join(' ');
const body = args || '{}';
const res = await fetch('http://localhost:8081/fault', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});
console.log(await res.text());
