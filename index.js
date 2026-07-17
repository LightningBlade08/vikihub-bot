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
  { symbol:'R_10',   name:'Volatility 10'       },
  { symbol:'R_25',   name:'Volatility 25'       },
  { symbol:'R_50',   name:'Volatility 50'       },
  { symbol:'R_75',   name:'Volatility 75'       },
  { symbol:'R_100',  name:'Volatility 100'      },
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
  return Object.fromEntries(DIGITS.map(d => [d, (counts[d] / ticks.length) * 100]));
}

// ─── BOTS ─────────────────────────────────────────────────────────────────────
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
  { id:3, name:'Phantom U9', markets: MARKETS, eval() { return false; } },
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
function telegramRequest(method, body) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}

async function sendMessage(text) {
  const res = await telegramRequest('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML' });
  return res?.result?.message_id || null;
}

async function editMessage(messageId, text) {
  await telegramRequest('editMessageText', { chat_id: CHAT_ID, message_id: messageId, text, parse_mode: 'HTML' });
}

async function deleteMessage(messageId) {
  await telegramRequest('deleteMessage', { chat_id: CHAT_ID, message_id: messageId });
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const marketState = {};
ALL_MARKETS.forEach(m => { marketState[m.symbol] = { ticks: [], pct: null, pip: null }; });

// Track active signals: { botId_symbol: { marketName, redDigit, pct } }
const activeSignals = {};
let signalMessageId = null;
let updateScheduled = false;

// ─── BUILD MESSAGE ────────────────────────────────────────────────────────────
function buildSignalMessage() {
  const entries = Object.entries(activeSignals);
  if (entries.length === 0) return null;

  let msg = `🟢 <b>VIKIHUB ACTIVE SIGNALS</b>\n`;
  msg += `🕐 ${new Date().toLocaleTimeString()}\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n\n`;

  // Group by bot
  const byBot = {};
  entries.forEach(([key, val]) => {
    const botId = parseInt(key.split('_')[0]);
    if (!byBot[botId]) byBot[botId] = [];
    byBot[botId].push(val);
  });

  Object.entries(byBot).forEach(([botId, signals]) => {
    const bot = BOTS.find(b => b.id === parseInt(botId));
    msg += `📌 <b>${bot.name}</b>\n`;
    signals.forEach(s => {
      msg += `   📊 ${s.marketName}\n`;
      msg += `   🔴 Red: D${s.redDigit} @ ${s.redPct}%\n`;
    });
    msg += '\n';
  });

  return msg;
}

// ─── UPDATE SIGNAL MESSAGE ────────────────────────────────────────────────────
async function updateSignalMessage() {
  updateScheduled = false;
  const msg = buildSignalMessage();

  if (!msg) {
    // No active signals — delete message
    if (signalMessageId) {
      await deleteMessage(signalMessageId);
      signalMessageId = null;
      console.log('[MSG] Signal cleared — message deleted');
    }
    return;
  }

  if (signalMessageId) {
    // Edit existing message
    await editMessage(signalMessageId, msg);
    console.log('[MSG] Signal message updated');
  } else {
    // Send new message
    signalMessageId = await sendMessage(msg);
    console.log('[MSG] New signal message sent:', signalMessageId);
  }
}

function scheduleUpdate() {
  if (!updateScheduled) {
    updateScheduled = true;
    setTimeout(updateSignalMessage, 1500); // debounce 1.5s
  }
}

// ─── CHECK BOTS ───────────────────────────────────────────────────────────────
function checkBots() {
  let changed = false;

  BOTS.forEach(bot => {
    bot.markets.forEach(market => {
      const s = marketState[market.symbol];
      if (!s.pct) return;
      const signal = bot.eval(s.pct);
      const key = `${bot.id}_${market.symbol}`;

      if (signal && !activeSignals[key]) {
        const min = getMin(s.pct);
        const redDigit = DIGITS.find(d => s.pct[d] === min);
        activeSignals[key] = {
          marketName: market.name,
          redDigit,
          redPct: s.pct[redDigit].toFixed(1),
        };
        console.log(`[SIGNAL ON] ${bot.name} → ${market.name}`);
        changed = true;
      } else if (!signal && activeSignals[key]) {
        delete activeSignals[key];
        console.log(`[SIGNAL OFF] ${bot.name} → ${market.name}`);
        changed = true;
      } else if (signal && activeSignals[key]) {
        // Update red digit % in case it changed
        const min = getMin(s.pct);
        const redDigit = DIGITS.find(d => s.pct[d] === min);
        activeSignals[key].redDigit = redDigit;
        activeSignals[key].redPct = s.pct[redDigit].toFixed(1);
      }
    });
  });

  if (changed) scheduleUpdate();
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
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
      marketState[market.symbol].pip = pip;
      const ticks = priceStrings.map(p => {
        const parts = p.split('.');
        if (parts.length === 1 || pip === 0) return 0;
        return parseInt(parts[1][pip-1] || '0') || 0;
      }).slice(-TICK_WINDOW);
      marketState[market.symbol].ticks = ticks;
      marketState[market.symbol].pct = calcPct(ticks);
      checkBots();
    }

    if (data.msg_type === 'tick') {
      const quoteMatch = rawStr.match(/"quote":([\d.]+)/);
      if (!quoteMatch) return;
      const pip = marketState[market.symbol].pip;
      if (pip == null) return;
      const parts = quoteMatch[1].split('.');
      const lastDigit = parts.length === 1 ? 0 : parseInt(parts[1][pip-1] || '0') || 0;
      const ticks = [...marketState[market.symbol].ticks, lastDigit].slice(-TICK_WINDOW);
      marketState[market.symbol].ticks = ticks;
      marketState[market.symbol].pct = calcPct(ticks);
      checkBots();
    }
  });

  ws.on('close', () => {
    console.log(`[WS] Disconnected: ${market.name} — reconnecting in 3s`);
    setTimeout(() => connectMarket(market), 3000);
  });

  ws.on('error', (e) => { console.error(`[WS] Error: ${market.name}:`, e.message); ws.terminate(); });

  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ ticks_history: market.symbol, count: 1000, end: 'latest', style: 'ticks' }));
  }, 3 * 60 * 1000);
}

// ─── START ────────────────────────────────────────────────────────────────────
console.log('🚀 VIKIHUB Signal Bot starting...');
sendMessage('🚀 <b>VIKIHUB Signal Bot is ONLINE</b>\nMonitoring all markets 24/7...');
ALL_MARKETS.forEach(connectMarket);

const http = require('http');
http.createServer((req, res) => res.end('VIKIHUB Bot Running')).listen(process.env.PORT || 3000);
