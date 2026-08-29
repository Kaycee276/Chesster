const blockedCountries = () => new Set(
  String(process.env.BLOCKED_COUNTRIES || '')
    .split(',').map((country) => country.trim().toUpperCase()).filter(Boolean),
);

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return String(forwarded || req.headers['cf-connecting-ip'] || req.ip || '').split(',')[0].trim();
}

function geoBlock(req, res, next) {
  const country = String(
    req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || req.headers['x-country-code'] || '',
  ).toUpperCase();
  if (country && blockedCountries().has(country)) {
    return res.status(451).json({ error: 'This region is not permitted to access wagered gameplay.' });
  }
  req.clientIp = clientIp(req);
  req.clientCountry = country || null;
  return next();
}

module.exports = { geoBlock, clientIp };
