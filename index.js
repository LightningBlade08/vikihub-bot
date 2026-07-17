const WebSocket = require('ws');
const https = require('https');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const BOT_TOKEN = '8692917018:AAGNnv4DHE0BDfWCUaW7c-sQBimMsHhL6hY';
const CHAT_ID   = '8302411984';
const APP_ID    = 1;
const WS_URL    = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;
const TICK_WINDOW = 1000;

// ─── MARKETS ──────────────────────────────────────────────────────────────────
const MARKETS = [
  { symbol:'R_10',   name:'Volatility 10'      },
  { symbol:'R_25',   name:'Volatility 25'      },
  { symbol:'R_50',   name:'Volatility 50'      },
  { symbol:'R_75',   name:'Volatility 75'      },
  { symbol:'R_100',  name:'Volatility 100'     },
];
const MARKETS_1S = [
  { symbol:'1HZ10V',  name:'Volatility 10 (1s)' },
  { symbol:'1HZ25V',  name:'Volatility 25 (1s)' },
  { symbol:'1HZ50V',  name:'Volatility 50 (1s)' },
  { symbol:'1HZ75V',  name:'Volatility 75 (1s)' },
  { symbol:'1HZ100V', name:'Volatility 100 (1s)'},
];
const ALL_MARKETS = [...MARKETS, ...MARKETS_1S];
const DIGITS = [0,1,2,3,4,5,6,7,8,9];

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function getMin(pct) { return Math.min(...DIGITS.map(d => pct[d])); }
function isUniqueLowest(pct) {
  const min = getMin(pct);
  return DIGITS.filter(d => pct[d] === min).length === 1;
}
function calcPct(ticks) {
  if (!ticks || ticks.length === 0) return null;
  const counts = Object.fromEntries(DIGITS.map(d => [d, 0]));
  ticks.forEach(t => counts[t % 10]++);
  const total = ticks.length;
  return Object.fromEntries(DIGITS.map(d => [d, (counts[d] / total) * 100]));
}
function getLastDigit(priceStr, pip) {
  const parts = String(priceStr).split('.');
  if (parts.length === 1) return 0;
  const decimals = parts[1].padEnd(pip, '0');
  return parseInt(decimals[pip - 1]) || 0;
}

// ─── BOT DEFINITIONS ──────────────────────────────────────────────────────────
const BOTS = [
  {
    id:1, name:'OVER BOT 1', markets: MARKETS,
    eval(pct) {
      if (!pct||!isUniqueLowest(pct)) return false;
      const min=getMin(pct);
      return pct[0]<9 && pct[1]<9 && (pct[0]===min||pct[1]===min);
    },
  },
  {
    id:2, name:'OVER 2 MAX', markets: MARKETS,
    eval(pct) {
      if (!pct||!isUniqueLowest(pct)) return false;
      const min=getMin(pct);
      return [0,1,2].every(d=>pct[d]<9.5) && [0,1,2].some(d=>pct[d]===min);
    },
  },
  {
    id:3, name:'Phantom U9', markets: MARKETS,
    eval() { return false; }, // WIP
  },
  {
    id:4, name:'VIET X1', markets: MARKETS,
    eval(pct) {
      if (!pct||!isUniqueLowest(pct)) return false;
      const min=getMin(pct);
      return pct[9]===min && [3,4,5,6,7,8].every(d=>pct[d]<10) && pct[3]<9.5;
    },
  },
  {
    id:5, name:'OVER/UNDER BOT', markets: MARKETS,
    eval(pct) {
      if (!pct||!isUniqueLowest(pct)) return false;
      const min=getMin(pct);
      return [0,1,8,9].every(d=>pct[d]<9.5) && [0,1,8,9].some(d=>pct[d]===min);
    },
  },
  {
    id:6, name:'VIET X2', markets: MARKETS,
    eval(pct) {
      if (!pct||!isUniqueLowest(pct)) return false;
      const min=getMin(pct);
      return pct[9]===min && pct[5]<9.5 && [6,7,8].every(d=>pct[d]<10);
    },
  },
  {
    id:7, name:'VIKI TRIPLE X', markets: MARKETS,
    eval(pct) {
      if (!pct||!isUniqueLowest(pct)) return false;
      const min=getMin(pct);
      return pct[0]===min && pct[4]<9.5 && [1,2,3].every(d=>pct[d]<10);
    },
  },
  {
    id:8, name:'VIKI DIAMOND X', markets: MARKETS_1S,
    eval(pct) {
      if (!pct||!isUniqueLowest(pct)) return false;
      const min=getMin(pct);
      return pct[0]<9.5 && pct[1]<9.5 && [2,3,4].every(d=>pct[d]<10.5) && (pct[0]===min||pct[1]===min);
    },
  },
];

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
function sendTelegram(message) {
  const body = JSON.stringify({ chat_id: CHAT_ID, text: message, parse_mode: 'HTML' });
  const options = {
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  };
  const req = https.request(options, res => {
    res.on('data', () => {});
  });
  req.on('error', e => console.error('Telegram error:', e.message));
  req.write(body);
  req.end();
}

// ─── MARKET STATE ─────────────────────────────────────────────────────────────
const state = {};
ALL_MARKETS.forEach(m => {
  state[m.symbol] = { ticks: [], pct: null, pip: null };
});

const prevSignals = {};

// ─── CHECK ALL BOTS ───────────────────────────────────────────────────────────
function checkBots() {
  BOTS.forEach(bot => {
    bot.markets.forEach(market => {
      const s = state[market.symbol];
      if (!s.pct) return;
      const signal = bot.eval(s.pct);
      const key = `${bot.id}-${market.symbol}`;
      if (signal && !prevSignals[key]) {
        const min = getMin(s.pct);
        const redDigit = DIGITS.find(d => s.pct[d] === min);
        const msg =
          `🟢 <b>${bot.name} — TRADE NOW</b>\n` +
          `📊 Market: <b>${market.name}</b>\n` +
          `🔴 Red digit: D${redDigit} @ ${s.pct[redDigit].toFixed(1)}%\n` +
          `⏰ ${new Date().toLocaleTimeString()}`;
        sendTelegram(msg);
        console.log(`[SIGNAL] ${bot.name} → ${market.name}`);
      }
      prevSignals[key] = signal;
    });
  });
}

// ─── WEBSOCKET PER MARKET ─────────────────────────────────────────────────────
function connectMarket(market) {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`[WS] Connected: ${market.name}`);
    ws.send(JSON.stringify({ ticks_history: market.symbol, count: 1000, end: 'latest', style: 'ticks', subscribe: 1 }));
  });

  ws.on('message', (raw) => {
    const rawStr = raw.toString();
    const data = JSON.parse(rawStr);

    if (data.msg_type === 'history') {
      const pricesMatch = rawStr.match(/"prices":\[([^\]]+)\]/);
      if (!pricesMatch) return;
      const priceStrings = pricesMatch[1].split(',').map(p => p.trim());
      const firstPrice = priceStrings.find(p => p.includes('.')) || priceStrings[0];
      const dotIdx = firstPrice.indexOf('.');
      const pip = dotIdx === -1 ? 0 : firstPrice.length - dotIdx - 1;
      state[market.symbol].pip = pip;
      const ticks = priceStrings.map(p => {
        const parts = p.split('.');
        if (parts.length === 1 || pip === 0) return 0;
        return parseInt(parts[1][pip-1] || '0') || 0;
      }).slice(-TICK_WINDOW);
      state[market.symbol].ticks = ticks;
      state[market.symbol].pct = calcPct(ticks);
      checkBots();
    }

    if (data.msg_type === 'tick') {
      const quoteMatch = rawStr.match(/"quote":([\d.]+)/);
      if (!quoteMatch) return;
      const pip = state[market.symbol].pip;
      if (pip == null) return;
      const parts = quoteMatch[1].split('.');
      const lastDigit = parts.length === 1 ? 0 : parseInt(parts[1][pip-1] || '0') || 0;
      const ticks = [...state[market.symbol].ticks, lastDigit].slice(-TICK_WINDOW);
      state[market.symbol].ticks = ticks;
      state[market.symbol].pct = calcPct(ticks);
      checkBots();
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Disconnected: ${market.name} — reconnecting in 3s`);
    setTimeout(() => connectMarket(market), 3000);
  });

  ws.on('error', (e) => {
    console.error(`[WS] Error on ${market.name}:`, e.message);
    ws.terminate();
  });

  // Resync every 3 minutes
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ ticks_history: market.symbol, count: 1000, end: 'latest', style: 'ticks' }));
    }
  }, 3 * 60 * 1000);
}

// ─── START ────────────────────────────────────────────────────────────────────
console.log('🚀 VIKIHUB Volatility Signal Bot starting...');
sendTelegram('🚀 <b>VIKIHUB Signal Bot is now ONLINE</b>\nMonitoring all markets 24/7...');
ALL_MARKETS.forEach(connectMarket);

// Keep Railway happy with a simple HTTP server
const http = require('http');
http.createServer((req, res) => res.end('VIKIHUB Bot Running')).listen(process.env.PORT || 3000);
