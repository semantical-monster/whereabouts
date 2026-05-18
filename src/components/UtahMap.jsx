import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { useQuizStore } from '../store/quizStore';
import { UTAH_COUNTIES } from '../data/utahCounties';

function shuffle(arr) {
  return [...arr].sort(() => Math.random() - 0.5);
}

// ── County chip ────────────────────────────────────────────────────────────────
function CountyChip({ fips, name, onDragStart, onDragEnd, onChipClick, placed, wrong, selected }) {
  if (placed) return null;
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, fips)}
      onDragEnd={onDragEnd}
      onClick={() => onChipClick(fips)}
      style={{
        padding: '5px 10px',
        background: selected ? 'rgba(196,144,42,0.3)' : wrong ? 'rgba(139,58,26,0.35)' : 'rgba(255,255,255,0.07)',
        border: `1px solid ${selected ? 'rgba(196,144,42,0.8)' : wrong ? 'rgba(139,58,26,0.6)' : 'rgba(111,163,122,0.3)'}`,
        borderRadius: 4,
        fontFamily: 'Raleway, sans-serif',
        fontSize: 11,
        fontWeight: 500,
        color: selected ? '#c4902a' : wrong ? '#f0a898' : '#f4ede0',
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s, border 0.15s',
        whiteSpace: 'nowrap',
        outline: selected ? '2px solid rgba(196,144,42,0.5)' : 'none',
        outlineOffset: 1,
      }}
      onMouseOver={e => { if (!wrong && !selected) e.currentTarget.style.background = 'rgba(111,163,122,0.2)'; }}
      onMouseOut={e => { if (!wrong && !selected) e.currentTarget.style.background = 'rgba(255,255,255,0.07)'; }}
    >
      {name}
    </div>
  );
}

export default function UtahMap() {
  const svgRef = useRef(null);
  const mapContainerRef = useRef(null);
  const [topo, setTopo] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [dragFips, setDragFips] = useState(null);
  const [selectedFips, setSelectedFips] = useState(null);
  const [hoveredFips, setHoveredFips] = useState(null);
  const [wrongFips, setWrongFips] = useState(new Set());
  const [attempts, setAttempts] = useState(0);
  const [firstTryCount, setFirstTryCount] = useState(0);
  const everAttemptedRef = useRef(new Set());
  const [feedback, setFeedbackLocal] = useState(null);
  const feedbackTimer = useRef(null);

  const {
    quizMode, setQuizMode,
    score, streak, addScore, breakStreak,
    correct, wrong, markCorrect, markWrong,
    resetQuiz, setView,
    activeState,
  } = useQuizStore();

  const isDragDrop = quizMode === 'drag-drop';

  useEffect(() => {
    fetch('/counties-10m.json').then(r => r.json()).then(setTopo);
  }, []);

  // Build county metadata from TopoJSON + static seat data
  const countyMeta = useMemo(() => {
    if (!topo || !activeState) return {};
    const prefix = activeState.fips;
    const features = topojson.feature(topo, topo.objects.counties).features
      .filter(f => f.id.toString().padStart(5, '0').startsWith(prefix));
    const meta = {};
    features.forEach(f => {
      const fips = f.id.toString().padStart(5, '0');
      const topoName = f.properties?.name || fips;
      const utahData = prefix === '49' ? UTAH_COUNTIES[fips] : null;
      meta[fips] = {
        name: utahData?.name || topoName,
        seat: utahData?.seat || null,
      };
    });
    return meta;
  }, [topo, activeState]);

  // Alphabetical chip order, recomputed when state changes
  const chipOrder = useMemo(() =>
    Object.keys(countyMeta).sort((a, b) => countyMeta[a].name.localeCompare(countyMeta[b].name)),
    [countyMeta]
  );

  // Reset local quiz state when active state changes
  useEffect(() => {
    setAttempts(0);
    setFirstTryCount(0);
    everAttemptedRef.current = new Set();
    setSelectedFips(null);
    setWrongFips(new Set());
    setHoveredFips(null);
    setTooltip(null);
    setDragFips(null);
  }, [activeState?.fips]);

  const flashFeedback = useCallback((text, type) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedbackLocal({ text, type });
    feedbackTimer.current = setTimeout(() => setFeedbackLocal(null), 1600);
  }, []);

  // ── Build SVG map ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!topo || !svgRef.current || !activeState || Object.keys(countyMeta).length === 0) return;

    const W = 680, H = 820;
    const stateFeatures = topojson.feature(topo, topo.objects.counties).features
      .filter(f => f.id.toString().padStart(5, '0').startsWith(activeState.fips));

    const projection = d3.geoMercator().fitExtent([[28, 28], [W - 28, H - 28]], {
      type: 'FeatureCollection', features: stateFeatures,
    });
    const path = d3.geoPath().projection(projection);

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    svg.append('rect').attr('width', W).attr('height', H)
      .attr('fill', '#e8dfc8').attr('rx', 4);

    for (let x = 18; x < W; x += 22)
      for (let y = 18; y < H; y += 22)
        svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 0.9)
          .attr('fill', 'rgba(0,0,0,0.07)');

    const getCountyFill = (fips) => {
      if (correct.has(fips)) return '#4a7c59';
      if (!isDragDrop && wrong.has(fips)) return '#8b3a1a';
      if (hoveredFips === fips && isDragDrop && (dragFips || selectedFips)) return '#2e7da8';
      return '#b8cfa8';
    };

    const getCountyStroke = (fips) => {
      if (correct.has(fips)) return '#1a3a2a';
      if (!isDragDrop && wrong.has(fips)) return '#5a1a0a';
      if (hoveredFips === fips && isDragDrop && (dragFips || selectedFips)) return '#1e4d6b';
      return '#5a8a6a';
    };

    svg.append('g').selectAll('path')
      .data(stateFeatures)
      .join('path')
      .attr('d', path)
      .attr('fill', d => getCountyFill(d.id.toString().padStart(5, '0')))
      .attr('stroke', d => getCountyStroke(d.id.toString().padStart(5, '0')))
      .attr('stroke-width', d => {
        const fips = d.id.toString().padStart(5, '0');
        return (correct.has(fips) || (!isDragDrop && wrong.has(fips))) ? 1.5 : 0.7;
      })
      .style('cursor', isDragDrop ? (selectedFips ? 'pointer' : 'copy') : 'pointer')
      .attr('data-fips', d => d.id.toString().padStart(5, '0'))
      .on('mouseover', function(event, d) {
        const fips = d.id.toString().padStart(5, '0');
        setHoveredFips(fips);
        if (isDragDrop && !correct.has(fips)) return;
        const county = countyMeta[fips];
        if (!county) return;
        setTooltip({
          x: event.offsetX, y: event.offsetY,
          name: county.name + ' County',
          sub: correct.has(fips) && county.seat ? `Seat: ${county.seat}` : correct.has(fips) ? null : 'Click to identify',
        });
        if (!correct.has(fips) && !wrong.has(fips) && !isDragDrop)
          d3.select(this).attr('fill', '#8fbf8a');
      })
      .on('mousemove', function(event) {
        setTooltip(t => t ? { ...t, x: event.offsetX, y: event.offsetY } : null);
      })
      .on('mouseout', function(event, d) {
        const fips = d.id.toString().padStart(5, '0');
        setHoveredFips(null);
        setTooltip(null);
        d3.select(this).attr('fill', getCountyFill(fips));
      })
      .on('click', function(event, d) {
        const fips = d.id.toString().padStart(5, '0');
        if (isDragDrop) {
          if (!selectedFips) return;
          const county = countyMeta[selectedFips];
          const isFirstTry = !everAttemptedRef.current.has(selectedFips);
          everAttemptedRef.current = new Set([...everAttemptedRef.current, selectedFips]);
          setAttempts(n => n + 1);
          if (selectedFips === fips) {
            markCorrect(selectedFips);
            addScore(120);
            if (isFirstTry) setFirstTryCount(n => n + 1);
            flashFeedback(`✓ ${county?.name}!`, 'correct');
            setWrongFips(s => { const n = new Set(s); n.delete(selectedFips); return n; });
          } else {
            markWrong(selectedFips);
            breakStreak();
            flashFeedback('Incorrect', 'wrong');
            setWrongFips(s => new Set([...s, selectedFips]));
            setTimeout(() => setWrongFips(s => { const n = new Set(s); n.delete(selectedFips); return n; }), 1200);
          }
          setSelectedFips(null);
          return;
        }
        const county = countyMeta[fips];
        if (!county) return;
        if (!correct.has(fips)) {
          markCorrect(fips);
          addScore(50);
          flashFeedback(`✓ ${county.name} County`, 'correct');
        } else {
          const sub = county.seat ? `${county.name} · Seat: ${county.seat}` : county.name;
          flashFeedback(sub, 'info');
        }
      });

    // County name labels
    stateFeatures.forEach(d => {
      const fips = d.id.toString().padStart(5, '0');
      const county = countyMeta[fips];
      if (!county) return;
      const centroid = path.centroid(d);
      if (!centroid || isNaN(centroid[0])) return;
      const area = path.area(d);

      const showLabel = isDragDrop ? correct.has(fips) : true;
      if (!showLabel) return;
      if (area < 600) return;

      svg.append('text')
        .attr('x', centroid[0])
        .attr('y', centroid[1] + (area > 3000 ? -7 : 0))
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', area > 4000 ? '10px' : '8px')
        .attr('font-family', 'Raleway, sans-serif')
        .attr('font-weight', '700')
        .attr('fill', correct.has(fips) ? '#f4ede0' : '#1a3a2a')
        .attr('pointer-events', 'none')
        .text(county.name.toUpperCase());

      if (area > 2500 && correct.has(fips) && county.seat) {
        svg.append('text')
          .attr('x', centroid[0]).attr('y', centroid[1] + 8)
          .attr('text-anchor', 'middle')
          .attr('font-size', '8px')
          .attr('font-family', 'Raleway, sans-serif')
          .attr('fill', '#a8d4b4')
          .attr('pointer-events', 'none')
          .text(county.seat);
      }
    });

    // Green border — inside SVG so it never clips
    svg.append('rect')
      .attr('x', 2).attr('y', 2)
      .attr('width', W - 4).attr('height', H - 4)
      .attr('fill', 'none')
      .attr('stroke', '#4a7c59')
      .attr('stroke-width', 3)
      .attr('rx', 3)
      .attr('pointer-events', 'none');

  }, [topo, correct, wrong, quizMode, hoveredFips, dragFips, selectedFips, isDragDrop, countyMeta]);

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e, fips) => {
    setSelectedFips(null);
    setDragFips(fips);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', fips);
  }, []);

  const handleChipClick = useCallback((fips) => {
    setSelectedFips(prev => prev === fips ? null : fips);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    setHoveredFips(el?.getAttribute('data-fips') || null);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const droppedFips = e.dataTransfer.getData('text/plain');
    if (!droppedFips) return;

    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetFips = el?.getAttribute('data-fips');
    if (!targetFips) { setDragFips(null); return; }

    const county = countyMeta[droppedFips];
    const isFirstTry = !everAttemptedRef.current.has(droppedFips);
    everAttemptedRef.current = new Set([...everAttemptedRef.current, droppedFips]);
    setAttempts(n => n + 1);

    if (droppedFips === targetFips) {
      markCorrect(droppedFips);
      addScore(120);
      if (isFirstTry) setFirstTryCount(n => n + 1);
      flashFeedback(`✓ ${county?.name}!`, 'correct');
      setWrongFips(s => { const n = new Set(s); n.delete(droppedFips); return n; });
    } else {
      markWrong(droppedFips);
      breakStreak();
      flashFeedback('Incorrect', 'wrong');
      setWrongFips(s => new Set([...s, droppedFips]));
      setTimeout(() => setWrongFips(s => { const n = new Set(s); n.delete(droppedFips); return n; }), 1200);
    }

    setDragFips(null);
    setHoveredFips(null);
  }, [countyMeta, markCorrect, markWrong, addScore, breakStreak, flashFeedback]);

  const handleDragEnd = useCallback(() => {
    setDragFips(null);
    setHoveredFips(null);
  }, []);

  const handleReset = useCallback(() => {
    resetQuiz();
    setSelectedFips(null);
    setAttempts(0);
    setFirstTryCount(0);
    everAttemptedRef.current = new Set();
  }, [resetQuiz]);

  const unplacedFips = chipOrder.filter(f => !correct.has(f));
  const total = Object.keys(countyMeta).length;
  const identified = correct.size;
  const pct = total > 0 ? Math.round((identified / total) * 100) : 0;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: Map panel ── */}
      <div
        ref={mapContainerRef}
        style={{
          flex: 1,
          overflow: 'hidden',
          background: '#e8e0ce',
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.07) 1px, transparent 0)',
          backgroundSize: '22px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 16,
        }}
        onDragOver={isDragDrop ? handleDragOver : undefined}
        onDrop={isDragDrop ? handleDrop : undefined}
      >
        {feedback && (
          <div style={{
            flexShrink: 0,
            alignSelf: 'center',
            background: '#1a3a2a',
            border: `1px solid ${feedback.type === 'correct' ? '#c4902a' : feedback.type === 'wrong' ? '#8b3a1a' : '#4a7c59'}`,
            borderRadius: 4, padding: '7px 20px',
            fontFamily: 'Raleway, sans-serif', fontSize: 13, fontWeight: 500,
            color: feedback.type === 'correct' ? '#c4902a' : feedback.type === 'wrong' ? '#f0a898' : '#f4ede0',
            zIndex: 20, whiteSpace: 'nowrap', textAlign: 'center',
          }}>
            {feedback.text}
          </div>
        )}

        <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}>
          <svg
            ref={svgRef}
            viewBox="0 0 680 820"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }}
          />
          {tooltip && (
            <div style={{
              position: 'absolute', left: tooltip.x + 14, top: tooltip.y - 10,
              background: '#1a3a2a', border: '1px solid #4a7c59',
              borderRadius: 4, padding: '6px 12px', pointerEvents: 'none', zIndex: 10,
            }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 14, color: '#f4ede0', fontWeight: 600 }}>
                {tooltip.name}
              </div>
              {tooltip.sub && (
                <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: '#6fa37a', marginTop: 2, letterSpacing: 0.5 }}>
                  {tooltip.sub}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: '#4a7c59', fontWeight: 500 }}>
              {identified} / {total} counties placed
            </span>
            <span style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: '#8b5e3c', fontWeight: 500 }}>{pct}%</span>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.15)', height: 4, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: 'linear-gradient(90deg, #4a7c59, #c4902a)',
              borderRadius: 3, transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      </div>

      {/* ── RIGHT: Sidebar ── */}
      <div style={{
        width: 248, background: '#1a3a2a',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden', height: '100%',
      }}>
        {/* Score row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '14px 14px 8px' }}>
          {(isDragDrop ? [
            { label: 'First Try', value: `${firstTryCount} / ${total}`, color: '#c4902a' },
            { label: 'Attempts', value: attempts, color: '#6fa37a' },
          ] : [
            { label: 'Score', value: score.toLocaleString(), color: '#c4902a' },
            { label: 'Streak', value: streak > 0 ? `${streak} 🔥` : '—', color: streak > 2 ? '#f09f38' : '#6fa37a' },
          ]).map(({ label, value, color }) => (
            <div key={label} style={{
              background: 'rgba(255,255,255,0.06)', borderRadius: 4,
              border: '1px solid rgba(111,163,122,0.2)', padding: '8px 10px',
            }}>
              <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 9, color: '#6fa37a', letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Mode selector */}
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#6fa37a', marginBottom: 6, fontWeight: 600 }}>
            Quiz Mode
          </div>
          {[
            { key: 'drag-drop', icon: '✋', label: 'Place & Match', desc: 'Click a name, then click the map' },
            { key: 'click-id',  icon: '🖱',  label: 'Click to Reveal', desc: 'Click any county to identify it' },
          ].map(({ key, icon, label, desc }) => (
            <button key={key} onClick={() => { handleReset(); setQuizMode(key); }} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              width: '100%', padding: '8px 10px', marginBottom: 5,
              background: quizMode === key ? 'rgba(196,144,42,0.18)' : 'transparent',
              border: `1px solid ${quizMode === key ? 'rgba(196,144,42,0.5)' : 'rgba(111,163,122,0.2)'}`,
              borderRadius: 4, cursor: 'pointer', textAlign: 'left',
              fontFamily: 'Raleway, sans-serif',
              color: quizMode === key ? '#c4902a' : '#6fa37a',
              fontSize: 11, transition: 'all 0.12s',
            }}>
              <span style={{ fontSize: 14 }}>{icon}</span>
              <div>
                <div style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }}>{desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Drag-drop chip pool */}
        {isDragDrop && (
          <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ position: 'sticky', top: 0, background: '#1a3a2a', paddingBottom: 6, zIndex: 1 }}>
              <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: '#6fa37a', marginBottom: selectedFips ? 6 : 0, fontWeight: 600 }}>
                {unplacedFips.length} remaining
              </div>
              {selectedFips && (
                <div style={{
                  fontFamily: 'Raleway, sans-serif', fontSize: 10,
                  background: 'rgba(196,144,42,0.15)', border: '1px solid rgba(196,144,42,0.4)',
                  borderRadius: 4, padding: '5px 8px', color: '#c4902a', fontWeight: 500,
                }}>
                  Placing: <strong>{countyMeta[selectedFips]?.name}</strong> — click the map
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {chipOrder.filter(f => !correct.has(f)).map(fips => (
                <CountyChip
                  key={fips}
                  fips={fips}
                  name={countyMeta[fips]?.name}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onChipClick={handleChipClick}
                  placed={correct.has(fips)}
                  wrong={wrongFips.has(fips)}
                  selected={selectedFips === fips}
                />
              ))}
            </div>
            {unplacedFips.length === 0 && (
              <div style={{ textAlign: 'center', padding: 20 }}>
                <div style={{ fontSize: 28 }}>🎉</div>
                <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: '#c4902a', marginTop: 8, fontWeight: 600 }}>All counties placed!</div>
                <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 11, color: '#6fa37a', marginTop: 6, lineHeight: 1.8 }}>
                  <div>{firstTryCount} / {total} first try</div>
                  <div>{attempts} total attempts</div>
                </div>
                <button onClick={handleReset} style={{ marginTop: 12, padding: '8px 16px', background: 'rgba(196,144,42,0.2)', border: '1px solid rgba(196,144,42,0.4)', borderRadius: 4, color: '#c4902a', fontFamily: 'Raleway, sans-serif', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                  Play Again
                </button>
              </div>
            )}
          </div>
        )}

        {/* Click-ID instructions */}
        {!isDragDrop && (
          <div style={{ padding: '0 14px', flex: 1 }}>
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, border: '1px solid rgba(111,163,122,0.2)', padding: 12 }}>
              <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: '#6fa37a', lineHeight: 1.7 }}>
                Click any county on the map to identify it.
                {activeState?.fips === '49' && ' County seat revealed on correct ID.'}
              </div>
            </div>
          </div>
        )}

        {/* Legend + back */}
        <div style={{ padding: 14, borderTop: '1px solid rgba(111,163,122,0.15)' }}>
          {(isDragDrop ? [
            { color: '#4a7c59', label: 'Correctly placed' },
            { color: '#2e7da8', label: 'Drop target' },
            { color: '#b8cfa8', label: 'Unplaced' },
          ] : [
            { color: '#4a7c59', label: 'Correctly placed' },
            { color: '#8b3a1a', label: 'Wrong guess' },
            { color: '#b8cfa8', label: 'Unidentified' },
          ]).map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: '#6fa37a' }}>{label}</span>
            </div>
          ))}
          <button onClick={() => { handleReset(); setView('usa'); }} style={{
            width: '100%', marginTop: 8, padding: '8px', borderRadius: 4,
            background: 'transparent', border: '1px solid rgba(111,163,122,0.3)',
            fontFamily: 'Raleway, sans-serif', fontSize: 10, color: '#6fa37a', cursor: 'pointer', letterSpacing: 1, fontWeight: 500,
          }}>
            ← All States
          </button>
        </div>
      </div>
    </div>
  );
}
