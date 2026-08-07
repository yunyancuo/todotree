let zones = [
  { id: 'todo', name: '待完成', order: 0 },
  { id: 'done', name: '已完成', order: 1 },
  { id: 'goals', name: '目标', order: 2 },
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

function allDescendantsSatisfy(id, predicate) {
  const children = getChildren(id);
  if (children.length === 0) return true;
  return children.every(c => predicate(c) && allDescendantsSatisfy(c.id, predicate));
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
      rootId = generateId();
      items.push({ id: rootId, text: line.replace(/^# /, ''), status: 'pending', zone: 'todo', ddl: null, parentId: null, collapsed: false, order: 0 });
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
      statusChangedAt: null, detachedParentId: null, isCopy: false,
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

    if (zone.id !== 'abandoned') {
      const handle = document.createElement('div');
      handle.className = 'zone-resize-handle';
      setupResizeHandle(handle, body);
      section.appendChild(handle);
    }

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
    if (!displayParentId && item.detachedParentId) {
      displayParentId = item.detachedParentId;
    }

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

  nodeDiv.appendChild(numSpan);
  nodeDiv.appendChild(toggleBtn);
  nodeDiv.appendChild(dot);
  nodeDiv.appendChild(textSpan);
  if (item.ddl) nodeDiv.appendChild(ddlSpan);
  nodeDiv.appendChild(deleteBtn);
  nodeDiv.addEventListener('contextmenu', e => { e.preventDefault(); showContextMenu(e, item.id); });
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

function setupResizeHandle(handle, body) {
  let startY, startHeight;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startY = e.clientY;
    startHeight = body.offsetHeight;
    document.addEventListener('mousemove', onResize);
    document.addEventListener('mouseup', onResizeEnd);
  });
  function onResize(e) {
    body.style.height = Math.max(40, startHeight + e.clientY - startY) + 'px';
  }
  function onResizeEnd() {
    document.removeEventListener('mousemove', onResize);
    document.removeEventListener('mouseup', onResizeEnd);
  }
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
  return idx >= 0 ? (idx + 1) : '';
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

  const children = treeData.filter(i => i.parentId === id && !i.detachedParentId);
  if (children.length > 0 && item.zone === 'todo') {
    if (next === 'done' && !allDescendantsSatisfy(id, c => c.status === 'done')) {
      undoStack.pop();
      return;
    }
  }

  if (next === 'abandoned' || next === 'urgent') {
    cascadeStatus(id, next);
  }

  const parent = treeData.find(i => i.id === item.parentId);
  if (next === 'urgent' && parent && item.zone === 'todo') {
    item.detachedParentId = item.parentId;
    item.parentId = null;
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

function cascadeStatus(parentId, status) {
  for (const child of getChildren(parentId)) {
    const c = treeData.find(i => i.id === child.id);
    if (c) {
      c.status = status;
      c.statusChangedAt = Date.now();
      if (status === 'urgent' && c.parentId) {
        c.detachedParentId = c.parentId;
        c.parentId = null;
      }
      cascadeStatus(c.id, status);
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

  const lookupParentId = item.parentId || item.detachedParentId;

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
        i.zone === zone.id &&
        !i.isCopy &&
        (i.parentId === originParentId || i.detachedParentId === originParentId)
      );
      if (!hasItems) {
        treeData = treeData.filter(i => i.id !== copy.id);
      }
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

  const originParentId = item?.detachedParentId || item?.parentId || item?.originParentId;

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
    if (item.isCopy) continue;
    if (item.zone === 'todo') {
      if (item.status === 'done') moveWithParentCopy(item.id, 'done');
      else if (item.status === 'abandoned') moveWithParentCopy(item.id, 'abandoned');
      else if (item.status === 'urgent') item.order = -Date.now();
    }
  }
}

function handleKeydown(e) { if (e.key === 'Enter') addItem(); }

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
function createContextMenu() {
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="context-menu-item" data-action="add-ddl">添加/修改 DDL</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-item danger" data-action="delete">删除</div>
    <div class="context-menu-item danger" data-action="delete-all">删除含子任务</div>
  `;
  return menu;
}
function showContextMenu(e, id) {
  hideContextMenu();
  contextMenuTargetId = id;
  contextMenu = createContextMenu();
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.style.top = e.clientY + 'px';
  document.body.appendChild(contextMenu);
  contextMenu.querySelector('[data-action="delete"]').addEventListener('click', () => { deleteItem(id); hideContextMenu(); });
  contextMenu.querySelector('[data-action="delete-all"]').addEventListener('click', () => { deleteItem(id); hideContextMenu(); });
  contextMenu.querySelector('[data-action="add-ddl"]').addEventListener('click', () => {
    const item = treeData.find(i => i.id === id);
    if (!item) return;
    const current = item.ddl || '';
    const input = prompt('输入截止日期 (YYYY-MM-DD)：', current);
    if (input !== null) {
      const trimmed = input.trim();
      item.ddl = trimmed || null;
      saveToFile().then(() => render());
    }
    hideContextMenu();
  });
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
