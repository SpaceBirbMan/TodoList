import { useMemo, useRef, useState } from 'react';
import { useBoard } from './board';
import { trackPointer, type Point } from './drag';
import { EditField, Highlight } from './edit';
import { Icon, SearchIcon } from './icon';
import { formatEdited, indicatorFor, isNodeComplete, listHasItems, orderedSiblings, planNodeMove, searchView } from './model';
import type { Place, TreeNode } from './types';

function placeOnNode(point: Point, movingId: string, nodes: TreeNode[], items: Parameters<typeof planNodeMove>[1], completedFirst: boolean) {
  const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-node-id]');
  const overId = hit?.dataset.nodeId;
  if (!hit || !overId) return null;
  const rect = hit.getBoundingClientRect();
  const ratio = rect.height ? (point.y - rect.top) / rect.height : 0.5;
  let place: Place = ratio < 0.5 ? 'before' : 'after';
  if (hit.dataset.kind === 'folder' && ratio > 0.28 && ratio < 0.72) place = 'inside';
  const groups = planNodeMove(nodes, items, movingId, overId, place, completedFirst);
  if (!groups) return null;
  const inside = place === 'inside' && groups[0]?.parentId === overId ? overId : null;
  return { groups, mark: indicatorFor(groups, movingId, inside) };
}

function DragRow({ node, depth, open, mark, onMark, onGhost }: {
  node: TreeNode;
  depth: number;
  open: boolean;
  mark: { overId: string; place: Place } | null;
  onMark: (mark: { overId: string; place: Place } | null) => void;
  onGhost: (ghost: { title: string; x: number; y: number } | null) => void;
}) {
  const board = useBoard();
  const suppress = useRef(false);
  const complete = isNodeComplete(node, board.nodes, board.items);
  const icon = node.kind === 'folder' ? (open ? 'folderOpen' : 'folder') : listHasItems(node.id, board.items) ? 'documentText' : 'document';
  const editing = board.editing?.type === 'node' && board.editing.id === node.id;

  return (
    <div
      className={['row', board.selectedNodeId === node.id ? 'selected' : '', complete ? 'complete' : '', mark?.overId === node.id ? `drop-${mark.place}` : ''].filter(Boolean).join(' ')}
      style={{ ['--depth' as string]: depth }}
      data-node-id={node.id}
      data-kind={node.kind}
      role="treeitem"
      aria-selected={board.selectedNodeId === node.id}
      aria-expanded={node.kind === 'folder' ? open : undefined}
      onClick={() => {
        if (board.selectedNodeId === node.id) board.openNode(node.id);
        else board.selectNode(node.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        board.openTreeMenu(event.clientX, event.clientY, node.id);
      }}
    >
      <span
        className="handle"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          trackPointer({
            event,
            holdMs: event.pointerType === 'touch' ? 280 : 0,
            canDrag: () => !board.snapshot().search.trim(),
            onRefuse: () => board.warn('Сначала очистите поиск'),
            onDragStart: () => onGhost({ title: node.title, x: event.clientX, y: event.clientY }),
            onMove: (point) => {
              onGhost({ title: node.title, x: point.x, y: point.y });
              const shot = board.snapshot();
              onMark(placeOnNode(point, node.id, shot.nodes, shot.items, board.completedFirst)?.mark ?? null);
            },
            onEnd: (point, gesture) => {
              if (gesture === 'drag') {
                const shot = board.snapshot();
                const next = placeOnNode(point, node.id, shot.nodes, shot.items, board.completedFirst);
                if (next) board.moveNodes(node.id, next.groups);
              } else if (gesture === 'click') {
                if (board.selectedNodeId === node.id && node.kind === 'folder') board.activateNode(node.id, true);
                else if (board.selectedNodeId === node.id) board.openNode(node.id);
                else board.selectNode(node.id);
              }
              onGhost(null);
              onMark(null);
            },
          });
        }}
      >
        <Icon name={icon} />
      </span>
      {editing ? <EditField value={node.title} label="Название" onCommit={board.commitEdit} onCancel={board.cancelEdit} /> : (
        <span className="title-slot">
        <button
          type="button"
          className="name"
          onClick={(event) => {
            event.stopPropagation();
            if (suppress.current) { suppress.current = false; return; }
            if (node.kind === 'list') board.openNode(node.id);
            else if (board.selectedNodeId === node.id) board.beginRenameNode(node.id);
            else board.selectNode(node.id);
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' || event.button !== 0) return;
            const x = event.clientX;
            const y = event.clientY;
            const timer = window.setTimeout(() => {
              suppress.current = true;
              board.openTreeMenu(x, y, node.id);
            }, 520);
            const move = (ev: PointerEvent) => {
              if (Math.hypot(ev.clientX - x, ev.clientY - y) > 8) window.clearTimeout(timer);
            };
            const up = () => {
              window.clearTimeout(timer);
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            board.openTreeMenu(event.clientX, event.clientY, node.id);
          }}
        >
          <Highlight text={node.title} query={board.search} />
        </button>
        </span>
      )}
      {complete ? <Icon name="tick" className="flag" /> : null}
      {node.kind === 'list' ? <span className="date">{formatEdited(node.updatedAt)}</span> : null}
    </div>
  );
}

function Branch({ parentId, depth, found, cache, mark, onMark, onGhost }: {
  parentId: string | null;
  depth: number;
  found: ReturnType<typeof searchView>;
  cache: Map<string, boolean>;
  mark: { overId: string; place: Place } | null;
  onMark: (mark: { overId: string; place: Place } | null) => void;
  onGhost: (ghost: { title: string; x: number; y: number } | null) => void;
}) {
  const { nodes, items, completedFirst } = useBoard();
  const ordered = orderedSiblings(nodes, items, parentId, completedFirst, cache)
    .filter((node) => !found || found.visible.has(node.id));
  return ordered.map((node) => {
    const open = node.kind === 'folder' && (node.expanded || Boolean(found?.forced.has(node.id)));
    return (
      <div key={node.id}>
        <DragRow node={node} depth={depth} open={open} mark={mark} onMark={onMark} onGhost={onGhost} />
        {open ? (
          <div className="kids">
            <Branch parentId={node.id} depth={depth + 1} found={found} cache={cache} mark={mark} onMark={onMark} onGhost={onGhost} />
          </div>
        ) : null}
      </div>
    );
  });
}

export function TreePanel() {
  const board = useBoard();
  const found = useMemo(() => searchView(board.nodes, board.search), [board.nodes, board.search]);
  const cache = useMemo(() => new Map<string, boolean>(), [board.nodes, board.items]);
  const [mark, setMark] = useState<{ overId: string; place: Place } | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const sortHold = useRef(false);

  return (
    <section className="tree" data-side="right" aria-label="Папки и списки">
      <div className="search-row">
        <label className="search">
          <SearchIcon />
          <input value={board.search} placeholder="Поиск" aria-label="Поиск" onChange={(event) => board.setSearch(event.target.value)} />
        </label>
        <button
          type="button"
          className={board.menu?.area === 'sort' ? 'icon-button is-open' : 'icon-button'}
          aria-label="Сортировать"
          aria-haspopup="menu"
          title="Сортировать"
          onClick={() => {
            if (sortHold.current) { sortHold.current = false; return; }
            board.sortNodes(board.selectedNodeId);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            board.openSortMenu(event.clientX, event.clientY);
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' || event.button !== 0) return;
            const x = event.clientX;
            const y = event.clientY;
            const timer = window.setTimeout(() => {
              sortHold.current = true;
              board.openSortMenu(x, y);
            }, 520);
            const move = (ev: PointerEvent) => {
              if (Math.hypot(ev.clientX - x, ev.clientY - y) > 8) window.clearTimeout(timer);
            };
            const up = () => {
              window.clearTimeout(timer);
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          }}
        >
          <Icon name="sort" />
        </button>
      </div>
      <div
        className="tree-scroll"
        role="tree"
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('.row, button, input')) return;
          board.clearNodeSelection();
        }}
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest('.row')) return;
          event.preventDefault();
          board.openTreeMenu(event.clientX, event.clientY, null);
        }}
      >
        {found && found.visible.size === 0
          ? <p className="empty-note">Ничего не найдено</p>
          : <Branch parentId={null} depth={0} found={found} cache={cache} mark={mark} onMark={setMark} onGhost={setGhost} />}
      </div>
      <div className="toolbar">
        <button type="button" aria-label="Добавить список" title="Добавить список" data-action="add-list" onClick={() => board.createNode('list')}><Icon name="add" /></button>
        <button type="button" aria-label="Добавить папку" title="Добавить папку" data-action="add-folder" onClick={() => board.createNode('folder')}><Icon name="folderAdd" /></button>
        <button type="button" aria-label="Копировать" title="Копировать" data-action="copy-node" disabled={!board.selectedNodeId} onClick={() => board.selectedNodeId && board.copyNode(board.selectedNodeId)}><Icon name="documentCopy" /></button>
        <button type="button" aria-label="Удалить" title="Удалить" data-action="delete-node" disabled={!board.selectedNodeId} onClick={() => board.selectedNodeId && board.askRemove(board.selectedNodeId)}><Icon name="trash" /></button>
      </div>
      {ghost ? <div className="ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>{ghost.title}</div> : null}
    </section>
  );
}
