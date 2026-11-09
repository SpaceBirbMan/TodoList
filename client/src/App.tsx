import { useEffect, useState } from 'react';
import { useBoard } from './board';
import { Editor } from './Editor';
import { Logo } from './icon';
import { AccountMenu, ConfirmDialog, ContextMenu } from './Overlays';
import { BottomBar, ThemeToggle, TopBar } from './TopBar';
import { TreePanel } from './TreePanel';

function Login() {
  const { loginGoogle, loginPassword, warning } = useBoard();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  return (
    <main className="login">
      <ThemeToggle />
      <div className="login-card">
        <Logo className="login-logo" />
        <div className="auth-toggle" role="group" aria-label="Способ входа">
          <button type="button" aria-pressed={mode === 'login'} onClick={() => setMode('login')}>Вход</button>
          <button type="button" aria-pressed={mode === 'register'} onClick={() => setMode('register')}>Регистрация</button>
        </div>
        <h1>Sapphire</h1>
        {warning ? <p className="login-warning" role="status">{warning}</p> : null}
        <form
          className="login-form"
          onSubmit={(event) => {
            event.preventDefault();
            void loginPassword(login, password, mode);
          }}
        >
          <label>Логин
            <input name="login" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} />
          </label>
          <label>Пароль
            <input name="password" type="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
          <button type="submit" className="btn btn-primary">{mode === 'login' ? 'Войти' : 'Создать аккаунт'}</button>
        </form>
        <button type="button" className="btn btn-cancel login-google" data-action="login-google" onClick={loginGoogle}>Войти через Google</button>
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
      <h1 className="sr-only">Sapphire</h1>
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
