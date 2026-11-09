import { useEffect } from 'react';
import { useBoard } from './board';
import { Editor } from './Editor';
import { Logo } from './icon';
import { AccountMenu, ConfirmDialog, ContextMenu } from './Overlays';
import { BottomBar, ThemeToggle, TopBar } from './TopBar';
import { TreePanel } from './TreePanel';

function Login() {
  const { googleEnabled, loginGoogle, loginDev, warning } = useBoard();
  return (
    <main className="login">
      <ThemeToggle />
      <div className="login-card">
        <Logo className="login-logo" />
        <h1>Saphire</h1>
        {warning ? <p className="login-warning" role="status">{warning}</p> : null}
        <button type="button" className="btn btn-primary" data-action="login-google" onClick={loginGoogle}>Войти через Google</button>
        {!googleEnabled ? <button type="button" className="btn btn-cancel" data-action="login-dev" onClick={() => void loginDev()}>Войти на этом компьютере</button> : null}
      </div>
    </main>
  );
}

export function App() {
  const board = useBoard();
  useEffect(() => {
    document.body.classList.toggle('dragging-warning', board.draggingWarning);
    return () => document.body.classList.remove('dragging-warning');
  }, [board.draggingWarning]);
  if (!board.ready) return <main className="login"><p>Загрузка</p></main>;
  if (!board.user) return <Login />;
  return (
    <div className="app" onContextMenu={(event) => event.preventDefault()}>
      <h1 className="sr-only">Saphire</h1>
      <TopBar />
      <div className="workspace" data-view={board.mobileView}>
        <Editor />
        <TreePanel />
      </div>
      <BottomBar />
      <div className={board.warningHot ? 'warning-dock hot' : 'warning-dock'} data-warning-dock />
      <ContextMenu />
      <ConfirmDialog />
      <AccountMenu />
    </div>
  );
}
