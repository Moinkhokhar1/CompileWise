import { useEffect, useState } from "react";
import { authedFetch, API_BASE, AuthUser } from "../api";
import CodeWorkspace from "../components/CodeWorkspace";

interface Problem { id: string; title: string; description: string; starterCode: string; }
interface Room { id: string; title: string; code: string; }

const LAST_ROOM_KEY = "cc_last_room_code";

export default function StudentScreen({ user }: { user: AuthUser }) {
  const [joinCode, setJoinCode] = useState("");
  const [room, setRoom] = useState<Room | null>(null);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [selected, setSelected] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rejoin the last room automatically on refresh instead of losing it.
  useEffect(() => {
    const lastCode = localStorage.getItem(LAST_ROOM_KEY);
    if (lastCode) joinRoom(lastCode);
  }, []);

  async function joinRoom(code: string) {
    setError(null);
    const r = await authedFetch(user.token, `/api/rooms/join/${code.toUpperCase()}`, { method: "POST" });
    if (r.error) {
      setError(r.error);
      return;
    }
    setRoom(r);
    localStorage.setItem(LAST_ROOM_KEY, r.code);
    const probs = await authedFetch(user.token, `/api/problems/room/${r.id}`);
    setProblems(Array.isArray(probs) ? probs : []);
  }

  function leaveRoom() {
    localStorage.removeItem(LAST_ROOM_KEY);
    setRoom(null);
    setProblems([]);
    setSelected(null);
  }

  if (selected) {
    return (
      <div className="page">
        <button className="btn-secondary" onClick={() => setSelected(null)} style={{ marginBottom: 12 }}>
          ← Back to problems
        </button>
        <h3>{selected.title}</h3>
        <p style={{ color: "#64748b" }}>{selected.description}</p>
        <CodeWorkspace
          problemId={selected.id}
          starterCode={selected.starterCode}
          authToken={user.token}
          apiBase={API_BASE}
          maxHints={3}
        />
      </div>
    );
  }

  return (
    <div className="page">
      {!room ? (
        <div className="card" style={{ maxWidth: 400 }}>
          <h2>Join a room</h2>
          <input placeholder="Room join code" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
          {error && <div style={{ color: "crimson", fontSize: 13, marginBottom: 8 }}>{error}</div>}
          <button className="btn-primary" onClick={() => joinRoom(joinCode)}>Join</button>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2>{room.title}</h2>
            <button className="btn-secondary" onClick={leaveRoom}>Leave room</button>
          </div>

          <h3 style={{ marginTop: 20 }}>Problems</h3>
          {problems.length === 0 && <p style={{ color: "#94a3b8" }}>No problems posted yet — check back soon.</p>}
          {problems.map((p) => (
            <div key={p.id} className="card">
              <strong>{p.title}</strong>
              <p style={{ fontSize: 13, color: "#64748b" }}>{p.description}</p>
              <button className="btn-primary" onClick={() => setSelected(p)}>Open</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}