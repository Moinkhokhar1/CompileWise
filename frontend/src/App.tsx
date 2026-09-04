import { useEffect, useState } from "react";
import LoginScreen from "./pages/LoginScreen";
import FacultyScreen from "./pages/FacultyScreen";
import StudentScreen from "./pages/StudentScreen";
import { AuthUser, loadAuth, saveAuth, clearAuth } from "./api";

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checkedStorage, setCheckedStorage] = useState(false);

  useEffect(() => {
    const stored = loadAuth();
    if (stored) setUser(stored);
    setCheckedStorage(true);
  }, []);

  function handleAuth(u: AuthUser) {
    saveAuth(u);
    setUser(u);
  }

  function handleLogout() {
    clearAuth();
    setUser(null);
  }

  if (!checkedStorage) return null; // avoid a login-screen flash while we check localStorage

  if (!user) return <LoginScreen onAuth={handleAuth} />;

  return (
    <div>
      <header className="topbar">
        <span className="brand">Code Learning Platform</span>
        <span className="topbar-user">
          {user.name} · {user.role === "FACULTY" ? "Faculty" : "Student"}
          <button className="btn-ghost" onClick={handleLogout}>Log out</button>
        </span>
      </header>
      {user.role === "FACULTY" ? <FacultyScreen user={user} /> : <StudentScreen user={user} />}
    </div>
  );
}