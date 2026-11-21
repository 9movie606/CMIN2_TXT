export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 後台管理介面 (/admin)
    if (path === '/admin') {
      return new Response(renderAdminHTML(), {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // 2. 後台 API：驗證密碼並讀取 KV 原始資料（不設快取，確保編輯時讀取最新資料）
    if (path === '/api/load' && request.method === 'POST') {
      const { password } = await request.json().catch(() => ({}));
      if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
        return jsonResponse({ error: '密碼錯誤或未設定環境變數 ADMIN_PASSWORD' }, 401);
      }
      const rawData = (await env.IP_KV.get('raw_iplist')) || '';
      return jsonResponse({ data: rawData });
    }

    // 3. 後台 API：驗證密碼並寫入 KV
    if (path === '/api/save' && request.method === 'POST') {
      const { password, data } = await request.json().catch(() => ({}));
      if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
        return jsonResponse({ error: '密碼錯誤，拒絕寫入' }, 401);
      }
      await env.IP_KV.put('raw_iplist', data || '');
      return jsonResponse({ success: true });
    }

    // 4. 主入口 (/)：KV 原始資料快取 1 小時 (3600秒)，每次讀取依然即時隨機洗牌輸出
    if (path === '/' || path === '/all_list.txt') {
      const rawData = await env.IP_KV.get('raw_iplist', { cacheTtl: 3600 });
      if (!rawData) {
        return new Response('# 資料庫為空，請先前往 /admin 寫入 IP 列表', {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
          },
        });
      }

      const perRegionCount = parseInt(env.PER_REGION_COUNT || '5', 10);
      const headerNote = (env.HEADER_NOTE || '').trim();
      const resultText = generateRandomList(rawData, perRegionCount, headerNote);

      return new Response(resultText, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        },
      });
    }

    return new Response('Not Found', { status: 404 });
  },
};

// 解析原始列表並執行「每區隨機抽取 N 個 + 全局去重 + 多地區合併備註」
function generateRandomList(rawText, perRegionCount, headerNote) {
  const lines = rawText.split(/\r?\n/);
  let currentRegion = null;
  const regionIps = {};
  const ipRegionsMap = {};

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // 不含點與冒號視為地區標頭
    if (!line.includes('.') && !line.includes(':')) {
      currentRegion = line;
      if (!regionIps[currentRegion]) {
        regionIps[currentRegion] = [];
      }
    } else if (currentRegion) {
      if (!regionIps[currentRegion].includes(line)) {
        regionIps[currentRegion].push(line);
      }
      if (!ipRegionsMap[line]) {
        ipRegionsMap[line] = [];
      }
      if (!ipRegionsMap[line].includes(currentRegion)) {
        ipRegionsMap[line].push(currentRegion);
      }
    }
  }

  const selectedIps = [];
  const seenIps = new Set();

  // 遍歷每個地區，隨機洗牌後抽取最多 perRegionCount 個不重複 IP
  for (const region of Object.keys(regionIps)) {
    const shuffled = shuffleArray([...regionIps[region]]);
    let picked = 0;

    for (const ip of shuffled) {
      if (picked >= perRegionCount) break;
      if (!seenIps.has(ip)) {
        seenIps.add(ip);
        selectedIps.push(ip);
        picked++;
      }
    }
  }

  // 組合輸出格式：IP#地區1-地區2
  const outputLines = [];
  if (headerNote) {
    outputLines.push(headerNote);
  }
  for (const ip of selectedIps) {
    const regionsTag = ipRegionsMap[ip].join('-');
    outputLines.push(`${ip}#${regionsTag}`);
  }

  return outputLines.join('\n') + '\n';
}

// Fisher-Yates 真隨機洗牌演算法
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 後台管理網頁 HTML
function renderAdminHTML() {
  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>IP 列表 KV 管理後台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f172a; color: #f8fafc;
      display: flex; justify-content: center; padding: 20px;
    }
    .box {
      width: 100%; max-width: 760px; background: #1e293b;
      border: 1px solid #334155; border-radius: 12px; padding: 20px;
    }
    h2 { font-size: 1.15rem; margin-bottom: 16px; }
    .row { display: flex; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
    input[type="password"] {
      flex: 1; min-width: 200px; height: 42px; padding: 0 12px;
      background: #0f172a; border: 1px solid #334155; border-radius: 8px;
      color: #fff; font-size: 15px; outline: none;
    }
    input[type="password"]:focus { border-color: #38bdf8; }
    button {
      height: 42px; padding: 0 18px; border: none; border-radius: 8px;
      font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .btn-load { background: #334155; color: #f8fafc; }
    .btn-load:hover { background: #475569; }
    .btn-save { background: #38bdf8; color: #000; }
    .btn-save:hover { background: #0284c7; color: #fff; }
    textarea {
      width: 100%; height: 460px; background: #020617; color: #4ade80;
      border: 1px solid #334155; border-radius: 8px; padding: 12px;
      font-family: ui-monospace, monospace; font-size: 13px; line-height: 1.5;
      resize: vertical; outline: none;
    }
    .status { margin-top: 10px; font-size: 14px; color: #94a3b8; min-height: 20px; }
  </style>
</head>
<body>
  <div class="box">
    <h2>CMIN2 原始 IP 列表編輯器 (KV)</h2>
    <div class="row">
      <input type="password" id="pwd" placeholder="請輸入管理密碼 (ADMIN_PASSWORD)" />
      <button class="btn-load" onclick="loadData()">讀取列表</button>
      <button class="btn-save" onclick="saveData()">保存寫入 KV</button>
    </div>
    <textarea id="editor" placeholder="點擊「讀取列表」載入現有資料，或直接貼上各地區 IP 列表後點擊保存..."></textarea>
    <div class="status" id="status"></div>
  </div>

  <script>
    const statusEl = document.getElementById('status');
    const editorEl = document.getElementById('editor');
    const pwdEl = document.getElementById('pwd');

    async function loadData() {
      const password = pwdEl.value;
      if (!password) return showStatus('請先輸入管理密碼', '#f87171');
      showStatus('讀取中...', '#38bdf8');
      try {
        const res = await fetch('/api/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const json = await res.json();
        if (!res.ok) return showStatus(json.error || '讀取失敗', '#f87171');
        editorEl.value = json.data;
        showStatus('讀取成功！共 ' + json.data.split('\\n').length + ' 行', '#4ade80');
      } catch (e) {
        showStatus('網路請求錯誤', '#f87171');
      }
    }

    async function saveData() {
      const password = pwdEl.value;
      if (!password) return showStatus('請先輸入管理密碼', '#f87171');
      showStatus('正在寫入 KV...', '#38bdf8');
      try {
        const res = await fetch('/api/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password, data: editorEl.value })
        });
        const json = await res.json();
        if (!res.ok) return showStatus(json.error || '保存失敗', '#f87171');
        showStatus('保存成功！（主訂閱因設有1小時快取，最遲1小時內全網同步生效）', '#4ade80');
      } catch (e) {
        showStatus('網路請求錯誤', '#f87171');
      }
    }

    function showStatus(msg, color) {
      statusEl.textContent = msg;
      statusEl.style.color = color;
    }
  </script>
</body>
</html>`;
}
