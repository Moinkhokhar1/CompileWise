import { useEffect, useState } from "react";
import { authedFetch, AuthUser } from "../api";

interface Problem { id: string; title: string; description: string; starterCode: string; }
interface Room { id: string; title: string; code: string; problems: Problem[]; }

export default function FacultyScreen({ user }: { user: AuthUser }) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [showNewRoom, setShowNewRoom] = useState(false);
  const [roomTitle, setRoomTitle] = useState("");

  const [showNewProblem, setShowNewProblem] = useState(false);
  const [problemTitle, setProblemTitle] = useState("");
  const [problemDesc, setProblemDesc] = useState("");
  const [starterCode, setStarterCode] = useState("#include <stdio.h>\n\nint main() {\n    \n    return 0;\n}\n");

  const [progress, setProgress] = useState<any>(null);
  const [loadingProgress, setLoadingProgress] = useState(false);

  // Load faculty's existing rooms on mount — fixes "rooms/problems disappear on refresh".
  useEffect(() => {
    loadRooms();
  }, []);

  async function loadRooms() {
    const data = await authedFetch(user.token, "/api/rooms/mine");
    if (Array.isArray(data)) {
      setRooms(data);
      if (data.length > 0 && !selectedRoomId) setSelectedRoomId(data[0].id);
    }
  }

  async function createRoom() {
    if (!roomTitle.trim()) return;
    await authedFetch(user.token, "/api/rooms", { method: "POST", body: JSON.stringify({ title: roomTitle }) });
    setRoomTitle("");
    setShowNewRoom(false);
    await loadRooms();
  }

  async function createProblem() {
    if (!selectedRoomId || !problemTitle.trim()) return;
    await authedFetch(user.token, "/api/problems", {
      method: "POST",
      body: JSON.stringify({ roomId: selectedRoomId, title: problemTitle, description: problemDesc, starterCode }),
    });
    setProblemTitle("");
    setProblemDesc("");
    setShowNewProblem(false);
    await loadRooms();
  }

  async function loadProgress() {
    if (!selectedRoomId) return;
    setLoadingProgress(true);
    const data = await authedFetch(user.token, `/api/rooms/${selectedRoomId}/progress`);
    setProgress(data);
    setLoadingProgress(false);
  }
  async function deleteRoom(roomId: string, roomTitle: string) {
  if (!confirm(`Delete "${roomTitle}"? This removes all its problems and student progress permanently.`)) return;
  await authedFetch(user.token, `/api/rooms/${roomId}`, { method: "DELETE" });
  if (selectedRoomId === roomId) {
    setSelectedRoomId(null);
    setProgress(null);
  }
  await loadRooms();
}

  useEffect(() => {
    if (selectedRoomId) loadProgress();
  }, [selectedRoomId]);

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  return (
    <div className="page">
      <h2>Your rooms</h2>

      {rooms.map((r) => (
        <div
          key={r.id}
          className={`card card-clickable ${r.id === selectedRoomId ? "card-selected" : ""}`}
          onClick={() => setSelectedRoomId(r.id)}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>{r.title}</strong>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="join-code">{r.code}</span>
              <button
                className="btn-secondary"
                style={{ color: "#b91c1c", padding: "4px 10px", fontSize: 12 }}
                onClick={(e) => {
                  e.stopPropagation(); // don't trigger card selection
                  deleteRoom(r.id, r.title);
                }}
              >
                Delete
              </button>
            </div>
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
            {r.problems.length} problem{r.problems.length === 1 ? "" : "s"}
          </div>
        </div>
      ))}

      {!showNewRoom ? (
        <button className="btn-secondary" onClick={() => setShowNewRoom(true)}>+ New room</button>
      ) : (
        <div className="card">
          <input placeholder="Room title, e.g. CS101 Section A" value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} />
          <button className="btn-primary" onClick={createRoom}>Create room</button>{" "}
          <button className="btn-secondary" onClick={() => setShowNewRoom(false)}>Cancel</button>
        </div>
      )}

      {selectedRoom && (
        <>
          <h2 style={{ marginTop: 32 }}>{selectedRoom.title} — problems</h2>
          {selectedRoom.problems.map((p) => (
            <div key={p.id} className="card">
              <strong>{p.title}</strong>
              <p style={{ fontSize: 13, color: "#64748b" }}>{p.description}</p>
            </div>
          ))}

          {!showNewProblem ? (
            <button className="btn-secondary" onClick={() => setShowNewProblem(true)}>+ Add problem</button>
          ) : (
            <div className="card">
              <input placeholder="Problem title" value={problemTitle} onChange={(e) => setProblemTitle(e.target.value)} />
              <textarea placeholder="Description" value={problemDesc} onChange={(e) => setProblemDesc(e.target.value)} style={{ height: 70 }} />
              <textarea value={starterCode} onChange={(e) => setStarterCode(e.target.value)} style={{ height: 120, fontFamily: "monospace" }} />
              <button className="btn-primary" onClick={createProblem}>Create problem</button>{" "}
              <button className="btn-secondary" onClick={() => setShowNewProblem(false)}>Cancel</button>
            </div>
          )}

          <h2 style={{ marginTop: 32 }}>Student progress</h2>
          <button className="btn-secondary" onClick={loadProgress} disabled={loadingProgress}>
            {loadingProgress ? "Refreshing…" : "Refresh"}
          </button>

          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Problem</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Hints used</th>
                <th>AI patch used</th>
                <th>Error types hit</th>
              </tr>
            </thead>
            <tbody>
              {progress &&
                Object.values(progress).flatMap((student: any, si: number) =>
                  Object.values(student.problems).map((p: any, pi: number) => (
                    <tr key={`${si}-${pi}`}>
                      <td>{student.studentName}</td>
                      <td>{p.title}</td>
                      <td>
                        <span className={`badge ${p.status === "SUCCESS" ? "badge-success" : p.status === "ERROR" ? "badge-error" : "badge-running"}`}>
                          {p.status}
                        </span>
                      </td>
                      <td>{p.totalAttempts}</td>
                      <td>{p.hintsUsed}</td>
                      <td>{p.usedAiPatch ? "Yes" : "No"}</td>
                      <td>
                        {p.errorCategoriesEncountered.map((c: string) => (
                          <span key={c} className="chip">{c}</span>
                        ))}
                      </td>
                    </tr>
                  ))
                )}
              {progress && Object.keys(progress).length === 0 && (
                <tr><td colSpan={7} style={{ color: "#94a3b8" }}>No submissions yet.</td></tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}