const WebSocket = require('ws');
const https = require('https');
const http = require('http');

const BOT_TOKEN = '8692917018:AAGNnv4DHE0BDfWCUaW7c-sQBimMsHhL6hY';
const CHAT_ID   = '8302411984';
const WS_URL    = 'wss://ws.binaryws.com/websockets/v3?app_id=1';
const TICK_WINDOW = 1000;

function sriLankaTime() {
  return new Date().toLocaleTimeString('en-US', { timeZone: 'Asia/Colombo', hour12: true });
}

const MARKETS = [
  { symbol:'R_10',    name:'Volatility 10'       },
  { symbol:'R_25',    name:'Volatility 25'       },
  { symbol:'R_50',    name:'Volatility 50'       },
  { symbol:'R_75',    name:'Volatility 75'       },
  { symbol:'R_100',   name:'Volatility 100'      },
];
const MARKETS_1S = [
  { symbol:'1HZ10V',  name:'Volatility 10 (1s)'  },
  { symbol:'1HZ25V',  name:'Volatility 25 (1s)'  },
  { symbol:'1HZ50V',  name:'Volatility 50 (1s)'  },
  { symbol:'1HZ75V',  name:'Volatility 75 (1s)'  },
  { symbol:'1HZ100V', name:'Volatility 100 (1s)' },
];
const ALL_MARKETS = [...MARKETS, ...MARKETS_1S];
const DIGITS = [0,1,2,3,4,5,6,7,8,9];

function getMin(pct)  { return Math.min(...DIGITS.map(d => pct[d])); }
function getMax(pct)  { return Math.max(...DIGITS.map(d => pct[d])); }
function uniqueLowest(pct) {
  const min = getMin(pct);
  return DIGITS.filter(d => pct[d] === min).length === 1;
}
function redDigit(pct) {
  const min = getMin(pct);
  return DIGITS.find(d => pct[d] === min);
}
function calcPct(ticks) {
  if (!ticks || ticks.length === 0) return null;
  const counts = Object.fromEntries(DIGITS.map(d => [d, 0]));
  ticks.forEach(t => counts[t % 10]++);
  return Object.fromEntries(DIGITS.map(d => [d, (counts[d] / ticks.length) * 100]));
}

const BOTS = [
  {
    id: 1, name: 'OVER BOT 1', markets: MARKETS,
    eval(pct) {
      if (!pct || !uniqueLowest(pct)) return false;
      const rd = redDigit(pct);
      // D0 and D1 both under 9%, and one of them is the red digit
      return pct[0] < 9 && pct[1] < 9 && (rd === 0 || rd === 1);
    },
  },
  {
    id: 2, name: 'OVER 2 MAX', markets: MARKETS,
    eval(pct) {
      if (!pct || !uniqueLowest(pct)) return false;
      const rd = redDigit(pct);
      // D0, D1, D2 all under 9.5%, one of them is red
      return pct[0] < 9.5 && pct[1] < 9.5 && pct[2] < 9.5 && (rd === 0 || rd === 1 || rd === 2);
    },
  },
  {
    id: 3, name: 'Phantom U9', markets: MARKETS,
    eval() { return false; }, // WIP
  },
  {
    id: 4, name: 'VIET X1', markets: MARKETS,
    eval(pct) {
      if (!pct || !uniqueLowest(pct)) return false;
      const rd = redDigit(pct);
      // D9 must be red, D3-D8 all under 10%, D3 also under 9.5%
      return rd === 9 &&
             pct[3] < 9.5 &&
             [3,4,5,6,7,8].every(d => pct[d] < 10);
    },
  },
  {
    id: 5, name: 'OVER/UNDER BOT', markets: MARKETS,
    eval(pct) {
      if (!pct || !uniqueLowest(pct)) return false;
      const rd = redDigit(pct);
      // D0, D1, D8, D9 all under 9.5%, one of them is red
      return pct[0] < 9.5 && pct[1] < 9.5 && pct[8] < 9.5 && pct[9] < 9.5 &&
             (rd === 0 || rd === 1 || rd === 8 || rd === 9);
    },
  },
  {
    id: 6, name: 'VIET X2', markets: MARKETS,
    eval(pct) {
      if (!pct || !uniqueLowest(pct)) return false;
      const rd = redDigit(pct);
      // D9 must be red, D5 under 9.5%, D6/D7/D8 under 10%
      return rd === 9 &&
             pct[5] < 9.5 &&
             [6,7,8].every(d => pct[d] < 10);
    },
  },
  {
    id: 7, name: 'VIKI TRIPLE X', markets: MARKETS,
    eval(pct) {
      if (!pct || !uniqueLowest(pct)) return false;
      const rd = redDigit(pct);
      // D0 must be red, D4 under 9.5%, D1/D2/D3 under 10%
      return rd === 0 &&
             pct[4] < 9.5 &&
             [1,2,3].every(d => pct[d] < 10);
    },
  },
  {
    id: 8, name: 'VIKI DIAMOND X', markets: MARKETS_1S,
    eval(pct) {
      if (!pct || !uniqueLowest(pct)) return false;
      const rd = redDigit(pct);
      // D0 and D1 both under 9.5%, one is red, D2/D3/D4 under 10.5%
      return pct[0] < 9.5 && pct[1] < 9.5 &&
             (rd === 0 || rd === 1) &&
             [2,3,4].every(d => pct[d] < 10.5);
    },
  },
];

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
function tgRequest(method, body) {
  return new Promise(resolve => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
    });
    req.on('error', () => resolve(null));
    req.write(data);
    req.end();
  });
}
async function sendMsg(text) {
  const r = await tgRequest('sendMessage', { chat_id: CHAT_ID, text, parse_mode: 'HTML' });
  return r?.result?.message_id || null;
}
async function editMsg(id, text) {
  await tgRequest('editMessageText', { chat_id: CHAT_ID, message_id: id, text, parse_mode: 'HTML' });
}
async function deleteMsg(id) {
  await tgRequest('deleteMessage', { chat_id: CHAT_ID, message_id: id });
}

// ─── STATE ────────────────────────────────────────────────────────────────────
const mktState = {};
ALL_MARKETS.forEach(m => { mktState[m.symbol] = { ticks: [], pct: null, pip: null }; });

const activeSignals = {}; // key: `botId_symbol`
let signalMsgId = null;
let updatePending = false;

function buildMessage() {
  const keys = Object.keys(activeSignals);
  if (keys.length === 0) return null;

  // Group by bot
  const byBot = {};
  keys.forEach(k => {
    const [botId] = k.split('_');
    if (!byBot[botId]) byBot[botId] = [];
    byBot[botId].push(activeSignals[k]);
  });

  let msg = `🟢 <b>VIKIHUB ACTIVE SIGNALS</b>\n`;
  msg += `🕐 ${sriLankaTime()} (SL Time)\n`;
  msg += `━━━━━━━━━━━━━━━\n\n`;

  Object.entries(byBot).forEach(([botId, sigs]) => {
    const bot = BOTS.find(b => b.id === parseInt(botId));
    msg += `📌 <b>${bot.name}</b>\n`;
    sigs.forEach(s => {
      msg += `  📊 ${s.market}\n`;
      msg += `  🔴 D${s.red} @ ${s.redPct}%\n`;
    });
    msg += '\n';
  });

  return msg.trim();
}

async function updateSignalMessage() {
  updatePending = false;
  const msg = buildMessage();

  if (!msg) {
    if (signalMsgId) {
      await deleteMsg(signalMsgId);
      signalMsgId = null;
      console.log('[SIGNALS] All clear — message deleted');
    }
    return;
  }

  if (signalMsgId) {
    await editMsg(signalMsgId, msg);
    console.log('[SIGNALS] Message updated');
  } else {
    signalMsgId = await sendMsg(msg);
    console.log('[SIGNALS] New message sent:', signalMsgId);
  }
}

function scheduleUpdate() {
  if (!updatePending) {
    updatePending = true;
    setTimeout(updateSignalMessage, 2000);
  }
}

// ─── CHECK BOTS ───────────────────────────────────────────────────────────────
function checkBots() {
  let changed = false;
  BOTS.forEach(bot => {
    bot.markets.forEach(market => {
      const s = mktState[market.symbol];
      if (!s || !s.pct) return;
      const signal = bot.eval(s.pct);
      const key = `${bot.id}_${market.symbol}`;

      if (signal) {
        const rd = redDigit(s.pct);
        const newData = { market: market.name, red: rd, redPct: s.pct[rd].toFixed(1) };
        if (!activeSignals[key]) {
          activeSignals[key] = newData;
          console.log(`[ON]  ${bot.name} → ${market.name}`);
          changed = true;
        } else if (activeSignals[key].redPct !== newData.redPct) {
          activeSignals[key] = newData;
          changed = true;
        }
      } else {
        if (activeSignals[key]) {
          delete activeSignals[key];
          console.log(`[OFF] ${bot.name} → ${market.name}`);
          changed = true;
        }
      }
    });
  });
  if (changed) scheduleUpdate();
}

// ─── WEBSOCKET ────────────────────────────────────────────────────────────────
function connectMarket(market) {
  const ws = new WebSocket(WS_URL);

  ws.on('open', () => {
    console.log(`[WS] ${market.name} connected`);
    ws.send(JSON.stringify({ ticks_history: market.symbol, count: 1000, end: 'latest', style: 'ticks', subscribe: 1 }));
  });

  ws.on('message', raw => {
    const str = raw.toString();
    const data = JSON.parse(str);

    if (data.msg_type === 'history') {
      const match = str.match(/"prices":\[([^\]]+)\]/);
      if (!match) return;
      const prices = match[1].split(',').map(p => p.trim());
      const first = prices.find(p => p.includes('.')) || prices[0];
      const dot = first.indexOf('.');
      const pip = dot === -1 ? 0 : first.length - dot - 1;
      mktState[market.symbol].pip = pip;
      const ticks = prices.map(p => {
        const parts = p.split('.');
        if (parts.length === 1 || pip === 0) return 0;
        return parseInt(parts[1].padEnd(pip,'0')[pip-1]) || 0;
      }).slice(-TICK_WINDOW);
      mktState[market.symbol].ticks = ticks;
      mktState[market.symbol].pct = calcPct(ticks);
      checkBots();
    }

    if (data.msg_type === 'tick') {
      const m = str.match(/"quote":([\d.]+)/);
      if (!m) return;
      const pip = mktState[market.symbol].pip;
      if (pip == null) return;
      const parts = m[1].split('.');
      const last = parts.length === 1 ? 0 : parseInt(parts[1].padEnd(pip,'0')[pip-1]) || 0;
      const ticks = [...mktState[market.symbol].ticks, last].slice(-TICK_WINDOW);
      mktState[market.symbol].ticks = ticks;
      mktState[market.symbol].pct = calcPct(ticks);
      checkBots();
    }
  });

  ws.on('close', () => {
    console.log(`[WS] ${market.name} disconnected — retry in 3s`);
    setTimeout(() => connectMarket(market), 3000);
  });

  ws.on('error', e => { console.error(`[WS] ${market.name} error:`, e.message); ws.terminate(); });

  // Resync every 3 min
  setInterval(() => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ ticks_history: market.symbol, count: 1000, end: 'latest', style: 'ticks' }));
  }, 180000);
}

// ─── START ────────────────────────────────────────────────────────────────────
console.log('🚀 VIKIHUB Bot starting...');
sendMsg(`🚀 <b>VIKIHUB Signal Bot ONLINE</b>\n🕐 ${sriLankaTime()} (SL Time)\nMonitoring 10 markets for 8 bots...`);
ALL_MARKETS.forEach(connectMarket);

// Keep alive for UptimeRobot
http.createServer((req, res) => res.end('VIKIHUB Running')).listen(process.env.PORT || 3000);
