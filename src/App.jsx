import { useRef, useState } from 'react';
import { useQuizStore } from './store/quizStore';
import USAMap from './components/USAMap';
import StateMap from './components/StateMap';
import AboutPage from './components/AboutPage';
import { T } from './styles/theme';
import { useMediaQuery } from './hooks/useMediaQuery';

export default function App() {
  const { view, activeState, activeCategory, score, streak, setView, resetQuiz } = useQuizStore();
  const isMobile = useMediaQuery('(max-width: 768px)');

  // iOS Safari doesn't reliably fire 'click' on tapped elements (see StateMap's
  // withDedupe) — without "All States" on mobile, this logo is the only way back
  // to the USA map, so it needs the same pointerup-primary / click-fallback guard.
  const lastLogoPointerUpAtRef = useRef(0);
  const handleLogoActivate = (event) => {
    if (event.type === 'pointerup') {
      lastLogoPointerUpAtRef.current = Date.now();
    } else if (Date.now() - lastLogoPointerUpAtRef.current < 500) {
      return;
    }
    setView('usa');
    resetQuiz();
  };

  return (
    <div className="app-height" style={{
      background: T.bgPrimary,
      fontFamily: 'Raleway, sans-serif',
      display: 'flex',
      flexDirection: 'column',
    }}>
      <header style={{
        background: T.bgSecondary,
        borderBottom: `3px solid ${T.gold}`,
        padding: isMobile ? '10px 14px' : '14px 28px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
        gap: isMobile ? 10 : 0,
      }}>
        <div
          onClick={handleLogoActivate}
          onPointerUp={handleLogoActivate}
          style={{ cursor: 'pointer', transition: 'filter 0.15s', minWidth: 0 }}
          onMouseEnter={e => { e.currentTarget.style.filter = 'drop-shadow(0 0 6px rgba(196,144,42,0.5))'; }}
          onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}
        >
          <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: isMobile ? 20 : 26, fontWeight: 700, color: T.textPrimary, letterSpacing: -0.5, lineHeight: 1 }}>
            Where<span style={{ color: T.gold }}>abouts</span>
          </div>
          {!isMobile && (
            <div style={{ fontSize: 9, letterSpacing: 3, textTransform: 'uppercase', color: T.textSecondary, marginTop: 3 }}>
              USA · Geography Quest
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: isMobile ? 10 : 24, alignItems: 'center', flexShrink: 0 }}>
          {view === 'state' && activeState && !isMobile && (
            <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 16, color: T.gold, fontWeight: 700, borderLeft: `2px solid rgba(196,144,42,0.4)`, paddingLeft: 16 }}>
              {activeState.name} — {activeCategory.charAt(0).toUpperCase() + activeCategory.slice(1)} Quiz
            </div>
          )}
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: isMobile ? 8 : 9, color: T.textSecondary, letterSpacing: 1, textTransform: 'uppercase' }}>Score</div>
            <div style={{ fontSize: isMobile ? 16 : 22, fontWeight: 700, color: T.goldBright, lineHeight: 1.1 }}>{score.toLocaleString()}</div>
          </div>
          {streak > 0 && (
            <div style={{ background: 'rgba(196,144,42,0.15)', border: '1px solid rgba(196,144,42,0.4)', borderRadius: 4, padding: isMobile ? '4px 8px' : '6px 12px', textAlign: 'center' }}>
              <div style={{ fontSize: isMobile ? 8 : 9, color: T.gold, letterSpacing: 1 }}>STREAK</div>
              <div style={{ fontSize: isMobile ? 14 : 18, fontWeight: 700, color: T.goldBright }}>{streak} 🔥</div>
            </div>
          )}
        </div>
      </header>

      <main style={{ flex: 1, padding: 0, overflow: view === 'about' ? 'visible' : 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        {view === 'usa' ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', flex: 1, minHeight: 0, padding: '12px 0' }}>
            <USAMap />
          </div>
        ) : view === 'state' ? (
          <div style={{ height: '100%', overflow: 'hidden', flex: 1 }}>
            <StateMap />
          </div>
        ) : (
          <AboutPage />
        )}
      </main>

      {/* Footer nav — all views */}
      <footer style={{
        flexShrink: 0,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        padding: '0 20px',
        position: 'relative',
      }}>
        <AboutLink view={view} setView={setView} />
        <span style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'Raleway, sans-serif',
          fontSize: 10,
          color: T.textMuted,
          letterSpacing: 1,
          pointerEvents: 'none',
        }}>
          whereabouts.quest
        </span>
      </footer>
    </div>
  );
}

function AboutLink({ view, setView }) {
  const [hovered, setHovered] = useState(false);
  return (
    <span
      onClick={() => setView(view === 'about' ? 'usa' : 'about')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        fontFamily: 'Raleway, sans-serif',
        fontSize: 10,
        color: hovered ? T.textSecondary : T.textMuted,
        letterSpacing: 1,
        cursor: 'pointer',
        transition: 'color 0.15s',
      }}
    >
      {view === 'about' ? '← Back' : 'About'}
    </span>
  );
}
