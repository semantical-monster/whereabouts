import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { useQuizStore } from '../store/quizStore';
import { UTAH_COUNTIES } from '../data/utahCounties';
import { STATE_FEATURES } from '../data/features/index.js';
import { isWhitelisted } from '../data/riverWhitelist.js';
import { T } from '../styles/theme';

const CATEGORY_INSTRUCTIONS = {
  counties: 'Drag county name onto the map',
  rivers:   'Drag river name onto its course',
  peaks:    'Drag peak name onto its summit marker',
  parks:    'Drag park name onto its location',
  cities:   'Drag city name onto its location',
};

function FeatureChip({ id, label, onDragStart, onDragEnd, onChipClick, placed, wrong, selected, held }) {
  if (placed) return null;
  const isActive = selected || held;
  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, id)}
      onDragEnd={onDragEnd}
      onClick={() => onChipClick(id)}
      style={{
        padding: '5px 10px',
        background: selected ? 'rgba(196,144,42,0.3)' : held ? 'rgba(196,144,42,0.12)' : wrong ? 'rgba(122,42,26,0.35)' : 'rgba(28,42,58,0.7)',
        border: `1px solid ${isActive ? 'rgba(196,144,42,0.8)' : wrong ? 'rgba(122,42,26,0.6)' : 'rgba(74,106,132,0.4)'}`,
        borderRadius: 4,
        fontFamily: 'Raleway, sans-serif',
        fontSize: 11,
        fontWeight: 500,
        color: isActive ? T.gold : wrong ? '#f0a898' : T.textPrimary,
        cursor: 'pointer',
        userSelect: 'none',
        transition: 'background 0.15s, border 0.15s',
        whiteSpace: 'nowrap',
        outline: selected ? '2px solid rgba(196,144,42,0.5)' : 'none',
        outlineOffset: 1,
      }}
      onMouseOver={e => { if (!wrong && !isActive) e.currentTarget.style.background = 'rgba(74,106,132,0.25)'; }}
      onMouseOut={e => { if (!wrong && !isActive) e.currentTarget.style.background = held ? 'rgba(196,144,42,0.12)' : 'rgba(28,42,58,0.7)'; }}
    >
      {label}
    </div>
  );
}

// Scale city radius by population
function cityRadius(pop) {
  if (pop >= 150000) return 8;
  if (pop >= 80000) return 6;
  if (pop >= 30000) return 5;
  return 4;
}

export default function StateMap() {
  const svgRef = useRef(null);
  const mapContainerRef = useRef(null);
  const projectionRef = useRef(null);

  // Zoom state for peaks mode — ref so zoom changes don't trigger D3 redraws
  const zoomTransformRef = useRef(d3.zoomIdentity);
  const zoomRef = useRef(null);
  const hintTimerRef = useRef(null);

  const [topo, setTopo] = useState(null);
  const [loadedFeatures, setLoadedFeatures] = useState(null);
  const [tooltip, setTooltip] = useState(null);
  const [dragId, setDragId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [wrongIds, setWrongIds] = useState(new Set());
  const [attempts, setAttempts] = useState(0);
  const [firstTryCount, setFirstTryCount] = useState(0);
  const everAttemptedRef = useRef(new Set());
  const [feedback, setFeedbackLocal] = useState(null);
  const feedbackTimer = useRef(null);
  // Zoom scale drives the Reset button and hint visibility (React renders, not D3)
  const [zoomScale, setZoomScale] = useState(1);
  const [showHint, setShowHint] = useState(false);
  // After a wrong drop, dragEnd must not clear dragId so the chip stays highlighted.
  const keepDragIdRef = useRef(false);

  const {
    quizMode,
    addScore, breakStreak,
    correct, wrong, markCorrect, markWrong,
    resetQuiz, setView,
    activeState, activeCategory,
  } = useQuizStore();

  const isDragDrop = quizMode === 'drag-drop';

  useEffect(() => {
    fetch('/counties-10m.json').then(r => r.json()).then(setTopo);
  }, []);

  // Dynamically load per-state feature data (code-split chunk per state)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadedFeatures(null);
    const loader = STATE_FEATURES[activeState?.fips];
    if (!loader) return;
    let cancelled = false;
    loader().then(mod => { if (!cancelled) setLoadedFeatures(mod); }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeState?.fips]);

  // County metadata for the underlay + counties category
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

  // Features for the active non-county layer (loaded dynamically from per-state chunk).
  // Rivers are additionally filtered to drop degenerate stubs (< 0.02° total length)
  // that would render as invisible sub-pixel paths but still produce sidebar chips.
  const categoryFeatures = useMemo(() => {
    const features = loadedFeatures?.[activeCategory]?.features ?? [];
    if (activeCategory !== 'rivers') return features;
    return features.filter(f => {
      const geom = f.geometry;
      if (!geom) return false;
      const chains = geom.type === 'MultiLineString' ? geom.coordinates : [geom.coordinates];
      let total = 0;
      for (const c of chains) {
        for (let i = 1; i < c.length; i++) {
          total += Math.sqrt((c[i][0] - c[i-1][0]) ** 2 + (c[i][1] - c[i-1][1]) ** 2);
        }
      }
      return total >= 0.05 || isWhitelisted(f.properties.name);
    });
  }, [loadedFeatures, activeCategory]);

  // Chips for the sidebar — counties use FIPS as id, others use feature name
  const chipItems = useMemo(() => {
    if (activeCategory === 'counties') {
      return Object.keys(countyMeta)
        .sort((a, b) => countyMeta[a].name.localeCompare(countyMeta[b].name))
        .map(fips => ({ id: fips, label: countyMeta[fips].name }));
    }
    return categoryFeatures
      .map(f => ({ id: f.properties.name, label: f.properties.name + (f.properties.elevation ? ` (${f.properties.elevation.toLocaleString()}ft)` : '') }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [activeCategory, countyMeta, categoryFeatures]);

  // Reset local state when state or category changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAttempts(0);
    setFirstTryCount(0);
    everAttemptedRef.current = new Set();
    setSelectedId(null);
    setWrongIds(new Set());
    setHoveredId(null);
    setTooltip(null);
    setDragId(null);
    keepDragIdRef.current = false;
  }, [activeState?.fips, activeCategory]);

  // Reset zoom transform and manage scroll hint when state or category changes
  useEffect(() => {
    zoomTransformRef.current = d3.zoomIdentity;
    setZoomScale(1);
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    if (activeCategory === 'peaks') {
      setShowHint(true);
      hintTimerRef.current = setTimeout(() => setShowHint(false), 4000);
    } else {
      setShowHint(false);
    }
    return () => {
      if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    };
  }, [activeState?.fips, activeCategory]);

  const flashFeedback = useCallback((text, type) => {
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    setFeedbackLocal({ text, type });
    feedbackTimer.current = setTimeout(() => setFeedbackLocal(null), 1600);
  }, []);

  // ── Build SVG ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!topo || !svgRef.current || !activeState || Object.keys(countyMeta).length === 0) return;

    const W = 680, H = 820;
    const stateFeatures = topojson.feature(topo, topo.objects.counties).features
      .filter(f => f.id.toString().padStart(5, '0').startsWith(activeState.fips));

    const stateFeatureCollection = { type: 'FeatureCollection', features: stateFeatures };
    const projection = activeState?.fips === '02'
      ? d3.geoAlbers()
          .rotate([154, 0])
          .center([-2, 58.5])
          .parallels([55, 65])
          .fitExtent([[16, 16], [W - 16, H - 16]], stateFeatureCollection)
      : d3.geoMercator()
          .fitExtent([[28, 28], [W - 28, H - 28]], stateFeatureCollection);
    projectionRef.current = projection;
    const path = d3.geoPath().projection(projection);

    // Defined inside the effect so it captures fresh selectedId, chipItems etc.
    // The effect re-runs whenever selectedId changes, so no stale closure.
    const handleNonCountyClick = (featureName) => {
      if (!selectedId) return;
      const label = chipItems.find(c => c.id === selectedId)?.label?.split(' (')[0] || selectedId;
      const isFirstTry = !everAttemptedRef.current.has(selectedId);
      everAttemptedRef.current = new Set([...everAttemptedRef.current, selectedId]);
      setAttempts(n => n + 1);
      if (selectedId === featureName) {
        markCorrect(selectedId);
        addScore(120);
        if (isFirstTry) setFirstTryCount(n => n + 1);
        flashFeedback(`✓ ${label}!`, 'correct');
        setWrongIds(s => { const n = new Set(s); n.delete(selectedId); return n; });
      } else {
        markWrong(selectedId);
        breakStreak();
        flashFeedback('Incorrect', 'wrong');
        setWrongIds(s => new Set([...s, selectedId]));
        setTimeout(() => setWrongIds(s => { const n = new Set(s); n.delete(selectedId); return n; }), 1200);
      }
      setSelectedId(null);
    };

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // clipPath clips zoom-group content to the viewBox so county lines
    // don't bleed into the padding area when panning/zooming
    svg.append('defs')
      .append('clipPath').attr('id', 'map-clip')
      .append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', H);

    // Background and dots are always outside the zoom-group
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', T.bgMap).attr('rx', 4);

    for (let x = 18; x < W; x += 22)
      for (let y = 18; y < H; y += 22)
        svg.append('circle').attr('cx', x).attr('cy', y).attr('r', 0.9).attr('fill', 'rgba(0,0,0,0.07)');

    // ── Peaks layer — uses a zoom-group wrapping underlay + markers ───────────
    if (activeCategory === 'peaks') {
      const zoomGroup = svg.append('g').attr('id', 'zoom-group').attr('clip-path', 'url(#map-clip)');

      // County underlay inside zoom-group so it pans/zooms with the peaks
      zoomGroup.append('g').selectAll('path')
        .data(stateFeatures)
        .join('path')
        .attr('d', path)
        .attr('fill', 'transparent')
        .attr('stroke', 'rgba(74,106,132,0.3)')
        .attr('stroke-width', 0.6)
        .attr('pointer-events', 'none');

      const peakGroup = zoomGroup.append('g');
      const k0 = zoomTransformRef.current.k;
      const size = 8;

      categoryFeatures.forEach(f => {
        const name = f.properties.name;
        const [lon, lat] = f.geometry.coordinates;
        const [px, py] = projection([lon, lat]);
        const isCorrect = correct.has(name);
        const isHovered = hoveredId === name;

        // Triangle centered at origin so counter-scale transform keeps it pixel-fixed
        const tri = `M 0,${-size} L ${size * 0.8},${size * 0.5} L ${-size * 0.8},${size * 0.5} Z`;
        peakGroup.append('path')
          .attr('d', tri)
          .attr('transform', `translate(${px},${py}) scale(${1 / k0})`)
          .attr('fill', isCorrect ? T.goldBright : isHovered ? 'rgba(224,168,48,0.7)' : '#5a7a9a')
          .attr('stroke', isCorrect ? T.textPrimary : '#2a4a6a')
          .attr('stroke-width', 1.2)
          .attr('data-id', name)
          .attr('data-px', px)
          .attr('data-py', py)
          .style('cursor', 'crosshair')
          .on('mouseover', function() { setHoveredId(name); })
          .on('mouseout', function() { setHoveredId(null); })
          .on('click', function() { handleNonCountyClick(name); });

      });

      // d3.zoom: scroll-wheel zoom + pan, peaks mode only
      const zoom = d3.zoom()
        .scaleExtent([1, 50])
        .translateExtent([[0, 0], [W, H]])
        .on('zoom', (event) => {
          const t = event.transform;
          zoomTransformRef.current = t;
          setZoomScale(t.k);

          zoomGroup.attr('transform', t);

          // Counter-scale each triangle so it stays pixel-fixed regardless of zoom level
          peakGroup.selectAll('path[data-id]').attr('transform', function() {
            const px = +d3.select(this).attr('data-px');
            const py = +d3.select(this).attr('data-py');
            return `translate(${px},${py}) scale(${1 / t.k})`;
          });

          // Only dismiss the scroll hint on user-initiated zoom, not programmatic restore
          if (event.sourceEvent) {
            setShowHint(false);
            if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
          }
        });

      zoomRef.current = zoom;
      svg.call(zoom);
      // Restore previous zoom transform (prevents snap-back to 1x when a chip is placed)
      svg.call(zoom.transform, zoomTransformRef.current);
    } else {
      // ── County underlay (non-peaks, non-county modes) ──────────────────────
      if (activeCategory !== 'counties') {
        svg.append('g').selectAll('path')
          .data(stateFeatures)
          .join('path')
          .attr('d', path)
          .attr('fill', 'transparent')
          .attr('stroke', 'rgba(74,106,132,0.25)')
          .attr('stroke-width', 0.6)
          .attr('pointer-events', 'none');
      }

      // ── County layer ────────────────────────────────────────────────────────
      if (activeCategory === 'counties') {
        const getCountyFill = (fips) => {
          if (correct.has(fips)) return T.correct;
          if (!isDragDrop && wrong.has(fips)) return T.wrong;
          if (hoveredId === fips && isDragDrop && (dragId || selectedId)) return T.dropTarget;
          return T.countyFill;
        };
        const getCountyStroke = (fips) => {
          if (correct.has(fips)) return '#0a1420';
          if (!isDragDrop && wrong.has(fips)) return '#4a0a0a';
          if (hoveredId === fips && isDragDrop && (dragId || selectedId)) return '#0a3a5a';
          return T.border;
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
          .style('cursor', isDragDrop ? (selectedId ? 'pointer' : 'copy') : 'pointer')
          .attr('data-id', d => d.id.toString().padStart(5, '0'))
          .on('mouseover', function(event, d) {
            const fips = d.id.toString().padStart(5, '0');
            setHoveredId(fips);
            if (!correct.has(fips) && !wrong.has(fips) && !isDragDrop)
              d3.select(this).attr('fill', T.hover);
          })
          .on('mouseout', function(event, d) {
            const fips = d.id.toString().padStart(5, '0');
            setHoveredId(null);
            d3.select(this).attr('fill', getCountyFill(fips));
          })
          .on('click', function(event, d) {
            const fips = d.id.toString().padStart(5, '0');
            if (isDragDrop) {
              if (!selectedId) return;
              const county = countyMeta[selectedId];
              const isFirstTry = !everAttemptedRef.current.has(selectedId);
              everAttemptedRef.current = new Set([...everAttemptedRef.current, selectedId]);
              setAttempts(n => n + 1);
              if (selectedId === fips) {
                markCorrect(selectedId);
                addScore(120);
                if (isFirstTry) setFirstTryCount(n => n + 1);
                flashFeedback(`✓ ${county?.name}!`, 'correct');
                setWrongIds(s => { const n = new Set(s); n.delete(selectedId); return n; });
              } else {
                markWrong(selectedId);
                breakStreak();
                flashFeedback('Incorrect', 'wrong');
                setWrongIds(s => new Set([...s, selectedId]));
                setTimeout(() => setWrongIds(s => { const n = new Set(s); n.delete(selectedId); return n; }), 1200);
              }
              setSelectedId(null);
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

      }

      // ── Rivers layer ────────────────────────────────────────────────────────
      if (activeCategory === 'rivers') {
        const riverGroup = svg.append('g');
        categoryFeatures.forEach(f => {
          const name = f.properties.name;
          const isCorrect = correct.has(name);
          const isHovered = hoveredId === name;
          riverGroup.append('path')
            .datum(f)
            .attr('d', path)
            .attr('fill', 'none')
            .attr('stroke', isCorrect ? T.goldBright : isHovered ? '#5ab0e0' : '#2e7da8')
            .attr('stroke-width', isCorrect ? 3 : isHovered ? 4 : 2)
            .attr('stroke-linecap', 'round')
            .attr('stroke-linejoin', 'round')
            .attr('data-id', name)
            .style('cursor', 'crosshair')
            .on('mouseover', function() { setHoveredId(name); })
            .on('mouseout', function() { setHoveredId(null); })
            .on('click', function() { handleNonCountyClick(name); });
        });
      }

      // ── Parks layer ─────────────────────────────────────────────────────────
      if (activeCategory === 'parks') {
        const parkGroup = svg.append('g');
        categoryFeatures.forEach(f => {
          const name = f.properties.name;
          const [lon, lat] = f.geometry.coordinates;
          const [px, py] = projection([lon, lat]);
          const isCorrect = correct.has(name);
          const isHovered = hoveredId === name;
          parkGroup.append('circle')
            .attr('cx', px).attr('cy', py).attr('r', 10)
            .attr('fill', isCorrect ? 'rgba(224,168,48,0.5)' : isHovered ? 'rgba(74,106,132,0.7)' : 'rgba(74,106,132,0.4)')
            .attr('stroke', isCorrect ? T.goldBright : '#2a4a6a')
            .attr('stroke-width', isCorrect ? 2 : 1.5)
            .attr('data-id', name)
            .style('cursor', 'crosshair')
            .on('mouseover', function() { setHoveredId(name); })
            .on('mouseout', function() { setHoveredId(null); })
            .on('click', function() { handleNonCountyClick(name); });
        });
      }

      // ── Cities layer ─────────────────────────────────────────────────────────
      if (activeCategory === 'cities') {
        const cityGroup = svg.append('g');
        categoryFeatures.forEach(f => {
          const name = f.properties.name;
          const pop = f.properties.pop;
          const [lon, lat] = f.geometry.coordinates;
          const [px, py] = projection([lon, lat]);
          const isCorrect = correct.has(name);
          const isHovered = hoveredId === name;
          const r = cityRadius(pop);
          cityGroup.append('circle')
            .attr('cx', px).attr('cy', py).attr('r', r)
            .attr('fill', isCorrect ? T.goldBright : isHovered ? '#6a9aaa' : '#4a6a84')
            .attr('stroke', '#0a1420')
            .attr('stroke-width', 1)
            .attr('data-id', name)
            .style('cursor', 'crosshair')
            .on('mouseover', function() { setHoveredId(name); })
            .on('mouseout', function() { setHoveredId(null); })
            .on('click', function() { handleNonCountyClick(name); });
        });
      }
    }

    // Border is always drawn outside the zoom-group so it stays fixed
    svg.append('rect').attr('x', 2).attr('y', 2).attr('width', W - 4).attr('height', H - 4)
      .attr('fill', 'none').attr('stroke', T.border).attr('stroke-width', 3)
      .attr('rx', 3).attr('pointer-events', 'none');

    return () => {
      // Always clean up zoom handler before the next effect run
      if (svgRef.current) d3.select(svgRef.current).on('.zoom', null);
    };

  }, [topo, correct, wrong, quizMode, hoveredId, dragId, selectedId, isDragDrop, countyMeta, activeCategory, categoryFeatures, chipItems]);


  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((e, id) => {
    setSelectedId(null);
    setDragId(id);
    keepDragIdRef.current = false;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, []);

  const handleChipClick = useCallback((id) => {
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (activeCategory === 'counties' || activeCategory === 'rivers') {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      setHoveredId(el?.getAttribute('data-id') || null);
    }
  }, [activeCategory]);

  const resolveTarget = useCallback((e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el?.getAttribute('data-id') || null;
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setHoveredId(null);
    const droppedId = e.dataTransfer.getData('text/plain');
    if (!droppedId) return;

    const targetId = resolveTarget(e);
    if (!targetId) { setDragId(null); return; }

    const chipItem = chipItems.find(c => c.id === droppedId);
    const isFirstTry = !everAttemptedRef.current.has(droppedId);
    everAttemptedRef.current = new Set([...everAttemptedRef.current, droppedId]);
    setAttempts(n => n + 1);

    if (droppedId === targetId) {
      setDragId(null);
      markCorrect(droppedId);
      addScore(120);
      if (isFirstTry) setFirstTryCount(n => n + 1);
      flashFeedback(`✓ ${chipItem?.label.split(' (')[0]}!`, 'correct');
      setWrongIds(s => { const n = new Set(s); n.delete(droppedId); return n; });
    } else {
      // Leave dragId set so the chip stays highlighted for immediate re-drag.
      // keepDragIdRef tells handleDragEnd not to clear it.
      keepDragIdRef.current = true;
      markWrong(droppedId);
      breakStreak();
      flashFeedback('Incorrect', 'wrong');
      setWrongIds(s => new Set([...s, droppedId]));
      setTimeout(() => setWrongIds(s => { const n = new Set(s); n.delete(droppedId); return n; }), 1200);
    }
  }, [resolveTarget, chipItems, markCorrect, markWrong, addScore, breakStreak, flashFeedback]);

  // Hover tooltip for all categories. Driven by React onMouseMove so it uses screen
  // coordinates directly. Uses elementFromPoint to identify the hovered data-id.
  const handleMapMouseMove = useCallback((e) => {
    if (dragId) { setTooltip(null); return; }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const id = el?.getAttribute('data-id');
    if (!id || !correct.has(id)) { setTooltip(null); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let tooltipName;
    if (activeCategory === 'counties') {
      const county = countyMeta[id];
      tooltipName = county?.seat ? `${county.name} County · ${county.seat}` : `${(county?.name ?? id)} County`;
    } else {
      const feat = categoryFeatures.find(f => f.properties.name === id);
      tooltipName = id;
      if (activeCategory === 'peaks') {
        const elev = feat?.properties.elevation;
        if (elev) tooltipName = `${id} · ${elev.toLocaleString()} ft`;
      } else if (activeCategory === 'parks') {
        const type = feat?.properties.type;
        if (type) tooltipName = `${id} · ${type}`;
      } else if (activeCategory === 'cities') {
        const pop = feat?.properties.pop;
        if (pop) tooltipName = `${id} · pop. ${pop.toLocaleString()}`;
      }
    }
    setTooltip({ x, y, name: tooltipName, sub: null });
  }, [activeCategory, dragId, correct, categoryFeatures, countyMeta]);

  const handleMapMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleDragEnd = useCallback(() => {
    if (keepDragIdRef.current) {
      keepDragIdRef.current = false; // consumed — dragId stays set for re-drag
    } else {
      setDragId(null);
    }
    setHoveredId(null);
  }, []);


  const handleReset = useCallback(() => {
    resetQuiz();
    setSelectedId(null);
    setDragId(null);
    keepDragIdRef.current = false;
    setAttempts(0);
    setFirstTryCount(0);
    everAttemptedRef.current = new Set();
  }, [resetQuiz]);

  const unplaced = chipItems.filter(c => !correct.has(c.id));
  const total = chipItems.length;
  const identified = correct.size;
  const pct = total > 0 ? Math.round((identified / total) * 100) : 0;
  const categoryLabel = CATEGORY_INSTRUCTIONS[activeCategory] || '';

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── LEFT: Map panel ── */}
      <div
        ref={mapContainerRef}
        style={{
          flex: 1, overflow: 'hidden', background: T.bgMap,
          backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(0,0,0,0.06) 1px, transparent 0)',
          backgroundSize: '22px 22px',
          display: 'flex', flexDirection: 'column', gap: 8, padding: 16,
        }}
        onDragOver={isDragDrop ? handleDragOver : undefined}
        onDrop={isDragDrop ? handleDrop : undefined}
        onDragLeave={() => setHoveredId(null)}
      >
        {feedback && (
          <div style={{
            flexShrink: 0, alignSelf: 'center', background: T.bgTertiary,
            border: `1px solid ${feedback.type === 'correct' ? T.gold : feedback.type === 'wrong' ? T.wrong : T.border}`,
            borderRadius: 4, padding: '7px 20px',
            fontFamily: 'Raleway, sans-serif', fontSize: 13, fontWeight: 500,
            color: feedback.type === 'correct' ? T.gold : feedback.type === 'wrong' ? '#f0a898' : T.textPrimary,
            zIndex: 20, whiteSpace: 'nowrap', textAlign: 'center',
          }}>
            {feedback.text}
          </div>
        )}

        <div
          style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }}
          onClick={e => { if (!e.target.closest('[data-id]')) setDragId(null); }}
          onMouseMove={handleMapMouseMove}
          onMouseLeave={handleMapMouseLeave}
        >
          <svg
            ref={svgRef}
            viewBox="0 0 680 820"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block' }}
          />

          {/* Scroll hint — peaks mode only, dismisses on first scroll or after 4s */}
          {activeCategory === 'peaks' && showHint && (
            <div style={{
              position: 'absolute', bottom: 36, left: '50%', transform: 'translateX(-50%)',
              background: 'rgba(15,25,35,0.9)', border: '1px solid rgba(138,172,196,0.3)',
              borderRadius: 4, padding: '6px 14px', pointerEvents: 'none', zIndex: 8,
              fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary,
              letterSpacing: 0.8, whiteSpace: 'nowrap',
            }}>
              Scroll to zoom in
            </div>
          )}

          {/* Reset zoom button — peaks mode, only when zoomed in */}
          {activeCategory === 'peaks' && zoomScale > 1.1 && (
            <button
              onClick={() => {
                if (zoomRef.current && svgRef.current) {
                  d3.select(svgRef.current).call(zoomRef.current.transform, d3.zoomIdentity);
                }
              }}
              style={{
                position: 'absolute', bottom: 8, left: 8,
                background: T.bgTertiary, border: `1px solid rgba(196,144,42,0.5)`,
                borderRadius: 4, padding: '5px 10px', cursor: 'pointer',
                fontFamily: 'Raleway, sans-serif', fontSize: 9, fontWeight: 600,
                color: T.gold, letterSpacing: 0.8, zIndex: 8,
              }}
            >
              Reset zoom
            </button>
          )}

          {tooltip && (
            <div style={{
              position: 'absolute', left: tooltip.x + 14, top: tooltip.y - 10,
              background: T.bgTertiary, border: `1px solid rgba(138,172,196,0.4)`,
              borderRadius: 4, padding: '6px 12px', pointerEvents: 'none', zIndex: 10,
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 14, color: T.textPrimary, fontWeight: 600 }}>
                {tooltip.name}
              </div>
              {tooltip.sub && (
                <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary, marginTop: 2, letterSpacing: 0.5 }}>
                  {tooltip.sub}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary, fontWeight: 500 }}>
              {identified} / {total} placed
            </span>
            <span style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary, fontWeight: 500 }}>{pct}%</span>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.15)', height: 4, borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: `linear-gradient(90deg, ${T.correct}, ${T.goldBright})`,
              borderRadius: 3, transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      </div>

      {/* ── RIGHT: Sidebar ── */}
      <div style={{ width: 248, background: T.bgSecondary, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }}>
        {/* Score row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '14px 14px 8px' }}>
          {[
            { label: 'First Try', value: `${firstTryCount} / ${total}`, color: T.goldBright },
            { label: 'Attempts', value: attempts, color: T.textSecondary },
          ].map(({ label, value, color }) => (
            <div key={label} style={{
              background: 'rgba(255,255,255,0.04)', borderRadius: 4,
              border: '1px solid rgba(138,172,196,0.15)', padding: '8px 10px',
            }}>
              <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 9, color: T.textSecondary, letterSpacing: 1.5, textTransform: 'uppercase', fontWeight: 600 }}>{label}</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 20, fontWeight: 600, color, marginTop: 2 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Instruction label */}
        <div style={{ padding: '0 14px 10px' }}>
          <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary, background: 'rgba(255,255,255,0.03)', borderRadius: 4, border: '1px solid rgba(138,172,196,0.15)', padding: '7px 10px', lineHeight: 1.5 }}>
            {categoryLabel}
            {selectedId && (
              <div style={{ marginTop: 5, color: T.gold, fontWeight: 600 }}>
                Placing: <strong>{chipItems.find(c => c.id === selectedId)?.label.split(' (')[0]}</strong> — click the map
              </div>
            )}
          </div>
        </div>

        {/* Chip pool */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ position: 'sticky', top: 0, background: T.bgSecondary, paddingBottom: 6, zIndex: 1 }}>
            <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 9, letterSpacing: 2, textTransform: 'uppercase', color: T.textSecondary, fontWeight: 600 }}>
              {unplaced.length} remaining
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {chipItems.filter(c => !correct.has(c.id)).map(({ id, label }) => (
              <FeatureChip
                key={id}
                id={id}
                label={label}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onChipClick={handleChipClick}
                placed={correct.has(id)}
                wrong={wrongIds.has(id)}
                selected={selectedId === id}
                held={dragId === id}
              />
            ))}
          </div>
          {unplaced.length === 0 && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <div style={{ fontSize: 28 }}>🎉</div>
              <div style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: 18, color: T.goldBright, marginTop: 8, fontWeight: 600 }}>All placed!</div>
              <div style={{ fontFamily: 'Raleway, sans-serif', fontSize: 11, color: T.textSecondary, marginTop: 6, lineHeight: 1.8 }}>
                <div>{firstTryCount} / {total} first try</div>
                <div>{attempts} total attempts</div>
              </div>
              <button onClick={handleReset} style={{ marginTop: 12, padding: '8px 16px', background: 'rgba(224,168,48,0.15)', border: '1px solid rgba(224,168,48,0.4)', borderRadius: 4, color: T.goldBright, fontFamily: 'Raleway, sans-serif', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                Play Again
              </button>
            </div>
          )}
        </div>

        {/* Legend + back */}
        <div style={{ padding: 14, borderTop: '1px solid rgba(138,172,196,0.15)' }}>
          {[
            { color: activeCategory === 'counties' ? T.correct : T.goldBright, label: 'Correctly placed' },
            { color: activeCategory === 'counties' ? T.dropTarget : T.hover, label: activeCategory === 'counties' ? 'Drop target' : 'Hover target' },
            { color: activeCategory === 'counties' ? T.countyFill : '#4a6a84', label: 'Unplaced' },
          ].map(({ color, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              <span style={{ fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary }}>{label}</span>
            </div>
          ))}
          <button onClick={() => { handleReset(); setView('usa'); }} style={{
            width: '100%', marginTop: 8, padding: '8px', borderRadius: 4,
            background: 'transparent', border: '1px solid rgba(74,106,132,0.3)',
            fontFamily: 'Raleway, sans-serif', fontSize: 10, color: T.textSecondary, cursor: 'pointer', letterSpacing: 1, fontWeight: 500,
          }}>
            ← All States
          </button>
        </div>
      </div>
    </div>
  );
}
