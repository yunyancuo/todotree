let zones = [
  { id: 'goals', name: '目标', order: 0 },
  { id: 'todo', name: '待完成', order: 1 },
  { id: 'done', name: '已完成', order: 2 },
  { id: 'abandoned', name: '放弃', order: 3 },
];

const STATUS_CYCLE = ['pending', 'done', 'urgent', 'abandoned'];
const AUTO_MOVE_DELAY = 60000;

let treeData = [];
let zonesContainer;
let newTodoInput;
let ddlInput;
let zoneSelect;
let parentSelect;
let statsEl;
let filePathBar;
let pinned = true;
let headerEl;
let pinBtn;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let moveTimers = {};
let undoStack = [];
const MAX_UNDO = 20;
let undoBtn;
let persistedHeights = {};

function pushUndo() {
  undoStack.push(JSON.parse(JSON.stringify(treeData)));
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  if (undoBtn) undoBtn.disabled = false;
}

async function undo() {
  if (undoStack.length === 0) return;
  treeData = undoStack.pop();
  if (undoBtn) undoBtn.disabled = undoStack.length === 0;
  for (const id of Object.keys(moveTimers)) { clearTimeout(moveTimers[id]); delete moveTimers[id]; }
  await saveToFile();
  render();
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function getChildren(parentId) {
  return treeData.filter(i => i.parentId === parentId && !i.detachedParentId).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function getDescendantIds(parentId) {
  const ids = [];
  for (const child of getChildren(parentId)) {
    ids.push(child.id, ...getDescendantIds(child.id));
  }
  return ids;
}

function getZoneItems(zoneId) {
  return treeData.filter(i => i.zone === zoneId).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function parseMarkdown(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  let rootId = null;
  let currentZone = 'todo';
  let order = 0;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;

    if (/^# /.test(line)) {
      rootId = '__root__';
      order = 1;
      continue;
    }

    if (/^## 待完成/.test(line)) { currentZone = 'todo'; continue; }
    if (/^## 已完成/.test(line)) { currentZone = 'done'; continue; }
    if (/^## 目标/.test(line)) { currentZone = 'goals'; continue; }
    if (/^## 放弃/.test(line)) { currentZone = 'abandoned'; continue; }
    if (/^## /.test(line)) { currentZone = 'todo'; continue; }

    const indent = rawLine.match(/^(\s*)/)[1].length;
    const trimmed = line.trim();
    const match = trimmed.match(/^-\s*\[([^\]]*)\]\s+(.+)/);
    if (!match) continue;

    const statusChar = match[1].trim();
    let ddl = null;
    let taskText = match[2];
    const ddlMatch = taskText.match(/\s*\|\s*ddl:\s*(\d{4}-\d{2}-\d{2})\s*$/);
    if (ddlMatch) { ddl = ddlMatch[1]; taskText = taskText.replace(/\s*\|\s*ddl:\s*\d{4}-\d{2}-\d{2}\s*$/, ''); }

    const statusMap = { 'x': 'done', '!': 'urgent', '>': 'goal', '~': 'abandoned', '': 'pending' };
    const status = statusMap[statusChar] || 'pending';

    const depth = Math.min(Math.floor(indent / 2), 5);
    let parentId = null;
    if (depth > 0) {
      if (depth === 1) {
        parentId = items.filter(i => i.zone === currentZone && !i.parentId && i.id !== rootId).pop()?.id || null;
      } else {
        for (let i = items.length - 1; i >= 0; i--) {
          if (items[i].zone === currentZone) {
            const itemDepth = Math.min(Math.floor((items[i].indent || 0) / 2), 5);
            if (itemDepth === depth - 1) { parentId = items[i].id; break; }
          }
        }
      }
    }

    items.push({
      id: generateId(), text: taskText, status, zone: currentZone,
      ddl, parentId, collapsed: false, order: order++, indent,
      statusChangedAt: null, detachedParentId: null, isCopy: false, urgentOriginalOrder: null,
    });
  }

  return items;
}

function exportMarkdown() {
  const lines = ['# TodoTree', ''];

  for (const zone of zones) {
    lines.push(`## ${zone.name}`);
    lines.push('');

    const zoneItems = getZoneItems(zone.id);
    const topLevelItems = zoneItems.filter(i => !i.parentId && !i.isCopy);

    function writeItems(items, depth = 0) {
      for (const item of items) {
        if (item.isCopy) continue;
        const prefix = '  '.repeat(depth);
        const statusMap = { pending: ' ', done: 'x', urgent: '!', goal: '>', abandoned: '~' };
        const s = statusMap[item.status] || ' ';
        let text = `${prefix}- [${s}] ${item.text}`;
        if (item.ddl) text += ` | ddl:${item.ddl}`;
        lines.push(text);

        const children = zoneItems.filter(i => i.parentId === item.id && !i.isCopy);
        if (children.length > 0) writeItems(children, depth + 1);
      }
    }

    writeItems(topLevelItems);
    lines.push('');
  }

  return lines.join('\n');
}

async function saveToFile() {
  await window.todoAPI.save(exportMarkdown());
}

function render() {
  const savedHeights = {};
  document.querySelectorAll('.zone-body').forEach(body => {
    const section = body.closest('.zone-section');
    const zoneId = section?.dataset?.zoneId;
    if (zoneId && body.style.height) savedHeights[zoneId] = body.style.height;
  });

  zonesContainer.innerHTML = '';
  let totalCount = 0;

  for (const zone of zones) {
    const zoneItems = getZoneItems(zone.id);
    totalCount += zoneItems.filter(i => !i.isCopy).length;

    const section = document.createElement('div');
    section.className = 'zone-section';
    section.dataset.zoneId = zone.id;

    const header = document.createElement('div');
    header.className = 'zone-header';
    header.draggable = true;
    header.innerHTML = `
      <span class="zone-drag-handle">⠿</span>
      <span class="zone-toggle">▼</span>
      <span class="zone-name">${zone.name}</span>
      <span class="zone-count">${zoneItems.filter(i => !i.isCopy).length} 项</span>
    `;

    header.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/zone', zone.id);
      e.dataTransfer.effectAllowed = 'move';
      header.classList.add('dragging');
    });
    header.addEventListener('dragend', () => { header.classList.remove('dragging'); });
    header.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; header.classList.add('drag-over'); });
    header.addEventListener('dragleave', () => { header.classList.remove('drag-over'); });
    header.addEventListener('drop', e => {
      e.preventDefault();
      header.classList.remove('drag-over');
      const fromZoneId = e.dataTransfer.getData('text/zone');
      if (fromZoneId && fromZoneId !== zone.id) {
        const fromIdx = zones.findIndex(z => z.id === fromZoneId);
        const toIdx = zones.findIndex(z => z.id === zone.id);
        if (fromIdx >= 0 && toIdx >= 0) {
          const [moved] = zones.splice(fromIdx, 1);
          zones.splice(toIdx, 0, moved);
          render();
        }
      }
    });

    const clearBtn = document.createElement('button');
    clearBtn.className = 'zone-clear';
    clearBtn.textContent = '清除';
    clearBtn.addEventListener('click', e => { e.stopPropagation(); clearZone(zone.id); });
    header.appendChild(clearBtn);

    const body = document.createElement('div');
    body.className = 'zone-body';

    header.addEventListener('click', () => {
      body.style.display = body.style.display === 'none' ? '' : 'none';
      header.querySelector('.zone-toggle').textContent = body.style.display === 'none' ? '▶' : '▼';
    });

    if (zoneItems.length === 0) {
      body.innerHTML = '<div class="empty-state">暂无</div>';
    } else {
      renderZoneItems(zone.id, zoneItems, body);
    }

    section.appendChild(header);
    section.appendChild(body);

    if (savedHeights[zone.id]) body.style.height = savedHeights[zone.id];
    else if (persistedHeights[zone.id]) body.style.height = persistedHeights[zone.id];

    const handle = document.createElement('div');
    handle.className = 'zone-resize-handle';
    setupResizeHandle(handle, body, zone.id);
    section.appendChild(handle);

    zonesContainer.appendChild(section);
  }

  statsEl.textContent = `共 ${totalCount} 项`;
  updateParentSelect();
}

function renderZoneItems(zoneId, zoneItems, container) {
  const phantomIds = new Set();
  const phantomMap = {};

  const nonPhantom = [];

  for (const item of zoneItems) {
    if (item.isCopy) continue;

    let displayParentId = item.parentId;

    if (displayParentId) {
      const parent = treeData.find(i => i.id === displayParentId);
      if (parent && parent.zone !== zoneId) {
        const phantomKey = displayParentId;
        phantomIds.add(item.id);
        if (!phantomMap[phantomKey]) phantomMap[phantomKey] = { parent, items: [] };
        phantomMap[phantomKey].items.push(item);
        continue;
      }
    }

    nonPhantom.push(item);
  }

  const topLevel = nonPhantom.filter(i => !i.parentId);

  renderItems(zoneItems, topLevel, 0, container);

  for (const key of Object.keys(phantomMap)) {
    const group = phantomMap[key];

    const phantomDiv = document.createElement('div');
    phantomDiv.className = 'tree-node phantom';
    phantomDiv.innerHTML = `<span class="phantom-icon">↳</span><span class="phantom-text">${group.parent.text}</span>`;
    container.appendChild(phantomDiv);

    group.items.sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const item of group.items) {
      renderSingleItem(zoneItems, item, 1, container);
    }
  }
}

function renderSingleItem(allZoneItems, item, depth, container) {
  const hasChildren = allZoneItems.some(c => c.parentId === item.id);
  const isCollapsed = item.collapsed || false;
  const indentClass = depth > 5 ? 'indent-5' : `indent-${depth}`;

  const nodeDiv = document.createElement('div');
  nodeDiv.className = `tree-node ${indentClass}`;
  nodeDiv.dataset.id = item.id;
  nodeDiv.draggable = true;

  nodeDiv.addEventListener('dragstart', e => {
    e.dataTransfer.setData('text/plain', item.id);
    e.dataTransfer.effectAllowed = 'move';
    nodeDiv.classList.add('dragging');
  });
  nodeDiv.addEventListener('dragend', () => { nodeDiv.classList.remove('dragging'); });
  nodeDiv.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; nodeDiv.classList.add('drag-over'); });
  nodeDiv.addEventListener('dragleave', () => { nodeDiv.classList.remove('drag-over'); });
  nodeDiv.addEventListener('drop', e => {
    e.preventDefault();
    nodeDiv.classList.remove('drag-over');
    const fromId = e.dataTransfer.getData('text/plain');
    if (fromId && fromId !== item.id) reorderItems(fromId, item.id);
  });

  const numSpan = document.createElement('span');
  numSpan.className = 'item-num';
  numSpan.textContent = getSiblingIndex(item);
  const zoneColors = { goals: '#89b4fa', todo: '#c9a84c', done: 'rgba(180,200,180,0.7)', abandoned: 'rgba(160,160,160,0.55)' };
  numSpan.style.color = zoneColors[item.zone] || '#c9a84c';

  const toggleBtn = document.createElement('button');
  toggleBtn.className = `toggle-btn${hasChildren ? '' : ' empty'}`;
  toggleBtn.textContent = isCollapsed ? '▶' : '▼';
  toggleBtn.addEventListener('click', e => { e.stopPropagation(); toggleCollapse(item.id); });

  const dot = document.createElement('div');
  dot.className = `status-dot ${item.status}`;
  dot.title = cycleTooltip(item.status);
  dot.addEventListener('click', e => { e.stopPropagation(); cycleStatus(item.id); });

  const textSpan = document.createElement('span');
  textSpan.className = `node-text ${item.status}`;
  textSpan.textContent = item.text;

  const ddlSpan = document.createElement('span');
  if (item.ddl) {
    ddlSpan.className = 'node-ddl';
    const due = new Date(item.ddl);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (due < today) ddlSpan.classList.add('overdue');
    ddlSpan.textContent = item.ddl;
  }

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-delete';
  deleteBtn.textContent = '\u00D7';
  deleteBtn.addEventListener('click', e => { e.stopPropagation(); deleteItem(item.id); });

  nodeDiv.appendChild(dot);
  nodeDiv.appendChild(numSpan);
  nodeDiv.appendChild(toggleBtn);
  nodeDiv.appendChild(textSpan);
  if (item.ddl) nodeDiv.appendChild(ddlSpan);
  nodeDiv.appendChild(deleteBtn);
  nodeDiv.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); showContextMenu(e, item.id); return false; };
  container.appendChild(nodeDiv);

  if (hasChildren && !isCollapsed) {
    const children = allZoneItems.filter(c => c.parentId === item.id);
    for (const child of children) {
      renderSingleItem(allZoneItems, child, depth + 1, container);
    }
  }
}

function renderItems(allZoneItems, items, depth, container) {
  for (const item of items) {
    renderSingleItem(allZoneItems, item, depth, container);
  }
}

function setupResizeHandle(handle, body, zoneId) {
  let startY, startHeight, otherBody, otherStartHeight;
  const zoneIdx = zones.findIndex(z => z.id === zoneId);

  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startY = e.clientY;
    startHeight = body.offsetHeight;

    otherBody = null;
    otherStartHeight = 0;
    if (zoneIdx < zones.length - 1) {
      const nextZoneId = zones[zoneIdx + 1].id;
      const nextBody = document.querySelector(`.zone-section[data-zone-id="${nextZoneId}"] .zone-body`);
      if (nextBody) {
        otherBody = nextBody;
        otherStartHeight = nextBody.offsetHeight;
      }
    }

    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', onResizeEnd);
  });

  function onResize(e) {
    let delta = e.clientY - startY;
    let newH = Math.max(40, startHeight + delta);
    let otherH = otherBody ? Math.max(40, otherStartHeight - delta) : 0;

    if (otherBody && otherH <= 40 && delta > 0) {
      delta = otherStartHeight - 40;
      newH = startHeight + delta;
      otherH = 40;
    }
    if (newH <= 40 && delta < 0 && otherBody) {
      delta = 40 - startHeight;
      newH = 40;
      otherH = otherStartHeight - delta;
    }

    body.style.height = Math.max(40, newH) + 'px';
    if (otherBody) otherBody.style.height = Math.max(40, otherH) + 'px';
  }

  function onResizeEnd() {
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', onResizeEnd);
    persistZoneHeights();
  }
}

async function persistZoneHeights() {
  const heights = {};
  document.querySelectorAll('.zone-body').forEach(body => {
    const section = body.closest('.zone-section');
    const zoneId = section?.dataset?.zoneId;
    if (zoneId && body.style.height) heights[zoneId] = body.style.height;
  });
  persistedHeights = heights;
  await window.todoAPI.saveZoneHeights(heights);
}

async function reorderItems(fromId, toId) {
  const fromItem = treeData.find(i => i.id === fromId);
  const toItem = treeData.find(i => i.id === toId);
  if (!fromItem || !toItem || fromItem.parentId !== toItem.parentId || fromItem.zone !== toItem.zone || fromItem.isCopy || toItem.isCopy) return;

  pushUndo();

  const siblings = treeData.filter(i => i.parentId === fromItem.parentId && i.zone === fromItem.zone && !i.isCopy);
  const fromIdx = siblings.indexOf(fromItem);
  const toIdx = siblings.indexOf(toItem);
  siblings.splice(fromIdx, 1);
  siblings.splice(toIdx, 0, fromItem);
  siblings.forEach((s, i) => { s.order = i + 1; });

  await saveToFile();
  render();
}

function updateItemNumbers() {
  for (const zone of zones) {
    const zoneItems = treeData.filter(i => i.zone === zone.id);
    const topLevel = zoneItems.filter(i => !i.parentId && !i.isCopy);
    topLevel.forEach((item, idx) => { item.order = idx + 1; });
    for (const parent of zoneItems.filter(i => !i.isCopy && zoneItems.some(c => c.parentId === i.id))) {
      const children = zoneItems.filter(i => i.parentId === parent.id && !i.isCopy);
      children.forEach((c, idx) => { c.order = idx + 1; });
    }
  }
}

function getSiblingIndex(item) {
  if (!item) return '';
  const siblings = treeData.filter(i => i.parentId === item.parentId && i.zone === item.zone && !i.isCopy);
  const idx = siblings.indexOf(item);
  if (idx < 0) return '';

  if (!item.parentId) {
    const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
                '十一', '十二', '十三', '十四', '十五', '十六', '十七', '十八', '十九', '二十',
                '二十一', '二十二', '二十三', '二十四', '二十五', '二十六', '二十七', '二十八', '二十九', '三十'];
    return cn[idx] + '、' || (idx + 1);
  }
  return idx + 1;
}

function cycleTooltip(status) {
  return { pending: '待完成 → 点击', done: '已完成 → 点击', urgent: '加急！→ 点击', goal: '目标', abandoned: '放弃 → 点击' }[status] || '';
}

async function cycleStatus(id) {
  const item = treeData.find(i => i.id === id);
  if (!item || item.zone === 'goals' || item.isCopy) return;

  pushUndo();

  const idx = STATUS_CYCLE.indexOf(item.status);
  const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];

  if (next === 'pending' || next === 'done' || next === 'abandoned' || next === 'urgent') {
    cascadeStatus(id, next, true);
  }

  const parent = treeData.find(i => i.id === item.parentId);
  if (next === 'urgent' && item.zone === 'todo') {
    item.urgentOriginalOrder = item.order;
    item.order = -Date.now();
  }
  if (item.status === 'urgent' && next !== 'urgent') {
    item.order = item.urgentOriginalOrder || item.order;
    item.urgentOriginalOrder = null;
  }

  item.status = next;
  item.statusChangedAt = Date.now();

  if (moveTimers[id]) { clearTimeout(moveTimers[id]); delete moveTimers[id]; }
  if (next === 'done' || next === 'urgent' || next === 'abandoned') {
    startAutoMove(id);
  }

  await saveToFile();
  render();
}

function cascadeStatus(parentId, status, fromParent = false) {
  for (const child of getChildren(parentId)) {
    const c = treeData.find(i => i.id === child.id);
    if (c) {
      c.status = status;
      c.statusChangedAt = Date.now();
      if (status === 'urgent' && c.parentId) {
        c.urgentOriginalOrder = c.order;
        c.order = -Date.now();
      }
      if (status !== 'urgent' && c.urgentOriginalOrder) {
        c.order = c.urgentOriginalOrder;
        c.urgentOriginalOrder = null;
      }
      cascadeStatus(c.id, status, false);
    }
  }
}

function startAutoMove(id) {
  moveTimers[id] = setTimeout(async () => {
    await processAutoMove(id);
    delete moveTimers[id];
  }, AUTO_MOVE_DELAY);
}

async function processAutoMove(id) {
  const item = treeData.find(i => i.id === id);
  if (!item) return;

  if (item.status === 'done' && item.zone === 'todo') {
    moveWithParentCopy(id, 'done');
  } else if (item.status === 'abandoned' && item.zone === 'todo') {
    moveWithParentCopy(id, 'abandoned');
  } else if (item.status === 'urgent' && item.zone === 'todo') {
    item.order = -Date.now();
    await saveToFile();
    render();
  }
}

function moveWithParentCopy(id, newZone) {
  const item = treeData.find(i => i.id === id);
  if (!item) return;

  const lookupParentId = item.parentId;

  if (lookupParentId) {
    const existingCopy = treeData.find(i => i.isCopy && i.originParentId === lookupParentId && i.zone === newZone);
    if (!existingCopy) {
      const parent = treeData.find(i => i.id === lookupParentId);
      if (parent && parent.zone !== newZone) {
        treeData.push({
          id: generateId(), text: parent.text, status: parent.status, zone: newZone,
          ddl: parent.ddl, parentId: null, collapsed: false, order: Date.now(),
          statusChangedAt: null, detachedParentId: null, isCopy: true, originParentId: lookupParentId,
        });
      }
    }
  }

  item.zone = newZone;
  moveDescendants(item.id, newZone);
  cleanupOrphanCopies(lookupParentId);

  saveToFile().then(() => render());
}

function moveDescendants(id, newZone) {
  for (const child of getChildren(id)) {
    const c = treeData.find(i => i.id === child.id);
    if (c) {
      c.zone = newZone;
      moveDescendants(c.id, newZone);
    }
  }
}

function cleanupOrphanCopies(originParentId) {
  if (!originParentId) return;
  for (const zone of zones) {
    const copies = treeData.filter(i => i.isCopy && i.originParentId === originParentId && i.zone === zone.id);
    for (const copy of copies) {
      const hasItems = treeData.some(i =>
        i.zone === zone.id && !i.isCopy && i.parentId === originParentId
      );
      if (!hasItems) treeData = treeData.filter(i => i.id !== copy.id);
    }
  }
}

function moveItemToZone(id, newZone) {
  const item = treeData.find(i => i.id === id);
  if (!item) return;
  item.zone = newZone;
  for (const sid of getDescendantIds(id)) {
    const child = treeData.find(i => i.id === sid);
    if (child) child.zone = newZone;
  }
}

async function toggleCollapse(id) {
  const item = treeData.find(i => i.id === id);
  if (!item) return;
  item.collapsed = !item.collapsed;
  render();
}

async function addItem() {
  const text = newTodoInput.value.trim();
  if (!text) return;

  pushUndo();

  const zone = zoneSelect.value || 'todo';
  const parentId = parentSelect.value || null;
  const ddl = ddlInput.value || null;
  const siblings = treeData.filter(i => i.parentId === parentId && i.zone === zone && !i.isCopy);
  const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order || 0), 0);

  treeData.push({
    id: generateId(), text, status: zone === 'goals' ? 'goal' : 'pending',
    zone, ddl, parentId, collapsed: false, order: maxOrder + 1,
    statusChangedAt: null, detachedParentId: null, isCopy: false,
  });

  if (parentId) {
    const parent = treeData.find(i => i.id === parentId);
    if (parent && parent.collapsed) parent.collapsed = false;
  }

  await saveToFile();
  newTodoInput.value = '';
  ddlInput.value = '';
  render();
  newTodoInput.focus();
}

async function deleteItem(id) {
  pushUndo();
  const item = treeData.find(i => i.id === id);
  const descendants = getDescendantIds(id);
  const idsToRemove = [id, ...descendants];

  const originParentId = item?.parentId || item?.originParentId;

  for (const rid of idsToRemove) {
    if (moveTimers[rid]) { clearTimeout(moveTimers[rid]); delete moveTimers[rid]; }
  }
  treeData = treeData.filter(item => !idsToRemove.includes(item.id));

  cleanupOrphanCopies(originParentId);

  await saveToFile();
  render();
}

async function clearZone(zoneId) {
  pushUndo();
  const idsToRemove = treeData.filter(i => i.zone === zoneId && !i.isCopy).map(i => i.id);
  for (const id of idsToRemove) {
    if (moveTimers[id]) { clearTimeout(moveTimers[id]); delete moveTimers[id]; }
    idsToRemove.push(...getDescendantIds(id));
  }
  const copiesToRemove = treeData.filter(i => i.isCopy && i.zone === zoneId).map(i => i.id);
  treeData = treeData.filter(item => !idsToRemove.includes(item.id) && !copiesToRemove.includes(item.id));
  await saveToFile();
  render();
}

function updateParentSelect() {
  const currentValue = parentSelect.value;
  parentSelect.innerHTML = '<option value="">-- 根 --</option>';

  function addOptions(items, depth = 0) {
    for (const item of items) {
      if (item.isCopy) continue;
      const prefix = '  '.repeat(depth) + (depth > 0 ? '├ ' : '');
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = prefix + item.text;
      parentSelect.appendChild(option);
      const children = getChildren(item.id);
      if (children.length > 0) addOptions(children, depth + 1);
    }
  }

  for (const zone of zones) {
    const topLevel = treeData.filter(i => i.zone === zone.id && !i.parentId && !i.isCopy);
    addOptions(topLevel);
  }

  if (currentValue && treeData.some(i => i.id === currentValue)) {
    parentSelect.value = currentValue;
  }
}

async function collapseAll() { treeData.forEach(item => { item.collapsed = true; }); render(); }
async function expandAll() { treeData.forEach(item => { item.collapsed = false; }); render(); }

async function changeFile() {
  const result = await window.todoAPI.changeFile();
  if (result) {
    treeData = parseMarkdown(result.content);
    filePathBar.textContent = result.filePath;
    checkStaleStatuses();
    await saveToFile();
    render();
  }
}

function checkStaleStatuses() {
  for (const item of treeData) {
    if (item.isCopy || item.parentId) continue;
    if (item.zone === 'todo') {
      if (item.status === 'done') moveWithParentCopy(item.id, 'done');
      else if (item.status === 'abandoned') moveWithParentCopy(item.id, 'abandoned');
      else if (item.status === 'urgent') item.order = -Date.now();
    }
  }
}

function handleKeydown(e) { if (e.key === 'Enter') addItem(); }

function showModal(title, defaultValue, callback) {
  window.todoAPI.setFocusable(true);

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${title}</div>
      <input class="modal-input" value="${defaultValue || ''}" autofocus>
      <div class="modal-buttons">
        <button class="modal-btn cancel">取消</button>
        <button class="modal-btn confirm">确定</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.modal-input');
  const confirmBtn = overlay.querySelector('.confirm');
  const cancelBtn = overlay.querySelector('.cancel');

  const cleanup = () => {
    overlay.remove();
    window.todoAPI.setFocusable(false);
  };

  confirmBtn.addEventListener('click', () => { cleanup(); callback(input.value); });
  cancelBtn.addEventListener('click', () => { cleanup(); callback(null); });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) { cleanup(); callback(null); } });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { cleanup(); callback(input.value); }
    if (e.key === 'Escape') { cleanup(); callback(null); }
  });
  setTimeout(() => input.focus(), 50);
}

function updatePinUI() {
  if (pinned) {
    pinBtn.textContent = '📌';
    pinBtn.className = 'btn-icon pinned';
    pinBtn.title = '已锁定 (底层模式) | 点击解锁拖动';
    headerEl.style.cursor = 'default';
    document.body.style.cursor = 'default';
  } else {
    pinBtn.textContent = '📍';
    pinBtn.className = 'btn-icon unpinned';
    pinBtn.title = '已解锁 | 可拖动、吸附、缩放 | 点击锁定';
    headerEl.style.cursor = 'move';
  }
}

function setupDrag() {
  headerEl.addEventListener('mousedown', (e) => {
    if (pinned) return;
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    isDragging = true; dragStartX = e.screenX; dragStartY = e.screenY;
    headerEl.style.cursor = 'grabbing';
  });
  document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const dx = e.screenX - dragStartX, dy = e.screenY - dragStartY;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return;
    dragStartX = e.screenX; dragStartY = e.screenY;
    window.moveBy(dx, dy);
  });
  document.addEventListener('mouseup', async () => {
    if (!isDragging) return;
    isDragging = false;
    if (!pinned) headerEl.style.cursor = 'move';
    const wa = await window.todoAPI.getWorkArea();
    const { screenX: wx, screenY: wy, outerWidth: w, outerHeight: h } = window;
    const SNAP = 15;
    let nx = wx, ny = wy;
    if (Math.abs(wx - wa.x) <= SNAP) nx = wa.x;
    else if (Math.abs((wx + w) - (wa.x + wa.width)) <= SNAP) nx = wa.x + wa.width - w;
    if (Math.abs(wy - wa.y) <= SNAP) ny = wa.y;
    else if (Math.abs((wy + h) - (wa.y + wa.height)) <= SNAP) ny = wa.y + wa.height - h;
    if (nx !== wx || ny !== wy) window.moveTo(nx, ny);
  });
}

async function togglePin() { pinned = await window.todoAPI.togglePin(); updatePinUI(); }

let contextMenu = null;
let contextMenuTargetId = null;
function showContextMenu(e, id) {
  hideContextMenu();
  contextMenuTargetId = id;

  const menu = document.createElement('div');
  menu.className = 'context-menu';

  const addDdl = document.createElement('div');
  addDdl.className = 'context-menu-item';
  addDdl.textContent = '添加/修改 DDL';
  addDdl.onclick = (ev) => {
    ev.stopPropagation();
    hideContextMenu();
    const item = treeData.find(i => i.id === id);
    if (!item) return;
    showModal('截止日期 (YYYY-MM-DD)', item.ddl || '', (val) => {
      if (val !== null) {
        item.ddl = val.trim() || null;
        saveToFile().then(() => render());
      }
    });
  };

  const addChild = document.createElement('div');
  addChild.className = 'context-menu-item';
  addChild.textContent = '添加子任务';
  addChild.onclick = (ev) => {
    ev.stopPropagation();
    hideContextMenu();
    const parent = treeData.find(i => i.id === id);
    if (!parent) return;
    showModal('子任务名称', '', (val) => {
      if (val && val.trim()) {
        const siblings = treeData.filter(i => i.parentId === id && i.zone === parent.zone && !i.isCopy);
        const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order || 0), 0);
        treeData.push({
          id: generateId(), text: val.trim(), status: parent.zone === 'goals' ? 'goal' : 'pending',
          zone: parent.zone, ddl: null, parentId: id, collapsed: false, order: maxOrder + 1,
          statusChangedAt: null, detachedParentId: null, isCopy: false, urgentOriginalOrder: null,
        });
        saveToFile().then(() => render());
      }
    });
  };

  const sep1 = document.createElement('div');
  sep1.className = 'context-menu-separator';

  const del = document.createElement('div');
  del.className = 'context-menu-item danger';
  del.textContent = '删除';
  del.onclick = (ev) => { ev.stopPropagation(); deleteItem(id); hideContextMenu(); };

  const delAll = document.createElement('div');
  delAll.className = 'context-menu-item danger';
  delAll.textContent = '删除含子任务';
  delAll.onclick = (ev) => { ev.stopPropagation(); deleteItem(id); hideContextMenu(); };

  menu.appendChild(addDdl);
  menu.appendChild(addChild);
  menu.appendChild(sep1);
  menu.appendChild(del);
  menu.appendChild(delAll);

  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  document.body.appendChild(menu);
  contextMenu = menu;
}
function hideContextMenu() { if (contextMenu) { contextMenu.remove(); contextMenu = null; } contextMenuTargetId = null; }
document.addEventListener('click', (e) => { if (contextMenu && !contextMenu.contains(e.target)) hideContextMenu(); });
document.addEventListener('contextmenu', (e) => { if (contextMenu && !contextMenu.contains(e.target)) hideContextMenu(); });

window.todoAPI.onPinStateChanged((newPinned) => { pinned = newPinned; updatePinUI(); });

document.addEventListener('DOMContentLoaded', async () => {
  zonesContainer = document.getElementById('zones-container');
  newTodoInput = document.getElementById('new-todo-input');
  ddlInput = document.getElementById('ddl-input');
  zoneSelect = document.getElementById('zone-select');
  parentSelect = document.getElementById('parent-select');
  statsEl = document.getElementById('stats');
  filePathBar = document.getElementById('file-path-bar');
  headerEl = document.querySelector('.header');
  pinBtn = document.getElementById('pin-btn');
  undoBtn = document.getElementById('undo-btn');
  setupDrag();

  const result = await window.todoAPI.load();
  treeData = parseMarkdown(result.content);
  filePathBar.textContent = result.filePath;
  checkStaleStatuses();
  await saveToFile();
  persistedHeights = await window.todoAPI.getZoneHeights();
  render();
  updatePinUI();

  document.getElementById('add-btn').addEventListener('click', addItem);
  document.getElementById('collapse-all').addEventListener('click', collapseAll);
  document.getElementById('expand-all').addEventListener('click', expandAll);
  document.getElementById('open-file-btn').addEventListener('click', changeFile);
  document.getElementById('pin-btn').addEventListener('click', togglePin);
  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('close-btn').addEventListener('click', () => window.todoAPI.closeApp());
  newTodoInput.addEventListener('keydown', handleKeydown);

  const autoStartBtn = document.getElementById('auto-start-btn');
  const autoStartState = await window.todoAPI.getAutoStart();
  if (autoStartState) autoStartBtn.classList.add('active');
  autoStartBtn.addEventListener('click', async () => {
    const state = await window.todoAPI.toggleAutoStart();
    autoStartBtn.classList.toggle('active', state);
  });

  document.getElementById('shortcut-btn').addEventListener('click', async () => {
    const result = await window.todoAPI.createDesktopShortcut();
    if (result.success) { shortcutBtn.textContent = '✅ 已创建'; setTimeout(() => { shortcutBtn.textContent = '🖥 图标'; }, 2000); }
  });
  const shortcutBtn = document.getElementById('shortcut-btn');

  for (const item of treeData) {
    if (!item.isCopy && (item.status === 'done' || item.status === 'urgent' || item.status === 'abandoned') && item.zone === 'todo') {
      startAutoMove(item.id);
    }
  }
});
