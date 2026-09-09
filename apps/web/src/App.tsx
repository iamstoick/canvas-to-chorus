import { Link, Navigate, Route, Routes } from "react-router-dom";
import UploadPage from "./pages/UploadPage";
import QuestionsPage from "./pages/QuestionsPage";
import ResultPage from "./pages/ResultPage";
import SettingsPage from "./pages/SettingsPage";
import GalleryPage from "./pages/GalleryPage";
import SessionsPage from "./pages/SessionsPage";

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="px-6 py-5 flex items-center justify-between max-w-6xl w-full mx-auto">
        <Link to="/" className="font-display text-2xl tracking-tight">
          Canvas <span style={{ color: "var(--color-accent)" }}>to</span> Chorus
        </Link>
        <nav className="flex items-center gap-4">
          <span className="muted text-xs hidden sm:inline">Upload art · ask five questions · get lyrics and a sound</span>
          <Link to="/gallery" className="btn btn-ghost !py-1.5 !px-3 text-xs">My artworks</Link>
          <Link to="/sessions" className="btn btn-ghost !py-1.5 !px-3 text-xs">Sessions</Link>
          <Link to="/settings" className="btn btn-ghost !py-1.5 !px-3 text-xs">Model settings</Link>
        </nav>
      </header>
      <main className="flex-1 px-6 pb-16 max-w-6xl w-full mx-auto">
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/a/:id/questions" element={<QuestionsPage />} />
          <Route path="/a/:id/result" element={<ResultPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/gallery" element={<GalleryPage />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
