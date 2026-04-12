const OLA_KEY = process.env.OLA_MAPS_API_KEY;

async function run() {
  const q = "arcade in Bandra Mumbai";
  const url = `https://api.olamaps.io/places/v1/textsearch?input=${encodeURIComponent(q)}&api_key=${OLA_KEY}`;
  const res = await fetch(url, { headers: { "X-Request-Id": "123" } });
  if (!res.ok) {
    console.log("FAIL", res.status);
  }
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
