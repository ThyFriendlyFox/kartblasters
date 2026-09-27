// Vercel serverless function: GET /api/turn
//
// Hands the game short-lived Cloudflare TURN credentials, so players on
// strict networks can still connect (their traffic is relayed through
// Cloudflare). The API token stays here on the server; set these in
// Vercel -> Project -> Settings -> Environment Variables:
//   CLOUDFLARE_TURN_KEY_ID     the TURN key's ID
//   CLOUDFLARE_TURN_API_TOKEN  the TURN key's API token
const TTL = 12 * 60 * 60; // seconds the credentials stay valid

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const id = process.env.CLOUDFLARE_TURN_KEY_ID, token = process.env.CLOUDFLARE_TURN_API_TOKEN;
  if (!id || !token) return res.status(503).json({ error: 'TURN is not configured' });
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(id)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL }),
    });
    if (!r.ok) return res.status(502).json({ error: `Cloudflare answered ${r.status}` });
    const { iceServers = [] } = await r.json();
    // Browsers block port 53, and trying it only slows connections down
    const clean = iceServers
      .map((s) => ({ ...s, urls: [s.urls].flat().filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length);
    return res.status(200).json({ iceServers: clean, ttl: TTL });
  } catch (e) {
    return res.status(502).json({ error: String(e?.message || e) });
  }
}
