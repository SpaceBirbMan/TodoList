import type { Group, ListItem, Place, Status, TreeNode } from './types';

export function nextStatus(status: Status): Status {
  if (status === 'empty') return 'done';
  if (status === 'done') return 'failed';
  return 'empty';
}

export function applyStatus(items: ListItem[], id: string, status: Status) {
  const ids = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return items.map((item) => (ids.has(item.id) && item.kind === 'task' ? { ...item, status } : item));
}

export function taskVisual(item: ListItem, items: ListItem[]): Status | 'mixed' {
  if (item.kind !== 'task') return 'empty';
  const kids = items.filter((child) => child.parentId === item.id && child.kind === 'task');
  if (!kids.length) return item.status;
  const visuals = kids.map((child) => taskVisual(child, items));
  const first = visuals[0];
  if (visuals.every((visual) => visual === first) && first !== 'mixed') return first;
  return 'mixed';
}

export function alignParentStatus(items: ListItem[]) {
  const byParent = new Map<string, Status[]>();
  for (const item of items) {
    if (item.kind !== 'task' || !item.parentId) continue;
    const list = byParent.get(item.parentId) ?? [];
    list.push(item.status);
    byParent.set(item.parentId, list);
  }
  return items.map((item) => {
    const kids = byParent.get(item.id);
    if (!kids?.length || item.kind !== 'task') return item;
    const first = kids[0];
    if (!kids.every((status) => status === first) || item.status === first) return item;
    return { ...item, status: first };
  });
}

export function childrenOf(nodes: TreeNode[], parentId: string | null) {
  return nodes
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.title.localeCompare(b.title, 'ru'));
}

export function descendantListIds(nodes: TreeNode[], folderId: string) {
  const byParent = new Map<string, TreeNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = byParent.get(node.parentId) ?? [];
    list.push(node);
    byParent.set(node.parentId, list);
  }
  const out: string[] = [];
  const stack = [...(byParent.get(folderId) ?? [])];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop();
    if (!node || seen.has(node.id)) continue;
    seen.add(node.id);
    if (node.kind === 'list') out.push(node.id);
    else stack.push(...(byParent.get(node.id) ?? []));
  }
  return out;
}

export function isListComplete(listId: string, items: ListItem[]) {
  const tasks = items.filter((item) => item.listId === listId && item.kind === 'task');
  return tasks.length > 0 && tasks.every((task) => task.status === 'done');
}

export function isNodeComplete(node: TreeNode, nodes: TreeNode[], items: ListItem[], cache = new Map<string, boolean>()) {
  const cached = cache.get(node.id);
  if (cached !== undefined) return cached;
  const value = node.kind === 'list'
    ? isListComplete(node.id, items)
    : (() => {
      const lists = descendantListIds(nodes, node.id);
      return lists.length > 0 && lists.every((id) => isListComplete(id, items));
    })();
  cache.set(node.id, value);
  return value;
}

export function listHasItems(listId: string, items: ListItem[]) {
  return items.some((item) => item.listId === listId);
}

export function needsConfirm(node: TreeNode, nodes: TreeNode[], items: ListItem[]) {
  const lists = node.kind === 'list' ? [node.id] : descendantListIds(nodes, node.id);
  return lists.some((id) => items.some((item) => item.listId === id));
}

export function formatEdited(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
}

export function searchView(nodes: TreeNode[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, TreeNode[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const list = children.get(node.parentId) ?? [];
    list.push(node);
    children.set(node.parentId, list);
  }
  const selfMatch = new Set(nodes.filter((node) => node.title.toLowerCase().includes(q)).map((node) => node.id));
  const descMatch = new Map<string, boolean>();
  const hasDescendantMatch = (id: string): boolean => {
    const known = descMatch.get(id);
    if (known !== undefined) return known;
    const ok = (children.get(id) ?? []).some((child) => selfMatch.has(child.id) || hasDescendantMatch(child.id));
    descMatch.set(id, ok);
    return ok;
  };
  const visible = new Set<string>();
  const forced = new Set<string>();
  for (const node of nodes) {
    let ancestorMatch = false;
    let parent = node.parentId;
    while (parent) {
      if (selfMatch.has(parent)) ancestorMatch = true;
      parent = byId.get(parent)?.parentId ?? null;
    }
    if (selfMatch.has(node.id) || ancestorMatch || hasDescendantMatch(node.id)) visible.add(node.id);
  }
  for (const id of selfMatch) {
    let parent = byId.get(id)?.parentId ?? null;
    while (parent) {
      forced.add(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
  }
  return { visible, forced };
}

function isInside(nodes: TreeNode[], ancestorId: string, nodeId: string | null) {
  if (!nodeId) return false;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  let current = byId.get(nodeId);
  const seen = new Set<string>();
  while (current) {
    if (current.id === ancestorId) return true;
    if (seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

export function orderedSiblings(nodes: TreeNode[], items: ListItem[], parentId: string | null, completedFirst: boolean, cache = new Map<string, boolean>()) {
  const kids = childrenOf(nodes, parentId);
  const open = kids.filter((node) => !isNodeComplete(node, nodes, items, cache));
  const done = kids.filter((node) => isNodeComplete(node, nodes, items, cache));
  return completedFirst ? [...done, ...open] : [...open, ...done];
}

export function planNodeMove(nodes: TreeNode[], items: ListItem[], movingId: string, overId: string, place: Place, completedFirst = false): Group[] | null {
  const moving = nodes.find((node) => node.id === movingId);
  const over = nodes.find((node) => node.id === overId);
  if (!moving || !over || moving.id === over.id) return null;
  const cache = new Map<string, boolean>();
  const movingDone = isNodeComplete(moving, nodes, items, cache);
  let destParent: string | null;
  let ordered: TreeNode[];

  if (place === 'inside') {
    if (over.kind !== 'folder' || isInside(nodes, moving.id, over.id)) return null;
    destParent = over.id;
    ordered = orderedSiblings(nodes, items, over.id, completedFirst, cache).filter((node) => node.id !== moving.id);
    const boundary = ordered.findIndex((node) => isNodeComplete(node, nodes, items, cache) !== (completedFirst));
    if (completedFirst) {
      if (movingDone) ordered.splice(boundary < 0 ? ordered.length : boundary, 0, moving);
      else ordered.push(moving);
    } else if (movingDone || boundary < 0) ordered.push(moving);
    else ordered.splice(boundary, 0, moving);
  } else {
    if (isInside(nodes, moving.id, over.parentId)) return null;
    destParent = over.parentId;
    const siblings = orderedSiblings(nodes, items, over.parentId, completedFirst, cache).filter((node) => node.id !== moving.id);
    const overDone = isNodeComplete(over, nodes, items, cache);
    let index: number;
    if (movingDone !== overDone) {
      index = completedFirst
        ? siblings.filter((node) => isNodeComplete(node, nodes, items, cache)).length
        : siblings.filter((node) => !isNodeComplete(node, nodes, items, cache)).length;
    } else {
      const group = siblings.filter((node) => isNodeComplete(node, nodes, items, cache) === movingDone);
      const offset = completedFirst
        ? (movingDone ? 0 : siblings.length - group.length)
        : (movingDone ? siblings.length - group.length : 0);
      const at = group.findIndex((node) => node.id === over.id);
      index = offset + (at < 0 ? group.length : place === 'before' ? at : at + 1);
    }
    ordered = siblings.slice();
    ordered.splice(Math.max(0, Math.min(index, ordered.length)), 0, moving);
  }

  const groups: Group[] = [{ parentId: destParent, orderedIds: ordered.map((node) => node.id) }];
  if (moving.parentId !== destParent) {
    groups.push({
      parentId: moving.parentId,
      orderedIds: orderedSiblings(nodes, items, moving.parentId, completedFirst, cache).filter((node) => node.id !== moving.id).map((node) => node.id),
    });
  }
  const unchanged = groups.every((group) => orderedSiblings(nodes, items, group.parentId, completedFirst, cache).map((node) => node.id).join() === group.orderedIds.join());
  return unchanged ? null : groups;
}

export function planItemMove(items: ListItem[], listId: string, movingId: string, overId: string, place: Place): Group[] | null {
  const moving = items.find((item) => item.id === movingId && item.listId === listId);
  const over = items.find((item) => item.id === overId && item.listId === listId);
  if (!moving || !over || moving.id === over.id) return null;
  const siblings = (parentId: string | null) => items
    .filter((item) => item.listId === listId && item.parentId === parentId)
    .sort((a, b) => a.position - b.position || a.body.localeCompare(b.body, 'ru'));
  const canNest = moving.kind === 'task' && !items.some((item) => item.parentId === moving.id);
  let destParent: string | null;
  let ordered: ListItem[];

  if (place === 'inside') {
    if (!canNest || over.kind !== 'task' || over.parentId) return null;
    destParent = over.id;
    ordered = siblings(destParent).filter((item) => item.id !== moving.id);
    ordered.push(moving);
  } else {
    let target = over;
    if (over.parentId && !canNest) {
      const root = items.find((item) => item.id === over.parentId);
      if (!root) return null;
      target = root;
      destParent = null;
    } else {
      destParent = over.parentId;
    }
    if (destParent && !canNest) return null;
    const rest = siblings(destParent).filter((item) => item.id !== moving.id);
    const index = rest.findIndex((item) => item.id === target.id);
    if (index < 0) return null;
    ordered = rest.slice();
    ordered.splice(place === 'before' ? index : index + 1, 0, moving);
  }

  const groups: Group[] = [{ parentId: destParent, orderedIds: ordered.map((item) => item.id) }];
  if (moving.parentId !== destParent) {
    groups.push({
      parentId: moving.parentId,
      orderedIds: siblings(moving.parentId).filter((item) => item.id !== moving.id).map((item) => item.id),
    });
  }
  const unchanged = groups.every((group) => siblings(group.parentId).map((item) => item.id).join() === group.orderedIds.join());
  return unchanged ? null : groups;
}

export function itemAfterRemoval(items: ListItem[], listId: string, removed: ReadonlySet<string>, selectedId: string): string | null {
  const groups = new Map<string, ListItem[]>();
  for (const item of items) {
    if (item.listId !== listId) continue;
    const key = item.parentId ?? '';
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  for (const group of groups.values()) group.sort((a, b) => a.position - b.position || a.body.localeCompare(b.body, 'ru'));
  const flat: ListItem[] = [];
  const walk = (parentId: string) => {
    for (const item of groups.get(parentId) ?? []) {
      flat.push(item);
      if (item.kind === 'task') walk(item.id);
    }
  };
  walk('');
  const index = flat.findIndex((item) => item.id === selectedId);
  if (index < 0) return null;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (!removed.has(flat[i].id)) return flat[i].id;
  }
  for (let i = index + 1; i < flat.length; i += 1) {
    if (!removed.has(flat[i].id)) return flat[i].id;
  }
  return null;
}

export function indicatorFor(groups: Group[], movingId: string, insideId: string | null) {
  if (insideId) return { overId: insideId, place: 'inside' as const };
  const dest = groups[0];
  if (!dest) return null;
  const index = dest.orderedIds.indexOf(movingId);
  if (index < 0) return null;
  if (index < dest.orderedIds.length - 1) return { overId: dest.orderedIds[index + 1], place: 'before' as const };
  if (index > 0) return { overId: dest.orderedIds[index - 1], place: 'after' as const };
  if (dest.parentId) return { overId: dest.parentId, place: 'inside' as const };
  return null;
}
