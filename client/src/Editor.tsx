import { useRef, useState } from 'react';
import { useBoard } from './board';
import { trackPointer, type Point } from './drag';
import { EditField } from './edit';
import { Icon, Logo, type IconName } from './icon';
import { indicatorFor, isListComplete, planItemMove, taskVisual } from './model';
import type { ListItem, Place } from './types';

function statusIcon(visual: ReturnType<typeof taskVisual>): IconName {
  if (visual === 'done') return 'tick';
  if (visual === 'failed') return 'closeCircle';
  if (visual === 'mixed') return 'minusCircle';
  return 'circle';
}

function placeOnItem(point: Point, movingId: string, items: ListItem[], listId: string) {
  const hit = document.elementFromPoint(point.x, point.y)?.closest<HTMLElement>('[data-item-id]');
  const overId = hit?.dataset.itemId;
  if (!hit || !overId) return null;
  const rect = hit.getBoundingClientRect();
  const ratio = rect.height ? (point.y - rect.top) / rect.height : 0.5;
  let place: Place = ratio < 0.5 ? 'before' : 'after';
  if (hit.dataset.kind === 'task' && hit.dataset.root === '1' && ratio > 0.28 && ratio < 0.72) place = 'inside';
  const groups = planItemMove(items, listId, movingId, overId, place);
  if (!groups) return null;
  const inside = place === 'inside' && groups[0]?.parentId === overId ? overId : null;
  return { groups, mark: indicatorFor(groups, movingId, inside) };
}

function ItemRow({ item, depth, mark, onMark, onGhost }: {
  item: ListItem;
  depth: number;
  mark: { overId: string; place: Place } | null;
  onMark: (mark: { overId: string; place: Place } | null) => void;
  onGhost: (ghost: { title: string; x: number; y: number } | null) => void;
}) {
  const board = useBoard();
  const suppress = useRef(false);
  const visual = taskVisual(item, board.items);
  const editing = board.editing?.type === 'item' && board.editing.id === item.id;
  const selected = board.selectedItemId === item.id;

  return (
    <div
      className={['item', selected ? 'selected' : '', visual === 'done' ? 'is-done' : '', visual === 'failed' ? 'is-failed' : '', item.kind === 'comment' ? 'comment' : '', mark?.overId === item.id ? `drop-${mark.place}` : ''].filter(Boolean).join(' ')}
      style={{ ['--depth' as string]: depth }}
      data-item-id={item.id}
      data-kind={item.kind}
      data-root={item.parentId ? '0' : '1'}
      onClick={() => board.selectItem(item.id)}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        board.openEditorMenu(event.clientX, event.clientY, item.id);
      }}
    >
      <span
        key={visual}
        className={`handle status ${visual}`}
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          board.selectItem(item.id);
          trackPointer({
            event,
            holdMs: event.pointerType === 'touch' ? 280 : 0,
            onDragStart: () => onGhost({ title: item.body, x: event.clientX, y: event.clientY }),
            onMove: (point) => {
              onGhost({ title: item.body, x: point.x, y: point.y });
              const shot = board.snapshot();
              onMark(placeOnItem(point, item.id, shot.items, item.listId)?.mark ?? null);
            },
            onEnd: (point, gesture) => {
              if (gesture === 'drag') {
                const shot = board.snapshot();
                const next = placeOnItem(point, item.id, shot.items, item.listId);
                if (next) board.moveItems(item.id, next.groups);
              } else if (gesture === 'click' && item.kind === 'task') board.cycleTask(item.id);
              onGhost(null);
              onMark(null);
            },
          });
        }}
      >
        <Icon name={item.kind === 'comment' ? 'messageEdit' : statusIcon(visual)} />
      </span>
      {editing ? <EditField value={item.body} label="Текст" onCommit={board.commitEdit} onCancel={board.cancelEdit} /> : (
        <button
          type="button"
          className="name"
          onClick={(event) => {
            event.stopPropagation();
            if (suppress.current) { suppress.current = false; return; }
            board.beginRenameItem(item.id);
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'mouse' || event.button !== 0) return;
            const x = event.clientX;
            const y = event.clientY;
            const timer = window.setTimeout(() => {
              suppress.current = true;
              board.openEditorMenu(x, y, item.id);
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
            board.openEditorMenu(event.clientX, event.clientY, item.id);
          }}
        >
          {item.body}
        </button>
      )}
    </div>
  );
}

function ItemBranch({ parentId, listId, depth, mark, onMark, onGhost }: {
  parentId: string | null;
  listId: string;
  depth: number;
  mark: { overId: string; place: Place } | null;
  onMark: (mark: { overId: string; place: Place } | null) => void;
  onGhost: (ghost: { title: string; x: number; y: number } | null) => void;
}) {
  const { items } = useBoard();
  const kids = items.filter((item) => item.listId === listId && item.parentId === parentId).sort((a, b) => a.position - b.position);
  return kids.map((item) => (
    <div key={item.id}>
      <ItemRow item={item} depth={depth} mark={mark} onMark={onMark} onGhost={onGhost} />
      {item.kind === 'task' ? <ItemBranch parentId={item.id} listId={listId} depth={depth + 1} mark={mark} onMark={onMark} onGhost={onGhost} /> : null}
    </div>
  ));
}

export function Editor() {
  const board = useBoard();
  const list = board.nodes.find((node) => node.id === board.openListId && node.kind === 'list') ?? null;
  const [mark, setMark] = useState<{ overId: string; place: Place } | null>(null);
  const [ghost, setGhost] = useState<{ title: string; x: number; y: number } | null>(null);
  const selectedHere = board.items.some((item) => item.id === board.selectedItemId && item.listId === list?.id);

  return (
    <section className="editor" aria-label="Список">
      {list ? (
        <>
          <div className="editor-head">
            <button type="button" className="back icon-button" aria-label="Назад" onClick={() => board.setMobileView('tree')}><Icon name="arrowLeft" /></button>
            <button
                type="button"
                className={isListComplete(list.id, board.items) ? 'list-title complete' : 'list-title'}
                onClick={() => {
                  if (board.selectedNodeId === list.id) board.beginRenameNode(list.id);
                  else board.activateNode(list.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  board.openTreeMenu(event.clientX, event.clientY, list.id);
                }}
              >
                {list.title}
              </button>
          </div>
          <div
            className="items"
            onClick={(event) => {
              const row = (event.target as HTMLElement).closest('[data-item-id]');
              if (!row) board.clearItemSelection();
            }}
            onContextMenu={(event) => {
              if ((event.target as HTMLElement).closest('[data-item-id]')) return;
              event.preventDefault();
              board.openEditorMenu(event.clientX, event.clientY, null);
            }}
          >
            <ItemBranch parentId={null} listId={list.id} depth={0} mark={mark} onMark={setMark} onGhost={setGhost} />
          </div>
          <div className="toolbar">
            <button type="button" aria-label="Добавить задачу" title="Добавить задачу" data-action="add-task" onClick={() => board.createItem('task')}><Icon name="add" /></button>
            <button type="button" aria-label="Добавить подзадачу" title="Добавить подзадачу" data-action="add-subtask" disabled={!board.items.some((item) => item.id === board.selectedItemId && item.listId === list.id && item.kind === 'task')} onClick={() => board.createItem('subtask')}><Icon name="add" /></button>
            <button type="button" aria-label="Добавить комментарий" title="Добавить комментарий" data-action="add-comment" onClick={() => board.createItem('comment')}><Icon name="messageEdit" /></button>
            <button type="button" aria-label="Удалить" title="Удалить" data-action="delete-item" disabled={!selectedHere} onClick={() => board.selectedItemId && board.removeItem(board.selectedItemId)}><Icon name="trash" /></button>
          </div>
        </>
      ) : <div className="editor-empty"><Logo className="gem-faint" /></div>}
      {ghost ? <div className="ghost" style={{ left: ghost.x + 12, top: ghost.y + 12 }}>{ghost.title}</div> : null}
    </section>
  );
}
