import { useState } from 'react';
import { useBoard } from './board';
import { trackPointer } from './drag';
import { Icon, Logo } from './icon';

export function ThemeToggle() {
  const { theme, setTheme } = useBoard();
  return (
    <div className="theme-toggle" role="group" aria-label="Тема">
      <button type="button" aria-label="Тёмная тема" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}><Icon name="moon" /></button>
      <button type="button" aria-label="Светлая тема" aria-pressed={theme === 'light'} onClick={() => setTheme('light')}><Icon name="sun" /></button>
    </div>
  );
}

export function TopBar() {
  const board = useBoard();
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  return (
    <header className="topbar">
      <div className="top-left">
        {board.warning ? (
          <div
            className="warning"
            role="status"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              trackPointer({
                event,
                holdMs: 0,
                onDragStart: () => {
                  board.setDraggingWarning(true);
                  setGhost({ x: event.clientX, y: event.clientY });
                },
                onMove: (point) => {
                  setGhost(point);
                  const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-warning-dock]');
                  board.setWarningHot(Boolean(hit));
                },
                onEnd: (point, gesture) => {
                  board.setDraggingWarning(false);
                  board.setWarningHot(false);
                  setGhost(null);
                  if (gesture !== 'drag') return;
                  const hit = document.elementFromPoint(point.x, point.y)?.closest('[data-warning-dock]');
                  if (hit) board.fileWarning();
                },
              });
            }}
          >
            <Icon name="danger" />
            <span>{board.warning}</span>
          </div>
        ) : <Logo className="brand" />}
        {ghost && board.warning ? <div className="ghost" style={{ left: ghost.x + 8, top: ghost.y + 8 }}>{board.warning}</div> : null}
      </div>
      <div className="top-actions">
        <ThemeToggle />
        <button type="button" className="account" aria-label="Аккаунт" aria-expanded={board.accountOpen} onClick={() => board.setAccountOpen(!board.accountOpen)}>
          {board.user?.picture ? <img src={board.user.picture} alt="" /> : <Icon name="profile" />}
        </button>
      </div>
    </header>
  );
}

export function BottomBar() {
  const { log, warningHot } = useBoard();
  const clock = log ? formatClock(log.at) : '';
  return (
    <footer className={warningHot ? 'bottom hot' : 'bottom'} data-warning-dock>
      <Logo />
      <p className="log" role="status">{log ? `${clock} ${log.message}` : ''}</p>
    </footer>
  );
}

function formatClock(at: number) {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}
